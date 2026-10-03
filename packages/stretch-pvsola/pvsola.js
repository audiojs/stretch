// PVSOLA: a phase-locked vocoder whose frames restart from the input's own waveform wherever it fits (Moinet & Dutoit,
// DAFx 2011; the shape-invariant vocoder of Röbel, DAFx 2010). Each frame is first propagated (identity phase locking,
// Laroche & Dolson 1999). Then the input frame itself is tried in its place, within ±`shift` of where the time map puts
// it: where its waveform matches the propagated one (normalized correlation ≥ .6), the frame takes the input's own
// phases, so a voice keeps the shape of its glottal pulses; where nothing matches (noise, breath, reverberation) the
// frame stays the vocoder's, which makes new noise instead of repeating it.
//
// Stretching speech by copying the waveform (WSOLA) plays a few milliseconds again at every splice; over noise, that
// repeat and its crossfade are a comb filter whose delay changes splice to splice: a flanger. The vocoder alone keeps
// each harmonic but not their alignment, and the voice goes distant. On speech slowed 1.5 and 2×: pulse shape kept
// 0.89 / 0.85 of the input's (vocoder 0.63 / 0.62, WSOLA 0.93 / 0.91), periodicity induced in noise 0.40 / 0.46 against
// the input's 0.30 (vocoder 0.40 / 0.45, WSOLA 0.53 / 0.60), sharp onsets 1.04 / 1.23 per input onset (vocoder 0.23,
// WSOLA 1.28 / 1.71).
//
// A frame that matches nearly as well (within .05) by simply continuing the frame before is preferred: the four frames
// overlapping any sample then carry the same waveform, where frames each placed at their own best put four copies of
// the room's reverberation, a pitch period apart, under every vowel (0.15 to 0.3 dB further from the input's spectrum).
// A frame stays with a reset, or with the vocoder, a little longer once chosen (.15 hysteresis): the lecture switched
// 18 times a second, now 13. Above 8 kHz a reset keeps the vocoder's phases: breath, sibilance and the room's air are
// noise there, and the input's own phases would repeat them. Listening preferred it; sharp onsets 1.04 / 1.23 from
// 1.10 / 1.32, pulse shape 0.89 / 0.85 from 0.92 / 0.87.
//
// pvsola(data, { factor }) → stretched copy (a Float32Array, or channels); pvsola(opts) → write(chunk) → the stream,
// write() → the rest. stretcher(channels, opts) is the engine, for hosts: `at(s)` puts output sample s at input sample
// at(s), the output aligned to its own sample 0. Channels share one decision and shift, on their mean.

import { fft, ifft } from 'fourier-transform'
import { lockState, lockAdvance } from '@audio/spectral-pvoc'
import { writer } from './util.js'

const MATCH = .6, HOLD = .15, KEEP = .05, AIR = 8000

/** Frame geometry at a sample rate, in samples: N the frame (46 ms), H the hop (N/4), T the shift searched (±4.5 ms). */
export function geometry(o = {}) {
  let sr = o.sampleRate || o.fs || 44100
  let N = o.frameSize ?? 2 ** Math.round(Math.log2(sr * 2048 / 44100))
  return { N, H: o.hopSize ?? N >> 2, T: Math.round(o.shift ?? .0045 * sr) }
}

/** The engine over `nch` channels: write(channels) → the output now final, end() → the rest. Options: `factor` (a number,
 *  or a function of input seconds) or `at` (output sample → input sample), `sampleRate`, `frameSize`, `shift`. */
