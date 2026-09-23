// Paul Nasca's "extreme stretch": every grain keeps its magnitude spectrum and takes
// uniformly random phases, which destroys temporal structure; overlapping grains sum
// to a smeared, ambient drone. Designed for factors ≥ 8×.
//
// Grains sit on a fixed output grid, hop N/2, Hann-windowed on both sides; grain k
// reads input around k·hop / factor. Random-phase grains are uncorrelated, so where
// they overlap their powers add, not their amplitudes: output is normalized by
// √(mean w² · Σw²), which holds the level flat. Normalizing by Σw², as for coherent
// frames, left a 2.7 dB tremolo at the hop rate and a 2.7 dB loss (the dip Nasca's
// reference corrects with its `hinv_buf` curve).

import { fft, ifft } from 'fourier-transform'
import { writer } from './util.js'

function createRandom(seed) {
  let value = (seed >>> 0) || 1
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

// The grain engine shared by batch and stream: identical arithmetic in both, so the
// stream reproduces the batch under any chunking.
function engine(opts) {
  let factor = opts?.factor ?? 8
  let N = opts?.frameSize ?? 4096
  if (!(N >= 4 && (N & (N - 1)) === 0)) throw new Error(`paulstretch: frameSize must be a power of 2, got ${N}`)
  let hop = N >> 1, half = N >> 1
  let rand = createRandom(opts?.seed ?? 0x1f123bb5)
  let win = new Float64Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / N))
  let mean = 0
  for (let i = 0; i < N; i++) mean += win[i] * win[i] / N
  // output t is covered by two grains, at window indices t mod hop and that + hop
  let gain = new Float64Array(hop)
  for (let t = 0; t < hop; t++) gain[t] = 1 / Math.sqrt(mean * (win[t] * win[t] + win[t + hop] * win[t + hop]))
  let f = new Float64Array(N), re = new Float64Array(half + 1), im = new Float64Array(half + 1)

  return {
    factor, N, hop, gain,
    // input sample where grain k starts reading
    start: k => Math.round(k * hop / factor) - hop,
    // grain k: read `src` (absolute index = local + srcAt, zero outside [0, srcLen)),
    // overlap-add into `acc` (absolute output index = local + accAt, clipped to outLen)
    grain(k, src, srcAt, srcLen, acc, accAt, outLen) {
      let a = this.start(k)
      for (let i = 0; i < N; i++) {
        let j = a + i
        f[i] = (j >= 0 && j < srcLen ? src[j - srcAt] : 0) * win[i]
      }
      let [r, m] = fft(f, [re, im])
      for (let b = 0; b <= half; b++) {
        let mag = Math.sqrt(r[b] * r[b] + m[b] * m[b]), ph = rand() * Math.PI * 2
        re[b] = mag * Math.cos(ph); im[b] = mag * Math.sin(ph)
      }
      let y = ifft(re, im, f)
      for (let i = 0, o = k * hop - hop; i < N; i++) {
        let t = o + i
        if (t >= 0 && t < outLen) acc[t - accAt] += y[i] * win[i]
      }
    },
  }
}

function batch(data, opts) {
  let e = engine(opts)
  let outLen = Math.round(data.length * e.factor)
  let acc = new Float64Array(outLen)
  for (let k = 0; k * e.hop - e.hop < outLen; k++) e.grain(k, data, 0, data.length, acc, 0, outLen)
  let out = new Float32Array(outLen)
  for (let t = 0; t < outLen; t++) out[t] = acc[t] * e.gain[t % e.hop]
  return out
}

function stream(opts) {
  let e = engine(opts), { factor, N, hop } = e
  let src = new Float32Array(N * 4), srcAt = 0, fed = 0            // src[0] is input sample srcAt
  let acc = new Float64Array(N * 4), accAt = 0, k = 0              // acc[0] is output sample accAt

  function append(chunk) {
    if (fed - srcAt + chunk.length > src.length) {
      let b = new Float32Array(Math.max(2 * src.length, fed - srcAt + chunk.length))
      b.set(src.subarray(0, fed - srcAt)); src = b
    }
    src.set(chunk, fed - srcAt); fed += chunk.length
  }
  function grain(len, outLen) {
    if (k * hop + hop - accAt > acc.length) {
      let b = new Float64Array(Math.max(2 * acc.length, k * hop + hop - accAt)); b.set(acc); acc = b
    }
    e.grain(k++, src, srcAt, len, acc, accAt, outLen)
  }
  // hand over output samples before `end` (every grain covering them is in), then drop
  // input no later grain reads
  function emit(end) {
    let n = Math.max(0, end - accAt), out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = acc[i] * e.gain[(accAt + i) % hop]
    acc.copyWithin(0, n); acc.fill(0, acc.length - n); accAt += n
    let keep = Math.min(Math.max(0, e.start(k)), fed) - srcAt   // a long hop can start past the buffered input
    if (keep > N) { src.copyWithin(0, keep, fed - srcAt); srcAt += keep }
    return out
  }

  return {
    write(chunk) {
      append(chunk)
      while (e.start(k) + N <= fed) grain(Infinity, Infinity)
      return emit(Math.min((k - 1) * hop, Math.round(fed * factor)))
    },
    flush() {
      let outLen = Math.round(fed * factor)
      while (k * hop - hop < outLen) grain(fed, outLen)
      return emit(outLen)
    },
  }
}

export default function paulstretch(data, opts) {
  // channel arrays + Float64Array accepted — parity with @audio/shift (audit: [L,R] was silently read as opts)
  if (Array.isArray(data) && (data[0] instanceof Float32Array || data[0] instanceof Float64Array)) return data.map(ch => paulstretch(ch, opts))
  if (data instanceof Float64Array) data = Float32Array.from(data)
  if (!(data instanceof Float32Array)) {
    if ((data?.factor ?? 8) === 1) return writer({ write: chunk => new Float32Array(chunk), flush: () => new Float32Array(0) })   // as batch
    return writer(stream(data))
  }
  if ((opts?.factor ?? 8) === 1) return new Float32Array(data)
  return batch(data, opts)
}
