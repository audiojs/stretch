import test, { almost, ok, is } from 'tst'
import { wsola, pvoc, pvocLock, pghi, transient, hybrid, paulstretch, psola, sms } from './index.js'
import { lsd, chordBalance, chordRetention, modulationDepth } from '@audio/quality'

// Plain OLA via wsola with delta:0 (correlation search disabled)
const ola = (d, o) => d instanceof Float32Array
  ? wsola(d, { ...o, frameSize: o?.frameSize || 2048, delta: 0 })
  : wsola({ ...d, frameSize: d?.frameSize || 2048, delta: 0 })

let fs = 44100

function sine(freq, n, sampleRate) {
  let d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * i / sampleRate)
  return d
}

function rms(data) {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / data.length)
}

function peakFreq(data, sampleRate) {
  // simple zero-crossing frequency estimation
  let crossings = 0
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1] <= 0 && data[i] > 0) crossings++
  }
  return crossings * sampleRate / data.length
}

// helper: test a stretch algorithm
function testStretch(name, fn, tolerances = {}) {
  let lenTol = tolerances.lenTol ?? 0.05
  let rmsTol = tolerances.rmsTol ?? 0.05
  let freqTol = tolerances.freqTol ?? 0.1

  test(`${name} — factor 1 returns copy`, () => {
    let data = sine(440, 8192, fs)
    let out = fn(data, { factor: 1 })
    is(out.length, data.length)
    almost(rms(out), rms(data), 0.01)
  })

  test(`${name} — factor 2 doubles length`, () => {
    let data = sine(440, 8192, fs)
    let out = fn(data, { factor: 2 })
    almost(out.length, data.length * 2, data.length * lenTol)
    ok(rms(out) > 0.1, 'has signal')
  })

  test(`${name} — factor 0.5 halves length`, () => {
    let data = sine(440, 16384, fs)
    let out = fn(data, { factor: 0.5 })
    almost(out.length, data.length * 0.5, data.length * lenTol)
    ok(rms(out) > 0.1, 'has signal')
  })

  test(`${name} — preserves pitch (440Hz sine)`, () => {
    let data = sine(440, 16384, fs)
    let out = fn(data, { factor: 2 })
    let freq = peakFreq(out, fs)
    almost(freq, 440, 440 * freqTol, 'pitch preserved')
  })

  test(`${name} — energy conservation`, () => {
    let data = sine(440, 8192, fs)
    let out = fn(data, { factor: 2 })
    almost(rms(out), rms(data), rms(data) * rmsTol + 0.05, 'energy preserved')
  })
}

// --- WSOLA ---
testStretch('wsola', wsola)

// --- Phase vocoder (plain) ---
testStretch('pvoc', pvoc, { rmsTol: 0.15 })

// --- Phase-locked vocoder ---
testStretch('pvocLock', pvocLock, { rmsTol: 0.15 })

// --- Transient-aware vocoder ---
testStretch('transient', transient, { rmsTol: 0.15 })

// --- PGHI vocoder ---
testStretch('pghi', pghi, { rmsTol: 0.15 })

// --- HPSS hybrid ---
testStretch('hybrid', hybrid, { rmsTol: 0.2 })

// --- PaulStretch ---
test('paulstretch — extreme stretch (8x)', () => {
  let data = sine(440, 4096, fs)
  let out = paulstretch(data, { factor: 8 })
  almost(out.length, data.length * 8, data.length * 0.1)
  ok(rms(out) > 0.05, 'has signal')
})

test('paulstretch — factor 1 returns copy', () => {
  let data = sine(440, 4096, fs)
  let out = paulstretch(data, { factor: 1 })
  is(out.length, data.length)
})

test('paulstretch — very extreme (32x)', () => {
  let data = sine(440, 4096, fs)
  let out = paulstretch(data, { factor: 32 })
  almost(out.length, data.length * 32, data.length * 0.2)
  ok(rms(out) > 0.01, 'has signal')
})

// --- PSOLA ---
test('psola — factor 1 returns copy', () => {
  let data = sine(440, 8192, fs)
  let out = psola(data, { factor: 1 })
  is(out.length, data.length)
})

