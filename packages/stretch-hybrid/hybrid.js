// Hybrid harmonic/percussive time stretch (Driedger & Müller; HPSS after FitzGerald).
// Median-filters the spectrogram along time (harmonic ridge) and frequency
// (percussive spike), Wiener-masks the STFT into two layers, then stretches each
// with the algorithm suited to it: phase-locked vocoder for the harmonic layer,
// short-frame WSOLA for the percussive layer — chords stay coherent AND attacks
// stay sharp, where either algorithm alone must trade one for the other.
//
// References:
// - Driedger, J. & Müller, M. (2016). "A Review of Time-Scale Modification of
//   Music Signals." Applied Sciences 6(2).
// - FitzGerald, D. (2010). "Harmonic/Percussive Separation Using Median Filtering."
//   DAFx-10.

import { fft, ifft } from 'fourier-transform'
import { stft, istft, winSqFloor } from 'fourier-transform/stft'
import wsola from '@audio/stretch-wsola'
import pvocLock from '@audio/stretch-pvoc-lock'
import { writer } from './util.js'

// Median of scratch[0..n) via insertion sort — windows are ~17 wide.
let _med = new Float64Array(0)
function median(arr, n) {
  for (let i = 1; i < n; i++) {
    let v = arr[i], j = i - 1
    while (j >= 0 && arr[j] > v) { arr[j + 1] = arr[j]; j-- }
    arr[j + 1] = v
  }
  return n & 1 ? arr[n >> 1] : 0.5 * (arr[(n >> 1) - 1] + arr[n >> 1])
}

// Mask frames[f] into harmonic h and percussive p spectra: time median over frames
// g0..g1 (the harmonic ridge), frequency median over ±fHalf bins (the percussive spike).
function maskFrame(frames, f, g0, g1, fHalf, half, h, p) {
  if (_med.length < Math.max(g1 - g0 + 1, 2 * fHalf + 1)) _med = new Float64Array(Math.max(g1 - g0 + 1, 2 * fHalf + 1))
  let { re, im, mag } = frames[f]
  for (let k = 0; k <= half; k++) {
    let c = 0
    for (let g = g0; g <= g1; g++) _med[c++] = frames[g].mag[k]
    let H = median(_med, c)
    let k0 = Math.max(0, k - fHalf), k1 = Math.min(half, k + fHalf)
    c = 0
    for (let b = k0; b <= k1; b++) _med[c++] = mag[b]
    let P = median(_med, c)
    // hard-ish separation (power 4): soft masks leak the tonal bed into the
    // percussive layer, where OLA then modulates it
    let h4 = H * H * H * H, p4 = P * P * P * P, denom = h4 + p4
    let mH = denom > 1e-40 ? h4 / denom : 0.5
    h.re[k] = re[k] * mH; h.im[k] = im[k] * mH
    p.re[k] = re[k] - h.re[k]; p.im[k] = im[k] - h.im[k]   // masks sum to 1
  }
}

// Split data into [harmonic, percussive] via median-filter HPSS + power-Wiener masks.
function hpssSplit(data, N, hop, tMed, fMed) {
  let frames = stft(data, { frameSize: N, hopSize: hop })
  let nF = frames.length, half = N >> 1, tHalf = tMed >> 1, fHalf = fMed >> 1
  let hFrames = new Array(nF), pFrames = new Array(nF)
  for (let f = 0; f < nF; f++) {
    let h = { re: new Float64Array(half + 1), im: new Float64Array(half + 1), time: frames[f].time }
    let p = { re: new Float64Array(half + 1), im: new Float64Array(half + 1), time: frames[f].time }
    maskFrame(frames, f, Math.max(0, f - tHalf), Math.min(nF - 1, f + tHalf), fHalf, half, h, p)
    hFrames[f] = h; pFrames[f] = p
  }
  let harm = istft(hFrames, { frameSize: N, hopSize: hop, signalLength: data.length })
  let perc = istft(pFrames, { frameSize: N, hopSize: hop, signalLength: data.length })
  return [new Float32Array(harm), new Float32Array(perc)]
}

