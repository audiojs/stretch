// WSOLA: waveform-similarity overlap-add (Verhelst & Roelands, ICASSP 1993), in the segment form of SoundTouch and sox
// `tempo`. The input is cut into segments laid one hop apart, each crossfaded into the one before over `overlap`
// samples, and each read, within ±`delta` of where the time map puts it, where its head best continues the segment
// before (normalized cross-correlation with the input that followed it). The waveform is copied, never resynthesized:
// a voice keeps the shape of its glottal pulses and its consonants their attacks, where a phase vocoder keeps each
// harmonic's phase but not their alignment to one another, and the voice goes distant and reverberant (Röbel, DAFx
// 2010). Two segments overlap at a time: Hann frames at 3/4 overlap, each aligned to the one before only, beat with
// the other two.
//
// Defaults are a voice's: the overlap 16 ms, a period at 62.5 Hz, so a splice is matched over a whole cycle of the
// lowest voice; the segment 40 ms, the overlap 2/5 of it (sox's speech profile); the search ±8 ms, half that period, a
// cycle's worth of places to align at: wider, a splice can land a period off and the time map wanders.
// The crossfade is matched to how alike the two sides are (Fink, Holters & Zölzer, EURASIP JASP 2016): linear for the
// same waveform, equal-power for unrelated ones (noise, a consonant), so neither dips nor bulges.
// Channels share one search, on their mean, so a stereo image stays where it was.
//
// wsola(data, { factor }) → stretched copy (a Float32Array, or channels); wsola(opts) → write(chunk) → the stream,
// write() → the rest. stretcher(channels, opts) is the engine itself, for hosts: `at(s)` puts output sample s at input
// sample at(s) (any time map), the output aligned to its own sample 0.

import { writer } from './util.js'

/** Segment geometry at a sample rate, in samples: S the segment, H the output hop, O the crossfade, D the search. */
export function geometry(o = {}) {
  let sr = o.sampleRate || o.fs || 44100
  let S = Math.max(4, Math.round(o.frameSize ?? .04 * sr))
  let H = Math.max(2, Math.min(S - 1, Math.round(o.hopSize ?? S * .6)))
  return { S, H, O: Math.min(S - H, H), D: Math.max(0, Math.round(o.delta ?? .008 * sr)) }
}

/** The engine over `nch` channels: write(channels) → the output now final, end() → the rest. Options: `factor` (a number,
 *  or a function of input seconds) or `at` (output sample → input sample) and `end` (the input's length, or a function
 *  giving it once known: Infinity until then), `sampleRate`, `frameSize`, `hopSize`, `delta`. */
