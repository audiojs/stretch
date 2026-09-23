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

export type PvocOpts = StretchOpts

declare const pvoc: {
  (data: Float32Array, opts?: PvocOpts): Float32Array
  (opts?: PvocOpts): StreamWriter
}
export default pvoc
