# @audio/stretch-pghi

Phase Gradient Heap Integration vocoder — "Phase Vocoder Done Right" (Průša & Holighaus, 2017), causal RTPGHI variant. Synthesis phase is integrated from the analysis phase gradients (instantaneous frequency across time, stretched group delay across frequency), visiting bins in order of decreasing magnitude via a max-heap — phase always flows from strong bins into their neighbourhoods.

No peak picking, no transient heuristics: chirps, vibrato and dense spectra stay coherent by construction.

```js
import pghi from '@audio/stretch-pghi'
let out = pghi(data, { factor: 2 })
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT size (power of 2) |
| `hopSize` | `frameSize/8` | Hop — gradient integration wants denser frames than peak locking |
| `tolerance` | `1e-6` | Bins below `tolerance×max` get random phase |

**Use when:** modulated material — vibrato, glides, chirps, pitch-unstable sources (measured: beats [`@audio/stretch-pvoc-lock`](../stretch-pvoc-lock) on tones/glissandi, ~4× better than plain pvoc on sweeps).<br>
**Not for:** steady polyphony — identity phase locking reproduces exact intra-region phase relations that first-order gradient integration only approximates; use [`@audio/stretch-pvoc-lock`](../stretch-pvoc-lock) there.

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
