// Transient-aware phase-locked vocoder (Röbel, 2003). Measures spectral flux
// between frames; on a sharp onset, resets to the original analysis phase
// instead of propagating it — preserving attack sharpness on drums and plucks.
// Implies phase locking, on the complex bins (@audio/spectral-pvoc lockAdvance).

import { stftBatch, stftStream } from 'fourier-transform/stft'
import { writer, stretchOpts } from './util.js'
import { lockState, lockAdvance } from '@audio/spectral-pvoc'

function updateFluxStats(state, value, alpha) {
  if (state.fluxMean == null) { state.fluxMean = value; state.fluxVar = 0; return }
  let delta = value - state.fluxMean
  state.fluxMean += alpha * delta
  state.fluxVar = (1 - alpha) * (state.fluxVar + alpha * delta * delta)
}

function makeProcess(threshold) {
  return function (re, im, state, ctx) {
    let { half, anaHop, synHop, freqPerBin } = ctx

    if (!state.st) {
      state.st = lockState(half)
      state.lm = new Float64Array(half + 1)   // log1p magnitudes, this frame and the previous
      state.lp = new Float64Array(half + 1)
      state.frames = 0
      state.cooldown = 0
      state.first = true
    }
    let st = state.st, mag = st.mag, lm = state.lp, lp = state.lm
    state.lm = lm; state.lp = lp
    for (let k = 0; k <= half; k++) {
      mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      lm[k] = Math.log1p(mag[k])
    }

    let isTransient = false
    if (!state.first) {
      let flux = 0, energy = 0
      for (let k = 0; k <= half; k++) {
        let weight = 0.5 + 0.5 * k / Math.max(1, half)
        let d = lm[k] - lp[k]
        if (d > 0) flux += d
        energy += weight * lm[k]
      }
      let normFlux = energy > 1e-10 ? flux / energy : 0
      let mean = state.fluxMean ?? normFlux
      let std = Math.sqrt(state.fluxVar ?? 0)
      // Std floor 0.07: steady polyphonic beating measures ≤ ~0.07 normFlux (p90),
      // genuine onsets ≥ ~0.19 — the floor keeps chord beats from firing resets.
      isTransient = state.frames > 4 && state.cooldown === 0 &&
        normFlux > mean + threshold * Math.max(0.07, std) && normFlux > mean * 1.35
      updateFluxStats(state, normFlux, isTransient ? 0.3 : 0.12)
      state.cooldown = isTransient ? 1 : Math.max(0, state.cooldown - 1)
    }

    lockAdvance(re, im, st, state.first || isTransient, anaHop, synHop, freqPerBin, half)
    state.first = false
    state.frames++
    return { re, im }
  }
}

export default function transient(data, opts) {
  // channel arrays + Float64Array accepted — parity with @audio/shift (audit: [L,R] was silently read as opts)
  if (Array.isArray(data) && (data[0] instanceof Float32Array || data[0] instanceof Float64Array)) return data.map(ch => transient(ch, opts))
  if (data instanceof Float64Array) data = Float32Array.from(data)
  let threshold = (data instanceof Float32Array ? opts?.transientThreshold : data?.transientThreshold) ?? 1.5
  let process = makeProcess(threshold)
  if (!(data instanceof Float32Array)) return writer(stftStream(process, { ...stretchOpts(data), complex: true }))
  if ((opts?.factor ?? 1) === 1) return new Float32Array(data)
  return stftBatch(data, process, { ...stretchOpts(opts), complex: true })
}