test('psola — factor 2 doubles length', () => {
  let data = sine(440, 8192, fs)
  let out = psola(data, { factor: 2 })
  almost(out.length, data.length * 2, data.length * 0.15)
  ok(rms(out) > 0.05, 'has signal')
})

test('psola — factor 0.5 halves length', () => {
  let data = sine(440, 8192, fs)
  let out = psola(data, { factor: 0.5 })
  almost(out.length, data.length * 0.5, data.length * 0.15)
  ok(rms(out) > 0.05, 'has signal')
})

test('psola — preserves pitch (440Hz sine)', () => {
  let data = sine(440, 16384, fs)
  let out = psola(data, { factor: 2 })
  let freq = peakFreq(out, fs)
  almost(freq, 440, 440 * 0.1, 'pitch preserved')
})

test('psola — energy conservation', () => {
  let data = sine(440, 8192, fs)
  let out = psola(data, { factor: 2 })
  almost(rms(out), rms(data), rms(data) * 0.3, 'energy preserved')
})

// --- Streaming ---
function testStream(name, fn, streamOpts = {}) {
  let factor = streamOpts.factor ?? 2
  let chunkSize = streamOpts.chunkSize ?? 4096
  let lenTol = streamOpts.lenTol ?? 0.15
  let energyTol = streamOpts.energyTol ?? 0.3

  test(`${name} writer — matches batch output`, () => {
    let data = sine(440, 16384, fs)
    let batch = fn(data, { factor })
    let batchRms = rms(batch)

    let write = fn({ factor })
    let chunks = []
    for (let i = 0; i < data.length; i += chunkSize) {
      let chunk = data.subarray(i, Math.min(i + chunkSize, data.length))
      let out = write(chunk)
      if (out.length) chunks.push(out)
    }
    let tail = write()
    if (tail.length) chunks.push(tail)

    let total = chunks.reduce((s, c) => s + c.length, 0)
    ok(total > 0, 'produces output')
    almost(total, batch.length, batch.length * lenTol, 'similar length')

    let assembled = new Float32Array(total)
    let off = 0
    for (let c of chunks) { assembled.set(c, off); off += c.length }
    let streamRms = rms(assembled)
    ok(streamRms > 0.05, 'has signal')
    almost(streamRms, batchRms, batchRms * energyTol, 'similar energy')
  })

  test(`${name} writer — handles small chunks`, () => {
    let data = sine(440, 8192, fs)
    let write = fn({ factor })
    let chunks = []
    for (let i = 0; i < data.length; i += 512) {
      let out = write(data.subarray(i, Math.min(i + 512, data.length)))
      if (out.length) chunks.push(out)
    }
    let tail = write()
    if (tail.length) chunks.push(tail)
    let total = chunks.reduce((s, c) => s + c.length, 0)
    ok(total > 0, 'produces output from small chunks')
  })

  test(`${name} writer — silence stays silent`, () => {
    let data = new Float32Array(8192)
    let write = fn({ factor })
    let chunks = []
    for (let i = 0; i < data.length; i += chunkSize) {
      let out = write(data.subarray(i, i + chunkSize))
      if (out.length) chunks.push(out)
    }
    let tail = write()
    if (tail.length) chunks.push(tail)
    let total = chunks.reduce((s, c) => s + c.length, 0)
    if (total > 0) {
      let assembled = new Float32Array(total)
      let off = 0
      for (let c of chunks) { assembled.set(c, off); off += c.length }
      almost(rms(assembled), 0, 0.001, 'silence preserved')
    }
  })
}

testStream('ola', ola)
testStream('wsola', wsola)
testStream('pvoc', pvoc)
testStream('pvocLock', pvocLock)
testStream('transient', transient)
testStream('paulstretch', paulstretch, { factor: 8, lenTol: 0.25, energyTol: 2 })
testStream('psola', psola, { lenTol: 0.25, energyTol: 0.5 })
testStream('sms', sms)
testStream('pghi', pghi)
testStream('hybrid', hybrid, { lenTol: 0.25, energyTol: 0.5 })

// --- Extreme ratios ---
function testExtreme(name, fn, factor, minLen) {
  test(`${name} — extreme ratio ${factor}x`, () => {
    let data = sine(440, 16384, fs)
    let out = fn(data, { factor })
    ok(out.length >= minLen, `output length ${out.length} >= ${minLen}`)
    ok(isFinite(rms(out)), 'no NaN/Infinity')
  })
}

