import type { StreamWriter } from '@audio/stretch-core'

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
