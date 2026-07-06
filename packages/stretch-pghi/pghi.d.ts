import type { StreamWriter, StretchOpts } from '@audio/stretch-core'

export interface PghiOpts extends StretchOpts {
  /** Bins below tolerance×frame-max get random phase (no reliable gradient). Default 1e-6 */
  tolerance?: number
}

declare const pghi: {
  (data: Float32Array, opts?: PghiOpts): Float32Array
  (opts?: PghiOpts): StreamWriter
}
export default pghi