testExtreme('ola', ola, 0.1, 100)
testExtreme('ola', ola, 10, 100000)
testExtreme('wsola', wsola, 0.1, 100)
testExtreme('wsola', wsola, 10, 100000)
testExtreme('pvoc', pvoc, 0.1, 100)
testExtreme('pvoc', pvoc, 10, 100000)
testExtreme('pvocLock', pvocLock, 0.1, 100)
testExtreme('pvocLock', pvocLock, 10, 100000)
testExtreme('transient', transient, 0.1, 100)
testExtreme('transient', transient, 10, 100000)
testExtreme('psola', psola, 0.1, 100)
testExtreme('psola', psola, 10, 100000)
testExtreme('paulstretch', paulstretch, 100, 1000000)

// --- Multi-channel (stereo) ---
// All algorithms process mono Float32Array. Stereo is handled by splitting channels.

function stereoTest(name, fn, opts) {
  test(`${name} — stereo split/process/recombine`, () => {
    let n = 8192
    let L = sine(440, n, fs)
    let R = sine(660, n, fs)

    let outL = fn(L, opts)
    let outR = fn(R, opts)

    ok(outL.length > 0, 'left channel has output')
    ok(outR.length > 0, 'right channel has output')
    is(outL.length, outR.length, 'channels same length')
    ok(rms(outL) > 0.05, 'left has signal')
    ok(rms(outR) > 0.05, 'right has signal')

    let diff = 0
    let len = Math.min(outL.length, outR.length)
    for (let i = 0; i < len; i++) diff += Math.abs(outL[i] - outR[i])
    ok(diff / len > 0.01, 'channels are different')
  })

  test(`${name} writer — stereo split/process/recombine`, () => {
    let n = 16384
    let L = sine(440, n, fs)
    let R = sine(660, n, fs)

    let wL = fn(opts)
    let wR = fn(opts)
    let chunksL = [], chunksR = []

    for (let i = 0; i < n; i += 4096) {
      let cL = wL(L.subarray(i, Math.min(i + 4096, n)))
      let cR = wR(R.subarray(i, Math.min(i + 4096, n)))
      if (cL.length) chunksL.push(cL)
      if (cR.length) chunksR.push(cR)
    }
    let tL = wL(), tR = wR()
    if (tL.length) chunksL.push(tL)
    if (tR.length) chunksR.push(tR)

    let totalL = chunksL.reduce((s, c) => s + c.length, 0)
    let totalR = chunksR.reduce((s, c) => s + c.length, 0)

    ok(totalL > 0, 'left stream has output')
    ok(totalR > 0, 'right stream has output')
    almost(totalL, totalR, totalL * 0.05, 'stream channels similar length')
  })
}

stereoTest('ola', ola, { factor: 1.5 })
stereoTest('wsola', wsola, { factor: 1.5 })
stereoTest('pvoc', pvoc, { factor: 1.5 })
stereoTest('pvocLock', pvocLock, { factor: 1.5 })
stereoTest('transient', transient, { factor: 1.5 })
stereoTest('paulstretch', paulstretch, { factor: 4 })
stereoTest('psola', psola, { factor: 1.5 })

// --- SMS (Sinusoidal Modeling Synthesis) ---
testStretch('sms', sms, { rmsTol: 0.2, freqTol: 0.1 })
testStream('sms', sms, { energyTol: 0.5 })
testExtreme('sms', sms, 0.1, 100)
testExtreme('sms', sms, 10, 100000)
stereoTest('sms', sms, { factor: 1.5 })

// --- Quality metrics ---
test('transient — preserves attack sharpness', () => {
  let n = 16384
  let data = new Float32Array(n)
  for (let i = 0; i < n; i += 2048) {
    for (let j = 0; j < 64 && i + j < n; j++) data[i + j] = Math.sin(2 * Math.PI * 440 * j / fs) * (1 - j / 64)
  }
  let out = transient(data, { factor: 2 })
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  ok(peak > 0.3, `transient peaks preserved (peak=${peak.toFixed(3)})`)
})

