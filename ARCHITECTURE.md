# Architecture

A reference for what this codebase **is**, written before the next round of
changes is built on top of it. Every claim carries a `file:line`.

**Stack** — Next 16 App Router + React 19 · TypeScript 7 with
`--experimental-strip-types` (no build step for scripts or tests) · Drizzle +
Postgres/pgvector · LM Studio as the model provider.

## How to change this file

Every claim carries a `file:line`. A claim you cannot cite does not belong here
yet — it belongs in `HANDOFF.md` until it settles.

**§4, §11, §12 and §13 are four views of the same facts** — what is stored, what
must hold, what nothing reads, what can be dialled. A change to one is not done
until it has been checked against the other three. Grep this file for the field,
function or constant you are changing and read every hit; a single decision
routinely lands in three sections at once. A stale view is worse than a missing
one: §12 exists to catch fields that nothing reads, and it hides them the moment
it goes out of date.

**What lives elsewhere.** `DESIGN.md` holds intent that is not built yet — it
has no `file:line` to cite, so it does not belong here until it ships. When it
does, mark it shipped there and document it here in the same pass.
`statmean.md` and `5D_Human_Psychology_Model.md` are reference and working
notes, not claims the code must match, and are out of scope for reconciliation.

**Amend a superseded claim in place, carrying the evidence that reversed it.**
Never delete one. §14 is where a deferred question becomes a settled one, and
that history — the reasoning, not just the verdict — is the most valuable thing
in this document.

---

## Contents

