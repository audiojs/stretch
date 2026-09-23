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

export interface TransientOpts extends StretchOpts {
  transientThreshold?: number
}

declare const transient: {
  (data: Float32Array, opts?: TransientOpts): Float32Array
  (opts?: TransientOpts): StreamWriter
}
export default transient
