import type { StreamWriter, StretchOpts } from '@audio/stretch-core'

export type PvocLockOpts = StretchOpts

declare const pvocLock: {
  (data: Float32Array, opts?: PvocLockOpts): Float32Array
  (opts?: PvocLockOpts): StreamWriter
}
export default pvocLock