test('sms — noise residual energy preservation', () => {
  let n = 8192, seed = 0x12345
  let data = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    data[i] = (seed / 0x100000000 - 0.5) * 0.6
  }
  let out = sms(data, { factor: 2, residualMix: 1 })
  ok(rms(out) > rms(data) * 0.3, 'noise energy preserved via residual')
})

test('pvocLock — spectral purity on sine', () => {
  let data = sine(440, 16384, fs)
  let out = pvocLock(data, { factor: 1.5 })
  let trim = Math.floor(out.length * 0.1)
  let freq = peakFreq(out.slice(trim, out.length - trim), fs)
  almost(freq, 440, 22, 'frequency drift < 5%')
})

// --- Spectral-quality regression (LSD vs. regenerated ground truth) ---
// LSD < 1.5 dB = transparent, < 3 good, > 5 poor.

function chordSig(dur) {
  let freqs = [261.6, 329.6, 392.0]
  let n = Math.round(dur * fs), d = new Float32Array(n)
  let a = 0.72 / freqs.length
  for (let i = 0; i < n; i++) for (let f of freqs) d[i] += Math.sin(2 * Math.PI * f * i / fs) * a
  return d
}

function sweepSig(f0, f1, dur) {
  let n = Math.round(dur * fs), d = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let t = i / fs, f = f0 + (f1 - f0) * t / dur
    d[i] = Math.sin(2 * Math.PI * f * t) * 0.72
  }
  return d
}

function vowelSig(freq, dur) {
  let n = Math.round(dur * fs), d = new Float32Array(n)
  let formants = [700, 1200, 2500], bw = [80, 120, 160]
  for (let h = 1; h <= 30; h++) {
    let hf = freq * h
    if (hf > fs / 2) break
    let amp = 0
    for (let fi = 0; fi < 3; fi++) {
      let df = hf - formants[fi]
      amp += Math.exp(-0.5 * (df / bw[fi]) ** 2)
    }
    amp = amp * 0.3 / h
    for (let i = 0; i < n; i++) d[i] += Math.sin(2 * Math.PI * hf * i / fs) * amp
  }
  return d
}

function sineSig(freq, dur) {
  let n = Math.round(dur * fs), d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * i / fs) * 0.8
  return d
}

// Limits set ~0.2-0.4 dB above measured to catch regressions, not noise.
let qualityCases = [
  // [name, fn, sigName, gen, factor, maxLSD]
  ['pvocLock',  pvocLock,  'sine',   f => sineSig(440, 0.5 * f),                 0.5, 0.7],
  ['pvocLock',  pvocLock,  'sine',   f => sineSig(440, 0.5 * f),                 2.0, 0.7],
  ['pvocLock',  pvocLock,  'chord',  f => chordSig(0.5 * f),                     0.5, 0.7],
  ['pvocLock',  pvocLock,  'chord',  f => chordSig(0.5 * f),                     1.5, 0.7],
  ['pvocLock',  pvocLock,  'chord',  f => chordSig(0.5 * f),                     2.0, 0.8],

  ['pvoc',      pvoc,      'chord',  f => chordSig(0.5 * f),                     0.5, 1.3],
  // 2.0× re-measured at 0.83 after the stft center-alignment fix (identical for
  // the old onset-zeroing) — re-ratcheted from 0.7 per the +0.2 convention.
  ['pvoc',      pvoc,      'chord',  f => chordSig(0.5 * f),                     2.0, 1.05],
  ['pvoc',      pvoc,      'sweep',  f => sweepSig(200, 2000, 0.5 * f),          2.0, 3.2],

  ['transient', transient, 'chord',  f => chordSig(0.5 * f),                     1.5, 0.8],

  ['wsola',     wsola,     'sine',   f => sineSig(440, 0.5 * f),                 2.0, 0.2],
  ['wsola',     wsola,     'chord',  f => chordSig(0.5 * f),                     2.0, 0.9],
  ['wsola',     wsola,     'vowel',  f => vowelSig(150, 0.5 * f),                2.0, 0.2],

  // pghi: measured 0.17 sine / 0.85 sweep / 0.94 chord @2x (gradient integration
  // beats locking on modulated content, approximates it on steady polyphony)
  ['pghi',      pghi,      'sine',   f => sineSig(440, 0.5 * f),                 2.0, 0.4],
  ['pghi',      pghi,      'sweep',  f => sweepSig(200, 2000, 0.5 * f),          2.0, 1.1],
  ['pghi',      pghi,      'chord',  f => chordSig(0.5 * f),                     2.0, 1.2],

  ['hybrid',    hybrid,    'chord',  f => chordSig(0.5 * f),                     2.0, 1.0],

  ['psola',     psola,     'sine',   f => sineSig(440, 0.5 * f),                 1.5, 0.4],
  ['psola',     psola,     'vowel',  f => vowelSig(150, 0.5 * f),                1.5, 1.0],
]

