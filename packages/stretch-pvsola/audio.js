// audio manifest: PVSOLA, a phase-locked vocoder reset to the input waveform where it fits.
// Whole-render (streaming: false) with a structural `frames` hook: output length =
// round(input × factor); the host sizes output buffers from it (variable-length whole op).

import stretchFn from './pvsola.js'

export const stretchPvsola = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		// the channels together: one search, so the image stays put
		const res = stretchFn(inp, { factor: params.factor[0], sampleRate: ctx.sampleRate })
		for (let c = 0; c < inp.length; c++) out[c].set(res[c].length > out[c].length ? res[c].subarray(0, out[c].length) : res[c])
	}
}
stretchPvsola.channels = 'any'
stretchPvsola.streaming = false
stretchPvsola.frames = (n, { params }) => Math.round(n * params.factor[0])
stretchPvsola.params = {
	factor: { type: 'number', min: 0.25, max: 4, default: 1 },
}
