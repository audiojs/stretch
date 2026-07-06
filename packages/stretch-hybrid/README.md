# @audio/stretch-hybrid

Hybrid harmonic/percussive time stretch (Driedger & Müller). Median-filter HPSS splits the spectrogram into a harmonic and a percussive layer; the harmonic layer goes through the phase-locked vocoder, the percussive layer through short-frame OLA — chords stay coherent and attacks stay sharp, where a single algorithm must trade one for the other.

```js
import hybrid from '@audio/stretch-hybrid'
let out = hybrid(data, { factor: 2 })
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT size for HPSS + harmonic path |
| `hopSize` | `frameSize/4` | Hop between frames |
| `percFrame` | `512` | OLA frame for the percussive layer |
| `harmMedian` | `17` | Median filter across time (frames) |
| `percMedian` | `17` | Median filter across frequency (bins) |

**Use when:** full mixes — drums over tonal material.<br>
**Cost:** separation + two stretches ≈ 4–6× the CPU of [`@audio/stretch-pvoc-lock`](../stretch-pvoc-lock) alone; on purely tonal or purely percussive material the single-path algorithms match it for less.

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
