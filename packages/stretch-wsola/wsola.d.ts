import type { StreamWriter } from '@audio/stretch-core'

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
