/** Streaming form: call with a chunk to process it, with no argument to flush the tail */
export interface StreamWriter {
  (chunk: Float32Array): Float32Array
  (chunk: Float32Array[]): Float32Array[]
  (): Float32Array | Float32Array[]
}

export interface PvsolaOpts {
  /** Time stretch ratio, or a function of input seconds (sliding stretch) */
  factor?: number | ((t: number) => number)
  /** Input sample for an output sample: any time map (overrides `factor`) */
  at?: (s: number) => number
  sampleRate?: number
  /** Frame, samples, a power of 2 (default 46 ms) */
  frameSize?: number
  /** Shift searched for a reset, ±samples (default 4.5 ms) */
  shift?: number
}

export interface Stretcher {
  write(chunk: Float32Array[]): Float32Array[]
  end(): Float32Array[]
}

/** The engine over `channels` channels, for hosts: output aligned to its own sample 0 */
export function stretcher(channels: number, opts?: PvsolaOpts): Stretcher
/** Frame geometry in samples: N frame, H hop, T shift searched */
export function geometry(opts?: PvsolaOpts): { N: number, H: number, T: number }

declare const pvsola: {
  (data: Float32Array | Float64Array, opts?: PvsolaOpts): Float32Array
  (data: (Float32Array | Float64Array)[], opts?: PvsolaOpts): Float32Array[]
  (opts?: PvsolaOpts): StreamWriter
}
export default pvsola
