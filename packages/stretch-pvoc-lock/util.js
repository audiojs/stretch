// Local helpers (inlined family convention — no shared-dep package).

// Phase unwrap to [-π, π)
export function wrapPhase(p) {
  return p - Math.round(p / (2 * Math.PI)) * (2 * Math.PI)
}

// Wrap { write, flush } stream into single callable: fn(chunk) → process, fn() → flush
export function writer(s) {
  return (chunk) => chunk ? s.write(chunk) : s.flush()
}

// Resolve factor → anaHop/synHop for stftBatch/stftStream from fourier-transform/stft.
// `factor` may be a function `(t seconds of source) => factor` — sliding stretch:
// anaHop becomes a per-frame hop function (fourier-transform ≥2.4 samples it at every
// analysis frame; the phase-propagation math reads ctx.anaHop live). Scalar factors
// keep the integer-rounded constant hop — the achieved factor is synHop/anaHop;
// callers wanting an exact ratio resample on top.
export function stretchOpts(opts) {
  let frameSize = opts?.frameSize ?? 2048
  let hopSize = opts?.hopSize ?? (frameSize >> 2)
  let factor = opts?.factor ?? 1
  let synHop = opts?.synHop ?? hopSize
  let anaHop = opts?.anaHop
  if (anaHop == null) {
    if (typeof factor === 'function') {
      let sr = opts?.sampleRate ?? opts?.fs ?? 44100
      anaHop = fs => hopSize / Math.max(1e-6, factor(Math.max(0, fs) / sr))
    } else anaHop = Math.max(1, Math.round(hopSize / factor))
  }
  return { ...opts, frameSize, hopSize, synHop, anaHop }
}