for (let [name, fn, sigName, gen, factor, maxLSD] of qualityCases) {
  test(`${name} — LSD on ${sigName} @ ${factor}× < ${maxLSD} dB`, () => {
    let src = gen(1)
    let truth = gen(factor)
    let out = fn(src, { factor })
    let score = lsd(out, truth, { trim: 0.1 })
    ok(score < maxLSD, `LSD=${score.toFixed(2)} dB (limit ${maxLSD})`)
  })
}

// PSOLA falls through to WSOLA on polyphonic content (voiced threshold 0.72
// rejects chords whose autocorrelation peaks ~0.58). Verify reasonable quality.
test('psola — chord falls through to wsola (LSD < 0.9 dB)', () => {
  let src = chordSig(0.5)
  let truth = chordSig(1.0)
  let out = psola(src, { factor: 2 })
  let score = lsd(out, truth, { trim: 0.1 })
  ok(score < 0.9, `LSD=${score.toFixed(2)} dB (limit 0.9)`)
})

test('lsd — identity returns 0', () => {
  let a = chordSig(0.5)
  almost(lsd(a, a, { trim: 0.1 }), 0, 0.001)
})

test('lsd — non-matching signals return large value', () => {
  let a = sineSig(440, 0.5)
  let b = sineSig(880, 0.5)
  ok(lsd(a, b, { trim: 0.1 }) > 5, 'different pitches = high LSD')
})

// --- Chord partial balance & retention (Goertzel-based) ---
let chordFreqs = [261.6, 329.6, 392.0]
let chordBalanceCases = [
  // [name, fn, opts, minBalance, minRetention]
  ['pvocLock 0.5×', pvocLock, { factor: 0.5 }, 0.9, 0.9],
  ['pvocLock 2.0×', pvocLock, { factor: 2.0 }, 0.9, 0.9],
  ['wsola 0.5×',    wsola,    { factor: 0.5 }, 0.4, 0.5],
  ['wsola 2.0×',    wsola,    { factor: 2.0 }, 0.15, 0.4],
  ['psola 0.5×',    psola,    { factor: 0.5 }, 0.4, 0.5],
  ['psola 2.0×',    psola,    { factor: 2.0 }, 0.15, 0.4],
]

for (let [name, fn, opts, minBal, minRet] of chordBalanceCases) {
  test(`chord balance — ${name}`, () => {
    let src = chordSig(1.0)
    let ref = chordSig(1.0 * opts.factor)
    let out = fn(src, opts)
    let bal = chordBalance(out, chordFreqs, fs)
    let ret = chordRetention(out, ref, chordFreqs, fs)
    ok(bal >= minBal, `balance=${bal.toFixed(3)} (min ${minBal})`)
    ok(ret >= minRet, `retention=${ret.toFixed(3)} (min ${minRet})`)
  })
}

// --- Chord modulation depth ("crumble") regression ---
// Hop-rate amplitude modulation on polyphonic content — the defect canonical WSOLA
// was created to avoid.
let modulationCases = [
  // [name, fn, opts, freqs, maxDepth]
  ['pvocLock chord 2.0×', pvocLock, { factor: 2.0 }, chordFreqs, 0.05],
  ['wsola chord 2.0×',    wsola,    { factor: 2.0 }, chordFreqs, 0.05],
  ['wsola chord 1.5×',    wsola,    { factor: 1.5 }, chordFreqs, 0.05],
  ['wsola chord 0.5×',    wsola,    { factor: 0.5 }, chordFreqs, 0.05],
  ['wsola sine 2.0×',     wsola,    { factor: 2.0 }, [440],      0.02],
]