export function stretcher(nch, o = {}) {
  let { N, H, T } = geometry(o), sr = o.sampleRate || o.fs || 44100, half = N >> 1, B = half + 1
  if (H !== N >> 2) throw new RangeError('pvsola: the hop is a quarter frame')
  // frame k is centred at output kH, on the input at centre(k); the output's length once the input is all in
  let f = o.factor ?? 1, at = o.at, centre, total = () => Infinity
  if (at) centre = k => at(k * H)
  else if (typeof f === 'number') { centre = k => k * H / f; total = n => Math.round(n * f) }
  else {
    let c = [-H / Math.max(1e-6, f(0))], tk = 0
    centre = k => { while (c.length <= k + 1) { let p = c[c.length - 1]; c.push(p + H / Math.max(1e-6, f(Math.max(0, p) / sr))) } return c[k + 1] }
    total = n => { while (centre(tk + 1) < n) tk++; let a = centre(tk), b = centre(tk + 1); return Math.round(tk * H + H * (n - a) / (b - a)) }
  }
  let win = Float64Array.from({ length: N }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / N))
  // how much of a reset each bin takes: all of it below the air band, none above, a crossover 16 bins wide at AIR Hz
  let kc = AIR / (sr / N), air = Float64Array.from({ length: B }, (_, b) => Math.max(0, Math.min(1, (kc + 8 - b) / 16)))
  let x = Array.from({ length: nch }, () => new Float32Array(1 << 15)), m = new Float32Array(1 << 15), base = 0, n = 0
  let st = Array.from({ length: nch }, () => lockState(half)), fr = new Float64Array(N), ys = Array.from({ length: nch }, () => null)
  let ym = new Float64Array(N), re = new Float64Array(B), im = new Float64Array(B)
  // overlap-added output from `obase`: frames centred at kH, four over each sample from 0 on (Σ Hann² = 1.5)
  let out = Array.from({ length: nch }, () => new Float64Array(4 * N)), obase = -H - half, sent = 0
  let k = -1, off = 0, lastA = 0, lastReset = false, first = true, ended = false
  let xa = (b, i) => { i -= base; return i >= 0 && i < n - base ? b[i] : 0 }
  let nominal = k => Math.round(centre(k) - half)

  function grow(need) {
    if (need <= m.length) return
    let len = Math.max(need, 2 * m.length), have = n - base
    x = x.map(a => { let b = new Float32Array(len); b.set(a.subarray(0, have)); return b })
    let mb = new Float32Array(len); mb.set(m.subarray(0, have)); m = mb
  }

  // a channel's frame read at `a`, its spectrum into re/im
  function analyse(c, a) {
    for (let i = 0; i < N; i++) fr[i] = xa(x[c], a + i) * win[i]
    let [r, j] = fft(fr)
    re.set(r); im.set(j)
    let mg = st[c].mag
    for (let b = 0; b < B; b++) mg[b] = Math.sqrt(re[b] * re[b] + im[b] * im[b])
  }

  // how well the input read at a matches the propagated frames (their mean, under the synthesis window): every other
  // sample, a normalized correlation
  let yy = 0
  function score(a) {
    let xy = 0, xx = 0
    for (let i = 0; i < N; i += 2) { let v = xa(m, a + i) * win[i]; xy += v * ym[i]; xx += v * v }
    return xy / Math.sqrt(xx * yy + 1e-30)
  }

  function frame() {
    let a0 = nominal(k), a = a0 + off, did = first
    // propagate each channel from the frame before (the first starts on the input's phases)
    ym.fill(0)
    for (let c = 0; c < nch; c++) {
      analyse(c, a)
      lockAdvance(re, im, st[c], first, Math.max(1, a - lastA), H, 2 * Math.PI / N, half)
      let y = ys[c] = Float64Array.from(ifft(re, im))
      for (let i = 0; i < N; i++) ym[i] += y[i] * win[i] / nch
    }
    if (!first) {
      yy = 0
      for (let i = 0; i < N; i += 2) yy += ym[i] * ym[i]
      // the input's best shift, every other one, then either side; a frame that continues the one before, if nearly as good
      let best = -Infinity, bt = 0
      for (let t = -T; t <= T; t += 2) { let s = score(a0 + t); if (s > best) { best = s; bt = t } }
      for (let t = bt - 1; t <= bt + 1; t += 2) if (t >= -T && t <= T) { let s = score(a0 + t); if (s > best) { best = s; bt = t } }
      let ct = lastA + H - a0
      if (lastReset && Math.abs(ct) <= T) { let s = score(a0 + ct); if (s >= best - KEEP && s >= MATCH) { best = s; bt = ct } }
      if (best >= MATCH - (lastReset ? HOLD : 0)) {
        // reset: the input's own frame at that shift, its phases up to the air band, the vocoder's above it
        off = bt; a = a0 + bt; did = true
        for (let c = 0; c < nch; c++) {
          analyse(c, a)
          let s = st[c]
          for (let b = 0; b < B; b++) {
            let mg = s.mag[b], g = air[b]
            if (mg > 0 && g > 0) {
              let vr = g * re[b] / mg + (1 - g) * s.ur[b], vi = g * im[b] / mg + (1 - g) * s.ui[b], h = Math.hypot(vr, vi) || 1
              s.ur[b] = vr / h; s.ui[b] = vi / h
            }
            s.xr[b] = re[b]; s.xi[b] = im[b]; s.xm[b] = mg
            re[b] = mg * s.ur[b]; im[b] = mg * s.ui[b]
          }
          ys[c] = Float64Array.from(ifft(re, im))
        }
      }
    }
    // overlap-add at output kH − N/2
    let p = k * H - half - obase
    if (out[0].length < p + N) out = out.map(b => { let nb = new Float64Array(Math.max(2 * b.length, p + N)); nb.set(b); return nb })
    for (let c = 0; c < nch; c++) { let y = ys[c], o = out[c]; for (let i = 0; i < N; i++) o[p + i] += y[i] * win[i] }
    lastA = a; lastReset = did; first = false; k++
  }

  // frames run once all they may read has arrived; after the end, the input goes on as silence
  function run() {
    let end = ended ? total(n) : Infinity
    for (;;) {
      if (k * H - half >= end) return
      if (!ended && nominal(k) + T + N > n) return
      if (ended && at && nominal(k) - T > n) return
      frame()
    }
  }

  // the output before the next frame's start is final
  function take(upto) {
    let fin = Math.min(upto, k * H - half), len = Math.max(0, fin - sent), res = out.map(() => new Float32Array(len))
    for (let c = 0; c < nch; c++) for (let i = 0; i < len; i++) res[c][i] = out[c][sent - obase + i] / 1.5
    sent += len
    let drop = sent - obase - N
    if (drop > 2 * N) { for (let o of out) { o.copyWithin(0, drop); o.fill(0, o.length - drop) } obase += drop }
    let cut = Math.min(lastA, nominal(k) - T) - 1 - base
    if (cut > (m.length >> 1)) { for (let b of x) b.copyWithin(0, cut, n - base); m.copyWithin(0, cut, n - base); base += cut }
    return res
  }

  return {
    write(chunk) {
      let len = chunk[0].length
      grow(n - base + len)
      for (let c = 0; c < nch; c++) x[c].set(chunk[c], n - base)
      for (let i = 0, j = n - base; i < len; i++, j++) { let v = 0; for (let c = 0; c < nch; c++) v += chunk[c][i]; m[j] = v / nch }
      n += len
      run()
      return take(total(n))
    },
    end() { ended = true; run(); return take(total(n)) }
  }
}

function stream(o) {
  let s = null, mono = true
  return {
    write(chunk) {
      mono = !Array.isArray(chunk)
      s ??= stretcher(mono ? 1 : chunk.length, o)
      let r = s.write(mono ? [chunk] : chunk)
      return mono ? r[0] : r
    },
    flush() {
      if (!s) return new Float32Array(0)
      let r = s.end()
      return mono ? r[0] : r
    }
  }
}

export default function pvsola(data, opts) {
  let multi = Array.isArray(data) && (data[0] instanceof Float32Array || data[0] instanceof Float64Array)
  if (!multi && !(data instanceof Float32Array || data instanceof Float64Array)) return writer(stream(data))
  let ch = (multi ? data : [data]).map(c => c instanceof Float32Array ? c : Float32Array.from(c))
  let res
  if ((opts?.factor ?? 1) === 1 && !opts?.at) res = ch.map(c => new Float32Array(c))
  else {
    let s = stretcher(ch.length, opts), a = s.write(ch), b = s.end()
    res = a.map((p, c) => { let r = new Float32Array(p.length + b[c].length); r.set(p); r.set(b[c], p.length); return r })
  }
  return multi ? res : res[0]
}
