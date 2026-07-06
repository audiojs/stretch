# @audio/stretch [![test](https://github.com/audiojs/time-stretch/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/time-stretch/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/@audio/stretch)](https://www.npmjs.com/package/@audio/stretch) [![license](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/audiojs/time-stretch/blob/main/LICENSE)

Time stretching algorithms — umbrella over `@audio/stretch-*` atoms.

| Atom | Algorithm | Domain | Quality | CPU | Best for |
|---|---|---|---|---|---|
| [`@audio/stretch-wsola`](#wsola) | WSOLA | time | ★★★ | low | speech, real-time |
| [`@audio/stretch-psola`](#psola) | PSOLA | time | ★★★★ | medium | speech, monophonic instruments |
| [`@audio/stretch-pvoc`](#pvoc) | plain phase vocoder | freq | ★★ | medium | educational baseline |
| [`@audio/stretch-pvoc-lock`](#pvoc-lock) | phase-locked vocoder | freq | ★★★★ | medium | general music |
| [`@audio/stretch-transient`](#transient) | transient-aware vocoder | freq | ★★★★★ | medium | music with percussion |
| [`@audio/stretch-paulstretch`](#paulstretch) | PaulStretch | freq | — | medium | extreme stretch (ambient, drones) |
| [`@audio/stretch-sms`](#sms) | Sinusoidal Modeling | sinusoidal | ★★★★ | high | harmonic / tonal material |

For pitch shifting, see the `@audio/shift-*` family.


## Usage

Install the umbrella (all atoms):

```
npm install @audio/stretch
```

```js
import { transient, wsola } from '@audio/stretch'

let slower = transient(samples, { factor: 2 })          // 2× slower, same pitch
let fast   = wsola(samples, { factor: 0.75 })           // 1.33× faster

let write = transient({ factor: 1.5 })                  // real-time streaming
write(block1)
write(block2)
write()                                                  // → remaining samples
```

Or install just the atom you need — each is self-contained:

```
npm install @audio/stretch-transient
```

```js
import transient from '@audio/stretch-transient'
let out = transient(samples, { factor: 2 })
```

> Mono `Float32Array` in/out. For stereo, process channels independently. Output sizes may be variable — small or empty early chunks are normal in streaming.

## Time domain

### `wsola` — `@audio/stretch-wsola`

Waveform Similarity Overlap-Add. Divides signal into overlapping frames and places them at new synthesis positions, but before placing each frame searches ±delta samples for the read position that maximizes cross-correlation with the natural progression of the previous grain through the input — eliminating the phase cancellation (flanging) of plain OLA. No FFT overhead.

```js
import wsola from '@audio/stretch-wsola'

wsola(data, { factor: 1.5 })
wsola(data, { factor: 0.5, delta: 512 })
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | Window size |
| `hopSize` | `frameSize/4` | Hop between frames |
| `delta` | `frameSize/4` | Search range (±samples) |

**Use when:** Speech, real-time with tight CPU budgets, moderate ratios (0.5–2×).<br>
**Not for:** Polyphonic music with sustained tones — frequency-domain methods handle harmonics better.


### `psola` — `@audio/stretch-psola`

Pitch-Synchronous Overlap-Add. Detects pitch period via autocorrelation, then windows grains at pitch cycle boundaries. Because grains align with the pitch cycle there are no phase discontinuities at overlaps — cleaner than WSOLA for monophonic pitched signals.

```js
import psola from '@audio/stretch-psola'

psola(data, { factor: 1.5 })
psola(data, { factor: 0.75, sampleRate: 48000 })
psola(data, { factor: 2, minFreq: 100, maxFreq: 400 })  // male voice range
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `sampleRate` | `44100` | For pitch detection frequency range |
| `minFreq` | `80` | Lowest expected pitch (Hz) |
| `maxFreq` | `500` | Highest expected pitch (Hz) |

**Use when:** Speech, solo vocals, monophonic instruments, factors 0.5–2×.<br>
**Not for:** Polyphonic material — autocorrelation finds one pitch period so chords get mangled. Extreme ratios (>2×) cause gaps.


## Frequency domain

### `pvoc` — `@audio/stretch-pvoc`

Plain phase vocoder. Each bin's phase advances at its instantaneous frequency independently. Magnitudes are preserved but incoherent inter-harmonic phase relationships give complex signals a diffuse, "underwater" quality.

```js
import pvoc from '@audio/stretch-pvoc'
pvoc(data, { factor: 2 })
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT size (power of 2) |
| `hopSize` | `frameSize/4` | Hop between frames |

**Use when:** Educational baseline, simple tonal signals.<br>
**Not for:** General music — use [`pvoc-lock`](#pvoc-lock) or [`transient`](#transient).


### `pvoc-lock` — `@audio/stretch-pvoc-lock`

Phase-locked vocoder (Laroche & Dolson, 1999). After propagating phases, locks non-peak bins to their nearest spectral peak's rotation. Restores harmonic phase coherence, eliminating phasiness.

```js
import pvocLock from '@audio/stretch-pvoc-lock'
pvocLock(data, { factor: 2 })
```

Same options as [`pvoc`](#pvoc).

**Use when:** General music — tonal/ambient material where transient resets aren't needed.<br>
**Not for:** Percussive material where attacks matter — use [`transient`](#transient).


### `transient` — `@audio/stretch-transient`

Transient-aware phase-locked vocoder (Röbel, 2003). Measures spectral flux between frames; on a sharp onset it resets to the original analysis phase instead of propagating it, preserving attack sharpness on drums and plucks. Implies phase locking.

```js
import transient from '@audio/stretch-transient'

transient(data, { factor: 2 })
transient(data, { factor: 1.5, transientThreshold: 2.0 })  // less sensitive detection
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT size (power of 2) |
| `hopSize` | `frameSize/4` | Hop between frames |
| `transientThreshold` | `1.5` | Spectral flux threshold (higher = fewer resets) |

**Use when:** The right default for most music — percussion, mixed sources.<br>
**Not for:** Voice/speech — use [`psola`](#psola). Extreme stretch — use [`paulstretch`](#paulstretch).


### `paulstretch` — `@audio/stretch-paulstretch`

Extreme time stretching via phase randomization (Nasca, 2006). Preserves magnitudes but replaces all phases with random values, producing smooth, dreamlike textures. Designed for large factors.

```js
import paulstretch from '@audio/stretch-paulstretch'

paulstretch(data, { factor: 8 })
paulstretch(data, { factor: 100, frameSize: 8192 })
```

| Param | Default | |
|---|---|---|
| `factor` | `8` | Time stretch ratio (best >2×) |
| `frameSize` | `4096` | FFT size (larger = smoother) |
| `seed` | `0x1f123bb5` | PRNG seed (deterministic output) |

**Use when:** Ambient music, sound design, drone generation, 8×–1000× stretch.<br>
**Not for:** Small ratios (<2×) — sounds washed out. Not for preserving rhythm or transients.


## Sinusoidal

### `sms` — `@audio/stretch-sms`

Sinusoidal Modeling Synthesis (Serra 1989, McAulay-Quatieri 1986). Decomposes audio into individually tracked sinusoidal partials and resynthesizes at the new time rate. Each partial's frequency and magnitude are interpolated independently — no phase spreading or bin-by-bin artifacts.

```js
import sms from '@audio/stretch-sms'

sms(data, { factor: 2 })
sms(data, { factor: 0.5, maxTracks: 80 })
sms(data, { factor: 3, frameSize: 4096 })
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT frame size |
| `hopSize` | `frameSize/4` | Hop between frames |
| `maxTracks` | `60` | Max simultaneous sinusoidal tracks |
| `minMag` | `1e-4` | Peak detection threshold (linear) |
| `freqDev` | `3` | Max frequency deviation (bins) for track continuation |
| `residualMix` | `1` | Stochastic residual blended into the sinusoidal output |

**Use when:** Harmonic / tonal content — instruments, chords, vocals — where the phase vocoder introduces smearing. Default `residualMix=1` blends breath, noise, and transient energy alongside the sinusoidal model.<br>
**Not for:** Noise-dominated material.


## Shared — `@audio/stretch-core`

Helpers and quality metrics shared across atoms:

```js
import { hannWindow, wrapPhase, resample, writer, makeStreamBufs } from '@audio/stretch-core'
import { lsd, spectralSim, chordBalance, chordRetention, modulationDepth } from '@audio/stretch-core/quality'
```

`lsd` (log-spectral distance), `spectralSim` (cosine similarity), `chordBalance`, `chordRetention`, and `modulationDepth` (AM depth per partial) evaluate algorithm output against a reference.


## Research & comparison

| Command | What it does |
|---|---|
| `node scripts/compare.js` | writes `compare.html` — interactive waveforms, playback, internal-vs-external comparisons |
| `node scripts/bench.js` | throughput and ×realtime numbers for batch and streaming |
| `node scripts/diagnose.js` | targeted diagnostics for specific algorithm behaviors |

[Demo](https://audiojs.github.io/time-stretch/) for a lightweight browser listening matrix.


## See also

* [fourier-transform](https://github.com/audiojs/fourier-transform) — FFT + STFT kernels
* [@audio/shift-*](https://github.com/audiojs/pitch-shift) — pitch shifting family
* [@audio/filter](https://github.com/audiojs/audio-filter) — audio filters
* [digital-filter](https://github.com/audiojs/digital-filter) — filter design


## References

* Verhelst, W. & Roelands, M. (1993). "An overlap-add technique based on waveform similarity (WSOLA)." _ICASSP_.
* Laroche, J. & Dolson, M. (1999). "Improved phase vocoder time-scale modification of audio." _IEEE Trans. Speech Audio Processing_.
* Röbel, A. (2003). "A new approach to transient processing in the phase vocoder." _DAFx_.
* Nasca, P. (2006). "PaulStretch — extreme time stretching." _paulnasca.com_.
* Moulines, E. & Charpentier, F. (1990). "Pitch-synchronous waveform processing techniques for text-to-speech synthesis using diphones." _Speech Communication_, 9(5-6).
* Driedger, J. & Müller, M. (2016). "A review of time-scale modification of music signals." _Applied Sciences_, 6(2).
* Serra, X. (1989). "A System for Sound Analysis/Transformation/Synthesis Based on a Deterministic plus Stochastic Decomposition." PhD thesis, Stanford.
* McAulay, R.J. & Quatieri, T.F. (1986). "Speech analysis/synthesis based on a sinusoidal representation." _IEEE Trans. ASSP_, 34(4).


<div align="center">

[MIT](https://github.com/audiojs/time-stretch/blob/main/LICENSE) [ॐ](https://github.com/krishnized/license)

</div>
