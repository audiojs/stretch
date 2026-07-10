// Paul Nasca's "extreme stretch" — replaces STFT phase with uniform noise each
// frame. Destroys temporal structure; magnitudes alone reconstruct a smeared,
// ambient drone. Designed for factors ≥ 8×.

import { stftBatch, stftStream } from 'fourier-transform/stft'
import { writer } from './util.js'

function createRandom(seed) {
  let value = (seed >>> 0) || 1
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

function makeProcess(seed) {
  return (mag, phase, state, ctx) => {
    let rand = state.rand || (state.rand = createRandom(seed))
    let p = state.p || (state.p = new Float64Array(ctx.half + 1))
    for (let k = 0; k <= ctx.half; k++) p[k] = rand() * Math.PI * 2
    return { mag, phase: p }
  }
}

export default function paulstretch(data, opts) {
  // channel arrays + Float64Array accepted — parity with @audio/shift (audit: [L,R] was silently read as opts)
  if (Array.isArray(data) && (data[0] instanceof Float32Array || data[0] instanceof Float64Array)) return data.map(ch => paulstretch(ch, opts))
  if (data instanceof Float64Array) data = Float32Array.from(data)
  if (!(data instanceof Float32Array)) {
    opts = data
    let factor = opts?.factor ?? 8
    let frameSize = opts?.frameSize ?? 4096
    let synHop = frameSize >> 1
    let seed = opts?.seed ?? 0x1f123bb5
    return writer(stftStream(makeProcess(seed), { frameSize, synHop, anaHop: synHop / factor }))
  }
  let factor = opts?.factor ?? 8
  if (factor === 1) return new Float32Array(data)
  let frameSize = opts?.frameSize ?? 4096
  let synHop = frameSize >> 1
  let seed = opts?.seed ?? 0x1f123bb5
  return stftBatch(data, makeProcess(seed), { frameSize, synHop, anaHop: synHop / factor })
}
