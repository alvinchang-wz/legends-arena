# How the Neural Bot Works — Complete Explanation

A self-contained walkthrough of the neural bot in Legends Arena (a browser
MOBA). Written to be handed to someone (or something) that has never seen the
project. All code is verbatim from the repo.

---

## PART 0 — The one thing to understand first

The neural network makes **exactly one decision**: *"which enemy should I
attack right now?"*

That's it. It does not move the character. It does not fire skills. It does not
decide when to run away. It does not touch health, mana, cooldowns, or physics.

It looks at the situation, outputs a choice of target, and writes that choice
into a single variable (`hero.aiTarget`). The rest of the game — which was
already written by hand — reads that variable and does the actual work of
walking toward the target and swinging at it.

Everything below is the machinery around that one decision.

---

## PART 1 — The context: how bots already worked

Every hero in the game runs this loop:

```
Hero.update(dt)                        ← 60 times per second
├─ hard overrides: is the hero dead? stunned? mid-dash? being dragged by a
│                  hook? channeling a recall? If so, stop here — no AI runs.
├─ botThink()                          ← ~4 times per second  = THE DECISION
└─ botControl(dt)                      ← 60 times per second  = THE EXECUTION
```

Two different speeds, on purpose:

- **Thinking is slow (4 Hz)** because deciding "who do I attack" requires
  scanning every nearby unit and scoring them. Doing that 60×/second per bot
  would be 15× more expensive for no benefit. It also gives bots a human-like
  ~250 ms reaction time instead of twitchy frame-perfect target swapping.
- **Executing is fast (60 Hz)** because movement and attack timing need to be
  smooth.

The decision step picks a target. The execution step walks toward it and
attacks it. **The neural network replaces only the decision step.**

Here is the actual dispatch code (`js/entities.js`):

```js
  botThink() {
    if (!Recorder.enabled) { this.runThink(); return; }
    const snap = Recorder.snapshot(this);      // observation BEFORE the decision
    this.runThink();
    Recorder.commit(this, snap);               // labels AFTER the decision
  }
  runThink() {
    if (this.botType === 'neural') this.neuralThink();
    else this.heuristicThink();
  }
```

Every hero has a `botType` of either `'heuristic'` (the original hand-coded
bot) or `'neural'` (the learned one). Both can play in the same match.

---

## PART 2 — The teacher (the original hand-coded bot)

The neural bot learned by copying this. It's a scoring formula:

```js
  /* target scoring + tower-dive veto + jungle fallback; returns the chosen unit or null */
  heuristicSelectTarget() {
    const p = this.p;
    // pick a target: prefer heroes, low hp bias
    let best = null, bestScore = Infinity;
    for (const u of Game.enemyUnits(this.team, { structures: true })) {
      const d = dist(this, u);
      if (d > p.acquireRange) continue;              // too far away: ignore (560 units)
      if (!Game.canSee(this.team, u)) continue;      // hidden in a bush: ignore
      let score = d;                                  // start with distance
      if (u.type === 'hero') score -= p.heroBias + (1 - u.hpPct) * p.lowHpBias;
      if (u.isStructure) score += p.structPenalty;
      if (score < bestScore) { bestScore = score; best = u; }
    }
    // avoid tower-diving with no minion cover
    if (best && best.isStructure) {
      const cover = Game.minions.some(m => m.team === this.team && m.alive && dist(m, best) < 320);
      if (!cover && this.hpPct < clamp(p.diveHp + this.adapt.caution, 0.4, 1)) best = null;
    }
    ...
    return best;
  }
```

**Lowest score wins.** In plain words:

- Start with how far away the enemy is (closer = better).
- If it's an enemy **hero**, subtract 180 — heroes are worth walking further for.
- If that hero is **wounded**, subtract up to another 150 — finish off weak targets.
- If it's a **tower**, add 100 — towers are the least urgent.
- Never pick anything more than 560 units away, or hidden in a bush.
- Never pick a tower unless friendly minions are next to it soaking its shots.

That's the "expertise" the network had to learn.

---

## PART 3 — Turning the game into numbers (the observation)

