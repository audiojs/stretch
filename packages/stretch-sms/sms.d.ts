/** Streaming form: call with a chunk to process it, with no argument to flush the tail */
export interface StreamWriter {
  (chunk: Float32Array): Float32Array
  (): Float32Array
}

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
