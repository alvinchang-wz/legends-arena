'use strict';
/* ============================================================
   neural-runtime.js — hand-written MLP inference.

   The model is tiny (~7k params) and runs at ~4 Hz per bot, so a
   dependency-free implementation is smaller and faster to debug than
   TF.js/ONNX. All buffers are preallocated: a think tick allocates
   nothing.

   Architecture (v1, target selection):
     selfEnc  : selfDim -> H -> H            (ReLU)
     candEnc  : candDim -> H -> H            (ReLU)   applied per candidate
     scorer   : [selfEmb, candEmb] -> H -> 1 (ReLU)   score per candidate
     noTarget : selfEmb -> H -> 1            (ReLU)   score for "no target"
   ============================================================ */

const NEURAL_MODEL_SCHEMA = 1;

/* out = relu?(W·x + b);  W row-major [outDim x inDim] */
function mlpLinear(out, W, b, x, inDim, outDim, relu) {
  for (let o = 0; o < outDim; o++) {
    let sum = b[o];
    const base = o * inDim;
    for (let i = 0; i < inDim; i++) sum += W[base + i] * x[i];
    out[o] = relu && sum < 0 ? 0 : sum;
  }
}

const NeuralRuntime = {
  ready: false, model: null, cfg: null, warned: false, loadError: null,
  _buf: null,

  /* Validate + install a model object. Returns true on success. */
  loadFromObject(obj) {
    try {
      if (!obj || typeof obj !== 'object') throw new Error('model is not an object');
      if (obj.schemaVersion !== NEURAL_MODEL_SCHEMA) {
        throw new Error(`model schemaVersion ${obj.schemaVersion} != ${NEURAL_MODEL_SCHEMA}`);
      }
      if (obj.obsVersion !== NEURAL_OBSERVATION_VERSION) {
        throw new Error(`observation version ${obj.obsVersion} != ${NEURAL_OBSERVATION_VERSION}`);
      }
      const c = obj.config || {};
      if (c.selfDim !== OBS.SELF_DIM) throw new Error(`selfDim ${c.selfDim} != ${OBS.SELF_DIM}`);
      if (c.candDim !== OBS.CAND_DIM) throw new Error(`candDim ${c.candDim} != ${OBS.CAND_DIM}`);
      if (c.K !== OBS.K) throw new Error(`K ${c.K} != ${OBS.K}`);
      const H = c.hidden;
      if (!(H > 0)) throw new Error('bad hidden size');

      const need = ['se0w', 'se0b', 'se1w', 'se1b', 'ce0w', 'ce0b', 'ce1w', 'ce1b',
        'sc0w', 'sc0b', 'sc1w', 'sc1b', 'nt0w', 'nt0b', 'nt1w', 'nt1b'];
      const P = {};
      for (const k of need) {
        const arr = obj.params[k];
        if (!arr || !arr.length) throw new Error(`missing param ${k}`);
        for (let i = 0; i < arr.length; i++) {
          if (!Number.isFinite(arr[i])) throw new Error(`non-finite weight in ${k}`);
        }
        P[k] = Float32Array.from(arr);
      }
      const expect = {
        se0w: H * OBS.SELF_DIM, se0b: H, se1w: H * H, se1b: H,
        ce0w: H * OBS.CAND_DIM, ce0b: H, ce1w: H * H, ce1b: H,
        sc0w: H * (2 * H), sc0b: H, sc1w: H, sc1b: 1,
        nt0w: H * H, nt0b: H, nt1w: H, nt1b: 1,
      };
      for (const k of need) {
        if (P[k].length !== expect[k]) throw new Error(`${k} length ${P[k].length} != ${expect[k]}`);
      }
      this.model = P; this.cfg = { H, K: c.K };
      this._buf = {
        s0: new Float32Array(H), sEmb: new Float32Array(H),
        c0: new Float32Array(H), cEmb: new Float32Array(H),
        pair: new Float32Array(2 * H), h: new Float32Array(H),
        one: new Float32Array(1), scores: new Float32Array(OBS.K + 1),
      };
      this.ready = true; this.loadError = null; this.warned = false;
      return true;
    } catch (e) {
      this.ready = false; this.model = null; this.loadError = e.message;
      this.warnOnce(`neural model rejected: ${e.message} — falling back to heuristic bot`);
      return false;
    }
  },

  async load(url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return this.loadFromObject(await res.json());
    } catch (e) {
      this.ready = false; this.loadError = e.message;
      this.warnOnce(`neural model not loaded (${e.message}) — using heuristic bot`);
      return false;
    }
  },

  warnOnce(msg) {
    if (this.warned) return;
    this.warned = true;
    console.warn('[NeuralRuntime]', msg);
  },

  /* Score every candidate + the no-target option.
     Returns the scores buffer (length n+1, last = no-target), or null on failure. */
  scoreTargets(obs) {
    if (!this.ready) return null;
    const P = this.model, H = this.cfg.H, B = this._buf;
    mlpLinear(B.s0, P.se0w, P.se0b, obs.self, OBS.SELF_DIM, H, true);
    mlpLinear(B.sEmb, P.se1w, P.se1b, B.s0, H, H, true);

    const scores = B.scores;
    scores.fill(-Infinity);
    for (let k = 0; k < OBS.K; k++) {
      if (obs.mask[k] !== 1) continue;
      const view = obs.cand.subarray(k * OBS.CAND_DIM, (k + 1) * OBS.CAND_DIM);
      mlpLinear(B.c0, P.ce0w, P.ce0b, view, OBS.CAND_DIM, H, true);
      mlpLinear(B.cEmb, P.ce1w, P.ce1b, B.c0, H, H, true);
      B.pair.set(B.sEmb, 0); B.pair.set(B.cEmb, H);
      mlpLinear(B.h, P.sc0w, P.sc0b, B.pair, 2 * H, H, true);
      mlpLinear(B.one, P.sc1w, P.sc1b, B.h, H, 1, false);
      scores[k] = B.one[0];
    }
    mlpLinear(B.h, P.nt0w, P.nt0b, B.sEmb, H, H, true);
    mlpLinear(B.one, P.nt1w, P.nt1b, B.h, H, 1, false);
    scores[OBS.K] = B.one[0];

    for (let k = 0; k <= OBS.K; k++) {
      const v = scores[k];
      if (v !== -Infinity && !Number.isFinite(v)) {
        this.warnOnce('model produced NaN/Inf — falling back to heuristic bot');
        this.ready = false;
        return null;
      }
    }
    return scores;
  },

  /* argmax over legal options; index OBS.K means "no target". */
  argmaxIndex(scores) {
    let bi = OBS.K, bv = scores[OBS.K];
    for (let k = 0; k < OBS.K; k++) if (scores[k] > bv) { bv = scores[k]; bi = k; }
    return bi;
  },

  /* Softmax sample over legal options (stochastic play). */
  sampleIndex(scores, n, temperature) {
    const T = temperature || 1;
    let max = -Infinity;
    for (let k = 0; k < n; k++) if (scores[k] > max) max = scores[k];
    if (scores[OBS.K] > max) max = scores[OBS.K];
    let total = 0;
    const probs = [];
    for (let k = 0; k < n; k++) { const e = Math.exp((scores[k] - max) / T); probs.push(e); total += e; }
    const eNo = Math.exp((scores[OBS.K] - max) / T); probs.push(eNo); total += eNo;
    let r = Math.random() * total;
    for (let k = 0; k < probs.length; k++) { r -= probs[k]; if (r <= 0) return k === n ? OBS.K : k; }
    return OBS.K;
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NeuralRuntime, NEURAL_MODEL_SCHEMA };
}
