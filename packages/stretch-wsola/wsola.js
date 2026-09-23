import { hannWindow, writer, makeStreamBufs } from './util.js'

// Canonical Verhelst-Roelands WSOLA: each grain's read position maximizes cross-
// correlation with the *natural progression* of the previous grain through the
// input — i.e. data[prevRead + synHop : ...]. Correlating against the synthesis
// output (a sum of previous compromise grains) lets phase errors compound across
// grains and causes hop-rate amplitude modulation ("crumble") on polyphonic
// content. The input target is clean and gives the same result for monophonic
// signals at no extra cost.
function corrLength(frameSize, synHop) {
  // Hann taper on large frames makes outer samples low-energy — halving the
  // loop (≥2048 frames) cuts search cost ~33% without shifting the peak.
  return frameSize >= 2048 ? frameSize >> 1 : frameSize - synHop
}

export default function wsola(data, opts) {
  // channel arrays + Float64Array accepted — parity with @audio/shift (audit: [L,R] was silently read as opts)
  if (Array.isArray(data) && (data[0] instanceof Float32Array || data[0] instanceof Float64Array)) return data.map(ch => wsola(ch, opts))
  if (data instanceof Float64Array) data = Float32Array.from(data)
  if (!(data instanceof Float32Array)) return writer(wsolaStream(data))

  let factor = opts?.factor ?? 1
  if (factor === 1) return new Float32Array(data)

  let frameSize = opts?.frameSize ?? 2048
  let hopSize = opts?.hopSize ?? (frameSize >> 2)
  let delta = opts?.delta ?? (frameSize >> 2)

  let inLen = data.length
  let outLen = Math.round(inLen * factor)
  let out = new Float32Array(outLen)
  let norm = new Float32Array(outLen)

  let synHop = hopSize
  let anaHop = hopSize / factor
  let win = hannWindow(frameSize)
  let corrLen = corrLength(frameSize, synHop)

  // Cap the read position at the last index a full real frame can start from —
  // once analysis would run past it, keep re-aligning (via search) within that
  // final frame instead of abandoning synthesis before outLen is covered.
  let maxRead = Math.max(0, inLen - frameSize)

  let anaPos = 0, synPos = 0
  let prevReadPos = 0

  while (synPos < outLen) {
    let nomPos = Math.min(Math.round(anaPos), maxRead)
    let readPos = nomPos

    if (synPos > 0 && delta > 0) {
      let searchStart = Math.max(0, nomPos - delta)
      let searchEnd = Math.min(maxRead, nomPos + delta)

      let targetStart = prevReadPos + synHop
      let L = Math.min(corrLen, inLen - targetStart, inLen - searchEnd)
      if (L > 0) {
        let step = L > 768 ? 2 : 1
        let bestCorr = -Infinity, bestS = searchStart
        for (let s = searchStart; s <= searchEnd; s++) {
          let corr = 0
          for (let i = 0; i < L; i += step) corr += data[s + i] * data[targetStart + i]
          if (corr > bestCorr) { bestCorr = corr; bestS = s }
        }
        readPos = bestS
      }
    }

    for (let i = 0; i < frameSize && synPos + i < outLen; i++) {
      out[synPos + i] += (readPos + i < inLen ? data[readPos + i] : 0) * win[i]
      norm[synPos + i] += win[i]
    }

    prevReadPos = readPos
    anaPos += anaHop
    synPos += synHop
  }

  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-8) out[i] /= norm[i]
  return out
}

function wsolaStream(opts) {
  let factor = opts?.factor ?? 1
  let frameSize = opts?.frameSize ?? 2048
  let hopSize = opts?.hopSize ?? (frameSize >> 2)
  let delta = opts?.delta ?? (frameSize >> 2)
  let win = hannWindow(frameSize)
  let synHop = hopSize
  let anaHop = hopSize / factor
  let corrLen = corrLength(frameSize, synHop)
  if (factor === 1) return { write: chunk => new Float32Array(chunk), flush: () => new Float32Array(0) }   // as batch

  let st = makeStreamBufs(frameSize)
  // The batch loop, run incrementally: positions are absolute and advance exactly as
  // there, so every grain reads where the batch grain reads (stream ≡ batch under any
  // chunking). ib[0] sits at absolute input position `inOffset`.
  let anaPos = 0, synPos = 0, prevReadPos = 0, inOffset = 0, fed = 0, sent = 0

  // One grain at synPos. `inLen` is the total input length once known (flush); before
  // that it is Infinity and a grain runs only when its whole search span has arrived.
  function grain(inLen) {
    let maxRead = Math.max(0, inLen - frameSize)
    let nomPos = Math.min(Math.round(anaPos), maxRead)
    let readPos = nomPos
    let ib = st.ib, o = inOffset

    if (synPos > 0 && delta > 0) {
      let searchStart = Math.max(0, nomPos - delta)
      let searchEnd = Math.min(maxRead, nomPos + delta)
      let targetStart = prevReadPos + synHop
      let L = Math.min(corrLen, inLen - targetStart, inLen - searchEnd)
      if (L > 0) {
        let step = L > 768 ? 2 : 1
        let bestCorr = -Infinity, bestS = searchStart
        for (let s = searchStart; s <= searchEnd; s++) {
          let corr = 0
          for (let i = 0; i < L; i += step) corr += ib[s - o + i] * ib[targetStart - o + i]
          if (corr > bestCorr) { bestCorr = corr; bestS = s }
        }
        readPos = bestS
      }
    }

    st.growOut(st.pos + frameSize)
    let ob = st.ob, nb = st.nb, base = st.pos
    for (let i = 0; i < frameSize; i++) {
      ob[base + i] += (readPos + i < inLen ? ib[readPos - o + i] : 0) * win[i]
      nb[base + i] += win[i]
    }
    prevReadPos = readPos
    anaPos += anaHop
    synPos += synHop
    st.pos += synHop
  }

  // Emit up to absolute output position `end`: samples before synPos are final
  function emit(end) {
    let out = st.take(st.pos - synPos + end)
    sent += out.length
    return out
  }

  return {
    write(chunk) {
      st.appendIn(chunk); fed += chunk.length
      while (Math.round(anaPos) + delta + frameSize <= fed) grain(Infinity)
      // drop input no later grain reads: its search span and its correlation target
      let keep = Math.min(Math.min(Math.round(anaPos), fed - frameSize) - delta, prevReadPos + synHop)
      if (keep - inOffset > frameSize * 2) { st.compactIn(keep - inOffset); inOffset = keep }
      // the batch output is round(inputLength · factor) long: never run past that
      return emit(Math.min(synPos, Math.round(fed * factor)))
    },
    flush() {
      let outLen = Math.round(fed * factor)
      while (synPos < outLen) grain(fed)
      return emit(outLen)
    }
  }
}
