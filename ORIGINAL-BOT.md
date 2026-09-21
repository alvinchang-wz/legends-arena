# The Original Hero Bot — Framework & Code

This is the hand-coded heuristic bot: version 1, the seed all training starts
from. Live code is in `js/entities.js` (Hero class); there the constants are
read from `this.p` (the genome) instead of being literals, but the genome
defaults equal the numbers below, so behavior is the same.

## Framework

Two loops at different frequencies, plus a strict priority ladder.

```
Hero.update(dt)                     // every frame, ~60Hz
├─ hard overrides (bot never gets a say):
│    dead / respawning · hook-dragged · mid-dash · recall channel · stunned
└─ if bot:
     aiTimer -= dt
     if (aiTimer <= 0) { aiTimer = 0.22 + rand(0,0.12); botThink(); }   // ~4Hz: DECIDE
     botControl(dt)                                                     // 60Hz: EXECUTE
```

**Why split:** the target-scoring scan is O(units), so running it 4×/sec
instead of 60×/sec is ~15× cheaper (a full match simulates in ~3s). It also
gives bots a ~250ms "reaction time" — committing to a target between ticks
instead of twitch-switching every frame.

**Key invariant:** the AI produces *intentions*, never physics. It only calls
`moveToward` / `tryAttack` / `castSkill` — the same methods the player's input
path uses. Movement, cooldowns, mana, stuns, and collision are enforced
downstream in shared code, so bots cannot cheat and combat-rule changes apply
to both automatically.

### State the bot carries
| Field | Meaning |
|---|---|
| `aiState` | `'push'` or `'retreat'` — the only two strategic modes |
| `aiTarget` | committed target, or null |
| `aiTimer` | countdown to next think tick |
| `lane`, `path` | assigned lane + its waypoint list (pre-reversed for red, so both teams walk index 0 → end) |
| `wpIdx` | current waypoint along that path |

No planner, no memory, no team blackboard. Everything else is read fresh
from the world each tick.

---

## botThink() — decide (~4×/sec)

```js
botThink() {
  // 1. RETREAT STATE (hysteresis: 0.36 down, 0.85 up — the gap stops flickering)
  if (this.aiState === 'retreat') {
    if (this.hpPct > 0.85) this.aiState = 'push';
  } else if (this.hpPct < 0.36) {
    this.aiState = 'retreat';
    this.aiTarget = null;
    const danger = Game.heroes.some(h =>
      h.team !== this.team && h.alive && dist(this, h) < 900);
    if (!danger) this.startRecall();      // safe? recall instead of walking home
    return;
  }
  if (this.aiState === 'retreat') return;

  // 2. TARGET SELECTION — lowest score wins
  //    score = distance − 180(if hero) − 150×(missing HP fraction) + 100(if structure)
  let best = null, bestScore = Infinity;
  for (const u of Game.enemyUnits(this.team, { structures: true })) {
    const d = dist(this, u);
    if (d > 560) continue;                     // notice radius
    if (!Game.canSee(this.team, u)) continue;  // bushes hide enemies
    let score = d;
    if (u.type === 'hero')  score -= 180 + (1 - u.hpPct) * 150;  // prefer heroes, prefer wounded
    if (u.isStructure)      score += 100;                        // towers last
    if (score < bestScore) { bestScore = score; best = u; }
  }

  // 3. TOWER-DIVE VETO — never siege a tower without minion cover
  if (best && best.isStructure) {
    const cover = Game.minions.some(m =>
      m.team === this.team && m.alive && dist(m, best) < 320);
    if (!cover && this.hpPct < 0.95) best = null;
  }

  this.aiTarget = best;
  if (best) this.botCast(best);
}
```

## botCast() — skill usage

```js
botCast(t) {
  for (let i = 0; i < 3; i++) {
    const s = this.skills[i];
    if (this.skillCd[i] > 0 || this.mana < s.mana) continue;
    if (Math.random() > 0.55) continue;   // ~55% per think tick: staggers casts, avoids robotic dumps
    const d = this.distTo(t);
    const isHero = t.type === 'hero';
    switch (s.type) {
      case 'skillshot':   if (isHero && d < s.range * 0.9)          this.castSkill(i, t); break;
      case 'nova':        if (d < s.radius + t.radius)              this.castSkill(i, t); break;
      case 'dash':        if (isHero && d > 150 && d < s.dist + 100) this.castSkill(i, t); break;
      case 'zone':        if (isHero && d < s.range)                this.castSkill(i, t); break;
      case 'heal':        if (this.hpPct < 0.65)                    this.castSkill(i, null); break;
      case 'blinkstrike': if (isHero && d < s.range && t.hpPct < 0.55) this.castSkill(i, t); break;  // finisher only
      case 'buff':        if (isHero && d < 300)                    this.castSkill(i, null); break;
    }
  }
}
```

