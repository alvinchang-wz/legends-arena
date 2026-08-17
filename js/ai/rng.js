'use strict';
/* ============================================================
   rng.js — seeded deterministic RNG for reproducible matches.

   The game calls Math.random() in many places (spawn jitter, bot cast
   rolls, effects). Rather than thread a generator through every call
   site, seeding swaps Math.random for a mulberry32 stream. Call
   RNG.restore() to put the original back.
   ============================================================ */

const RNG = {
  _s: 1, _orig: null, active: false, seedValue: null,

  seed(s) {
    this.seedValue = s >>> 0;
    this._s = (s >>> 0) || 1;
    if (!this._orig) this._orig = Math.random;
    Math.random = () => this.next();
    this.active = true;
  },

  next() {
    this._s = (this._s + 0x6D2B79F5) | 0;
    let t = Math.imul(this._s ^ (this._s >>> 15), 1 | this._s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },

  restore() {
    if (this._orig) Math.random = this._orig;
    this.active = false; this.seedValue = null;
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { RNG };
