/** Streaming form: call with a chunk to process it, with no argument to flush the tail */
export interface StreamWriter {
  (chunk: Float32Array): Float32Array
  (chunk: Float32Array[]): Float32Array[]
  (): Float32Array | Float32Array[]
}

export interface WsolaOpts {
  /** Time stretch ratio, or a function of input seconds (sliding stretch) */
  factor?: number | ((t: number) => number)
  /** Input sample for an output sample: any time map (overrides `factor`) */
  at?: (s: number) => number
  /** With `at`: the input's length, or a function giving it once known (Infinity until then) */
  end?: number | (() => number)
  sampleRate?: number
  /** Segment, samples (default 40 ms) */
  frameSize?: number
  /** Output hop, samples (default 3/5 of the segment) */
  hopSize?: number
  /** Search, ±samples (default 8 ms) */
  delta?: number
}

export interface Stretcher {
  write(chunk: Float32Array[]): Float32Array[]
  end(): Float32Array[]
}

/** The engine over `channels` channels, for hosts: output aligned to its own sample 0 */
export function stretcher(channels: number, opts?: WsolaOpts): Stretcher
/** Segment geometry in samples: S segment, H hop, O crossfade, D search */
export function geometry(opts?: WsolaOpts): { S: number, H: number, O: number, D: number }

declare const wsola: {
  (data: Float32Array | Float64Array, opts?: WsolaOpts): Float32Array
  (data: (Float32Array | Float64Array)[], opts?: WsolaOpts): Float32Array[]
  (opts?: WsolaOpts): StreamWriter
}
export default wsola
