/** Streaming form: call with a chunk to process it, with no argument to flush the tail */
export interface StreamWriter {
  (chunk: Float32Array): Float32Array
  (): Float32Array
}

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
