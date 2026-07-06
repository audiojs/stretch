import { hannWindow, writer, makeStreamBufs } from '@audio/stretch-core'

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

  let st = makeStreamBufs(frameSize)
  let aPos = 0
  // Track absolute position of last read so the natural-progression target
  // survives input compaction (st.compactIn shifts ib).
  let prevReadAbs = 0
  let inOffset = 0  // absolute position of ib[0]

  // `final` mirrors the batch function's synPos<outLen: keep re-aligning within
  // the final real frame (nomPos capped at maxRead) until analysis has nominally
  // caught up with all buffered input, instead of stopping early because the
  // *uncapped* aPos+frameSize no longer fits — that premature stop is correct
  // behavior mid-stream (wait for more chunks) but wrong at flush (no more chunks
  // are coming, so the tail must still be covered).
  function run(final) {
    let maxRead = Math.max(0, st.il - frameSize)
    while (final ? Math.round(aPos) < st.il : Math.round(aPos) + frameSize <= st.il) {
      let nomPos = Math.min(Math.round(aPos), maxRead)
      let readPos = nomPos

      if (st.pos > 0 && delta > 0) {
        let searchS = Math.max(0, nomPos - delta)
        let searchE = Math.min(maxRead, nomPos + delta)
        let targetStart = (prevReadAbs - inOffset) + synHop
        let L = Math.min(corrLen, st.il - targetStart, st.il - searchE)
        if (targetStart >= 0 && L > 0) {
          let step = L > 768 ? 2 : 1
          let bestCorr = -Infinity, bestS = searchS
          let ib = st.ib
          for (let s = searchS; s <= searchE; s++) {
            let corr = 0
            for (let i = 0; i < L; i += step) corr += ib[s + i] * ib[targetStart + i]
            if (corr > bestCorr) { bestCorr = corr; bestS = s }
          }
          readPos = bestS
        }
      }

      st.growOut(st.pos + frameSize)
      let ob = st.ob, nb = st.nb, base = st.pos, ib = st.ib
      for (let i = 0; i < frameSize; i++) {
        ob[base + i] += (readPos + i < st.il ? ib[readPos + i] : 0) * win[i]
        nb[base + i] += win[i]
      }
      prevReadAbs = inOffset + readPos
      aPos += anaHop
      st.pos += synHop
    }
    let used = Math.floor(aPos)
    if (used > frameSize * 2 + delta) {
      let trim = used - frameSize - delta
      st.compactIn(trim)
      aPos -= trim
      inOffset += trim
    }
  }

  return {
    write(chunk) {
      st.appendIn(chunk)
      run(false)
      return st.take(Math.max(0, st.pos - frameSize + synHop))
    },
    flush() {
      run(true)
      return st.take(st.pos)
    }
  }
}
