# Neural Bot — Imitation Learning Guide

Behavior cloning of the hand-coded heuristic bot. **v1 scope: target selection
only.** Strategic state, recall, skill casting and all 60 Hz execution stay
heuristic and unchanged.

The original heuristic bot is untouched and remains the default and the
fallback. Nothing records or infers unless you explicitly enable it.

---

## 0. Requirements

```bash
python3 -m pip install --user torch numpy
```

Verified on a 2020 M1 (Python 3.9.6, torch 2.8.0, MPS available). No CUDA,
no cloud, no Node.js required — the headless simulator runs in the browser.

Start the dev server (also accepts `POST /_save` so the harness can write
datasets straight into the project):

```bash
python3 serve.py
```

---

## 1. Generate teacher matches

Open <http://localhost:8642/training/harness.html>.

Rendering is disabled before the game boots (`requestAnimationFrame` is
stubbed), so matches run headless at a fixed 1/60 s timestep with a seeded
RNG. Set **matches**, **seed**, **max examples**, then click
**1 · Collect teacher data**.

- ~1.6–5 s per match, ~5–9k examples per match
- writes `training/data/dataset.jsonl` (also downloadable)

Reference run: 10 matches → 92,391 examples, 45 MB, ~50 s.

Recording is off by default. It happens **only at AI think ticks (~4 Hz)**,
never per frame, and only for heroes whose `botType` is `heuristic`.

### Dataset sampling

Repetitive lane-pushing ticks would otherwise dominate. Always kept: state
transitions, recalls, skill-eligible ticks, tower-danger ticks, and new target
acquisitions. Sampled: mid-retreat coasting (15%), target maintenance (25%),
idle no-target pushing (8%). Tune in `Recorder.cfg`
([js/ai/recorder.js](js/ai/recorder.js)):

```js
Recorder.cfg.keepPushNoTarget = 0.04;
Recorder.cfg.keepTargetMaintain = 0.12;
Recorder.cfg.keepRetreat = 0.15;
Recorder.cfg.maximumExamples = 120000;
```

### Inspect the dataset

```bash
wc -l training/data/dataset.jsonl
head -c 600 training/data/dataset.jsonl
python3 -c "
import json,collections
c=collections.Counter(); m=set()
for l in open('training/data/dataset.jsonl'):
    r=json.loads(l); m.add(r['m'])
    c['rows']+=1; c['target' if r['y_target']!=16 else 'no_target']+=1
    c['retreat']+=r['y_state']; c['recall']+=r['y_recall']
print(dict(c), 'matches:', len(m))"
```

---

## 2. Train

```bash
# CPU (default; fastest for a model this small)
python3 training/train.py --data training/data/dataset.jsonl --epochs 25

# Apple MPS
python3 training/train.py --device mps --epochs 25

# resume from the last checkpoint
python3 training/train.py --resume

# low-resource M1 settings
python3 training/train.py --batch 128 --hidden 32 --epochs 15 --limit 40000
```

`--device auto` (default) picks **CPU** deliberately: at 6,850 parameters the
MPS transfer overhead costs more than the kernels save.

Splitting is **by whole match**, so adjacent think ticks never straddle
train/val/test. The split is seeded and recorded in the exported model.

Reference run (M1, CPU, 92k examples): **9.0 s**, early-stopped at epoch 25.

```
val : acc 0.987  acc|target 0.984  acc|none 0.992  (n=19954)
test: acc 0.987  acc|target 0.985  acc|none 0.990  (n=12729)
exported models/neural-bot-v1/model.json — 6850 weights, 143.8 KB
```

Metrics are reported separately for "a target exists" and "no target", because
overall accuracy hides the imbalance. The over-represented no-target class is
down-weighted via `--no-target-weight` (default 0.4).

Artifacts:

| Path | Contents |
|---|---|
| `models/neural-bot-v1/model.json` | exported weights + metadata (schema, split, metrics) |
| `training/checkpoints/target_v1.pt` | best-val checkpoint: weights, optimizer, epoch, schema version |
| `training/data/last_metrics.json` | metrics of the last run |

---

## 3. Enable the neural bot in the game

In the browser console on <http://localhost:8642>:

```js
await NeuralRuntime.load('models/neural-bot-v1/model.json');
Game.botTypes = ['neural', 'heuristic'];   // blue = neural, red = heuristic
```

Then start a match (Spectate Bots, or pick a hero and play against them).
`['neural','neural']`, `['heuristic','neural']` and `null` (all heuristic,
the default) also work. Per hero: `hero.botType = 'neural'`.

Deterministic evaluation vs. stochastic play:

```js
NeuralController.sampling = false;   // argmax — reproducible
NeuralController.sampling = true;    // softmax sampling — default
```

---

## 4. Evaluate neural vs heuristic

