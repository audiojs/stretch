// Phase-locked vocoder (Laroche & Dolson, 1999). After propagating phases,
// locks non-peak bins to their nearest spectral peak's rotation — restores
// harmonic phase coherence, eliminating the "phasiness" of plain pvoc.
// Runs on the complex bins (@audio/spectral-pvoc lockStep): locked bins
// rotate by one complex multiply, only free bins take trigonometry.
// Channels run apart, each its own stream's samples; { together } runs them as one sound (lockJoint): one rotation
// for all of them.
//
// For attack preservation on percussion, use @audio/stretch-transient.

import { stftBatch, stftStream } from 'fourier-transform/stft'
import { writer, stretchOpts } from './util.js'
import { lockState, lockStep, jointState, lockJoint } from '@audio/spectral-pvoc'

function process(re, im, state, ctx) {
  let { half, anaHop, synHop, freqPerBin } = ctx
  let st = state.st ??= lockState(half)
  // Unlike plain pvoc, pre-pad partial frames are processed, not passed through:
  // per-frame peak locking re-coheres whatever the early propagation does, and
  // warming the phase state on pad frames measures ~0.2 dB better LSD at onset.
  lockStep(re, im, st, !state.started, anaHop, synHop, freqPerBin, half)
  state.started = true
  return { re, im }
}

// Channels together (@audio/spectral-pvoc lockJoint): the step once a frame for all of them, one rotation for all, so
// the level and phase between channels stay the input's: the image holds and the mono sum keeps its level, where a
// vocoder a channel lets each channel's phases go their own way. Apart is the default: each channel at its best,
// the image wider and more diffuse than the input's (the choice Rubber Band gives as OptionChannelsApart, its
// default, and OptionChannelsTogether).
function together(res, ims, state, ctx) {
  let { half, anaHop, synHop, freqPerBin } = ctx
  lockJoint(res, ims, state.j ??= jointState(half, res.length), !state.started, anaHop, synHop, freqPerBin, half)
  state.started = true
}

export default function pvocLock(data, opts) {
  // channel arrays + Float64Array accepted — parity with @audio/shift (audit: [L,R] was silently read as opts)
  if (Array.isArray(data) && (data[0] instanceof Float32Array || data[0] instanceof Float64Array)) {
    // channels of one sound, as long as each other, asked together: through the stream (its samples are the batch's)
    if (!opts?.together || data.length < 2 || (opts.factor ?? 1) === 1 || data.some(ch => ch.length !== data[0].length)) return data.map(ch => pvocLock(ch, opts))
    let write = pvocLock({ ...opts, channels: data.length }), head = write(data.map(ch => ch instanceof Float32Array ? ch : Float32Array.from(ch))), tail = write()
    return head.map((h, c) => { let out = new Float32Array(h.length + tail[c].length); out.set(h); out.set(tail[c], h.length); return out })
  }
  if (data instanceof Float64Array) data = Float32Array.from(data)
  if (!(data instanceof Float32Array)) return writer(data?.together && data.channels > 1 ? stftStream(together, { ...stretchOpts(data), complex: true, joint: true }) : stftStream(process, { ...stretchOpts(data), complex: true }))
  if ((opts?.factor ?? 1) === 1) return new Float32Array(data)
  return stftBatch(data, process, { ...stretchOpts(opts), complex: true })
}
