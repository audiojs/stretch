# @audio/stretch-psola

Pitch-Synchronous Overlap-Add. Detects pitch period via autocorrelation, windows grains at pitch-cycle boundaries, then re-spaces them — no phase discontinuities at overlaps.

```js
import psola from '@audio/stretch-psola'

psola(data, { factor: 1.5 })
psola(data, { factor: 2, minFreq: 100, maxFreq: 400 })   // male voice range
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `sampleRate` | `44100` | For pitch detection range |
| `minFreq` | `80` | Lowest expected pitch (Hz) |
| `maxFreq` | `500` | Highest expected pitch (Hz) |

Falls through to WSOLA on unvoiced/polyphonic frames (autocorrelation peak < 0.72).

The exact zeros after the input's last sound count in no voicing share: the pitch contour runs over the sound and the shares count only its marks, so a voice followed by silence, its own or what a host appends to hear the ring, chooses among PSOLA, WSOLA and their blend by its own frames, and its grains run on into the silence. A dithered tail is sound to it, and its length counts. The stream stretches the input in overlapping segments, each choosing on its own: a segment that ends inside a run of exact zeros chooses by the sound before them, where the batch of the whole input counts the run in its shares.

**Use when:** speech, solo vocals, monophonic instruments, factors 0.5–2×.<br>
**Not for:** polyphonic material, extreme ratios (>2× causes gaps).

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
