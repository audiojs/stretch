/** Streaming form: call with a chunk to process it, with no argument to flush the tail */
export interface StreamWriter {
  (chunk: Float32Array): Float32Array
  (): Float32Array
}

/** Streaming form over several channels: a chunk of each in, what is ready of each out; no argument flushes the tails */
export interface ChannelsWriter {
  (chunks: Float32Array[]): Float32Array[]
  (): Float32Array[]
}

export interface StretchOpts {
  /** time-stretch ratio (output / input duration) */
  factor?: number
  frameSize?: number
  hopSize?: number
  synHop?: number
  anaHop?: number
}

export interface PvocLockOpts extends Omit<StretchOpts, 'factor'> {
  /** time-stretch ratio, or `t => ratio` of source time in seconds (sliding stretch) */
  factor?: number | ((t: number) => number)
  /** Hz, for a sliding `factor`, default 44100 */
  sampleRate?: number
  /** several channels as one sound: one rotation for all of them, the level and phase between channels kept (the image, the mono sum); default false, each channel apart */
  together?: boolean
}

declare const pvocLock: {
  (data: Float32Array, opts?: PvocLockOpts): Float32Array
  /** an array of channels, each stretched apart; with `together`, as long as each other, as one sound */
  (data: (Float32Array | Float64Array)[], opts?: PvocLockOpts): Float32Array[]
  /** one vocoder for `channels` channels, their frames at the same places; each channel's samples are those its own stream gives, unless `together` */
  (opts: PvocLockOpts & { channels: number }): ChannelsWriter
  (opts?: PvocLockOpts): StreamWriter
}
export default pvocLock
