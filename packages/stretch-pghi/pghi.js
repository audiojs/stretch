// Phase Gradient Heap Integration vocoder — "Phase Vocoder Done Right"
// (Průša & Holighaus, DAFx 2017), causal RTPGHI variant.
//
// Instead of propagating every bin's phase independently (pvoc) or locking bins
// to picked peaks (pvoc-lock), synthesis phase is *integrated* from the analysis
// phase gradients — along time at each bin's instantaneous frequency, along
// frequency at the stretched local group delay — visiting bins in order of
// decreasing magnitude via a max-heap, so phase always flows from strong bins
// into their neighbourhoods. No peak picking, no transient heuristics; chirps,
// vibrato and dense spectra stay coherent by construction.
//
// Bins below `tolerance`·max get random phase (they carry no reliable gradient).
//
// References:
// - Průša, Z. & Holighaus, N. (2017). "Phase Vocoder Done Right." EUSIPCO/DAFx.
// - Průša, Z. & Søndergaard, P. (2016). "Real-Time Spectrogram Inversion Using
//   Phase Gradient Heap Integration" (RTPGHI). DAFx-16.

import { stftBatch, stftStream } from 'fourier-transform/stft'
import { writer, wrapPhase, stretchOpts, PI2 } from './util.js'

// Binary max-heap over (key, item) pairs stored in state-owned arrays.
function heapPush(keys, items, size, key, item) {
  let i = size
  keys[i] = key; items[i] = item
  while (i > 0) {
    let p = (i - 1) >> 1
    if (keys[p] >= keys[i]) break
    let k = keys[p]; keys[p] = keys[i]; keys[i] = k
    let t = items[p]; items[p] = items[i]; items[i] = t
    i = p
  }
  return size + 1
}

function heapPop(keys, items, size) {
  let last = size - 1
  let top = items[0]
  keys[0] = keys[last]; items[0] = items[last]
  let i = 0
  for (;;) {
    let l = 2 * i + 1, r = l + 1, m = i
    if (l < last && keys[l] > keys[m]) m = l
    if (r < last && keys[r] > keys[m]) m = r
    if (m === i) break
    let k = keys[m]; keys[m] = keys[i]; keys[i] = k
    let t = items[m]; items[m] = items[i]; items[i] = t
    i = m
  }
  return top
}

