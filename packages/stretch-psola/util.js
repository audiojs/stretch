// Local helpers (inlined family convention — no shared-dep package).

export const PI2 = Math.PI * 2

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
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
