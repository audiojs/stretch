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

**Use when:** speech, solo vocals, monophonic instruments, factors 0.5–2×.<br>
**Not for:** polyphonic material, extreme ratios (>2× causes gaps).

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