## botControl() — execute (every frame)

A priority ladder; **first match wins, everything below is skipped.**

```js
botControl(dt) {
  // 1. RETREATING → walk to fountain (or hold still while recall channels)
  if (this.aiState === 'retreat') {
    if (this.recallT > 0) return;
    const b = FOUNTAINS[this.team];
    if (dist(this, b) > 200) this.moveToward(b.x, b.y, dt);
    return;
  }

  // 2. UNDER AN ENEMY TOWER with no minion cover → back off toward home
  const twr = Game.structures().find(s =>
    s.alive && s.team !== this.team && dist(this, s) < s.range + 80);
  if (twr) {
    const cover = Game.minions.some(m =>
      m.team === this.team && m.alive && dist(m, twr) < 320);
    if (!cover && this.hpPct < 0.95) {
      const b = BASES[this.team];
      this.moveToward(this.x + (b.x - this.x) * 0.1, this.y + (b.y - this.y) * 0.1, dt);
      if (this.aiTarget && this.aiTarget.isStructure) this.aiTarget = null;
      return;
    }
  }

  // 3. FIGHT — validated every frame, not just at think time
  let t = this.aiTarget;
  if (t && (!t.alive || !Game.canSee(this.team, t) || this.distTo(t) > 720)) {
    t = this.aiTarget = null;     // chase leash: 720 (wider than the 560 notice radius)
  }
  if (t) {
    if (this.inAttackRange(t)) this.tryAttack(t);
    else this.moveToward(t.x, t.y, dt);
    return;
  }

  // 4. PUSH THE LANE — follow waypoints toward the enemy base
  if (!this.path) return;
  let wp = this.path[this.wpIdx];
  if (!wp || this.distTo(wp) > 900) {       // drifted (respawn / long chase)? re-sync
    let bi = 0, bd = Infinity;
    for (let i = 0; i < this.path.length; i++) {
      const d = this.distTo(this.path[i]);
      if (d < bd) { bd = d; bi = i; }
    }
    this.wpIdx = Math.min(bi + 1, this.path.length - 1);
    wp = this.path[this.wpIdx];
  }
  while (wp && this.distTo(wp) < 80 && this.wpIdx < this.path.length - 1) {
    this.wpIdx++; wp = this.path[this.wpIdx];
  }
  if (wp) this.moveToward(wp.x, wp.y, dt);
}
```

---

## The whole bot in three questions

Asked ~4 times per second:

1. **Am I about to die?** (HP < 36%) → run home, heal, return at 85%.
2. **Is there something to fight within 560?** → prefer heroes, prefer wounded
   ones, never dive a tower without minion cover. Chase until 720, then drop it.
3. **Nothing to do?** → walk my lane toward the enemy base.

Emergent-looking teamwork (five bots collapsing on one wounded hero) is not
coordination — it's five independent bots running the same `lowHpBias` scoring
and reaching the same conclusion.

## Constants reference

> Live values live in `js/bot-params.js` and have drifted from the original
> seed below (verified 2026-09-04): think 0.12–0.20s (0.06–0.10 hot),
> retreat 28%, re-engage 72%, recall-safe 920, notice 700, chase 980,
> hero bias 240, low-HP bias 210, structure penalty 70, dive HP 88%,
> cast chance 97%/tick. The table keeps the original v1 numbers for history.

| Constant | Value | Role |
|---|---|---|
| think interval | 0.22–0.34 s | decision frequency |
| retreat HP | 36% | enter retreat |
| re-engage HP | 85% | leave retreat |
| recall-safe distance | 900 | recall if no enemy hero within |
| notice radius | 560 | target acquisition |
| chase leash | 720 | give up an acquired target |
| hero bias | 180 | prefer heroes over minions |
| low-HP bias | 150 | prefer wounded heroes |
| structure penalty | 100 | deprioritize towers |
| dive HP gate | 95% | HP needed to fight under a tower |
| minion-cover radius | 320 | what counts as tower cover |
| cast chance | 55%/tick | skill eagerness |
| waypoint reached | 80 | advance to next lane point |
| path re-sync | 900 | distance that triggers waypoint re-lookup |

## What was added later (NOT in the original)

- **Genome indirection** — constants read from `this.p` instead of literals.
- **Ult discipline** — a general gate on skill 3 (execute threshold or 2+
  enemies nearby); the original only gated `blinkstrike` inline.
- **In-match caution** — `adapt.caution` shifts retreat/dive thresholds after
  deaths and kills.
- **Four dormant heuristics** — kiting, jungling, late-game grouping,
  outnumbered-flight. All ship OFF and only activate if training enables them.
- **`attackOnMove`** (`opportunityAttack()`) — swing at anything already in
  range while moving. Tested 9/10 wins vs. the original; currently experiment-only.
