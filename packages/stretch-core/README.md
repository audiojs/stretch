# @audio/stretch-core

Shared helpers and quality metrics for `@audio/stretch-*` atoms. Not a stretching algorithm itself.

```js
import { hannWindow, wrapPhase, resample, writer, makeStreamBufs, stretchOpts } from '@audio/stretch-core'
import { lsd, spectralSim, chordBalance, chordRetention, modulationDepth } from '@audio/stretch-core/quality'
```

## Helpers (`./`)

| Export | |
|---|---|
| `hannWindow(n)` | precomputed Hann coefficients |
| `wrapPhase(p)` | wrap to (-π, π] |
| `resample(data, outLen)` | windowed-sinc resampling (anti-aliased when downsampling) |
| `writer(streamObj)` | adapt `{write, flush}` to a single callable |
| `makeStreamBufs()` | shared streaming buffer factory |
| `stretchOpts(opts)` | translate `{factor}` → `{anaHop, synHop}` for `fourier-transform/stft` |

## Quality (`./quality`)

| Export | |
|---|---|
| `lsd(out, ref)` | log-spectral distance (dB) — lower is closer |
| `spectralSim(out, ref)` | spectral cosine similarity — higher is closer |
| `chordBalance(out, freqs, fs)` | per-partial energy balance via Goertzel |
| `chordRetention(out, ref, freqs, fs)` | partial-energy ratio out/ref |
| `modulationDepth(out, freqs, fs)` | AM depth at each partial — catches "crumble" |

Used by `@audio/stretch`'s test suite and research scripts to compare algorithms.

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