export function stretcher(nch, o = {}) {
  let { S, H, O, D } = geometry(o), sr = o.sampleRate || o.fs || 44100, half = S / 2
  // segment k's centre on the input; the output's length once the input is all in (none for a host's map)
  let f = o.factor ?? 1, at = o.at, centre, total = () => Infinity
  if (at) centre = k => at(k * H + half)
  else if (typeof f === 'number') { centre = k => (k * H + half) / f; total = n => Math.round(n * f) }
  else {
    // a sliding factor: each centre a hop on from the last, over the factor there
    let c = [half / Math.max(1e-6, f(0))], tk = 0
    centre = k => { while (c.length <= k) { let p = c[c.length - 1]; c.push(p + H / Math.max(1e-6, f(p / sr))) } return c[k] }
    total = n => {
      while (centre(tk + 1) < n) tk++
      let a = centre(tk), b = centre(tk + 1)
      return Math.round(tk * H + half + H * (n - a) / (b - a))
    }
  }
  let x = Array.from({ length: nch }, () => new Float32Array(1 << 14)), m = new Float32Array(1 << 14), base = 0, n = 0
  let k = 0, cont = -1, out = Array.from({ length: nch }, () => new Float32Array(4096)), made = 0, sent = 0, ended = false
  let xa = (b, i) => { i -= base; return i >= 0 && i < n - base ? b[i] : 0 }
  // where segment k reads by the map, never before the input's start (a stretch there repeats its opening), and once
  // the input's end is known (it has ended, or a host knows its length) no further than lets its copy reach that end
  // where the map does: a stretch's segments run ahead of its map, and the last would copy silence the map has not reached
  let first = Math.round(at ? at(0) : 0), end = () => Math.floor(ended ? n : typeof o.end === 'function' ? o.end() : o.end ?? Infinity)
  let place = k => Math.max(first, Math.round(centre(k) - half))
  let cap = k => {
    let e = end(), c = centre(k), se = k * H + half + (e - c) * H / (centre(k + 1) - c)   // where the map reaches the end
    return e < Infinity && se > k * H ? e - Math.min(H, Math.ceil(se - k * H)) : Infinity
  }
  let start = k => Math.max(first, Math.min(place(k), cap(k)))

  function grow(need) {
    if (need <= m.length) return
    let len = Math.max(need, 2 * m.length), have = n - base
    x = x.map(a => { let b = new Float32Array(len); b.set(a.subarray(0, have)); return b })
    let mb = new Float32Array(len); mb.set(m.subarray(0, have)); m = mb
  }

  // normalized correlation of the channels' mean at s with the continuation, over the crossfade; every other lag on
  // every other sample, then the lags either side of the best at full rate. The map's own place wins a tie.
  function search(a) {
    let ncc = (s, step) => {
      let xy = 0, xx = 0, yy = 0
      for (let i = 0; i < O; i += step) { let p = xa(m, cont + i), q = xa(m, s + i); xy += p * q; xx += p * p; yy += q * q }
      return xy / Math.sqrt(xx * yy + 1e-30)
    }
    let lo = Math.max(first, a - D), hi = Math.max(lo, Math.min(a + D, cap(k)))
    let r = a, best = ncc(a, 2)
    for (let s = lo; s <= hi; s += 2) { let c = ncc(s, 2); if (c > best + 1e-9) { best = c; r = s } }
    let c0 = r
    best = ncc(c0, 1)
    for (let s = c0 - 1; s <= c0 + 1; s += 2) if (s >= lo && s <= hi) { let c = ncc(s, 1); if (c > best + 1e-9) { best = c; r = s } }
    return [r, best]
  }

  // segment k: H samples of output, crossfaded over the first O from the continuation of the one before
  function segment() {
    let a = start(k), r = a, rho = 1
    if (k === 0) r = first
    else if (a !== cont) {
      if (D > 0) [r, rho] = search(a)
      else {
        let xy = 0, xx = 0, yy = 0
        for (let i = 0; i < O; i++) { let p = xa(m, cont + i), q = xa(m, a + i); xy += p * q; xx += p * p; yy += q * q }
        rho = xx && yy ? xy / Math.sqrt(xx * yy) : 0
      }
      rho = Math.max(-.5, Math.min(1, rho))
    }
    let pend = made - sent
    if (out[0].length < pend + H) out = out.map(b => { let nb = new Float32Array(Math.max(2 * b.length, pend + H)); nb.set(b.subarray(0, pend)); return nb })
    for (let c = 0; c < nch; c++) {
      let y = out[c], b = x[c], i = 0
      if (k > 0 && r !== cont) for (; i < O; i++) {
        let t = (i + .5) / O * Math.PI / 2, cs = Math.cos(t), sn = Math.sin(t), g = 1 / Math.sqrt(1 + 2 * rho * cs * sn)
        y[pend + i] = g * (cs * xa(b, cont + i) + sn * xa(b, r + i))
      }
      for (; i < H; i++) y[pend + i] = xa(b, r + i)
    }
    made += H; cont = r + H; k++
  }

  // segments run once all they would read by the map has arrived (more than they read, held back from the end);
  // after the end, the input goes on as silence
  function run() {
    let end = ended ? total(n) : Infinity
    for (;;) {
      if (made >= end) return
      if (!ended && Math.max(place(k) + D, cont) + S > n) return
      if (ended && at && centre(k) - half - D > n) return
      segment()
    }
  }

  function take(upto) {
    let len = Math.max(0, Math.min(upto, made) - sent), res = out.map(b => b.slice(0, len))
    if (len) { for (let b of out) b.copyWithin(0, len, made - sent); sent += len }
    // input no segment reads any more goes
    let cut = Math.min(cont, start(k) - D) - 1 - base
    if (cut > (m.length >> 1)) {
      for (let b of x) b.copyWithin(0, cut, n - base)
      m.copyWithin(0, cut, n - base); base += cut
    }
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

export default function wsola(data, opts) {
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
