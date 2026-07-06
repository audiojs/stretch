# @audio/stretch-paulstretch

Extreme time stretching via phase randomization (Nasca, 2006). Preserves magnitudes but replaces all phases with a deterministic PRNG, producing smooth, dreamlike textures. Designed for large factors.

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

**Use when:** ambient music, sound design, drone generation, 8×–1000× stretch.<br>
**Not for:** small ratios (<2× sounds washed out), preserving rhythm or transients.

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