function makeProcess(tolerance) {
  return function process(mag, phase, state, ctx) {
    let { half, anaHop, synHop, freqPerBin, frameStart } = ctx
    let B = half + 1
    let r = synHop / anaHop

    if (!state.prevPhase) {
      state.prevPhase = new Float64Array(B)
      state.prevMag = new Float64Array(B)
      state.prevTgrad = new Float64Array(B)
      state.synPrev = new Float64Array(B)   // center-origin synthesis phases
      state.tgrad = new Float64Array(B)
      state.fgrad = new Float64Array(B)
      state.p = new Float64Array(B)
      state.heapKeys = new Float64Array(2 * B)
      state.heapItems = new Int32Array(2 * B)
      state.assigned = new Uint8Array(B)
      state.seed = 0x9e3779b9
      state.first = true
    }

    // Pass pre-pad partial frames through; anchor on the first full frame.
    if (state.first) {
      if (frameStart < 0) return { mag, phase }
      for (let m = 0; m < B; m++) {
        state.prevPhase[m] = phase[m]
        state.prevMag[m] = mag[m]
        state.synPrev[m] = phase[m] + Math.PI * m   // to center-origin
        state.prevTgrad[m] = m * freqPerBin * synHop
      }
      state.first = false
      return { mag, phase }
    }

    let tgrad = state.tgrad, fgrad = state.fgrad
    let assigned = state.assigned, keys = state.heapKeys, items = state.heapItems
    let synPrev = state.synPrev, p = state.p

    // Time gradient: phase advance per synthesis hop at each bin's instantaneous
    // frequency (standard heterodyned estimate; the center-origin term cancels
    // in the frame-to-frame difference).
    for (let m = 0; m < B; m++) {
      let dp = wrapPhase(phase[m] - state.prevPhase[m] - m * freqPerBin * anaHop)
      tgrad[m] = m * freqPerBin * synHop + r * dp
    }

    // Frequency gradient (local group delay), from center-origin phases:
    // φc(m) = φ(m) + πm removes the ±π/bin flip of frame-start phases. Under
    // stretch the group delay scales by r — with the center-aligned stft mapping
    // (input t → output t·r at frame centers) that scaling is exact.
    for (let m = 0; m < B; m++) {
      let lo = m > 0 ? wrapPhase(phase[m] - phase[m - 1] + Math.PI) : 0
      let hi = m < half ? wrapPhase(phase[m + 1] - phase[m] + Math.PI) : 0
      let d = m === 0 ? hi : m === half ? lo : 0.5 * (lo + hi)
      fgrad[m] = r * d
    }

    // Heap integration (mirrors phaseret's rtpghiupdate): every bin significant
    // in the current frame seeds the heap keyed by its PREVIOUS-frame magnitude —
    // strong established bins time-propagate first; newborn bins (tiny prev mag)
    // pop late, so a vertical chain from an established neighbour usually claims
    // them instead. Threshold is relative to the two-frame slab maximum.
    let maxMag = 0
    for (let m = 0; m < B; m++) {
      if (mag[m] > maxMag) maxMag = mag[m]
      if (state.prevMag[m] > maxMag) maxMag = state.prevMag[m]
    }
    let athr = tolerance * maxMag

    assigned.fill(0)
    let size = 0
    let remaining = 0
    for (let m = 0; m < B; m++) {
      if (mag[m] > athr) {
        size = heapPush(keys, items, size, state.prevMag[m], m)   // prev-frame entry: item = m
        remaining++
      }
    }

    while (size > 0 && remaining > 0) {
      let item = heapPop(keys, items, size)
      size--
      if (item < B) {
        // from previous frame: propagate through time into the same bin
        let m = item
        if (!assigned[m] && mag[m] > athr) {
          p[m] = synPrev[m] + 0.5 * (state.prevTgrad[m] + tgrad[m])
          assigned[m] = 1; remaining--
          size = heapPush(keys, items, size, mag[m], B + m)   // current-frame entry: item = B + m
        }
      } else {
        // from current frame: propagate through frequency to neighbours
        let m = item - B
        if (m < half && !assigned[m + 1] && mag[m + 1] > athr) {
          p[m + 1] = p[m] + 0.5 * (fgrad[m] + fgrad[m + 1])
          assigned[m + 1] = 1; remaining--
          size = heapPush(keys, items, size, mag[m + 1], B + m + 1)
        }
        if (m > 0 && !assigned[m - 1] && mag[m - 1] > athr) {
          p[m - 1] = p[m] - 0.5 * (fgrad[m] + fgrad[m - 1])
          assigned[m - 1] = 1; remaining--
          size = heapPush(keys, items, size, mag[m - 1], B + m - 1)
        }
      }
    }

    // Unreached bins (below tolerance, or islands with no significant history):
    // random phase — they carry no reliable gradient information.
    let seed = state.seed
    for (let m = 0; m < B; m++) {
      if (!assigned[m]) {
        seed = (seed * 1664525 + 1013904223) >>> 0
        p[m] = seed / 0x100000000 * PI2
      }
    }
    state.seed = seed

    for (let m = 0; m < B; m++) {
      state.prevPhase[m] = phase[m]
      state.prevMag[m] = mag[m]
      state.prevTgrad[m] = tgrad[m]
      state.synPrev[m] = p[m]
      p[m] = p[m] - Math.PI * m   // back to frame-start origin for synthesis
    }

    return { mag, phase: p }
  }
}

// Gradient integration is first-order — it needs denser frames than peak-locked
// propagation: default hop N/8 (the reference implementation's geometry).
function pghiOpts(opts) {
  let o = stretchOpts(opts)
  if (opts?.hopSize == null) {
    let hopSize = o.frameSize >> 3
    let factor = opts?.factor ?? 1
    o = { ...o, hopSize, synHop: opts?.synHop ?? hopSize, anaHop: opts?.anaHop ?? hopSize / factor }
  }
  return o
}

export default function pghi(data, opts) {
  // channel arrays + Float64Array accepted — parity with @audio/shift (audit: [L,R] was silently read as opts)
  if (Array.isArray(data) && (data[0] instanceof Float32Array || data[0] instanceof Float64Array)) return data.map(ch => pghi(ch, opts))
  if (data instanceof Float64Array) data = Float32Array.from(data)
  let tolerance = (data instanceof Float32Array ? opts?.tolerance : data?.tolerance) ?? 1e-6
  let process = makeProcess(tolerance)
  if (!(data instanceof Float32Array)) return writer(stftStream(process, pghiOpts(data)))
  if ((opts?.factor ?? 1) === 1) return new Float32Array(data)
  return stftBatch(data, process, pghiOpts(opts))
}
