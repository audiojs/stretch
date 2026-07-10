// Sinusoidal Modeling Synthesis time stretching.
// Tracks individual sinusoidal partials across frames, resynthesizes at new rate.
// Each harmonic is independently controlled — no phase spreading or bin-by-bin artifacts.
//
// References:
// - Serra, X. (1989). "A System for Sound Analysis/Transformation/Synthesis
//   Based on a Deterministic plus Stochastic Decomposition." PhD thesis, Stanford.
// - McAulay, R.J. & Quatieri, T.F. (1986). "Speech analysis/synthesis based on
//   a sinusoidal representation." IEEE Trans. ASSP, 34(4).

import { fft, ifft } from 'fourier-transform'
import { hannWindow, clamp, normalize, writer, makeStreamBufs, PI2 } from './util.js'

function createNoiseState(seed = 0x12345678) {
  return { seed: seed >>> 0 }
}

function nextNoisePhase(state) {
  state.seed = (state.seed * 1664525 + 1013904223) >>> 0
  return state.seed / 0x100000000 * PI2
}

// Tracks and peaks are structure-of-arrays: parallel bins/mags Float64Arrays.
// Frame data (tracks, residual) persists per frame; everything else below is
// module-level scratch reused across frames — the per-frame hot path allocates nothing.
function makeFrame(nTracks, half) {
  return {
    tracks: { bins: new Float64Array(nTracks), mags: new Float64Array(nTracks) },
    residual: new Float64Array(half + 1),
  }
}

let _buf = new Float64Array(0)      // windowed analysis frame
let _mag = new Float64Array(0)      // magnitude spectrum
let _pre = new Float64Array(0)      // pre-smooth residual
let _pkBin = new Float64Array(0)    // detected peaks
let _pkMag = new Float64Array(0)
let _pkBin2 = new Float64Array(0)   // permute scratch
let _pkMag2 = new Float64Array(0)
let _order = []                     // reusable index-sort scratch
const byMagDesc = (a, b) => _pkMag2[b] - _pkMag2[a]
const byCostAsc = (a, b) => _pairC[a] - _pairC[b]
let _pairT = new Int32Array(0)      // candidate track/peak pairs
let _pairP = new Int32Array(0)
let _pairC = new Float64Array(0)
let _taken = new Uint8Array(0)
let _assigned = new Uint8Array(0)
let _empty = new Int32Array(0)
let _sre = new Float64Array(0)      // synthesis spectrum
let _sim = new Float64Array(0)

// Smooth `pre[0..half]` with a triangular kernel into `out`.
function smoothResidual(pre, half, width, out) {
  for (let k = 0; k <= half; k++) {
    let sum = 0, weightSum = 0
    let start = Math.max(0, k - width), end = Math.min(half, k + width)
    for (let j = start; j <= end; j++) {
      let weight = width + 1 - Math.abs(j - k)
      sum += pre[j] * weight; weightSum += weight
    }
    out[k] = weightSum ? sum / weightSum : 0
  }
}

// Subtract top-nTracks peaks from the spectrum, smooth → noise envelope into `out`.
function residualEnvelope(mag, nPeaks, half, nTracks, out) {
  if (_pre.length < half + 1) _pre = new Float64Array(half + 1)
  let residual = _pre
  for (let k = 0; k <= half; k++) residual[k] = mag[k]

  let count = Math.min(nTracks, nPeaks)
  for (let i = 0; i < count; i++) {
    let bin = _pkBin[i], radius = 3.5
    let start = Math.max(1, Math.floor(bin - radius))
    let end = Math.min(half - 1, Math.ceil(bin + radius))
    for (let k = start; k <= end; k++) {
      let weight = Math.max(0, 1 - Math.abs(k - bin) / radius)
      residual[k] = Math.max(0, residual[k] - _pkMag[i] * weight)
    }
  }

  residual[0] = 0
  if (half > 0) residual[half] *= 0.5
  smoothResidual(residual, half, 4, out)
}

// Spectral peak detection with parabolic interpolation for sub-bin accuracy.
// Fills _pkBin/_pkMag sorted by magnitude desc (stable); returns peak count.
function detectPeaks(mag, half, thresh) {
  if (_pkBin.length < half + 1) {
    _pkBin = new Float64Array(half + 1)
    _pkMag = new Float64Array(half + 1)
    _pkBin2 = new Float64Array(half + 1)
    _pkMag2 = new Float64Array(half + 1)
  }
  let n = 0
  for (let k = 2; k < half - 1; k++) {
    if (mag[k] <= mag[k - 1] || mag[k] <= mag[k + 1] || mag[k] < thresh) continue
    let a = mag[k - 1], b = mag[k], c = mag[k + 1]
    let d = a - 2 * b + c
    let p = d ? 0.5 * (a - c) / d : 0
    _pkBin2[n] = k + p
    _pkMag2[n] = b - 0.25 * (a - c) * p
    n++
  }
  _order.length = n
  for (let i = 0; i < n; i++) _order[i] = i
  _order.sort(byMagDesc)
  for (let i = 0; i < n; i++) {
    _pkBin[i] = _pkBin2[_order[i]]
    _pkMag[i] = _pkMag2[_order[i]]
  }
  return n
}

