/** Streaming form: call with a chunk to process it, with no argument to flush the tail */
export interface StreamWriter {
  (chunk: Float32Array): Float32Array
  (): Float32Array
}

export interface StretchOpts {
  /** time-stretch ratio (output / input duration) */
  factor?: number
  frameSize?: number
  hopSize?: number
  synHop?: number
  anaHop?: number
}

export interface PghiOpts extends StretchOpts {
  /** Bins below tolerance×frame-max get random phase (no reliable gradient). Default 1e-6 */
  tolerance?: number
}

declare const pghi: {
  (data: Float32Array, opts?: PghiOpts): Float32Array
  (opts?: PghiOpts): StreamWriter
}
export default pghi