function hybridBatch(data, opts) {
  let factor = opts?.factor ?? 1
  if (factor === 1) return new Float32Array(data)

  let frameSize = opts?.frameSize ?? 2048
  let hopSize = opts?.hopSize ?? (frameSize >> 2)
  let percFrame = opts?.percFrame ?? 512
  let tMed = opts?.harmMedian ?? 17
  let fMed = opts?.percMedian ?? 17

  let [harm, perc] = hpssSplit(data, frameSize, hopSize, tMed, fMed)
  let yh = pvocLock(harm, { factor, frameSize, hopSize })
  // plain short-frame OLA (delta:0 — no correlation search): attacks repeat cleanly
  // instead of being hunted for; percussive residue has no phase to preserve
  let yp = wsola(perc, { factor, frameSize: percFrame, delta: 0 })

  let outLen = Math.round(data.length * factor)
  let out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    out[i] = (i < yh.length ? yh[i] : 0) + (i < yp.length ? yp[i] : 0)
  }
  return out
}

// Growable sample queue with an absolute start index.
function queue(Type = Float32Array) {
  let q = { buf: new Type(4096), start: 0, len: 0 }
  q.push = chunk => {
    if (q.len + chunk.length > q.buf.length) { let b = new Type(Math.max(2 * q.buf.length, q.len + chunk.length)); b.set(q.buf.subarray(0, q.len)); q.buf = b }
    q.buf.set(chunk, q.len); q.len += chunk.length
  }
  q.drop = n => { q.buf.copyWithin(0, n, q.len); q.buf.fill(0, q.len - n, q.len); q.len -= n; q.start += n }
  return q
}

// hpssSplit, run incrementally: frame k (input k·hop − N ..< k·hop, zero outside the
// signal) is analyzed once its input is in, masked once its time-median window is, and
// overlap-added; a sample is emitted once every frame covering it has been. Same
// frames, same arithmetic: the layers equal the batch split under any chunking.
function hpssStream(N, hop, tMed, fMed, onLayers) {
  let half = N >> 1, tHalf = tMed >> 1, fHalf = fMed >> 1
  let win = new Float64Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 * (1 - Math.cos(Math.PI * 2 * i / N))
  let floor = winSqFloor(win, hop)
  let input = queue(), frames = [], first = 0          // frames[0] is frame `first`
  let nextFrame = 0, nextMask = 0, fed = 0
  let hAcc = queue(Float64Array), pAcc = queue(Float64Array), nAcc = queue(Float64Array)
  let f = new Float64Array(N), re = new Float64Array(half + 1), im = new Float64Array(half + 1)
  let h = { re: new Float64Array(half + 1), im: new Float64Array(half + 1) }, p = { re: new Float64Array(half + 1), im: new Float64Array(half + 1) }

  function analyze(k, len) {
    for (let i = 0; i < N; i++) {
      let j = k * hop - N + i
      f[i] = (j >= 0 && j < len ? input.buf[j - input.start] : 0) * win[i]
    }
    let [r, m] = fft(f, [re, im])
    let frame = { re: new Float64Array(r), im: new Float64Array(m), mag: new Float64Array(half + 1) }
    for (let k = 0; k <= half; k++) frame.mag[k] = Math.sqrt(frame.re[k] * frame.re[k] + frame.im[k] * frame.im[k])
    frames.push(frame); nextFrame++
  }

  // overlap-add one frame's samples (input position k·hop − N on), clipped to [0, len)
  function ola(acc, sf, k, len) {
    let end = Math.min(k * hop, len) - acc.start
    if (end > acc.len) acc.push(new Float64Array(end - acc.len))
    for (let i = 0; i < N; i++) {
      let j = k * hop - N + i
      if (j >= acc.start && j < len) acc.buf[j - acc.start] += sf ? sf[i] * win[i] : win[i] * win[i]
    }
  }

  function mask(k, last, len) {
    maskFrame(frames, k - first, Math.max(0, k - tHalf) - first, Math.min(last, k + tHalf) - first, fHalf, half, h, p)
    ola(hAcc, ifft(h.re, h.im, f), k, len); ola(pAcc, ifft(p.re, p.im, f), k, len); ola(nAcc, null, k, len)
    nextMask++
    let drop = Math.min(frames.length, nextMask - tHalf - first)
    if (drop > 0) { frames.splice(0, drop); first += drop }
  }

  // hand over samples before `end`: no frame still to come reaches them
  function emit(end) {
    let n = Math.min(end - hAcc.start, hAcc.len)
    if (n <= 0) return
    let hh = new Float32Array(n), pp = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      let w = nAcc.buf[i] < floor ? floor : nAcc.buf[i]
      hh[i] = w > 1e-10 ? hAcc.buf[i] / w : 0
      pp[i] = w > 1e-10 ? pAcc.buf[i] / w : 0
    }
    hAcc.drop(n); pAcc.drop(n); nAcc.drop(n)
    let keep = Math.max(0, first * hop - N)   // input no remaining frame reads
    if (keep - input.start > N) input.drop(keep - input.start)
    onLayers(hh, pp)
  }

  return {
    write(chunk) {
      input.push(chunk); fed += chunk.length
      while (nextFrame * hop <= fed) analyze(nextFrame, fed)
      while (nextMask + tHalf < nextFrame) mask(nextMask, Infinity, Infinity)
      emit(nextMask * hop - N)
    },
    flush() {
      let nF = fed ? Math.floor((fed + N) / hop) + 1 : 0
      while (nextFrame < nF) analyze(nextFrame, fed)
      while (nextMask < nF) mask(nextMask, nF - 1, fed)
      while (hAcc.start + hAcc.len < fed) { hAcc.push(new Float64Array(fed - hAcc.start - hAcc.len)); pAcc.push(new Float64Array(fed - pAcc.start - pAcc.len)); nAcc.push(new Float64Array(fed - nAcc.start - nAcc.len)) }
      emit(fed)
    }
  }
}

