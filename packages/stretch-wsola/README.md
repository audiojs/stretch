# @audio/stretch-wsola

Waveform-similarity overlap-add (Verhelst & Roelands 1993), in the segment form of SoundTouch and sox `tempo`. Segments of the input are laid one hop apart, each crossfaded into the one before, each read where its head best continues the one before (normalized cross-correlation within ±`delta` of where the time map puts it). The waveform is copied, never resynthesized: a voice keeps its glottal pulse shape and its consonants their attacks, which a phase vocoder smears into a distant, reverberant sound.

```js
import wsola from '@audio/stretch-wsola'

let out = wsola(samples, { factor: 1.5 })
let [l, r] = wsola([left, right], { factor: 1.5, sampleRate: 48000 })   // one search for both: the image stays

let write = wsola({ factor: 2 })   // streaming
write(block1)
let tail = write()                  // flush
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio, or a function of input seconds |
| `sampleRate` | `44100` | |
| `frameSize` | 40 ms | Segment |
| `hopSize` | `frameSize · 3/5` | Output hop: segments cross over the rest, 16 ms (a 62.5 Hz period) |
| `delta` | 8 ms | Search, ± (half that period) |

Hosts with their own time map use the engine: `stretcher(channels, { at: s => inputSample, end, sampleRate })` → `{ write(channels), end() }`, its output aligned to its sample 0; where the map runs at rate 1 the output is the input. `end`, the input's length once known (a number or a function), keeps the last segments reading inside it.

The crossfade follows how alike the two sides are (Fink, Holters & Zölzer 2016): linear for the same waveform, equal-power for noise.

On speech (VoiceBank, Spoken Wikipedia, a lecture), ×0.7 to ×2: the spectrum 0.8 to 1.8 dB closer to the input's than the previous version (Hann frames at ¾ overlap), within 0.25 dB of sox `tempo -s`; 0.91 to 1.08 of the input's pulse peakiness kept, a phase-locked vocoder 0.62 to 0.71.

**Use when:** shortening speech, a solo voice, a monophonic instrument. Slowing, its repeats turn noise and reverberation into a flanger: use [`@audio/stretch-pvsola`](../stretch-pvsola). **Not for:** chords and mixes: one alignment cannot fit several pitches (a chord's balance at 2×: 0.18, the phase-locked vocoder's 0.9). Use [`@audio/stretch-pvoc-lock`](../stretch-pvoc-lock) or [`@audio/stretch-transient`](../stretch-transient).

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
