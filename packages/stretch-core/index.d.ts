export const PI2: number

export function clamp(v: number, min: number, max: number): number
export function wrapPhase(p: number): number
export function normalize(out: Float32Array, norm: Float32Array): void
export function hannWindow(N: number): Float64Array
export function resample(data: Float32Array, outLen: number): Float32Array

export interface StreamWriter {
  (chunk: Float32Array): Float32Array
  (): Float32Array
}
export function writer(s: { write(chunk: Float32Array): Float32Array, flush(): Float32Array }): StreamWriter

export interface StreamBufs {
  readonly ib: Float32Array
  readonly il: number
  readonly ob: Float32Array
  readonly nb: Float32Array
  readonly oread: number
  pos: number
  appendIn(chunk: Float32Array): void
  growOut(need: number): void
  compactIn(trim: number): void
  take(upTo: number): Float32Array
}
export function makeStreamBufs(N: number, nf?: number): StreamBufs

export interface StretchOpts {
  factor?: number
  frameSize?: number
  hopSize?: number
  synHop?: number
  anaHop?: number
}
export function stretchOpts<T extends StretchOpts>(opts?: T): T & {
  frameSize: number
  hopSize: number
  synHop: number
  anaHop: number
}

export function findPeaks(mag: ArrayLike<number>, half: number): Uint8Array
export function lockPhase(phase: ArrayLike<number>, propPhase: Float64Array, mag: ArrayLike<number>, half: number): void
