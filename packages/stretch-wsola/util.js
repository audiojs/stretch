// Local helpers (inlined family convention — no shared-dep package).

// Wrap { write, flush } stream into single callable: fn(chunk) → process, fn() → flush
export function writer(s) {
  return (chunk) => chunk ? s.write(chunk) : s.flush()
}

const _hannCache = new Map()
export function hannWindow(N) {
  if (_hannCache.has(N)) return _hannCache.get(N)
  let w = new Float64Array(N)
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / N))
  _hannCache.set(N, w)
  return w
}

// Shared streaming buffer state: inBuf, outBuf/nrmBuf with grow/compact/take.
// Plain mutable fields, no accessors — keeps the struct jz-compilable.
export function makeStreamBufs(N, nf = 0) {
  let st = {
    ib: new Float32Array(N * 4), il: 0,
    ob: new Float32Array(N * 8), nb: new Float32Array(N * 8),
    pos: 0, oread: 0, hi: 0,   // hi: end of the furthest frame overlap-added so far

    appendIn(chunk) {
      let need = st.il + chunk.length
      if (need > st.ib.length) {
        let b = new Float32Array(Math.max(need * 2, st.ib.length * 2))
        b.set(st.ib.subarray(0, st.il)); st.ib = b
      }
      st.ib.set(chunk, st.il); st.il += chunk.length
    },

    growOut(need) {
      st.hi = Math.max(st.hi, need)
      if (need <= st.ob.length) return
      let len = Math.max(need * 2, st.ob.length * 2)
      let o = new Float32Array(len), n = new Float32Array(len)
      o.set(st.ob); n.set(st.nb); st.ob = o; st.nb = n
    },

    compactIn(trim) {
      if (trim <= 0) return
      st.ib.copyWithin(0, trim, st.il); st.il -= trim
    },

    take(upTo) {
      upTo = Math.min(upTo, st.pos)
      if (upTo <= st.oread) return new Float32Array(0)
      let len = Math.floor(upTo - st.oread)
      let out = new Float32Array(len)
      for (let i = 0; i < len; i++) {
        let j = st.oread + i, n = nf > 0 ? Math.max(st.nb[j], nf) : st.nb[j]
        out[i] = n > 1e-8 ? st.ob[j] / n : st.ob[j]   // as the batch normalize: near-zero weight stays raw
      }
      st.oread += len
      if (st.oread > N * 8) {
        // shift left; zero only past the high-water mark: frames extend up to N − hop
        // beyond pos, and zeroing from pos erased their unfinished overlap-add tails
        st.ob.copyWithin(0, st.oread); st.nb.copyWithin(0, st.oread)
        st.pos -= st.oread; st.hi -= st.oread; st.oread = 0
        st.ob.fill(0, st.hi); st.nb.fill(0, st.hi)
      }
      return out
    }
  }
  return st
}