for (let [name, fn, opts, freqs, maxDepth] of modulationCases) {
  test(`modulation depth — ${name}`, () => {
    let src = freqs.length === 1 ? sineSig(freqs[0], 1.0) : chordSig(1.0)
    let out = fn(src, opts)
    let depth = modulationDepth(out, freqs, fs)
    ok(depth < maxDepth, `depth=${depth.toFixed(3)} (max ${maxDepth})`)
  })
}

// --- Alignment & onset regression (stft center-mapping) ---
// Input time t must land at t×factor: the pre-fix engine lagged by (N/2)(factor−1)
// and pvoc zeroed pre-pad frames, swallowing the first ~N×factor samples.

function firstAbove(data, thresh) {
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > thresh) return i
  return -1
}

// RMS half-max crossing — a threshold on raw samples would bias early by the
// window ramp; the envelope midpoint tracks the perceptual event position.
function onsetPos(data) {
  let win = 256, nWin = Math.floor(data.length / win), maxRms = 0
  let env = new Float64Array(nWin)
  for (let k = 0; k < nWin; k++) {
    let s = 0
    for (let i = 0; i < win; i++) { let v = data[k * win + i]; s += v * v }
    env[k] = Math.sqrt(s / win)
    if (env[k] > maxRms) maxRms = env[k]
  }
  for (let k = 0; k < nWin; k++) if (env[k] > maxRms * 0.5) return k * win
  return -1
}

for (let [name, fn] of [['pvocLock', pvocLock], ['transient', transient]]) {
  test(`${name} — stretched event lands at t×factor (±512)`, () => {
    let n = fs * 2, from = Math.floor(0.5 * fs)
    let data = new Float32Array(n)
    for (let i = from; i < Math.floor(1.2 * fs); i++) data[i] = Math.sin(2 * Math.PI * 440 * i / fs) * 0.8
    for (let factor of [0.5, 2]) {
      let onset = onsetPos(fn(data, { factor }))
      ok(Math.abs(onset - from * factor) <= 512, `${factor}×: onset ${onset} vs ideal ${from * factor}`)
    }
  })
}

test('pvoc — onset from t=0 is not swallowed', () => {
  let onset = firstAbove(pvoc(sine(440, fs, fs), { factor: 2 }), 0.05)
  ok(onset >= 0 && onset < 512, `first audible sample at ${onset}`)
})

// --- Streaming with fractional analysis hop (regression: NaN output at 1.5×) ---
for (let [name, fn] of [['pvoc', pvoc], ['pvocLock', pvocLock], ['pghi', pghi], ['transient', transient], ['hybrid', hybrid], ['paulstretch', paulstretch], ['sms', sms]]) {
  test(`${name} stream — finite output at fractional hop (1.5×)`, () => {
    let data = sine(440, 32768, fs)
    let write = fn({ factor: 1.5 })
    let total = 0, energy = 0, bad = 0
    let consume = (out) => {
      for (let j = 0; j < out.length; j++) { if (!Number.isFinite(out[j])) bad++; energy += out[j] * out[j] }
      total += out.length
    }
    for (let i = 0; i < data.length; i += 1024) consume(write(data.subarray(i, Math.min(i + 1024, data.length))))
    consume(write())
    is(bad, 0, 'no NaN/Inf samples')
    ok(Math.abs(total - data.length * 1.5) < data.length * 0.15, `length ${total} ≈ ${data.length * 1.5}`)
    ok(Math.sqrt(energy / Math.max(1, total)) > 0.3, 'carries signal energy')
  })
}

test('pvocLock streaming: non-integer anaHop ratios stay finite', () => {
  // regression: hopSize/factor was passed unrounded — the STFT ring indexed at a
  // fractional hop and emitted NaN for any non-integer ratio (all semitone ratios)
  let x = sine(440, fs, fs)
  for (let factor of [1.5, 1.25, 1.7, 2.5, 0.75, 2 ** (7 / 12)]) {
    let write = pvocLock({ factor, frameSize: 1024 })
    let out = write(x.slice())
    ok(out.length > 0, `factor ${factor.toFixed(3)} emits`)
    ok([...out].every(v => isFinite(v)), `factor ${factor.toFixed(3)} finite`)
  }
})