A neural network can only consume numbers. So one file
(`js/ai/observation.js`) converts "what's happening right now" into a fixed
list of numbers. **This same file is used both when recording training data and
when the bot plays**, so what it learned from and what it sees can never
disagree.

### 3a. Two groups of numbers

**Group 1 — 30 numbers about the bot itself** ("self features"):

```js
const SELF_FEATURE_NAMES = [
  'hpFrac', 'manaFrac', 'isRetreating', 'recallLegal', 'atkCdFrac',
  'skillCd0', 'skillCd1', 'skillCd2', 'skillAfford0', 'skillAfford1', 'skillAfford2',
  'fountainDirX', 'fountainDirY', 'fountainDist', 'baseDirX', 'baseDirY', 'baseDist',
  'wpDirX', 'wpDirY', 'wpDist', 'hasTarget', 'targetIsHero', 'targetIsMinion',
  'targetIsStructure', 'team', 'levelFrac', 'caution', 'towerDanger',
  'alliesNear', 'enemiesNear',
];
```

**Group 2 — 16 numbers about each nearby enemy** ("candidate features"),
for up to 16 enemies:

```js
const CAND_FEATURE_NAMES = [
  'relX', 'relY', 'dist', 'hpFrac', 'isHero', 'isMinion', 'isStructure', 'isMonster',
  'radius', 'inAttackRange', 'inNoticeRadius', 'inChaseRadius', 'minionCover',
  'isCurrentTarget', 'rank', 'isEnemy',
];
```

### 3b. Two rules that make this work

**Rule 1: everything is relative and normalized.** The network never sees
"enemy at map coordinate (2140, 890)". It sees "enemy 0.37 of the way to my
right, 0.12 down, at 0.42 of max distance". So it learns *relationships*, not
map memorization, and every number sits roughly in the −1…1 range, which is
what neural networks train well on.

**Rule 2: illegal targets never even get encoded.** Dead units, teammates, and
enemies hidden in bushes are filtered out before the network sees anything. The
network literally cannot choose them, because they aren't in the list.

### 3c. The candidate list

```js
  buildCandidates(hero) {
    const pool = [];
    for (const u of Game.enemyUnits(hero.team, { structures: true, neutral: true })) {
      if (!u.alive) continue;
      const d = dist(hero, u);
      if (d > OBS.MAX_DIST) continue;              // 900 units
      if (!Game.canSee(hero.team, u)) continue;    // bush stealth respected
      pool.push({ u, d });
    }
    pool.sort((a, b) => (a.d - b.d) || (a.u.x - b.u.x) || (a.u.y - b.u.y) ||
      (a.u.type < b.u.type ? -1 : a.u.type > b.u.type ? 1 : 0));
    return pool.slice(0, OBS.K);                   // nearest 16
  },
```

Sorted nearest-first, with a **stable tie-breaker** (x, then y, then type) so
that the exact same game situation always produces the exact same ordering.
Without that, training and play could silently diverge.

Note `MAX_DIST = 900` is deliberately *larger* than the teacher's 560-unit
notice radius. This lets the network see enemies the teacher ignores, so it can
learn the cutoff rule itself rather than having it hidden by the data.

### 3d. Writing the numbers

```js
    let i = 0;
    s[i++] = clamp(hero.hpPct, 0, 1);
    s[i++] = hero.maxMana ? clamp(hero.mana / hero.maxMana, 0, 1) : 0;
    s[i++] = hero.aiState === 'retreat' ? 1 : 0;
    s[i++] = dist(hero, fountain) > 350 ? 1 : 0;                       // recall legal
    s[i++] = clamp(hero.atkCd * hero.curAtkSpd(), 0, 1);
    for (let k = 0; k < 3; k++) s[i++] = clamp(hero.skillCd[k] / hero.skills[k].cd, 0, 1);
    for (let k = 0; k < 3; k++) s[i++] = hero.mana >= hero.skills[k].mana ? 1 : 0;
    ...
```

and per candidate:

