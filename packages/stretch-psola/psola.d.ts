import type { StreamWriter } from '@audio/stretch-core'

export interface PsolaOpts {
  factor?: number
  sampleRate?: number
  minFreq?: number
  maxFreq?: number
  /** Pitch-contour sampling interval in samples (default max(12, minPeriod*0.75)) */
  pitchHop?: number
}

declare const psola: {
  (data: Float32Array, opts?: PsolaOpts): Float32Array
  (opts?: PsolaOpts): StreamWriter
}
export default psola
