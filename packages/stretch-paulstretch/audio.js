// audio manifest — extreme smear time-stretch (Paul Nasca) — randomized-phase texture.
// Whole-render (streaming: false) with a structural `frames` hook: output length =
// round(input × factor). `frame` (seconds) rounds to the nearest power-of-2 FFT size;
// larger frames smear transients more (the signature paulstretch texture).

import stretchFn from './paulstretch.js'

export const stretchPaul = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const factor = params.factor[0]
		const frameSize = 2 ** Math.round(Math.log2(params.frame[0] * ctx.sampleRate))
		for (let c = 0; c < inp.length; c++) {
			const r = stretchFn(inp[c], { factor, frameSize, fs: ctx.sampleRate, sampleRate: ctx.sampleRate })
			out[c].set(r.length > out[c].length ? r.subarray(0, out[c].length) : r)
		}
	}
}
stretchPaul.channels = 'any'
stretchPaul.streaming = false
stretchPaul.frames = (n, { params }) => Math.round(n * params.factor[0])
// What a host pads the input with so the stretch's decay is rendered, in seconds of input: a grain reads N samples
// around input position k·hop/factor (hop N/2), so grains read the input until it is a hop behind them, and the last
// one's output ends a hop later, hop/factor more of input. Past hop·(1 + 1/factor) of padding the output is silent,
// exactly; its stretched length, factor times as long, follows from `frames`
stretchPaul.tail = ({ sampleRate, params }) => 2 ** Math.round(Math.log2(params.frame[0] * sampleRate)) / 2 * (1 + 1 / params.factor[0]) / sampleRate
stretchPaul.params = {
	factor: { type: 'number', min: 0.25, max: 8, default: 4 },
	frame:  { type: 'number', min: 0.05, max: 2, default: 0.37, unit: 's' },
}