```js
      c[o + 0] = clamp((u.x - hero.x) / N.pos, -1, 1);   // relative X
      c[o + 1] = clamp((u.y - hero.y) / N.pos, -1, 1);   // relative Y
      c[o + 2] = clamp(d / N.dist, 0, 1);                // distance
      c[o + 3] = clamp(u.hpPct, 0, 1);                   // how hurt it is
      c[o + 4] = u.type === 'hero' ? 1 : 0;
      c[o + 5] = u.type === 'minion' ? 1 : 0;
      c[o + 6] = u.isStructure ? 1 : 0;
      c[o + 7] = u.type === 'monster' ? 1 : 0;
      c[o + 8] = clamp(u.radius / N.radius, 0, 1);
      c[o + 9] = hero.inAttackRange(u) ? 1 : 0;
      c[o + 10] = d <= acquire ? 1 : 0;                  // inside 560?
      c[o + 11] = d <= chase ? 1 : 0;                    // inside 720?
      c[o + 12] = cover;                                 // minions shielding this tower?
      c[o + 13] = u === hero.aiTarget ? 1 : 0;           // already my target?
      c[o + 14] = k / OBS.K;                             // how close in rank
      c[o + 15] = u.team === TEAM_NEUTRAL ? 0 : 1;
```

Everything is written into **preallocated arrays** that get reused every tick,
so a decision allocates zero new memory.

---

## PART 4 — Collecting the training data

While the hand-coded bot plays, the recorder writes down, at each think tick:
the situation (before deciding) and the answer (after deciding).

```js
  botThink() {
    if (!Recorder.enabled) { this.runThink(); return; }
    const snap = Recorder.snapshot(this);      // observation BEFORE the decision
    this.runThink();
    Recorder.commit(this, snap);               // labels AFTER the decision
  }
```

Order matters: the observation must be taken **before** the bot decides,
because one of its features is "who am I currently targeting" — which the
decision is about to overwrite.

The label is simply **the position in the candidate list of whoever the teacher
picked**, or a special "no target" class:

```js
    const chosen = hero.aiTarget;
    let targetIdx = OBS.K;                       // OBS.K == "no target" class
    if (chosen) {
      const i = snap.units.indexOf(chosen);
      if (i < 0) return;                         // chosen unit wasn't a legal candidate: skip
      targetIdx = i;
    }
```

So with 16 candidate slots, the label is a number from 0 to 16, where 16 means
"attack nobody".

### The boring-data problem

Most think ticks are a bot walking down an empty lane. If you keep all of them,
90% of your data says "do nothing" and the network learns almost nothing about
fighting. So the recorder keeps **all rare/important moments** and only a
**fraction of repetitive ones**:

```js
    const critical = stateChanged || recalled || anySkill || snap.towerDanger;
    if (!critical) {
      let p = 1;
      if (retreat) p = this.cfg.keepRetreat;                       // mid-retreat coasting
      else if (targetChanged) p = 1;                               // acquisitions always kept
      else if (targetIdx === OBS.K) p = this.cfg.keepPushNoTarget; // lane walking
      else p = this.cfg.keepTargetMaintain;                        // holding a target
      if (p < 1 && Math.random() > p) { this.dropped++; return; }
    }
```

Result: 10 matches → **92,391 examples**, 61% of which contain an actual
target, instead of being drowned in idle ticks.

---

## PART 5 — The neural network itself

### 5a. The shape problem

A normal network needs a fixed-size input. But the number of nearby enemies
changes constantly — sometimes 2, sometimes 15.

The solution is to **score each candidate separately with the same small
network**, then compare scores. Like a judge scoring contestants one at a time
with the same rubric — the number of contestants doesn't matter.

### 5b. The architecture (PyTorch, `training/train.py`)