function hybridStream(opts) {
  let factor = opts?.factor ?? 1
  if (factor === 1) return { write: chunk => new Float32Array(chunk), flush: () => new Float32Array(0) }   // as batch
  let frameSize = opts?.frameSize ?? 2048
  let hopSize = opts?.hopSize ?? (frameSize >> 2)
  let percFrame = opts?.percFrame ?? 512

  // The batch pipeline as streams: HPSS layers feed a phase-locked vocoder and a short-frame
  // OLA, and the two outputs sum sample-aligned, zero past the shorter one at the end
  let harm = pvocLock({ factor, frameSize, hopSize })
  let perc = wsola({ factor, frameSize: percFrame, delta: 0 })
  let yh = queue(), yp = queue(), fed = 0
  let split = hpssStream(frameSize, hopSize, opts?.harmMedian ?? 17, opts?.percMedian ?? 17, (hh, pp) => { yh.push(harm(hh)); yp.push(perc(pp)) })

  function sum(n) {
    let out = new Float32Array(Math.max(0, n))
    for (let i = 0; i < out.length; i++) out[i] = (i < yh.len ? yh.buf[i] : 0) + (i < yp.len ? yp.buf[i] : 0)
    yh.drop(Math.min(out.length, yh.len)); yp.drop(Math.min(out.length, yp.len))
    return out
  }

  return {
    write(chunk) {
      fed += chunk.length
      split.write(chunk)
      return sum(Math.min(yh.len, yp.len, Math.round(fed * factor) - yh.start))
    },
    flush() {
      split.flush()
      yh.push(harm()); yp.push(perc())
      return sum(Math.round(fed * factor) - yh.start)
    }
  }
}

export default function hybrid(data, opts) {
  // channel arrays + Float64Array accepted — parity with @audio/shift (audit: [L,R] was silently read as opts)
  if (Array.isArray(data) && (data[0] instanceof Float32Array || data[0] instanceof Float64Array)) return data.map(ch => hybrid(ch, opts))
  if (data instanceof Float64Array) data = Float32Array.from(data)
  if (!(data instanceof Float32Array)) return writer(hybridStream(data))
  return hybridBatch(data, opts)
}
