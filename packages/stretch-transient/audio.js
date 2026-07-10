// audio manifest — transient-preserving vocoder — detected onsets pass unstretched.
// Whole-render (streaming: false) with a structural `frames` hook: output length =
// round(input × factor); the host sizes output buffers from it (variable-length whole op).

import stretchFn from './transient.js'

export const stretchTransient = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const factor = params.factor[0]
		for (let c = 0; c < inp.length; c++) {
			const r = stretchFn(inp[c], { factor, fs: ctx.sampleRate, sampleRate: ctx.sampleRate })
			out[c].set(r.length > out[c].length ? r.subarray(0, out[c].length) : r)
		}
	}
}
stretchTransient.channels = 'any'
stretchTransient.streaming = false
stretchTransient.frames = (n, { params }) => Math.round(n * params.factor[0])
stretchTransient.params = {
	factor: { type: 'number', min: 0.25, max: 4, default: 1 },
}