In the harness, set **matches** (per pairing) and **seed**, click
**2 · Load model**, then **3 · Evaluate bots**. It runs all four pairings with
sides alternated and writes `training/data/eval.json`.

Reference run (6 matches per pairing, seeds 2000–2005, deterministic):

| Pairing | Result |
|---|---|
| heuristic vs heuristic | 3–3 (balanced baseline) |
| **neural** (blue) vs heuristic | **5–1** |
| heuristic vs **neural** (red) | 2–4 |
| neural vs neural | 5–1 (blue side) |
| **Side-balanced neural win rate** | **7/12 = 58%** |
| Fallbacks | **0 / 70,451 neural think ticks** |

7/12 is statistically indistinguishable from parity — which is the *expected*
and correct outcome for behavior cloning. The student was trained to copy the
teacher, not beat it. Parity plus 99.3% live decision agreement means the
pipeline reproduces the teacher faithfully; beating it requires DAgger or RL
fine-tuning (not implemented yet, by design).

Per-pairing metrics collected: wins, match length, kills/deaths/assists, hero
and structure damage, gold, average level, towers destroyed, retreat time
fraction, target switches, recalls started/completed, deaths under enemy towers,
and neural tick/fallback counts.

---

## 5. Tests

Click **Run tests** in the harness (or `runAITests(console.log)` in its
console). 38 assertions covering: retreat threshold and hysteresis, target
preference (heroes over minions, wounded priority, structure deprioritization),
bush visibility masking, tower cover encoding and dive rejection, acquire-vs-
chase separation, skill eligibility labels, malformed-model rejection, fallback
on inference errors, mixed heuristic/neural matches without state leakage, and
seed determinism.

Last run: **38 passed, 0 failed.**

---

## 6. How it fits together

```
Hero.update(dt)                        60 Hz
├─ hard overrides (dead, hooked, dashing, recalling, stunned)   ← model never consulted
├─ botThink()                          ~4 Hz   DECISION
│   ├─ botType 'heuristic' → heuristicThink()          (original, unchanged)
│   └─ botType 'neural'    → neuralThink()
│         ├─ heuristicStateStep()      push/retreat/flee stay hand-coded
│         ├─ NeuralController.selectTarget()  ← the only learned decision
│         │     └─ hard masks: no allies, dead, invisible, or uncovered towers
│         └─ botCast()                 skill rules stay hand-coded
└─ botControl(dt)                      60 Hz   EXECUTION (shared, unchanged)
```

The network only writes `hero.aiTarget`. It never touches position, velocity,
health, mana, cooldowns, damage, collision, visibility, stun or dash state —
the engine still enforces every rule through `moveToward` / `tryAttack` /
`castSkill` / `startRecall`.

### Files

| File | Role |
|---|---|
| [js/ai/observation.js](js/ai/observation.js) | schema v1 encoder — the one place state becomes features |
| [js/ai/neural-runtime.js](js/ai/neural-runtime.js) | hand-written MLP inference, validation, NaN guards |
| [js/ai/neural-controller.js](js/ai/neural-controller.js) | decision step + hard legality masks |
| [js/ai/recorder.js](js/ai/recorder.js) | optional teacher recording + sampling |
| [js/ai/rng.js](js/ai/rng.js) | seeded RNG for reproducible matches |
| [js/entities.js](js/entities.js) | `Hero.botThink` dispatcher; original teacher intact |
| [training/harness.html](training/harness.html) | headless collection + evaluation UI |
| [training/train.py](training/train.py) | PyTorch behavior cloning + JSON export |
| [training/tests.js](training/tests.js) | scenario tests |

### Fallback behavior

If the model is missing, the schema/observation version mismatches, dimensions
disagree, a weight is non-finite, or inference throws, the runtime logs **one**
warning and every neural bot silently reverts to the heuristic teacher. The
game never breaks because of a bad model.

### Versioning

`NEURAL_OBSERVATION_VERSION` (observation.js) and `NEURAL_MODEL_SCHEMA`
(neural-runtime.js) are stamped into datasets, checkpoints and exported models.
Change the feature layout → bump the observation version → old models are
rejected with a clear message instead of silently mispredicting.

---

## 7. Not implemented yet (deliberately)

DAgger and RL fine-tuning are **not** built. The architecture leaves room for
both: the recorder can log student states with teacher labels (DAgger), and the
heads are separable for policy-gradient fine-tuning. Get supervised cloning
solid first.

Next steps in order: multi-head model (push/retreat, recall, skills — labels
are already being recorded), then DAgger to fix compounding drift, then RL.

For skills, the recorded label is deterministic **eligibility**, not the
sampled coin flip — the teacher's 55% cast roll would otherwise teach
contradictory labels for identical states. Train skill probability toward
~0.55 when eligible and 0 when not, then sample at inference.
