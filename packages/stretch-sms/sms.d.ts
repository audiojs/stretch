import type { StreamWriter } from '@audio/stretch-core'

export interface SmsOpts {
  factor?: number
  frameSize?: number
  hopSize?: number
  maxTracks?: number
  minMag?: number
  freqDev?: number
  residualMix?: number
}

declare const sms: {
  (data: Float32Array, opts?: SmsOpts): Float32Array
  (opts?: SmsOpts): StreamWriter
}
export default sms
