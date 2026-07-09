// Plain phase vocoder. Each bin's phase advances at its instantaneous frequency,
// independently of the rest. Magnitudes preserved but incoherent inter-harmonic
// phase relationships give complex signals a diffuse, "underwater" quality.
//
// For harmonic coherence use @audio/stretch-pvoc-lock.
// For transient preservation use @audio/stretch-transient.

import { stftBatch, stftStream } from 'fourier-transform/stft'
import { writer, wrapPhase, stretchOpts } from './util.js'

function process(mag, phase, state, ctx) {
  let { half, anaHop, synHop, freqPerBin, frameStart } = ctx

  if (!state.prev) {
    state.prev = new Float64Array(half + 1)
    state.sum = new Float64Array(half + 1)
    state.p = new Float64Array(half + 1)
    state.first = true
  }

  // stftBatch pre-pads with N zeros; propagating phase through those partial
  // frames drifts the accumulator. Pass them through untouched (preserves the
  // onset), then anchor once the analysis frame sits fully inside the signal.
  if (state.first) {
    if (frameStart < 0) return { mag, phase }
    state.sum.set(phase)
    state.prev.set(phase)
    state.first = false
    return { mag, phase }
  }

  let p = state.p
  for (let k = 0; k <= half; k++) {
    let dp = wrapPhase(phase[k] - state.prev[k] - k * freqPerBin * anaHop)
    state.sum[k] += (k * freqPerBin + dp / anaHop) * synHop
    p[k] = state.sum[k]
  }

  state.prev.set(phase)
  return { mag, phase: p }
}

export default function pvoc(data, opts) {
  if (!(data instanceof Float32Array)) return writer(stftStream(process, stretchOpts(data)))
  if ((opts?.factor ?? 1) === 1) return new Float32Array(data)
  return stftBatch(data, process, stretchOpts(opts))
}
