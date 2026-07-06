import type { StreamWriter, StretchOpts } from '@audio/stretch-core'

export interface TransientOpts extends StretchOpts {
  transientThreshold?: number
}

declare const transient: {
  (data: Float32Array, opts?: TransientOpts): Float32Array
  (opts?: TransientOpts): StreamWriter
}
export default transient