```python
class TargetPolicy(nn.Module):
    """Per-candidate scoring; mirrors the JS runtime exactly."""

    def __init__(self, hidden=32):
        super().__init__()
        h = hidden
        self.se0, self.se1 = nn.Linear(SELF_DIM, h), nn.Linear(h, h)
        self.ce0, self.ce1 = nn.Linear(CAND_DIM, h), nn.Linear(h, h)
        self.sc0, self.sc1 = nn.Linear(2 * h, h), nn.Linear(h, 1)
        self.nt0, self.nt1 = nn.Linear(h, h), nn.Linear(h, 1)

    def forward(self, xs, xc, xm):
        s = F.relu(self.se1(F.relu(self.se0(xs))))              # (B,H)
        c = F.relu(self.ce1(F.relu(self.ce0(xc))))              # (B,K,H)
        pair = torch.cat([s.unsqueeze(1).expand(-1, c.size(1), -1), c], dim=-1)
        cand = self.sc1(F.relu(self.sc0(pair))).squeeze(-1)     # (B,K)
        cand = cand.masked_fill(xm == 0, -1e9)
        no_target = self.nt1(F.relu(self.nt0(s)))               # (B,1)
        return torch.cat([cand, no_target], dim=-1)             # (B,K+1)
```

Step by step:

1. **`se0`/`se1` — the self encoder.** Squeezes the 30 "how am I doing" numbers
   into a 32-number summary of my situation.
2. **`ce0`/`ce1` — the candidate encoder.** Squeezes each enemy's 16 numbers
   into a 32-number summary. *The same encoder is used for every enemy.*
3. **`pair`** — glue my summary onto each enemy's summary (32 + 32 = 64
   numbers per enemy).
4. **`sc0`/`sc1` — the scorer.** Turns each 64-number pair into **one number**:
   how attractive is this enemy, given my situation.
5. **`masked_fill`** — empty candidate slots get score −1,000,000,000 so they
   can never win.
6. **`nt0`/`nt1` — the no-target head.** Produces one more score for "attack
   nobody", from my situation alone.
7. **Output**: 17 scores (16 enemies + "nobody"). Highest wins.

**Total size: 6,850 numbers.** Small enough to print. For comparison, an image
model has millions to billions.

### 5c. Training

```python
loss = F.cross_entropy(logits, y[idx].to(device), weight=weights)
```

Standard classification: "of these 17 options, which one did the teacher pick?"

Two details that matter for honesty:

**Split by whole match, not by row:**

```python
def split_by_match(rows, seed=0, val_frac=0.15, test_frac=0.15):
    """Split by whole match so adjacent think ticks never straddle splits."""
```

Ticks a quarter-second apart are nearly identical. If they landed in both
training and testing, the test score would be measuring memorization, not
learning. Whole matches are held out instead.

**Down-weight the common answer:**

```python
    weights = torch.ones(K + 1, device=device)
    weights[K] = args.no_target_weight        # default 0.4
```

"No target" is the most common answer, so it counts for less — otherwise the
network could score well by always saying "nobody".

**Result on unseen matches: 98.7% accuracy**, trained in **9 seconds on CPU**.
(CPU beats the Apple GPU here because the model is so small that copying data
to the GPU costs more than the math saves.)

---

## PART 6 — Running the model inside the game

Rather than load a big ML library into the browser, the math is written by
hand. A neural network layer is just: multiply, add, and clamp negatives to
zero.

```js
/* out = relu?(W·x + b);  W row-major [outDim x inDim] */
function mlpLinear(out, W, b, x, inDim, outDim, relu) {
  for (let o = 0; o < outDim; o++) {
    let sum = b[o];
    const base = o * inDim;
    for (let i = 0; i < inDim; i++) sum += W[base + i] * x[i];
    out[o] = relu && sum < 0 ? 0 : sum;
  }
}
```

That is the entire "AI engine". Everything else is bookkeeping.

The full scoring pass, mirroring the PyTorch model exactly:

```js
  scoreTargets(obs) {
    if (!this.ready) return null;
    const P = this.model, H = this.cfg.H, B = this._buf;
    mlpLinear(B.s0,   P.se0w, P.se0b, obs.self, OBS.SELF_DIM, H, true);
    mlpLinear(B.sEmb, P.se1w, P.se1b, B.s0,     H,            H, true);

    const scores = B.scores;
    scores.fill(-Infinity);
    for (let k = 0; k < OBS.K; k++) {
      if (obs.mask[k] !== 1) continue;                    // empty slot: skip
      const view = obs.cand.subarray(k * OBS.CAND_DIM, (k + 1) * OBS.CAND_DIM);
      mlpLinear(B.c0,   P.ce0w, P.ce0b, view, OBS.CAND_DIM, H, true);
      mlpLinear(B.cEmb, P.ce1w, P.ce1b, B.c0, H,            H, true);
      B.pair.set(B.sEmb, 0); B.pair.set(B.cEmb, H);       // glue the two summaries
      mlpLinear(B.h,   P.sc0w, P.sc0b, B.pair, 2 * H, H, true);
      mlpLinear(B.one, P.sc1w, P.sc1b, B.h,    H,     1, false);
      scores[k] = B.one[0];                               // this enemy's score
    }
    mlpLinear(B.h,   P.nt0w, P.nt0b, B.sEmb, H, H, true);
    mlpLinear(B.one, P.nt1w, P.nt1b, B.h,    H, 1, false);
    scores[OBS.K] = B.one[0];                             // "attack nobody" score

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
```

The trained weights ship as a 144 KB JSON file
(`models/neural-bot-v1/model.json`) that the game fetches at startup.

---

## PART 7 — Making the decision, safely

```js
  selectTarget(hero) {
    if (!NeuralRuntime.ready) return undefined;
    try {
      this.stats.ticks++;
      const obs = Observation.encode(hero);
      const scores = NeuralRuntime.scoreTargets(obs);
      if (!scores) { this.stats.fallbacks++; return undefined; }

      const idx = this.sampling
        ? NeuralRuntime.sampleIndex(scores, obs.n, this.temperature)
        : NeuralRuntime.argmaxIndex(scores);

      if (idx === OBS.K || idx >= obs.n) { this.stats.noTarget++; return null; }

      const u = obs.units[idx];
      // hard legality re-check: the model may not target dead/invisible/allied units
      if (!u || !u.alive || u.team === hero.team || !Game.canSee(hero.team, u)) {
        this.stats.noTarget++;
        return null;
      }
      // hard safety: never commit to a structure without minion cover
      if (u.isStructure) {
        const cover = Game.minions.some(m => m.team === hero.team && m.alive && dist(m, u) < 320);
        const p = hero.p || Brains.defaults();
        if (!cover && hero.hpPct < clamp(p.diveHp + hero.adapt.caution, 0.4, 1)) {
          this.stats.noTarget++;
          return null;
        }
      }
      this.stats.picked++;
      return u;
    } catch (e) {
      NeuralRuntime.warnOnce(`inference error (${e.message}) — falling back to heuristic bot`);
      NeuralRuntime.ready = false;
      this.stats.fallbacks++;
      return undefined;
    }
  },
```

The three possible return values are the whole safety design:

| Return | Meaning | What happens |
|---|---|---|
| a unit | the model chose this target | bot attacks it |
| `null` | the model chose "nobody" | bot pushes the lane instead |
| `undefined` | **the model is unavailable or broke** | the hand-coded teacher takes over |

**`argmax` vs `sampling`:** in normal play the bot samples from the scores
probabilistically (so identical situations don't always produce identical
play). For reproducible evaluation, `NeuralController.sampling = false` makes
it always take the highest score.

### The four safety layers

1. **The network is never asked** when the hero is dead, stunned, dashing,
   hook-dragged, or recalling — those overrides run earlier in `update()` and
   return before any AI code.
2. **Illegal targets never enter the input** (dead / allied / bush-hidden are
   filtered during candidate building).
3. **The choice is re-validated** after the fact — even a "correct" model
   output is checked again against live game state.
4. **Tower-dive safety stays hard-coded.** If the model picks a tower with no
   friendly minions absorbing its fire, the pick is thrown away. This is
   tested by feeding a fake model that *insists* on the unsafe tower; the guard
   rejects it.

And if anything at all goes wrong — missing file, wrong version, mismatched
dimensions, a corrupted weight, an exception — one warning is logged and every
neural bot silently reverts to the hand-coded bot. A bad model cannot break
the game.

---

## PART 8 — What the network never touches

This is the strict boundary:

```js
    this.aiTarget = pick;        // ← the ONLY thing the network writes
```

It cannot modify: position, velocity, health, mana, cooldowns, damage,
collision, visibility, stun state, dash state, or recall state.

