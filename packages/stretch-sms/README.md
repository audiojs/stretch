# @audio/stretch-sms

Sinusoidal Modeling Synthesis (Serra 1989, McAulay-Quatieri 1986). Decomposes audio into individually tracked sinusoidal partials and resynthesizes at the new time rate — frequency and magnitude of each partial interpolated independently, no bin-by-bin smearing.

```js
import sms from '@audio/stretch-sms'

sms(data, { factor: 2 })
sms(data, { factor: 0.5, maxTracks: 80 })
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT frame size |
| `hopSize` | `frameSize/4` | Hop between frames |
| `maxTracks` | `60` | Max simultaneous sinusoidal tracks |
| `minMag` | `1e-4` | Peak detection threshold (linear) |
| `freqDev` | `3` | Max frequency deviation (bins) for track continuation |
| `residualMix` | `1` | Stochastic residual blended into output |

**Use when:** harmonic / tonal content — instruments, chords, vocals — where the phase vocoder smears.<br>
**Not for:** noise-dominated material.

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
