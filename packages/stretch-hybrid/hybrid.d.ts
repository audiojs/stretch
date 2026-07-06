import type { StreamWriter } from '@audio/stretch-core'

export interface HybridOpts {
  factor?: number
  /** FFT size for HPSS analysis and the harmonic (vocoder) path (default 2048) */
  frameSize?: number
  hopSize?: number
  /** OLA frame for the percussive path — short keeps attacks tight (default 512) */
  percFrame?: number
  /** Median-filter length across time, in frames (default 17) */
  harmMedian?: number
  /** Median-filter length across frequency, in bins (default 17) */
  percMedian?: number
}

declare const hybrid: {
  (data: Float32Array, opts?: HybridOpts): Float32Array
  (opts?: HybridOpts): StreamWriter
}
export default hybrid