// =============================================================================
// audio.js manifests — whole-render atoms with a structural `frames` hook

test('manifests — every package hosts as a variable-length whole atom', async () => {
  let sr = 44100, N = 16384, d = new Float32Array(N)
  for (let i = 0; i < N; i++) d[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
  for (let pkg of ['pvoc-lock', 'pvoc', 'pghi', 'wsola', 'psola', 'sms', 'transient', 'hybrid', 'paulstretch']) {
    let mod = await import(`./packages/stretch-${pkg}/audio.js`)
    let m = Object.values(mod)[0]
    ok(typeof m === 'function' && m.streaming === false && typeof m.frames === 'function', `${pkg}: whole-render manifest shape`)
    let params = {}
    for (let [k, sp] of Object.entries(m.params)) params[k] = new Float32Array([sp.default])
    params.factor = new Float32Array([2])
    let outLen = m.frames(N, { sampleRate: sr, params })
    is(outLen, N * 2, `${pkg}: frames hook = input × factor`)
    let process = m({ sampleRate: sr })
    let out = [new Float32Array(outLen)]
    process([[d]], [out], params)
    ok(out[0].some(v => Math.abs(v) > 0.05), `${pkg}: produced signal`)
    ok([...out[0]].every(Number.isFinite), `${pkg}: finite output`)
    // pitch preserved over the steady middle
    let o = out[0], from = outLen >> 2, to = outLen - (outLen >> 2), zc = 0
    for (let i = from + 1; i < to; i++) if ((o[i - 1] < 0) !== (o[i] < 0)) zc++
    let hz = zc / 2 / ((to - from) / sr)
    ok(Math.abs(hz - 440) < 10, `${pkg}: pitch preserved (${hz.toFixed(0)}Hz)`)
  }
})

test('pvoc-lock — sliding factor fn: length integrates, pitch preserved throughout', () => {
	let sr = 44100, n = sr * 2, d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
	let f = t => 1 + Math.min(1, Math.max(0, t / 2))  // 1 → 2 over the 2s source
	let out = pvocLock(d, { factor: f, fs: sr, sampleRate: sr })
	almost(out.length / n, 1.5, 0.02, `∫factor over source (got ${(out.length / n).toFixed(3)})`)
	ok([...out].every(isFinite), 'finite')
	let zc = (a, lo, hi) => { let c = 0; for (let i = lo + 1; i < hi; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) c++; return c / 2 / ((hi - lo) / sr) }
	almost(zc(out, sr >> 2, sr >> 1), 440, 6, 'pitch early')
	almost(zc(out, out.length - sr, out.length - (sr >> 2)), 440, 6, 'pitch late (2× region)')

	// streaming form matches
	let w = pvocLock({ factor: f, fs: sr, sampleRate: sr })
	let total = 0
	for (let off = 0; off < n; off += 4096) total += w(d.subarray(off, Math.min(off + 4096, n))).length
	total += w().length
	almost(total / n, 1.5, 0.02, 'stream length integrates')
})

// --- audit 2026-07-10: channel-array + Float64 input parity with @audio/shift ---

test('batch entries accept [L, R] channel arrays and Float64Array', () => {
	let L = new Float32Array(8000), R = new Float32Array(8000)
	for (let i = 0; i < 8000; i++) { L[i] = Math.sin(2 * Math.PI * 220 * i / 8000); R[i] = Math.sin(2 * Math.PI * 330 * i / 8000) }
	for (const fn of [wsola, pvoc]) {
		let out = fn([L, R], { factor: 2, sampleRate: 8000 })
		ok(Array.isArray(out) && out.length === 2, fn.name + ': channel array in → channel array out')
		ok(Math.abs(out[0].length - 2 * L.length) < 4096, fn.name + ': each channel stretched (' + out[0].length + ')')
		let d64 = fn(Float64Array.from(L), { factor: 2, sampleRate: 8000 })
		ok(d64 instanceof Float32Array && Math.abs(d64.length - 2 * L.length) < 4096, fn.name + ': Float64Array accepted')
	}
})
