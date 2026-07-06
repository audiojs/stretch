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

import { stft, istft } from 'fourier-transform/stft'
import wsola from '@audio/stretch-wsola'
import pvocLock from '@audio/stretch-pvoc-lock'
import { writer } from '@audio/stretch-core'

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

// Split data into [harmonic, percussive] via median-filter HPSS + power-Wiener masks.
function hpssSplit(data, N, hop, tMed, fMed) {
  let frames = stft(data, { frameSize: N, hopSize: hop })
  let nF = frames.length, half = N >> 1
  let win = Math.max(tMed, fMed)
  if (_med.length < win) _med = new Float64Array(win)

  let hFrames = new Array(nF), pFrames = new Array(nF)
  let tHalf = tMed >> 1, fHalf = fMed >> 1
  for (let f = 0; f < nF; f++) {
    let { re, im, mag, time } = frames[f]
    let hRe = new Float64Array(half + 1), hIm = new Float64Array(half + 1)
    let pRe = new Float64Array(half + 1), pIm = new Float64Array(half + 1)
    let f0 = Math.max(0, f - tHalf), f1 = Math.min(nF - 1, f + tHalf)
    for (let k = 0; k <= half; k++) {
      let c = 0
      for (let g = f0; g <= f1; g++) _med[c++] = frames[g].mag[k]
      let H = median(_med, c)
      let k0 = Math.max(0, k - fHalf), k1 = Math.min(half, k + fHalf)
      c = 0
      for (let b = k0; b <= k1; b++) _med[c++] = mag[b]
      let P = median(_med, c)
      // hard-ish separation (power 4): soft masks leak the tonal bed into the
      // percussive layer, where OLA then modulates it
      let h4 = H * H * H * H, p4 = P * P * P * P, denom = h4 + p4
      let mH = denom > 1e-40 ? h4 / denom : 0.5
      hRe[k] = re[k] * mH; hIm[k] = im[k] * mH
      pRe[k] = re[k] - hRe[k]; pIm[k] = im[k] - hIm[k]   // masks sum to 1
    }
    hFrames[f] = { re: hRe, im: hIm, time }
    pFrames[f] = { re: pRe, im: pIm, time }
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

function hybridStream(opts) {
  let factor = opts?.factor ?? 1
  let frameSize = opts?.frameSize ?? 2048
  let segLen = frameSize * 8
  let advance = segLen >> 1
  let outOlap = Math.round((segLen - advance) * factor)

  let inBuf = new Float32Array(segLen * 2)
  let inLen = 0
  let tail = null

  function concat(parts) {
    let n = 0
    for (let p of parts) n += p.length
    if (!n) return new Float32Array(0)
    let out = new Float32Array(n)
    let off = 0
    for (let p of parts) { out.set(p, off); off += p.length }
    return out
  }

  // Crossfade the retained overlap of the previous segment into the new one.
  function blend(out, results) {
    if (tail) {
      let xLen = Math.min(tail.length, out.length, outOlap)
      let xf = new Float32Array(xLen)
      for (let i = 0; i < xLen; i++) {
        let w = (i + 0.5) / xLen
        xf[i] = tail[i] * (1 - w) + out[i] * w
      }
      results.push(xf)
      let emitEnd = out.length - outOlap
      if (emitEnd > xLen) results.push(new Float32Array(out.subarray(xLen, emitEnd)))
      tail = emitEnd < out.length ? new Float32Array(out.subarray(Math.max(xLen, emitEnd))) : null
    } else {
      let emitEnd = out.length - outOlap
      if (emitEnd > 0) results.push(new Float32Array(out.subarray(0, emitEnd)))
      tail = new Float32Array(out.subarray(Math.max(0, emitEnd)))
    }
  }

  return {
    write(chunk) {
      if (inLen + chunk.length > inBuf.length) {
        let nb = new Float32Array(Math.max((inLen + chunk.length) * 2, inBuf.length * 2))
        nb.set(inBuf.subarray(0, inLen))
        inBuf = nb
      }
      inBuf.set(chunk, inLen)
      inLen += chunk.length
      let results = []
      while (inLen >= segLen) {
        let seg = new Float32Array(inBuf.subarray(0, segLen))
        blend(hybridBatch(seg, opts), results)
        inBuf.copyWithin(0, advance, inLen)
        inLen -= advance
      }
      return concat(results)
    },
    flush() {
      let results = []
      if (inLen > 0) {
        let seg = new Float32Array(inBuf.subarray(0, inLen))
        let out = hybridBatch(seg, opts)
        if (tail) {
          let xLen = Math.min(tail.length, out.length, outOlap)
          let xf = new Float32Array(xLen)
          for (let i = 0; i < xLen; i++) {
            let w = (i + 0.5) / xLen
            xf[i] = tail[i] * (1 - w) + out[i] * w
          }
          results.push(xf)
          if (out.length > xLen) results.push(new Float32Array(out.subarray(xLen)))
        } else {
          results.push(out)
        }
        inLen = 0
      } else if (tail) {
        results.push(tail)
      }
      tail = null
      return concat(results)
    }
  }
}

export default function hybrid(data, opts) {
  if (!(data instanceof Float32Array)) return writer(hybridStream(data))
  return hybridBatch(data, opts)
}
