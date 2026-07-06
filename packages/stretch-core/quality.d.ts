export interface QualityOpts {
  frameSize?: number
  hopSize?: number
  trim?: number
  floor?: number
}

export function lsd(a: Float32Array, b: Float32Array, opts?: QualityOpts): number
export function spectralSim(a: Float32Array, b: Float32Array, opts?: QualityOpts): number
export function goertzelEnergy(data: Float32Array, freq: number, sr: number): number
export function chordBalance(data: Float32Array, freqs: number[], sr: number): number
export function chordRetention(data: Float32Array, ref: Float32Array, freqs: number[], sr: number): number

export interface ModulationDepthOpts {
  envWindow?: number
  envHop?: number
  trim?: number
}
export function modulationDepth(data: Float32Array, freqs: number[], sr: number, opts?: ModulationDepthOpts): number
