/** Streaming form: call with a chunk to process it, with no argument to flush the tail */
export interface StreamWriter {
  (chunk: Float32Array): Float32Array
  (): Float32Array
}

export interface PaulstretchOpts {
  factor?: number
  frameSize?: number
  seed?: number
}

declare const paulstretch: {
  (data: Float32Array, opts?: PaulstretchOpts): Float32Array
  (opts?: PaulstretchOpts): StreamWriter
}
export default paulstretch
