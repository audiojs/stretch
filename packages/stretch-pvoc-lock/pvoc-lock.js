// Phase-locked vocoder (Laroche & Dolson, 1999). After propagating phases,
// locks non-peak bins to their nearest spectral peak's rotation — restores
// harmonic phase coherence, eliminating the "phasiness" of plain pvoc.
//
// For attack preservation on percussion, use @audio/stretch-transient.

import { stftBatch, stftStream } from 'fourier-transform/stft'
import { writer, wrapPhase, stretchOpts } from './util.js'
import { lockPhase } from '@audio/spectral-pvoc'

function process(mag, phase, state, ctx) {
  let { half, anaHop, synHop, freqPerBin } = ctx

  if (!state.prev) {
    state.prev = new Float64Array(half + 1)
    state.synPrev = new Float64Array(half + 1)
    state.p = new Float64Array(half + 1)
    state.first = true
  }

  // Unlike plain pvoc, pre-pad partial frames are processed, not passed through:
  // per-frame peak locking re-coheres whatever the early propagation does, and
  // warming the phase state on pad frames measures ~0.2 dB better LSD at onset.
  let p = state.p
  if (state.first) {
    p.set(phase)
    state.first = false
  } else {
    for (let k = 0; k <= half; k++) {
      let dp = wrapPhase(phase[k] - state.prev[k] - k * freqPerBin * anaHop)
      p[k] = state.synPrev[k] + (k * freqPerBin + dp / anaHop) * synHop
    }
    lockPhase(phase, p, mag, half)
  }

  state.prev.set(phase)
  state.synPrev.set(p)
  return { mag, phase: p }
}

export default function pvocLock(data, opts) {
  // channel arrays + Float64Array accepted — parity with @audio/shift (audit: [L,R] was silently read as opts)
  if (Array.isArray(data) && (data[0] instanceof Float32Array || data[0] instanceof Float64Array)) return data.map(ch => pvocLock(ch, opts))
  if (data instanceof Float64Array) data = Float32Array.from(data)
  if (!(data instanceof Float32Array)) return writer(stftStream(process, stretchOpts(data)))
  if ((opts?.factor ?? 1) === 1) return new Float32Array(data)
  return stftBatch(data, process, stretchOpts(opts))
}
