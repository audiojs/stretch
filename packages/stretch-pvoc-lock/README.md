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

Streaming, called with options alone: a writer, a chunk in and what is ready out, no argument to flush. With `channels`, one vocoder for all of them, their frames at the same places; each channel's samples are those its own stream gives (two channels' transforms run at once where WebAssembly SIMD runs, `fourier-transform` 2.6).

```js
let write = pvocLock({ factor: 2, channels: 2 })
let [l, r] = write([left, right])   // a chunk of each
;[l, r] = write()                   // the tails
```

**Use when:** general music — tonal/ambient material.<br>
**Not for:** percussive material where attacks must stay sharp — use [`@audio/stretch-transient`](../stretch-transient).

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
