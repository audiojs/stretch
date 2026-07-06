import type { StreamWriter, StretchOpts } from '@audio/stretch-core'

export type PvocOpts = StretchOpts

declare const pvoc: {
  (data: Float32Array, opts?: PvocOpts): Float32Array
  (opts?: PvocOpts): StreamWriter
}
export default pvoc
