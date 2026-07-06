# @audio/stretch-transient

Transient-aware phase-locked vocoder (Röbel, 2003). Measures spectral flux between frames; on a sharp onset resets to the original analysis phase instead of propagating it, preserving attack sharpness on drums and plucks. Implies phase locking.

```js
import transient from '@audio/stretch-transient'

transient(data, { factor: 2 })
transient(data, { factor: 1.5, transientThreshold: 2.0 })   // less sensitive
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT size (power of 2) |
| `hopSize` | `frameSize/4` | Hop between frames |
| `transientThreshold` | `1.5` | Spectral flux threshold (higher = fewer resets) |

**Use when:** the right default for most music — percussion, mixed sources.<br>
**Not for:** voice/speech (use [`@audio/stretch-psola`](../stretch-psola)) or extreme stretch (use [`@audio/stretch-paulstretch`](../stretch-paulstretch)).

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