1. [The one-paragraph version](#1-the-one-paragraph-version)
2. [Layers and the dependency shape](#2-layers-and-the-dependency-shape)
3. [The systems](#3-the-systems)
4. [Stored data](#4-stored-data)
5. [Derived data](#5-derived-data)
6. [Generated, authored, seeded](#6-generated-authored-seeded)
7. [The LLM contract](#7-the-llm-contract)
8. [Workflow A — creating a playthrough](#8-workflow-a--creating-a-playthrough)
9. [Workflow B — one play turn](#9-workflow-b--one-play-turn)
10. [The other flows](#10-the-other-flows)
11. [Invariants](#11-invariants)
12. [The dead-field ledger](#12-the-dead-field-ledger)
13. [Tuning knobs](#13-tuning-knobs)
14. [Known deviations](#14-known-deviations)
15. [Glossary](#15-glossary)

---

## 1. The one-paragraph version

A single-player tower-climbing RPG where **everything is generated per world**
— the tower, the town, the people, the classes, the traits, the Signets, the
skills — and **nothing mechanical is decided by a model**. The event log is the
source of truth; `PlayState` is a fold over it; snapshots are a disposable
cache. Two model calls per narrative turn: a **Director** that proposes what
your text means, and a **Writer** that narrates what the engine already
decided, separated by a redaction wall. Combat, progression, loot and NPC
change are pure code.

The governing rule, repeated in a dozen file headers:
**the code supplies structure, the model supplies flavour** — and *every field
the model does not have to produce is a field it cannot get wrong*
([schema.ts:13](src/session/schema.ts:13),
[classnames.ts:11](src/character/classnames.ts:11),
[floorgen.ts:14](src/world/floorgen.ts:14),
[director.ts:12](src/llm/director.ts:12)).

---

## 2. Layers and the dependency shape

Innermost first. Arrows are the only legal direction.

```
config ─┐
        ├─> engine (roll) ──┐
                            ├─> combat ─┐
                            ├─> items ──┤
                            ├─> skills ─┼─> character ─┐
                            └───────────┘              ├─> session ─┐
                                                       ├─> world ───┼─> play ─┐
                                        llm/provider ──┴────────────┘         │
                                        llm/redact  <─────────────────────────┤
                                        llm/writer  <── (only WriterView)     │
                                                                    db <──────┤
                                                                              │
                                                            server/game.ts <──┘
                                                                    ▲
                                                                  app/
```

**The rules, as the code states them:**

- **The engine layer is pure and model-free.** *"The model NEVER decides a
  combat outcome. It narrates a structured round log the engine produced."*
  ([combat/types.ts:5](src/combat/types.ts:5)). Every combat action returns
  `{state, error}` so an illegal proposal is rejected rather than corrupting the
  encounter ([combat.ts:6](src/combat/combat.ts:6)).
- **The world layer refuses to reach upward.** `travel.ts` returns a
  `needsRegion` *request* instead of calling a generator, which keeps it pure
  and testable offline ([travel.ts:8](src/world/travel.ts:8)).
  [climb.ts](src/play/climb.ts) is the only place in play that knows floors can
  be created on demand.
- **The play layer owns the trust boundary.** *"The Director PROPOSES changes;
  this module decides which are legal and applies only those."*
  ([delta.ts:20](src/play/delta.ts:20)). Refusing one field never discards the
  rest of the turn.
- **`redact.ts` is a wall, not a convention.** `WriterView` has no `World`, no
  undiscovered places, no unestablished facts — and because `writer.ts` accepts
  only a `WriterView`, handing it world state is a **compile error**
  ([redact.ts:11](src/llm/redact.ts:11)). `assertNoLeak`
  ([redact.ts:195](src/llm/redact.ts:195)) is the runtime backstop, *"because a
  type only protects the code paths the compiler can see."*
- **React never mutates locally.** Every panel action goes to the server as an
  event ([Panels.tsx:5](app/play/[id]/Panels.tsx:5)); the whole view comes back.
- **Routes stay thin** so the web surface and the terminal script cannot drift
  apart ([game.ts:40](src/server/game.ts:40)).

---

## 3. The systems

### `src/engine/` — the resolver primitive
`roll.ts` — 2d6 + modifier, three tiers; owns `Rng` and `mulberry32`
([:25](src/engine/roll.ts:25)). 2d6 rather than d20 because the middle band is
the **modal** outcome: failing forward is the default.

### `src/combat/` — the pure tactical engine
`types.ts` (nine abilities, `Combatant`, `CombatState`) · `dice.ts` (crits
double dice, not the modifier) · `resolve.ts` (attack, damage, death saves) ·
`conditions.ts` · `tempo.ts` (the tick budget that replaced one-action-per-turn,
so AGI can mean something) · `cast.ts` (wind-up casts; whether a skill
telegraphs is a *build* decision, not a property of the skill) · `grid.ts`
(Chebyshev distance, supercover LOS) · `combat.ts` (the state machine) ·
`ai.ts` · `statblock.ts` (foe numbers from depth, so the curve can be
*simulated*) · `encounter.ts` (every 10th floor is a boss).

### `src/skills/` — composed, never authored
`statgrammar.ts` — `STAT_GRAMMAR` ([:40](src/skills/statgrammar.ts:40)), the
coherence guard that replaced disciplines. A bow that heals *"reads as a bug"*.
`compose.ts` — prices parts against a budget; the budget **is** the balance.
`pools.ts` — which pool a skill draws follows its **stat**, not its payload
(`MENTAL = con,int,wis,cha,luk`, [:34](src/skills/pools.ts:34)).
`book.ts` — where skills drop from. `active.ts` — the closed-union effect and
its pure resolver.

### `src/character/` — who someone is
`persona.ts` (the core shared by player and villager) · `drift.ts` (two clocks,
with hysteresis) · `roles.ts` (authored mechanical shapes) · `classgen.ts`
(mechanics from seed) · `classnames.ts` (words from the model) · `classbuild.ts`
(the seam) · `classes.ts`.

### `src/session/` — Session Zero
`interview.ts` (fixed stages, **canned questions, no model call**) ·
`schema.ts` (JSON Schemas used as decoding grammars) · `genesis.ts` (two model
calls plus repair and validation) · `repair.ts` (deterministic fixes, each one
recorded) · `sheet.ts` (the sheet, and `toCombatant` — the bridge into combat).

### `src/play/` — the loop and progression
`state.ts` · `turn.ts` · `delta.ts` (validation + the fold) · `combat.ts` ·
`climb.ts` · `rest.ts` (the supply economy where the difficulty curve actually
lives) · `progress.ts` · `pathgen.ts` / `pathwords.ts` / `skilltree.ts` /
`allocate.ts` (the passive web; contiguity is the mechanic) · `traits.ts` /
`traitgen.ts` / `traitbook.ts` / `emergent.ts` · `signet.ts` / `signetgen.ts` /
`signetbook.ts` (with a reachability proof) · `graft.ts` (the one branch-growing
mechanism traits, Signets, subclasses and books all share) · `sheetaction.ts`.

### `src/world/`
`types.ts` · `floorgen.ts` (the only world-changing model call) · `travel.ts` ·
`lod.ts` (**places compress, people do not**) · `validate.ts` · `budget.ts` ·
`agenda.ts` · `naming.ts` (keeps `warehouse_south` out of prose by arithmetic,
not persuasion) · `layout.ts` (deterministic map positions).

### `src/llm/`
`provider.ts` (the boundary; implementations never import each other) ·
`director.ts` · `writer.ts` · `redact.ts` · `register.ts` (**trust IS the
language**) · `local.ts` / `localProvider.ts` · `similarity.ts` / `canon.ts`.

### `src/db/`, `src/server/`, `app/`
`db/schema.ts` (four tables) · `db/sessions.ts` (append, fold, snapshot) ·
`db/facts.ts` (pgvector canon) · `server/game.ts` (every view, plus the
in-memory fight store) · seven thin route handlers under `app/api/`.

---

### `src/world/subjects.ts` + `src/play/lore.ts` — what a world is about
A world mints 10–14 `Subject`s from its seed ([subjects.ts:74](src/world/subjects.ts:74)),
in kinds like a war, a house, a craft. Within one world the set is **CLOSED**,
and that is the whole trick: a piece of lore names the subjects it is `about`
([lore.ts:26](src/play/lore.ts:26)), a persona's `drive` names a want and a fear
in the same vocabulary, so **the match is a set intersection**
([lore.ts:65](src/play/lore.ts:65)). The engine never judges whether a history
would move somebody — it checks whether they were talking about the same thing.

A want is worth twice a fear (`WANT_WEIGHT` 2, `FEAR_WEIGHT` 1,
[lore.ts:53](src/play/lore.ts:53)); at `MOVING_DEPTH` 3 a match is deep enough to
push on who somebody is rather than just land. Knowing a piece of lore **is**
holding a belief — `loreClaim` builds an ordinary `Claim`
([lore.ts:99](src/play/lore.ts:99)) — so `belief.ts` carries it, `learn` and
`tell` move it between people, and nothing needed a second knowledge system.
Reading is a turn action and works once ([sheetaction.ts:241](src/play/sheetaction.ts:241)):
a paragraph cannot be re-read for the same comfort.

## 4. Stored data

Four tables ([db/schema.ts](src/db/schema.ts)). `EMBEDDING_DIMENSION = 1024`.

| table | key | holds |
|---|---|---|
| `sessions` | `id` uuid | `seed`, `language`, `premise`, `sheet` jsonb (the **opening** sheet — never `UPDATE`d), timestamps |
| `events` | `(session_id, seq)` | `kind` ∈ `start\|turn\|sheet\|climb`, `payload` jsonb. `seq` is dense and gap-free — it **is** the replay order, allocated inside the INSERT so the PK rejects interleaving ([sessions.ts:62](src/db/sessions.ts:62)) |
| `snapshots` | `(session_id, at_seq)` | `world`, `pc`, `sheet?`, `ended?` jsonb. No `combat` column, deliberately |
| `facts` | `(session_id, fact_id)` | `text`, `region`, `established_turn`, `embedding vector(1024)` with an HNSW cosine index |

### The shapes

**`World`** ([world/types.ts:134](src/world/types.ts:134)) — `seed`, `language`,
`regions: Record<RegionId, RegionRecord>`, `people` (flat, never compressed),
`facts`, `currentRegion`, `currentPlace`, `deepestFloor`, `turn`, `flags`.
`regionIdFor(floor) = 'floor-' + floor` ([:148](src/world/types.ts:148)) — one
floor is one region is one integer.

**`Region`** (full detail) — places, entrance, exit, danger, creatures.
**`Gazetteer`** (compressed) — geometry is *destroyed*; name, biome, summary and
known people survive ([lod.ts:37](src/world/lod.ts:37)).

**`Persona`** ([character/persona.ts:269](src/character/persona.ts:269)) — the
core every villager and the player share:

```ts
{ voice, status,
  temperament: Temperament,   // STORED — intuition·feeling·nerve·discipline, −10..+10
  needs: Needs,               // STORED — rest·food·safety·company·purpose, 0..10 = met
  counters: Counters,
  pressure: Temperament }     // hysteresis accumulator
```

**`CharacterSheet = Persona & {...}`** ([session/sheet.ts:60](src/session/sheet.ts:60))
— name, language, background, `baseAbilities`, `traits` (ids, in earn order),
level, hitDie, plus optionals: `spentAbilities`, `abilityPoints`, `xp`,
`allocated`, `skillPoints`, `treeBonuses`†, `traitBonuses`†, `signets`,
`learned`, `classId`, `classSpec`, `subclassId`, `library`.

† **denormalised caches**, written only alongside the list they summarise so
they cannot drift ([sheet.ts:83](src/session/sheet.ts:83)).

**`PlayState`** ([play/state.ts:25](src/play/state.ts:25)) — `world`, `sheet`,
`pc {hp, maxHp, conditions, coin, inventory, stamina, mana}`,
`combat` (never persisted), `ended`.

**`PlayEvent`** = `{kind:'start'} | TurnRecord | SheetRecord | ClimbRecord`.
A `TurnRecord` stores the *recorded* roll and the *validated* delta, and a whole
fight is **one event** carrying only the decisions.

---

## 5. Derived data

Nothing below is stored. This table is the answer to "where does this number
come from?"

| function | reads | produces |
|---|---|---|
| `dispositionOf` ([persona.ts:182](src/character/persona.ts:182)) | temperament + needs | `warmth·candour·nerve·discipline·intuition·feeling` on ±3. Circumstance colours wiring: warmth needs company, nerve is worn by being unsafe, discipline frays unrested |
| `describeMental` ([persona.ts:260](src/character/persona.ts:260)) | needs | rattled / exhausted / starving / lonely / adrift, and the upside `in good heart` |
| `registerTrust` ([persona.ts:257](src/character/persona.ts:257)) | trust + persona | the trust value a relationship is actually *read* at |
| `finalAbilities` ([sheet.ts:224](src/session/sheet.ts:224)) | base + background + spent + tree + traits + equipment | `Abilities`. **Everything that moves a score must land here** or trait gates read a number the player never sees |
| `maxHpFor` ([sheet.ts:248](src/session/sheet.ts:248)) | VIT, level, tree | `10 + vitMod + (level−1)(6+vitMod)`. **CON and the hit die are deliberately excluded** |
| `armourClassFor` | armour, **AGI**, tree | AC is evasion, so it reads AGI. DEX is accuracy and never touches it |
| `soakOf` ([resolve.ts](src/combat/resolve.ts)) | VIT, the incoming blow | VIT's physical defence. Capped by the stat AND a third of the hit — flat reduction was measured and rejected |
| `resistedRounds` ([conditions.ts](src/combat/conditions.ts)) | VIT or CON, duration | shortens a condition rather than rolling a save. Never reaches immunity |
| `speedFor` / `overloadFor` / `carryCapacityFor` | AGI, STR, carried weight | movement, and what hauling a hoard costs |
| `loreFor` ([lorebook.ts:74](src/play/lorebook.ts:74)) | item id + world seed | the history a thing carries, or nothing — `LORE_CHANCE` 0.35. Depth comes off *floor* depth, so a deep find is worth reading and not merely worth more |
| `resonanceOf` ([lore.ts:65](src/play/lore.ts:65)) | lore `about` ∩ drive want/fear | `Resonance` — whether it touched them at all, and what it moved |
| `maxStaminaFor` / `maxManaFor` ([sheet.ts:308](src/session/sheet.ts:308)) | VIT/CON, level, unmet rest/safety, tree | pool ceilings — the body is docked by going unrested, the mind by feeling unsafe |
| `toCombatant` ([sheet.ts:374](src/session/sheet.ts:374)) | derive + equipped attack | a `Combatant` at full HP and full pools |
| `conditionMet` / `progressOf` ([traits.ts:198](src/play/traits.ts:198)) | `TraitContext` | whether a trait condition holds, and its progress bar |
| `poolFor` / `costOf` ([pools.ts:34](src/skills/pools.ts:34)) | skill stat + effect | which pool, and how much |
| `gateFor` / `isOpen` ([pathgen.ts:135](src/play/pathgen.ts:135)) | path + scores + class lean | which paths a spread opens — **monotonic in the score by design** |
| `viewOf` and friends ([game.ts:203](src/server/game.ts:203)) | `PlayState` | the whole `GameView`, rebuilt per request |

---

## 6. Generated, authored, seeded

Three kinds of content, and confusing them is how orphaned ids happen.

**Seeded catalogues** — regenerated deterministically, never stored. Each XORs
the world seed with its own constant so systems do not correlate:

```
paths     seed ^ 0x9a7b5     classes   seed ^ 0xc1a55
traits    seed ^ 0x7a17      signets   seed ^ 0x51672
emergent  seed ^ 0x3e3a      tree      seed ^ hash(background) ^ hash(class)
```

**Identity-keyed content** — keyed on the *thing's own id* rather than the world
seed, so the same thing is always the same thing: node grants
`mulberry32(hash(nodeId))` ([skilltree.ts:209](src/play/skilltree.ts:209)),
subclass grants `hash(sub.id)`, book volumes, composed skill names. A node taken
at level 4 still teaches the same thing at level 12.
A lorebook keys the same way ([lorebook.ts:74](src/play/lorebook.ts:74)): a sword
found on floor nine carries the same history on a replay, and none of it travels
in the save.

**Seeded shape, stored words** — `subjects` are drawn from the seed, but the
names the model gives them are stored on the `World`
([types.ts:151](src/world/types.ts:151), [subjects.ts:111](src/world/subjects.ts:111)),
because a word derived from nothing would be lost on the next derivation. The
same split as `classSpec` on the sheet. **The ids never change**, so anything that
matched before naming still matches after it.

**Authored** — the pieces that must not vary: `ROLES`, `SHAPES` (the nine
emergent play-patterns), `PATH_WORDS`, the condition price table.

> **The catalogue-agreement invariant**
> ([traitbook.ts:158](src/play/traitbook.ts:158)) — the fold, the tree and the
> panel must all derive the *same* catalogue from `(seed, origin)`, or an earned
> id orphans. This is why `classSpec` is carried **on the sheet** rather than
> looked up, and why `GraftSpec.stat` is a stat (a fixed enum of nine) rather
> than a generated path id.

---

## 7. The LLM contract

Eight calls, all behind `Provider` ([llm/provider.ts:34](src/llm/provider.ts:34)).

| call | schema | may decide | reaches the log? |
|---|---|---|---|
| **Director** ([director.ts:255](src/llm/director.ts:255)) | `DIRECTOR_SCHEMA`, t=0.7 | what your text *means*: a check, who you addressed, a proposed delta — with **all three tier branches pre-committed before any dice exist** | indirectly — only the validated delta and the refusal reasons |
| **Writer** ([writer.ts:243](src/llm/writer.ts:243)) | text, t=0.85 | prose only, from a redacted view | yes — `TurnRecord.prose`, never regenerated |
| **Writer retry** ([writer.ts:260](src/llm/writer.ts:260)) | text, t=0.7 | one regeneration on register drift; a second failure is accepted | same field |
| **Floor** ([floorgen.ts:209](src/world/floorgen.ts:209)) | `floorSchema(floor)`, t=0.9 | a region's places, people, culture | **yes, in full** — inside `ClimbRecord.built` |
| **Character** ([genesis.ts:93](src/session/genesis.ts:93)) | `CHARACTER_SCHEMA`, t=0.8 | name, background, voice, proposed scores | once, into `sessions.sheet` |
| **Ground floor** ([genesis.ts:237](src/session/genesis.ts:237)) | `GROUND_FLOOR_SCHEMA`, t=0.9 | floor 0 and its people | once, into the origin event |
| **Class naming** ([classnames.ts:96](src/character/classnames.ts:96)) | `CLASS_NAMING_SCHEMA`, t=0.9 | **words only** — no mechanics are in the schema | only via the chosen class |
| **Subject naming** ([subjectnames.ts:50](src/world/subjectnames.ts:50)) | `SUBJECT_NAMING_SCHEMA`, t=0.9 | **words only** — the ids are given to it and it invents none | stored on `World.subjects` |

**Zero model calls** for: combat, panel actions, suggested actions, interview
questions, loot, or any trait/Signet/tree generation.

Class naming is wrapped in `try/catch` and returns `[]` on failure
([classnames.ts:128](src/character/classnames.ts:128)) — a creation page that
will not render because the model was down is a worse failure than a duller
word.

---

## 8. Workflow A — creating a playthrough

```
app/new/page.tsx
  seed drawn CLIENT-SIDE at mount (:43) ─── the one point real entropy enters
  three questions: world · character · drive
  │
  ├─ optional: POST /api/classes {seed, world, language}
  │     classShapesFor(seed)          pure code, no model — roles DEALT from a
  │                                   shuffled deck, 2 cross + 2 deepen subclasses
  │     nameClasses(...)              the only model call; words only; may fail
  │     buildClass(...)               shape + naming → CharacterClass
  │
  └─ POST /api/sessions {language, answers, draft, seed}
        draft carries classSpec — the WHOLE class object, because a generated
        class exists in no global list and an id would resolve to nothing
        │
        newGame  (server/game.ts:352)
          startInterview + recordAnswer per stage (blanks get canned defaults)
          runGenesis:
            1. generateCharacter  ──► sheet
            2. generateGroundFloor ──► region, people, premise, startPlace
                 (given the sheet, so the town is built around its resident)
          World assembled IN CODE: floor-0, turn 0, deepestFloor 0
          createSession → INSERT sessions + events(seq 0, kind 'start')
          saveSnapshot at seq 0
        │
        → /play/{id}
```

What code fills in regardless of the model: abilities always pass through
`repairAbilities` (clamp 8–15, shave to the 40-point budget); a chosen class
supplies the starting attack; `hitDie` comes from the class; `level = 1`;
`skillPoints ?? 1` so the tree is live on the first screen; and the starting
inventory turns the declared attack into a **real wielded weapon** plus three
rations, because a short rest spends one.

**No opening prose is generated.** The first passage is your first turn.

---

## 9. Workflow B — one play turn

```
 1  canonFacts   ← pgvector nearest-neighbour over this session's facts
 2  DIRECTOR ────────────────────────────────────── model call #1
       sees: place, affordances, "the ONLY legal moveTo values",
             people + their disposition/condition, canon, your pack
       returns: classification, addressed person, a check with all three
             tier branches pre-committed, and a proposed delta
 3  if check.required:
       modifier = abilityMod(finalAbilities[ability]) + edgeFor(skills)
       ENGINE rolls 2d6           ≤6 miss · 7–9 partial · ≥10 hit
       the pre-committed branch is selected and merged
 4  validateDelta ─────────────── the trust boundary
       refuses: a move to an unconnected place · trust for someone who does
       not exist · revealing an exit that is already known · combat where
       danger is 0 · using what you do not carry · resting when you may not
       (clamps: trust ±3, time 0..3)
 5  applyTurn ───────────────────── the fold
       applyDelta → combat (live or replayed) → drift causes derived FROM
       THE RECORD → traits awarded LAST
 6  toWriterView + assertNoLeak ─── the wall
 7  WRITER ─────────────────────────────────────── model call #2 (+1 retry)
       sees only the redacted view and what already happened
 8  appendTurn(record); snapshot every 20 events
```

The order **is** the design: the Director proposes and commits to every branch,
the engine rolls, the engine validates, and only then does the Writer see
anything.

### Combat, inside that

A fight opens mid-turn and the record is **not written** until it ends. The
encounter lives in an in-memory `fights` map on `globalThis`
([game.ts:328](src/server/game.ts:328) — Next gives routes and server components
separate module instances, so a plain module-level `Map` would produce two).

Every roll derives from state —
`combatRng = mulberry32(seed + turn·7919 + log.length)` — so storing the
**decisions** reproduces the identical fight. Options are a legal-move list; an
unaffordable skill is *not offered* rather than offered and refused. When it
concludes, the original turn's draft record plus `combatActions` is appended as
**one event**, and a snapshot is taken unconditionally.

---

## 10. The other flows

**Rest** — `canRest` refuses mid-fight; a **short** rest needs a ration; a
**long** rest requires a settlement **on floor 0**, because *"a real night of
sleep means going back down to town"* — otherwise a camp on floor 15 would undo
the whole climb. This is where the difficulty curve lives.

**Climb** — a crossing is a **logged event**. `ClimbRecord.built` carries the
generated region and its people, because `foldPlay` is synchronous and holds no
`Provider`. `applyClimb` is pure and drives **both** the live path and replay,
so the two cannot drift apart ([climb.ts:21](src/play/climb.ts:21)).

**Panel actions** — equipping a helmet is bookkeeping, not a story beat, so
there is no model call. Every action is a `{kind:'sheet'}` event, and each one
ends in `settle`, which re-derives HP and re-checks traits — because a score can
move from a panel without a turn ever being taken.

---

## 11. Invariants

**1. The log is truth; state is a fold; snapshots are a cache.**
*Deleting every snapshot must change nothing except how long loading takes*
([sessions.ts:18](src/db/sessions.ts:18)), and a test says so. This has been
broken twice: once by omitting `sheet`/`ended` from snapshots (fixed by
migration 0001), once by climbing (fixed by making the climb an event).

**2. Dice are recorded, never re-rolled.** Where a roll can be derived from
state instead, it is — which is why a whole fight stores only decisions.

**3. The model never decides an outcome.** It proposes; the engine validates and
resolves.

**4. Closed unions, never free text.** `ActiveEffect`, `ItemEffect`,
`WorldDelta`, `TraitCondition`, `Gate` are all closed. A model names things; it
never invents a mechanic.

**5. The redaction wall is a type, with a runtime backstop.**

**6. Adding an event kind means adding it to `FOLDED_KINDS`**
([sessions.ts:73](src/db/sessions.ts:73)) — or it is written and silently
dropped on reload. This has already happened once, to panel actions.

**7. Every stored field must have a writer *and* a reader.** See below.

---

## 12. The dead-field ledger

**This codebase's signature bug**: a field that is generated, stored, sometimes
displayed — and moved or read by nothing. It looks like a mechanic, survives
review, and quietly does nothing for months.
[`writers.test.ts`](src/character/writers.test.ts) proves the *writer* half for
needs and temperament; **nothing yet proves the reader half.**

### Serious — these break a system

| field | state |
|---|---|
| **`CharacterSheet.signets`** | **Never written by any code path.** No `SheetAction` claims one. Signets are generated, proved reachable, and filtered for visibility — and **can never be acquired.** The whole branch is inert in play. |
| **`pc.stamina` / `pc.mana`** | Stored and topped up by rest, but `playerCombatant` does not carry them **in** and `concludeCombat` does not carry them **out** — so **pools reset to full at the start of every fight.** The scarcity the pool economy exists to create is not happening. |
| **`Signet.grant`** | Generated everywhere, read nowhere. Its only consumer, `abilityOf` ([signet.ts:279](src/play/signet.ts:279)), has zero callers. |
| **`Trait.grants.note`** | Set by every authored, generated and emergent trait; read by nothing. A note is the **only** payout an emergent trait has, so every emergent trait grants literally nothing. |
| **`treeBonuses.attack` / `.damage`** | Accumulated by `applyGrant`, read by no formula. A node granting "+1 to hit" changes nothing. |
| **`ItemEffect.buff`** | `applyEffect` returns state unchanged and narrates *"…feels sharper"*. Drinking it consumes the potion and does nothing. |

### Confirmed dead

`Signet.augments` (display-only; nothing resolves the reference) ·
`Signet.hint` · `Gazetteer.openThreads` (read by the rehydration prompt, written
by nothing — always `[]`) · `Gazetteer.compressedAtTurn` ·
`Person.agenda` / `agendaPace` (and [agenda.ts](src/world/agenda.ts) itself,
which nothing imports) · `Person.sheet` / `recruited` / `stance` ·
`Person.tags` / `homeRegion` · `Fact.people` (no column — dropped on write) ·
`facts.region` (written, never SELECTed) · `Item.value` (there are no shops) ·
`ItemEffect.restore.supply` (the number is ignored) ·
`CharacterSheet.hitDie` (read by no formula since HP moved to VIT).

**Cleared by the component conversion** — `usesPerRest`, `skillUses`,
`usesLeft`, `spendUse`, `refreshUses`, `SkillUses`, `ActiveKind` and
`Skill.kind` are all DELETED rather than given readers, because none of them
had a job left once pools and the tick budget became the resource economy. The
sidebar shows what a skill will cost you instead of a permanent `n/n`.

**An inventory holds two different things.** Stacking works exactly as long as
two of a thing are interchangeable, and stops working the moment anything can
differ between them — durability broke it first, and refine levels, rarity, a
component tree and a history each break it the same way. So fungibles stack by
type and anything that can differ is an INSTANCE, discriminated by `stackable`,
which already meant that. `equipped` names a specific object rather than a kind
of one, so wielding the sharp axe instead of the notched one is a thing a player
can do. This is what finally reaches `items/instance.ts` and `items/shape.ts`,
which were tested islands reachable from nothing.

**A mending never quite gets it back.** Repair targets the piece that failed —
`weakestPart` said since it was written that this was its job and nothing ever
called it — and every mending lowers what that piece can be mended TO. Without
that, repair is "pay coin, it is new again" for ever and no blade is ever
replaced; with it gear has a lifespan and finding a better one eventually
matters. `gear.repairLoss` at nought is a world whose smiths can always make a
thing as good as new. Loose pieces drop, so a failed handle can be REPLACED
rather than only mended — otherwise `attachPart` is reachable only by taking
something off and putting the same thing back on, which is no decision at all.

**Refine, work, enhance — and the reset is the design.** `ItemInstance.refine`,
`.enchants` and `.rarity` were stored from the day instances existed and read by
nobody. Refining adds a level whose worth is fixed by the OBJECT (so two swords
of one kind refine differently); a milestone every four levels buys one working
from a closed list; and enhancing raises rarity, grants something lasting, and
THROWS AWAY BOTH. That reset is what makes when to enhance a decision rather
than one more upgrade taken as soon as it is affordable. Failure is two numbers
rather than a mode — risk and levels-lost — so Genshin (never fails), a stall,
a slip and RO's destruction are one code path with no switch on a rule. It also
gives COIN its first spender: it had been earned from every fight and spent on
nothing at all.

**A thing is made of pieces.** `instance.ts` has known how to walk an assembly,
weigh it, wear its weakest piece and join its silhouette since the day it was
written, and nothing ever built one — so every object was a single lump. Weapons
now come with their pieces on them: the PART TYPES are authored in one small
table (a haft is a haft in a kingdom and in a wreck, unlike a weapon's name),
and an archetype's recipe says how they go together. The pieces wear, not the
frame, so a blade can outlive a grip and repairing the part that failed is a
decision rather than topping up a bar. A `fused` piece is still a piece — it
carries weight and wear and cannot come off — which is the boundary that bounds
recursion without a depth cap.

**A container may have a board, a weight limit, both, or neither — one code
path.** That is the ruleset principle applied to bags: capacity alone is the
weight model (Fallout, Cyberpunk), a grid alone is the slot model (PoE, RE,
Tarkov), both are checked against both, and no branch anywhere asks which kind
of game this is. A board is not a rectangle — a frame with a notch is a mask
with a hole, and `firstFit` searches the cells it actually has. This is what
finally reaches `items/shape.ts`, which had been green, tested and called by
nothing since it was written.

**Capacity is something you own.** It used to be `carryBase + STR` and nothing
else, so a pack was not a thing you could find, fill or lose. A container is an
item with a `capacity`, a `Holding` may have `contents` — an `Inventory` again,
so a bag inside a bag needs no second shape and no depth limit — and a worn
container raises what you can carry. Containers buy SPACE, never weightlessness:
weight counts all the way down, or carrying would become a decision about bags
rather than about what you are carrying.

**The world declares where you can wear things.** `Slot` is a plain string
checked against `gear.slots`, not a union of three. A fixed enum could not say
that a world has no boots in it, that this one lets you wear two rings, or that
a greatspear takes both hands. Two-handers are `occupies: ['offhand']` — general
rather than a special case, and a suit of plate covering the legs uses the same
field. Only `equip` reads the slot set; everything that asks what is WORN reads
the equipped map, which already says, so a world's slots never have to be
threaded through the dozen places that merely look.

**Rumour has two layers, and they meet.** `deed.ts` is the DRAMATIC one —
people telling each other along the social graph, bounded by degrees of
separation, where who told whom matters. `ambient.ts` is the cheap one: a PLACE
knows a thing to a degree, with nobody modelled to hold it, and anyone standing
there who does not know it themselves inherits from it. That is what lets a
market know something without a market's worth of people being simulated, and
it is exactly the shape region LOD already has — ambient knowledge is the
gazetteer of rumour. News creeps along the map's own connections, so geography
decides what has got around; a place with nobody in it carries nothing onward,
which makes a cut road felt rather than announced; and the air CLEARS, because
gossip is not memory — what somebody saw stays with them for good while talk
thins until it is not worth repeating.

**Beliefs have a reader.** `Person.beliefs` was written by deeds and consulted
by nobody for two commits — a fresh instance of the signature bug, introduced by
the deed work itself. The Director and the Writer are now both told what each
person present THINKS the player has done and how sure they are, phrased as
belief and never as fact: `Warden Bex believes: Anan insulted Ora the smith —
saw it themselves`. `certaintyOf` turns `confidence` into words, so seeing a
thing and half-hearing about it are finally distinguishable downstream, which is
most of what a rumour system is for.

**Cleared by the relationship work** — `Person.trust` is deleted and replaced by
a directional edge. `registerConsequence` was a whole dead MECHANISM, not merely
a dead field: zero callers outside its own file, computing a `suspicion` nobody
read, while its docstring claimed "the language is the gameplay, so it has to
move the numbers". It writes four edge axes now. `Gazetteer.reputation` has its
first writer in the life of the codebase — deeds move `World.reputation`, and
compression copies it into the gazetteer, where the rehydration brief reads it
back so a floor that hates you is WRITTEN as one.

### The mirror image

**`NpcVoice.tics`** is *read* ([register.ts:63](src/llm/register.ts:63)) and
written as `[]` by **every** generator. A reader with no writer.

### A knock-on

`CLASSES = []` ([classes.ts:177](src/character/classes.ts:177)) makes
`subclassById` permanently `undefined`, so
[traitbook.ts:204](src/play/traitbook.ts:204) never leans the trait catalogue
toward the chosen subclass — even though `subclassOf`, which reads `classSpec`,
would have worked.

---

## 13. Tuning knobs

**Some of these now live in the `Ruleset`** ([src/rules/ruleset.ts](src/rules/ruleset.ts)),
which is the master config a world plays by. It sits on the `World` (jsonb, so
it replays for free) and every consumer takes it as an OPTIONAL parameter
defaulting to `STANDARD` — today's exact values — so converting a constant into
a lookup is provably a refactor.

The principle is **identity values, one code path**: never branch on a rule, run
the deepest implementation always, and let "simple" be that same code with its
dials neutral. `PLAIN` proves it — nobody soaks, nothing is heavy, nobody
changes, every floor is the first, and not one `if` was added.

Converted so far: `body` (carry, speed) · `combat` (soak, condition floor,
tempo) · `persona` (drift, and the suitability swing) · `rest` · `world` (the
danger curve, which was hardcoded to `danger === floor`). Everything below not
marked is still a constant awaiting conversion.

`ruleset.test.ts` holds a `PROVEN` list and asserts it still covers every field
on the type, so ADDING a dial without proving a reader fails there rather than
shipping quietly. It caught `persona.suitSwing` the moment it was added.

Every balance number, and where it lives.

| knob | value | file |
|---|---|---|
| point buy budget / min / max | 40 / 8 / 15 | [sheet.ts:169](src/session/sheet.ts:169) |
| HP at first / per level | 10 / 6 (+VIT mod each) | [sheet.ts:262](src/session/sheet.ts:262) |
| pool base / per level | 8 / 2 | [sheet.ts:295](src/session/sheet.ts:295) |
| skill cost floor / ceiling | 1 / 12 | [pools.ts:49](src/skills/pools.ts:49) |
| turn length in ticks / min action | 6 / 2 | [tempo.ts:20](src/combat/tempo.ts:20) |
| drift threshold / decay | 6 / 1 | [drift.ts:42](src/character/drift.ts:42) |
| **suitability swing** | ±25% on cost, magnitude and ticks | [suit.ts](src/skills/suit.ts), [ruleset.ts](src/rules/ruleset.ts) |
| skill budget per floor | `4 + floor × 0.8` | [book.ts](src/skills/book.ts) |
| effects drawn per skill | up to 3, until 75% of the budget is spent | [compose.ts](src/skills/compose.ts) |
| temperament range | −10..+10 | [persona.ts:82](src/character/persona.ts:82) |
| need range | 0..10 | [persona.ts:123](src/character/persona.ts:123) |
| trust range / max swing per turn | −3..+4 / ±3 | [types.ts:94](src/world/types.ts:94), [delta.ts](src/play/delta.ts) |
| time per turn | 0..3 | [delta.ts](src/play/delta.ts) |
| short / long rest turns | 1 / 8 | [rest.ts:22](src/play/rest.ts:22) |
| base speed / floor | 6 (+AGI mod) / 3 | [sheet.ts](src/session/sheet.ts) |
| carry base / per STR / overload step | 20 / 2 / 8 | [sheet.ts](src/session/sheet.ts) |
| damage soak ceiling / share of blow | 2 / one third | [resolve.ts](src/combat/resolve.ts) |
| condition resistance floor | 1 round | [conditions.ts](src/combat/conditions.ts) |
| default item weight (equipment/consumable/material/armour) | 3 / 1 / 1 / 8 | [items/types.ts](src/items/types.ts) |
| snapshot cadence | every 20 events | [sessions.ts:23](src/db/sessions.ts:23) |
| **danger** | `round(dangerBase + floor × dangerPerFloor)`; STANDARD `0 / 1` is identity | [budget.ts:32](src/world/budget.ts:32) |
| places per floor | `clamp(4 + floor/3, 4, 24)` | [budget.ts:14](src/world/budget.ts:14) |
| people per floor | `clamp(2 + floor/6, 2, 10) + 2` | [budget.ts:20](src/world/budget.ts:20) |
| XP to next level | `100 × level` | [progress.ts:20](src/play/progress.ts:20) |
| depth fall-off | `min(1, floor/level)²` | [progress.ts:35](src/play/progress.ts:35) |
| new-depth XP | `60 × floor`, no fall-off | [progress.ts:50](src/play/progress.ts:50) |
| tree rings | 8 | [skilltree.ts:142](src/play/skilltree.ts:142) |
| graft size | 2..5 | [graft.ts:44](src/play/graft.ts:44) |
| emergent branch cap | 3 | [emergent.ts:139](src/play/emergent.ts:139) |
| tower horizon | 30 | [signetbook.ts:54](src/play/signetbook.ts:54) |
| embedding dimension | 1024 (bge-m3) | [schema.ts:21](src/db/schema.ts:21) |

---

## 14. Known deviations

**~~Three of eight scripts are broken~~ — FIXED.** The root cause was one line:
`tsconfig.json`'s `include` covered `src/**` and `app/**` only, so
`npm run typecheck` never looked at `scripts/`. It does now, and all eight
build. `skillgen.ts` measures components; the two embedder scripts call
`rankFacts`, which is what `rankClues` was renamed to when the mystery engine
became the tower.

**`WorldDelta` is still ten hand-written verbs, and the question is now SETTLED
rather than deferred.** The design called for it to become a list of `Effect`s
sharing the skill vocabulary. Having built the second producer — deeds — the
answer is that it should not, for three reasons that are now evidence rather
than prediction.

*The shared vocabulary already exists, and it is not `Effect`.* Both producers
— the private exchange in `edgesAfter` and the deed chain in `afterDeeds` —
express consequence as `Partial<Record<EdgeAxis, number>>` applied through
`nudgeAll`. That is one closed vocabulary and one resolver, which is what the
unification was for.

*The `Effect` components are dead weight HERE and valuable elsewhere.* `shape`,
`duration` and `formula` pay off when a SKILL causes a social consequence — a
social `burst` is everybody who saw it, and a formula can scale off the caster's
nerve. They carry nothing for a Director's flat answer. So the `edge` channel
belongs to `Effect` on the day a skill can produce one, and not before; adding
it now is a channel `resolveSkill` cannot resolve, which is the bug
`verbs.test.ts` exists to catch.

*And the Director's social lever is a NAMED DEED, not a set of axes.* Trust is
the only axis a model should set directly — "does this person trust you more
after that exchange". But the engine is blind to a whole class of act: no rule
can tell handing a man a rope from handing him a rock. So `delta.deed` lets the
Director name one of `helped · insulted · humiliated · threatened` and the
deed's own mark decides what it costs, who felt it and how far it went — the
`useItem` division exactly. `drewOn`, `killed` and `spared` are NOT claimable:
they are outcomes the engine resolves, and a model able to name one could report
a killing that never happened.

Six of the ten verbs (`moveTo`, `revealExit`, `startCombat`, `useItem`,
`equipItem`, `rest`) are COMMANDS rather than consequences and were never
effect-shaped in the first place.

**Determinism holes** — the *record* is deterministic; its *production* is not.
The seed falls back to `Date.now()` when the client does not supply one; the
creation page is the single point where real entropy enters
([new/page.tsx:43](app/new/page.tsx:43)); fact retrieval depends on a live
embedder and silently degrades; an unresolved fight lives only in memory, so a
restart mid-fight discards the turn (a documented, accepted trade); and
`combatRng` keys on `log.length`, so an action that logs nothing (a move) leaves
the next draw identically seeded.

**Vestigial mystery engine** — `candidateReveals` still exists; two broken
scripts still carry Thai murder-mystery fixtures.
[validate.ts:7](src/world/validate.ts:7) names its own ancestry.

**Hand-maintained couplings, pinned only by test** — `DROPPABLE_FAMILIES` is
derived from the item catalogue by hand; `TOWER_DEPTH` duplicates
`TOWER_HORIZON` to avoid an import cycle.

**The physical layer — closed.** VIT now defends (`soakOf`), resists
(`resistedRounds`) and drives recovery; AGI now sets AC and speed; STR now has a
carrying capacity (`carryCapacityFor`) that overload spends as movement; CON
shortens poison. STR's "forcing things" needed no code — the Director calls a
check on any ability and `finalAbilities` covers STR. The old gap table is kept
in the plan file for history.

**The Director and Writer now know the PC.** Both were told less about the
player than about any villager in the room — a name, a background, some trait
strings and a hit-point total, while an NPC came with a disposition and a
condition. Both now receive bearing, condition and (the Director) what the
character climbs FOR and away from.

**Stale player-facing copy** — the creation page still tells the player that a
class decides *"which disciplines your skill tree can ever hold"* and that
*"what a class is locked out of stays locked out"*. Disciplines were purged;
classes now lean on stats and nothing is locked out.

---

## 15. Glossary

| term | meaning |
|---|---|
| **Director** | The model call that decides what your text *means* mechanically. Sees everything; writes no prose the player reads. The GM's judgement. |
| **Writer** | The model call that narrates what the engine already decided. Sees a redacted view. The GM's mouth. |
| **register** | Thai pronoun and particle choice, derived from trust. The signature mechanic: *the trust stat **is** the language*. |
| **path** | A generated name over a stat pair, with a threshold. Replaced the twelve hardcoded disciplines, which broke in any non-fantasy world. |
| **graft** | Growing a branch onto the tree. The one mechanism traits, Signets, subclasses and books all share; they differ only in how the branch is *entered*. |
| **Signet** | A rare, gated reward with a reachability proof. Currently unacquirable — see the ledger. |
| **declared trait** | A goal, shown with a progress bar. |
| **emergent trait** | A *recognition* of a play pattern, never foreshadowed — *"declared traits are goals; these are recognitions"* ([emergent.ts:10](src/play/emergent.ts:10)). |
| **temperament** | Stored wiring: intuition, feeling, nerve, discipline. |
| **needs** | Stored satisfaction: rest, food, safety, company, purpose. 10 is met. |
| **disposition** | **Derived** — how someone comes across, computed from temperament and needs. Not a stored field. |
| **drift** | How people change. Needs move fast; temperament only shifts when accumulated pressure crosses a threshold. |
| **gazetteer** | A compressed region. Geometry is gone; returning is an LLM *rehydration*, not a restore. |
| **tick budget** | The action economy. Replaced one-action-per-round so that being faster can mean something. |
| **fold** | Replaying the event log to rebuild `PlayState`. Synchronous, pure, and holds no `Provider` — which is why anything a model produces must be materialised into the record. |