Movement and attacking still go through the same shared methods that a human
player's input goes through:

```js
moveToward(...)   tryAttack(...)   castSkill(...)   startRecall(...)
```

So the neural bot obeys exactly the same physics, cooldowns, mana costs, and
collision rules as everyone else. It cannot cheat, even if the model wanted to.

---

## PART 9 — How well it works

| Measurement | Result | Meaning |
|---|---|---|
| Model size | 6,850 parameters | tiny |
| Training data | 92,391 examples from 10 matches | small |
| Training time | 9 seconds (CPU) | cheap |
| Accuracy on unseen matches | **98.7%** | it learned the rule |
| Live agreement in-game | **99.3%** over 10,031 decisions | the JS math matches PyTorch |
| Failures | **0** in 70,451 decisions | never crashed or picked illegally |
| Win rate vs teacher | 7/12 (58%) | statistically a tie |

The last row is the important one to read correctly. **A tie is the correct
result.** The network was trained to *imitate* the teacher, not to beat it. A
student that plays at parity with its teacher means the copying worked. Making
it genuinely *better* requires different methods (DAgger, reinforcement
learning) that are deliberately not built yet.

The two accuracy numbers measure different things:
- **98.7%** = the network learned the pattern from data it had never seen.
- **99.3%** = the hand-written JavaScript reproduces what PyTorch trained. If
  the weight layout were wrong, this would have collapsed to near-random.

---

## PART 10 — The complete flow, end to end

```
TRAINING (offline, once)
  hand-coded bot plays 10 seeded matches, headless, ~5s each
    └─ at each think tick (4 Hz): record [situation] → [chosen target]
       └─ keep all rare moments, sample the boring ones
          └─ 92,391 examples → dataset.jsonl
             └─ PyTorch: learn to predict the choice from the situation (9s)
                └─ export 6,850 weights → model.json (144 KB)

PLAYING (live, every match)
  Hero.update(dt), 60 Hz
    ├─ dead/stunned/dashing/hooked/recalling? → stop, network never consulted
    ├─ botThink(), 4 Hz
    │    └─ botType === 'neural'?
    │         ├─ heuristicStateStep()      ← push/retreat still hand-coded
    │         ├─ Observation.encode()      ← game state → 30 + 16×16 numbers
    │         ├─ NeuralRuntime.scoreTargets()  ← 17 scores
    │         ├─ pick highest (or sample)
    │         ├─ safety masks               ← reject illegal/unsafe picks
    │         ├─ hero.aiTarget = pick       ← THE ONLY THING IT WRITES
    │         └─ botCast()                  ← skills still hand-coded
    └─ botControl(dt), 60 Hz                ← walking + attacking, unchanged
```

---

## PART 11 — File map

| File | Role |
|---|---|
| `js/ai/observation.js` | game state → numbers (used by both recording and play) |
| `js/ai/recorder.js` | writes training examples, with sampling |
| `js/ai/neural-runtime.js` | hand-written matrix math + model loading + safety checks |
| `js/ai/neural-controller.js` | the decision + hard legality masks |
| `js/ai/rng.js` | seeded randomness for reproducible matches |
| `js/entities.js` | `Hero.botThink` dispatcher; the original teacher, intact |
| `training/harness.html` | headless match runner (collect + evaluate) |
| `training/train.py` | PyTorch training + JSON export |
| `training/tests.js` | 38 scenario tests |
| `models/neural-bot-v1/model.json` | the trained weights |

---

## PART 12 — What is deliberately NOT built

- The network decides **only the target**. Push/retreat, recall, and skill use
  are still hand-coded — though their labels are *already being recorded*, so
  the data for the next version exists.
- **No DAgger** (letting the student play and having the teacher correct its
  mistakes).
- **No reinforcement learning** (learning from wins/losses instead of copying).

One subtlety saved for later: the teacher casts a ready skill only 55% of the
time, at random. Training a student on those coin flips would give identical
situations contradictory labels. So the recorder saves deterministic
**eligibility** ("could this skill have been cast?") rather than the flip
itself, so a future skill head can learn "≈55% when eligible, 0% when not" and
sample at runtime instead of memorizing noise.
