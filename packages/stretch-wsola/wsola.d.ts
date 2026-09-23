/** Streaming form: call with a chunk to process it, with no argument to flush the tail */
export interface StreamWriter {
  (chunk: Float32Array): Float32Array
  (): Float32Array
}

export interface WsolaOpts {
  factor?: number
  frameSize?: number
  hopSize?: number
  delta?: number
}

declare const wsola: {
  (data: Float32Array, opts?: WsolaOpts): Float32Array
  (opts?: WsolaOpts): StreamWriter
}
export default wsola
