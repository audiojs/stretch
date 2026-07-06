# @audio/stretch-wsola

Waveform Similarity Overlap-Add time stretching. Search ±delta around each synthesis hop for the position that best correlates with the running output — eliminates the flanging of plain OLA, no FFT.

```js
import wsola from '@audio/stretch-wsola'

let out = wsola(samples, { factor: 1.5 })

let write = wsola({ factor: 2 })   // streaming
write(block1)
let tail = write()                  // flush
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | Window size |
| `hopSize` | `frameSize/4` | Hop between frames |
| `delta` | `frameSize/4` | Search range (±samples) |

**Use when:** speech, real-time, moderate ratios (0.5–2×). Polyphonic music is better served by [`@audio/stretch-pvoc-lock`](../stretch-pvoc-lock) or [`@audio/stretch-transient`](../stretch-transient).

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
