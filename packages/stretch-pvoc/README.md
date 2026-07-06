# @audio/stretch-pvoc

Plain phase vocoder. Each FFT bin's phase advances at its instantaneous frequency. Magnitudes preserved, but inter-harmonic phase coherence is lost — complex signals get a diffuse, "underwater" character. Educational baseline.

```js
import pvoc from '@audio/stretch-pvoc'
let out = pvoc(data, { factor: 2 })
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT size (power of 2) |
| `hopSize` | `frameSize/4` | Hop between frames |

**Use when:** learning the phase-vocoder algorithm, simple tonal signals.<br>
**Not for:** general music — use [`@audio/stretch-pvoc-lock`](../stretch-pvoc-lock) or [`@audio/stretch-transient`](../stretch-transient).

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
