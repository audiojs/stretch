// Shared helpers for @audio/stretch-* sub-packages.

export const PI2 = Math.PI * 2

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

// Phase unwrap to [-π, π)
export function wrapPhase(p) {
  return p - Math.round(p / PI2) * PI2
}

// Wrap { write, flush } stream into single callable: fn(chunk) → process, fn() → flush
export function writer(s) {
  return (chunk) => chunk ? s.write(chunk) : s.flush()
}

// Normalize OLA output in place
export function normalize(out, norm) {
  for (let i = 0; i < out.length; i++) {
    if (norm[i] > 1e-8) out[i] /= norm[i]
  }
}

const _hannCache = new Map()
export function hannWindow(N) {
  if (_hannCache.has(N)) return _hannCache.get(N)
  let w = new Float64Array(N)
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(PI2 * i / N))
  _hannCache.set(N, w)
  return w
}

function sinc(x) { return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x) }

// Windowed-sinc resampler (Lanczos, a=3). When downsampling, the kernel is
// dilated by the decimation ratio so the sinc cuts at the *output* Nyquist —
// interpolation alone would alias everything above it back into band.
export function resample(data, outLen) {
  let out = new Float32Array(outLen)
  let ratio = (data.length - 1) / (outLen - 1 || 1)
  let a = 3, n = data.length
  let s = Math.max(1, ratio), sup = a * s
  for (let i = 0; i < outLen; i++) {
    let pos = i * ratio
    let lo = Math.ceil(pos - sup), hi = Math.floor(pos + sup)
    let sum = 0, wsum = 0
    for (let j = Math.max(0, lo); j <= Math.min(n - 1, hi); j++) {
      let d = (pos - j) / s, w = sinc(d) * sinc(d / a)
      sum += data[j] * w
      wsum += w
    }
    out[i] = wsum > 0 ? sum / wsum : 0
  }
  return out
}

// Shared streaming buffer state: inBuf, outBuf/nrmBuf with grow/compact/take.
// Plain mutable fields, no accessors — keeps the struct jz-compilable.
export function makeStreamBufs(N, nf = 0) {
  let st = {
    ib: new Float32Array(N * 4), il: 0,
    ob: new Float32Array(N * 8), nb: new Float32Array(N * 8),
    pos: 0, oread: 0,

    appendIn(chunk) {
      let need = st.il + chunk.length
      if (need > st.ib.length) {
        let b = new Float32Array(Math.max(need * 2, st.ib.length * 2))
        b.set(st.ib.subarray(0, st.il)); st.ib = b
      }
      st.ib.set(chunk, st.il); st.il += chunk.length
    },

    growOut(need) {
      if (need <= st.ob.length) return
      let len = Math.max(need * 2, st.ob.length * 2)
      let o = new Float32Array(len), n = new Float32Array(len)
      o.set(st.ob); n.set(st.nb); st.ob = o; st.nb = n
    },

    compactIn(trim) {
      if (trim <= 0) return
      st.ib.copyWithin(0, trim, st.il); st.il -= trim
    },

    take(upTo) {
      upTo = Math.min(upTo, st.pos)
      if (upTo <= st.oread) return new Float32Array(0)
      let len = Math.floor(upTo - st.oread)
      let out = new Float32Array(len)
      for (let i = 0; i < len; i++) {
        let j = st.oread + i, n = nf > 0 ? Math.max(st.nb[j], nf) : st.nb[j]
        out[i] = n > 1e-8 ? st.ob[j] / n : 0
      }
      st.oread += len
      if (st.oread > N * 8) {
        st.ob.copyWithin(0, st.oread); st.nb.copyWithin(0, st.oread)
        st.pos -= st.oread; st.oread = 0
        st.ob.fill(0, st.pos); st.nb.fill(0, st.pos)
      }
      return out
    }
  }
  return st
}

// Resolve factor → anaHop/synHop for stftBatch/stftStream from fourier-transform/stft.
// anaHop must be an integer — the STFT stream indexes its ring at the raw hop position,
// so a fractional hop (any non-integer hopSize/factor, e.g. semitone ratios) yields NaN.
// The achieved factor is synHop/anaHop; callers wanting an exact ratio resample on top.
export function stretchOpts(opts) {
  let frameSize = opts?.frameSize ?? 2048
  let hopSize = opts?.hopSize ?? (frameSize >> 2)
  let factor = opts?.factor ?? 1
  let synHop = opts?.synHop ?? hopSize
  let anaHop = Math.max(1, Math.round(opts?.anaHop ?? hopSize / factor))
  return { ...opts, frameSize, hopSize, synHop, anaHop }
}

// Spectral peak detection for phase-locked vocoder (Laroche & Dolson 1999).
// Returns Uint8Array mask (1 = peak) — a reused scratch buffer, valid until the next call.
let _peaks = new Uint8Array(0)
export function findPeaks(mag, half) {
  if (_peaks.length !== half + 1) _peaks = new Uint8Array(half + 1)
  let peaks = _peaks
  peaks.fill(0)
  if (half <= 1) {
    peaks[0] = 1
    if (half === 1) peaks[1] = 1
    return peaks
  }

  let maxMag = 0
  for (let k = 0; k <= half; k++) if (mag[k] > maxMag) maxMag = mag[k]

  let minMag = Math.max(1e-8, maxMag * 0.015)
  let minProm = Math.max(1e-9, maxMag * 0.003)
  let lastPeak = -2, lastPeakMag = 0

  for (let k = 1; k < half; k++) {
    let value = mag[k]
    if (value < minMag || value < mag[k - 1] || value < mag[k + 1]) continue

    let shoulder = Math.max(mag[k - 1], mag[k + 1], k > 1 ? mag[k - 2] : 0, k + 2 <= half ? mag[k + 2] : 0)
    if (value - shoulder < minProm && value < maxMag * 0.1) continue

    if (k - lastPeak <= 1) {
      if (value > lastPeakMag) { peaks[lastPeak] = 0; peaks[k] = 1; lastPeak = k; lastPeakMag = value }
      continue
    }
    peaks[k] = 1; lastPeak = k; lastPeakMag = value
  }

  let found = false
  for (let k = 0; k <= half; k++) if (peaks[k]) { found = true; break }
  if (!found) {
    let best = 0
    for (let k = 1; k <= half; k++) if (mag[k] > mag[best]) best = k
    peaks[best] = 1
  }
  return peaks
}

// Lock non-peak bin phases to nearest peak's rotation.
let _peakBins = new Int32Array(0)
export function lockPhase(phase, propPhase, mag, half) {
  let peaks = findPeaks(mag, half)
  if (_peakBins.length < half + 1) _peakBins = new Int32Array(half + 1)
  let peakBins = _peakBins, nBins = 0
  for (let k = 0; k <= half; k++) if (peaks[k]) peakBins[nBins++] = k
  if (!nBins) return

  for (let i = 0; i < nBins; i++) {
    let pk = peakBins[i]
    let start = i === 0 ? 0 : Math.floor((peakBins[i - 1] + pk) * 0.5) + 1
    let end = i === nBins - 1 ? half : Math.floor((pk + peakBins[i + 1]) * 0.5)
    let delta = propPhase[pk] - phase[pk]
    let lockFloor = Math.max(1e-10, mag[pk] * 0.03)
    for (let k = start; k <= end; k++) {
      if (k === pk || mag[k] < lockFloor) continue
      propPhase[k] = phase[k] + delta
    }
  }
}