// Cost-weighted sinusoidal tracking: sorted assignment by frequency + magnitude continuity.
// Writes the continued track set into `out`.
function trackPeaks(prev, nPeaks, nTracks, maxDev, out) {
  out.bins.fill(0)
  out.mags.fill(0)

  let cap = nTracks * Math.max(nPeaks, 1)
  if (_pairT.length < cap) {
    _pairT = new Int32Array(cap)
    _pairP = new Int32Array(cap)
    _pairC = new Float64Array(cap)
  }
  let nPairs = 0
  for (let i = 0; i < nTracks; i++) {
    if (!prev.bins[i]) continue
    for (let j = 0; j < nPeaks; j++) {
      let fd = Math.abs(_pkBin[j] - prev.bins[i])
      if (fd >= maxDev) continue
      let mr = prev.mags[i] > 1e-10 ? _pkMag[j] / prev.mags[i] : 1
      _pairT[nPairs] = i
      _pairP[nPairs] = j
      _pairC[nPairs] = fd / maxDev + 0.25 * Math.abs(Math.log(clamp(mr, 0.01, 100)))
      nPairs++
    }
  }
  _order.length = nPairs
  for (let i = 0; i < nPairs; i++) _order[i] = i
  _order.sort(byCostAsc)

  if (_taken.length < nPeaks) _taken = new Uint8Array(nPeaks)
  if (_assigned.length < nTracks) {
    _assigned = new Uint8Array(nTracks)
    _empty = new Int32Array(nTracks)
  }
  _taken.fill(0); _assigned.fill(0)

  for (let s = 0; s < nPairs; s++) {
    let t = _pairT[_order[s]], p = _pairP[_order[s]]
    if (_assigned[t] || _taken[p]) continue
    out.bins[t] = _pkBin[p]
    out.mags[t] = _pkMag[p]
    _assigned[t] = 1; _taken[p] = 1
  }

  let nEmpty = 0
  for (let i = 0; i < nTracks; i++) if (!_assigned[i]) _empty[nEmpty++] = i
  let e = 0
  for (let j = 0; j < nPeaks && e < nEmpty; j++) {
    if (!_taken[j]) {
      let t = _empty[e++]
      out.bins[t] = _pkBin[j]
      out.mags[t] = _pkMag[j]
    }
  }
}

// Analyze one frame into `frame`: window+FFT, detect+track peaks, residual envelope
// (blended 70/30 with the previous frame's when given).
function analyzeFrame(data, pos, win, N, half, thresh, prev, nTracks, maxDev, prevResidual, frame) {
  if (_buf.length !== N) _buf = new Float64Array(N)
  if (_mag.length < half + 1) _mag = new Float64Array(half + 1)
  let buf = _buf
  for (let i = 0; i < N; i++) buf[i] = data[pos + i] * win[i]
  let [re, im] = fft(buf)
  let mag = _mag
  for (let k = 0; k <= half; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])

  let nPeaks = detectPeaks(mag, half, thresh)
  trackPeaks(prev, nPeaks, nTracks, maxDev, frame.tracks)

  let residual = frame.residual
  residualEnvelope(mag, nPeaks, half, nTracks, residual)
  if (prevResidual) for (let k = 0; k <= half; k++) residual[k] = 0.7 * residual[k] + 0.3 * prevResidual[k]
}

// Build synthesis spectrum from interpolated tracks, IFFT to time domain
function synthFrame(t0, t1, r0, r1, alpha, nTracks, phi, half, N, hop, noiseState, residualMix) {
  if (_sre.length !== half + 1) {
    _sre = new Float64Array(half + 1)
    _sim = new Float64Array(half + 1)
  }
  let re = _sre, im = _sim
  re.fill(0); im.fill(0)
  let dphi = PI2 * hop / N

  for (let i = 0; i < nTracks; i++) {
    let b0 = t0.bins[i], m0 = t0.mags[i], b1 = t1.bins[i], m1 = t1.mags[i]
    if (!b0 && !b1) continue

    let bin, mag
    if (!b0) { bin = b1; mag = m1 * alpha }
    else if (!b1) { bin = b0; mag = m0 * (1 - alpha) }
    else { bin = b0 + (b1 - b0) * alpha; mag = m0 + (m1 - m0) * alpha }

    phi[i] += bin * dphi
    let k = Math.round(bin)
    if (k > 0 && k < half) {
      re[k] += 2 * mag * Math.cos(phi[i])
      im[k] += 2 * mag * Math.sin(phi[i])
    }
  }

  if (residualMix > 0) {
    for (let k = 1; k < half; k++) {
      let resMag = (r0[k] + (r1[k] - r0[k]) * alpha) * residualMix
      if (resMag <= 1e-8) continue
      let phase = nextNoisePhase(noiseState)
      re[k] += 2 * resMag * Math.cos(phase)
      im[k] += 2 * resMag * Math.sin(phase)
    }
  }

  return ifft(re, im)
}

