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
