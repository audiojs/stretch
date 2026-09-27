// Phase-locked vocoder (Laroche & Dolson, 1999). After propagating phases,
// locks non-peak bins to their nearest spectral peak's rotation — restores
// harmonic phase coherence, eliminating the "phasiness" of plain pvoc.
// Runs on the complex bins (@audio/spectral-pvoc lockAdvance): locked bins
// rotate by one complex multiply, only free bins take trigonometry.
//
// For attack preservation on percussion, use @audio/stretch-transient.

import { stftBatch, stftStream } from 'fourier-transform/stft'
import { writer, stretchOpts } from './util.js'
import { lockState, lockAdvance } from '@audio/spectral-pvoc'

function process(re, im, state, ctx) {
  let { half, anaHop, synHop, freqPerBin } = ctx
  let st = state.st ??= lockState(half), mag = st.mag
  for (let k = 0; k <= half; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])

  // Unlike plain pvoc, pre-pad partial frames are processed, not passed through:
  // per-frame peak locking re-coheres whatever the early propagation does, and
  // warming the phase state on pad frames measures ~0.2 dB better LSD at onset.
  lockAdvance(re, im, st, !state.started, anaHop, synHop, freqPerBin, half)
  state.started = true
  return { re, im }
}

export default function pvocLock(data, opts) {
  // channel arrays + Float64Array accepted — parity with @audio/shift (audit: [L,R] was silently read as opts)
  if (Array.isArray(data) && (data[0] instanceof Float32Array || data[0] instanceof Float64Array)) return data.map(ch => pvocLock(ch, opts))
  if (data instanceof Float64Array) data = Float32Array.from(data)
  if (!(data instanceof Float32Array)) return writer(stftStream(process, { ...stretchOpts(data), complex: true }))
  if ((opts?.factor ?? 1) === 1) return new Float32Array(data)
  return stftBatch(data, process, { ...stretchOpts(opts), complex: true })
}