export default function sms(data, opts = {}) {
  // channel arrays + Float64Array accepted — parity with @audio/shift (audit: [L,R] was silently read as opts)
  if (Array.isArray(data) && (data[0] instanceof Float32Array || data[0] instanceof Float64Array)) return data.map(ch => sms(ch, opts))
  if (data instanceof Float64Array) data = Float32Array.from(data)
  if (!(data instanceof Float32Array)) return writer(smsStream(data))

  let factor = opts.factor ?? 1
  let N = opts.frameSize ?? 2048
  let hop = opts.hopSize ?? (N >> 2)
  let half = N >> 1
  let nTracks = opts.maxTracks ?? 60
  let thresh = opts.minMag ?? 1e-4
  let maxDev = opts.freqDev ?? 3
  let residualMix = clamp(opts.residualMix ?? 1, 0, 1)
  let win = hannWindow(N)
  let noiseState = createNoiseState()

  if (factor === 1) return new Float32Array(data)

  // Analysis pass — frames persist (synthesis interpolates between any two)
  let nAna = Math.max(1, Math.floor((data.length - N) / hop) + 1)
  let frames = new Array(nAna)
  let prev = { bins: new Float64Array(nTracks), mags: new Float64Array(nTracks) }
  let prevResidual = null
  for (let f = 0; f < nAna; f++) {
    let frame = makeFrame(nTracks, half)
    analyzeFrame(data, f * hop, win, N, half, thresh, prev, nTracks, maxDev, prevResidual, frame)
    frames[f] = frame; prev = frame.tracks; prevResidual = frame.residual
  }

  // Synthesis pass
  let outLen = Math.round(data.length * factor)
  let out = new Float32Array(outLen), nrm = new Float32Array(outLen)
  let phi = new Float64Array(nTracks)

  for (let s = 0; ; s++) {
    let sPos = s * hop
    if (sPos + N > outLen) break
    let af = Math.min(s / factor, nAna - 1)
    let f0 = Math.floor(af), f1 = Math.min(f0 + 1, nAna - 1), alpha = af - f0
    let fr = synthFrame(frames[f0].tracks, frames[f1].tracks, frames[f0].residual, frames[f1].residual, alpha, nTracks, phi, half, N, hop, noiseState, residualMix)
    for (let i = 0; i < N && sPos + i < outLen; i++) {
      let w2 = win[i] * win[i]
      out[sPos + i] += fr[i] * w2; nrm[sPos + i] += w2
    }
  }

  normalize(out, nrm)
  return out
}

function smsStream(opts = {}) {
  let factor = opts.factor ?? 1
  let N = opts.frameSize ?? 2048
  let hop = opts.hopSize ?? (N >> 2)
  let half = N >> 1
  let nTracks = opts.maxTracks ?? 60
  let thresh = opts.minMag ?? 1e-4
  let maxDev = opts.freqDev ?? 3
  let residualMix = clamp(opts.residualMix ?? 1, 0, 1)
  let win = hannWindow(N)
  let noiseState = createNoiseState()

  let st = makeStreamBufs(N)
  // Two frame slots ping-ponged: each analysis writes into the retiring slot,
  // so the steady-state stream allocates nothing per frame.
  let slotA = makeFrame(nTracks, half)
  let slotB = makeFrame(nTracks, half)
  let prevFrame = slotA
  let currFrame = null
  let phi = new Float64Array(nTracks)
  let anaIdx = 0, synIdx = 0, anaPos = 0

  function synthOne(alpha) {
    st.growOut(st.pos + N)
    let ob = st.ob, nb = st.nb, base = st.pos
    let fr = synthFrame(prevFrame.tracks, currFrame.tracks, prevFrame.residual, currFrame.residual, alpha, nTracks, phi, half, N, hop, noiseState, residualMix)
    for (let i = 0; i < N && base + i < ob.length; i++) {
      let w2 = win[i] * win[i]; ob[base + i] += fr[i] * w2; nb[base + i] += w2
    }
    st.pos += hop; synIdx++
  }

  function emitSynth() {
    if (anaIdx < 2) return
    while (synIdx / factor < anaIdx - 1) synthOne(synIdx / factor - (anaIdx - 2))
  }

  function processInput() {
    while (anaPos + N <= st.il) {
      let source = currFrame || prevFrame
      let target = source === slotA ? slotB : slotA
      analyzeFrame(st.ib, anaPos, win, N, half, thresh, source.tracks, nTracks, maxDev, source.residual, target)
      prevFrame = source; currFrame = target
      anaIdx++; anaPos += hop
      emitSynth()
    }
    if (anaPos > N * 2) { let trim = anaPos - N; st.compactIn(trim); anaPos -= trim }
  }

  return {
    write(chunk) {
      st.appendIn(chunk)
      processInput()
      return st.take(Math.max(0, st.pos - N + hop))
    },
    flush() {
      if (anaIdx >= 2 && currFrame) {
        while (synIdx / factor < anaIdx) {
          let af = Math.min(synIdx / factor, anaIdx - 1)
          synthOne(Math.min(af - (anaIdx - 2), 1))
        }
      }
      return st.take(st.pos)
    }
  }
}
