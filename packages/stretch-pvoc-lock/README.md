# @audio/stretch-pvoc-lock

Phase-locked vocoder (Laroche & Dolson, 1999). After propagating phases, locks non-peak bins to their nearest spectral peak's rotation — restores harmonic phase coherence and eliminates the phasiness of plain phase vocoder.

```js
import pvocLock from '@audio/stretch-pvoc-lock'
let out = pvocLock(data, { factor: 2 })
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT size (power of 2) |
| `hopSize` | `frameSize/4` | Hop between frames |

**Use when:** general music — tonal/ambient material.<br>
**Not for:** percussive material where attacks must stay sharp — use [`@audio/stretch-transient`](../stretch-transient).

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
