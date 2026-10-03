# @audio/stretch-pvsola

A phase-locked vocoder whose frames restart from the input's own waveform wherever it fits (PVSOLA, Moinet & Dutoit, DAFx 2011; the shape-invariant vocoder of Röbel, DAFx 2010). Each frame is propagated by the vocoder, then the input frame itself is tried in its place within ±4.5 ms: where its waveform matches (normalized correlation ≥ 0.6), the frame takes the input's own phases and a voice keeps the shape of its glottal pulses. Where nothing matches (noise, breath, reverberation), the frame stays the vocoder's, which makes new noise instead of repeating it.

```js
import pvsola from '@audio/stretch-pvsola'

let out = pvsola(samples, { factor: 1.5 })
let [l, r] = pvsola([left, right], { factor: 2, sampleRate: 48000 })   // one decision and shift for both

let write = pvsola({ factor: 1.5 })   // streaming
write(block1)
let tail = write()                     // flush
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio, or a function of input seconds |
| `sampleRate` | `44100` | |
| `frameSize` | 46 ms | Frame, a power of 2; the hop is a quarter of it |
| `shift` | 4.5 ms | Shift searched for a reset (±) |

Hosts with their own time map use the engine: `stretcher(channels, { at: s => inputSample, sampleRate })` → `{ write(channels), end() }`, its output aligned to its sample 0.

Slowing speech by copying the waveform (WSOLA) plays a few milliseconds again at every splice; over noise that repeat and its crossfade are a comb filter whose delay changes from splice to splice, a flanger. On speech slowed 1.5 and 2× (VoiceBank, Spoken Wikipedia, a lecture):

| | Pulse shape | Sharp onsets per input onset | Periodicity in noise (input 0.30) |
|---|---|---|---|
| phase-locked vocoder | 0.63 / 0.62 | 0.23 / 0.25 | 0.40 / 0.45 |
| WSOLA | 0.93 / 0.91 | 1.28 / 1.71 | 0.53 / 0.60 |
| PVSOLA | 0.89 / 0.85 | 1.04 / 1.23 | 0.40 / 0.46 |

A frame that matches nearly as well by continuing the frame before is preferred, so the four frames over any sample carry the same waveform; a frame keeps a reset, or the vocoder, a little longer once chosen; and above 8 kHz (breath, sibilance, the room's air) a reset keeps the vocoder's phases.

**Use when:** slowing speech or a solo voice. **Shortening:** [`@audio/stretch-wsola`](../stretch-wsola) skips instead of repeating and keeps attacks better (0.82 against 0.72 at 0.7×).

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
