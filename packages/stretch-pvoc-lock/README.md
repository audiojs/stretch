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

`{ together: true }` stretches the channels as one sound: the lock step runs once a frame for all of them (`@audio/spectral-pvoc` `lockJoint`) and one rotation turns every channel's bin, so the level and phase between channels stay the input's in every frame. Apart, each channel's phases go their own way: on a stereo piano sped up 0.8× the lag at which left and right agree best wandered over ±60 samples where the recording holds it at 6 to 15, and the mono sum lost 1 to 3 dB; together, both are the recording's. Apart is the default, as it is Rubber Band's (`OptionChannelsApart`: "the highest quality for the individual channels but a more diffuse stereo image, an unnatural increase in 'width', and generally a loss of mono compatibility"); its `OptionChannelsTogether` is this option. Together is for a mono sum that must keep its level or an image that must hold. An array of channels takes it too: `pvocLock([left, right], { factor, together: true })`.

**Use when:** general music — tonal/ambient material.<br>
**Not for:** percussive material where attacks must stay sharp — use [`@audio/stretch-transient`](../stretch-transient).

Part of [`@audio/stretch`](../..).

## License

[MIT](./LICENSE) · [ॐ](https://github.com/krishnized/license/)
