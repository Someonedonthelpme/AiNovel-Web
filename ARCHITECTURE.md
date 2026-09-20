# Architecture

A reference for what this codebase **is**, written before the next round of
changes is built on top of it. Every claim carries a `file:line`.

**Stack** — Next 16 App Router + React 19 · TypeScript 7 with
`--experimental-strip-types` (no build step for scripts or tests) · Drizzle +
Postgres/pgvector · LM Studio as the model provider.

## How to change this file

Every claim carries a `file:line`. A claim you cannot cite does not belong here
yet — it belongs in `HANDOFF.md` until it settles.

**`scripts/check-citations.ts` does NOT tell you a citation is right.** It
catches a line number landing on `*/`, on a blank line or past the end of a
file, and nothing else — a citation that points at plausible but unrelated code
passes silently. 3n-ii moved lines in eight files and left five citations wrong
that the checker was happy with: `regionIdFor` pointed at `facts: Fact[]`,
`gainLevels` at `settleCast`, the static-stratum freeze at a local variable. So
after any edit that inserts or removes lines, grep this file for each touched
path and read every hit BY HAND. It also cannot see a claim nobody wrote.

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
change are pure code — except a parley, whose model answer is written into the
fight's own record (§9).

The governing rule, repeated in a dozen file headers:
**the code supplies structure, the model supplies flavour** — and *every field
the model does not have to produce is a field it cannot get wrong*
([schema.ts:13](src/session/schema.ts:13),
[classnames.ts:11](src/character/classnames.ts:11),
[floorgen.ts:63](src/world/floorgen.ts:63),
[director.ts:35](src/llm/director.ts:35)).

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
  ([combat/types.ts:6](src/combat/types.ts:6)). Every combat action returns
  `{state, error}` so an illegal proposal is rejected rather than corrupting the
  encounter ([combat.ts:13](src/combat/combat.ts:13)).
- **The world layer refuses to reach upward.** `travel.ts` returns a
  `needsRegion` *request* instead of calling a generator, which keeps it pure
  and testable offline ([travel.ts:18](src/world/travel.ts:18)).
  [climb.ts](src/play/climb.ts) is the only place in play that knows floors can
  be created on demand.
- **The play layer owns the trust boundary.** *"The Director PROPOSES changes;
  this module decides which are legal and applies only those."*
  ([delta.ts:42](src/play/delta.ts:42)). Refusing one field never discards the
  rest of the turn.
- **`redact.ts` is a wall, not a convention.** `WriterView` has no `World`, no
  undiscovered places, no unestablished facts — and because `writer.ts` accepts
  only a `WriterView`, handing it world state is a **compile error**
  ([redact.ts:21](src/llm/redact.ts:21)). `assertNoLeak`
  ([redact.ts:226](src/llm/redact.ts:226)) is the runtime backstop, *"because a
  type only protects the code paths the compiler can see."*
- **React never mutates locally.** Every panel action goes to the server as an
  event ([Panels.tsx:11](app/play/[id]/Panels.tsx:11)); the whole view comes back.
- **Routes stay thin** so the web surface and the terminal script cannot drift
  apart ([game.ts:66](src/server/game.ts:66)).

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
*simulated*) · `encounter.ts` (every 10th floor is a boss — by depth, never by danger, [play/combat.ts:456](src/play/combat.ts:456)). **There are no mass foes.** A foe is somebody out of the floor's population: a lineage, a trade and a standing, built as a sheet ([crowd.ts:280](src/character/crowd.ts:280)) by `crowdFoes` ([play/combat.ts:173](src/play/combat.ts:173)). A pack comes from ONE group, chosen from the ones living at that depth ([habitat.ts:95](src/character/habitat.ts:95)), and the population is a stored thing that killing THINS ([population.ts](src/character/population.ts)).

### `src/skills/` — composed, never authored
`statgrammar.ts` — `STAT_GRAMMAR` ([:40](src/skills/statgrammar.ts:40)), the
coherence guard that replaced disciplines. A bow that heals *"reads as a bug"*.
`compose.ts` — prices parts against a budget; the budget **is** the balance.
`pools.ts` — which pool a skill draws follows its **stat**, not its payload
(`MENTAL = con,int,wis,cha,luk`, [:37](src/skills/pools.ts:37)).
`book.ts` — where skills drop from. `active.ts` — the closed-union effect and
its pure resolver.

### `src/character/` — who someone is
`persona.ts` (the core shared by player and villager) · `drift.ts` (two clocks,
with hysteresis) · `species.ts` (what KIND of thing someone is: a FOUR-LEVEL tree —
type → group → species → subspecies, [species.ts:50](src/character/species.ts:50) —
where every living thing sits at a leaf, each level adds an ability delta summing
to zero, and needs move by a whole-number multiplier,
[species.ts:21](src/character/species.ts:21)) · `speciesnames.ts` (the model's
words for it) · `speciesskill.ts` (what a kind can DO) · `bodyplan.ts` (what it
can wear) · `habitat.ts` (where it lives) · `kinship.ts` (what it makes of its
own sort) · `prey.ts` (what it hunts) · `crowd.ts` (somebody out of a
population, which is what every foe now is) · `roles.ts` (authored mechanical shapes) · `classgen.ts`
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
mechanism traits, Signets, subclasses and books all share) · `sheetaction.ts` ·
`journey.ts` (a grudge on the road, and its fade) · `sighting.ts` (who is out, and
word of where the player is) · `station.ts` (what a person is, for what their
grudge can do) · `arena.ts` (the ground a fight is fought on: a window of the map,
[arena.ts:15](src/play/arena.ts:15)) · `onroad.ts` (who is out on the roads with you, [onroad.ts:50](src/play/onroad.ts:50)) ·
`walker.ts` (a typed walk or a click, tile by tile, and where it stops,
[walker.ts:35](src/play/walker.ts:35)).

### `src/world/`
`types.ts` · `floorgen.ts` (the only world-changing model call) · `travel.ts` ·
`calendar.ts` (ticks, the date, night, and the world's words for them) ·
`strata.ts` (which structure speaks for a floor, [strata.ts:14](src/world/strata.ts:14); which one speaks for each LAW, [:71](src/world/strata.ts:71); a floor's era, [:100](src/world/strata.ts:100)) ·
`lod.ts` (**places compress, people do not — and neither do a static stratum's
places, a loop floor's, nor a floor where you hold a settlement's**, [lod.ts:61](src/world/lod.ts:61), [:84](src/world/lod.ts:84), [:87](src/world/lod.ts:87), [:90](src/world/lod.ts:90)) · `validate.ts` · `budget.ts` ·
`agenda.ts` · `naming.ts` (keeps `warehouse_south` out of prose by arithmetic,
not persuasion) · `layout.ts` (deterministic positions for the floor map) ·
`map.ts` (hub and field maps and 8-way pathfinding; doors read off the place graph,
never stored, [map.ts:329](src/world/map.ts:329)) · `route.ts` (a link's best path across its field).

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
Reading is a turn action and works once ([sheetaction.ts:242](src/play/sheetaction.ts:242)):
a paragraph cannot be re-read for the same comfort.

### `src/rules/` — the dials, and the law
`ruleset.ts` holds two different things on one carrier. The **dials** are
parameters with no subject — `carryBase` is the same number whoever asks — and
`rulesOf` resolves them. The **laws** are `{ axis, constraint, binds }`, and
`forbids(from, subject, constraint)` resolves those PER SUBJECT
([ruleset.ts:463](src/rules/ruleset.ts:463)), because whether the player is
bound is part of the law rather than an assumption in the engine.

`RULE_AXES` and `CONSTRAINTS` are closed enums: a model can name and dress a
law but never invent one, for the same reason `WorldDelta` stayed flat — a rule
nothing checks is a rule that changes nothing. **Six constraints, one or more
on each of the five axes** ([ruleset.ts:210](src/rules/ruleset.ts:210)), and
`ruleset.test.ts` holds a `PROVEN_CONSTRAINTS` list naming the reader of each:

| constraint | axis | checked by |
|---|---|---|
| `descendBelowGround` | movement | `descend` ([travel.ts:236](src/world/travel.ts:236)) and the panel's way down ([climb.ts:329](src/play/climb.ts:329)) |
| `crossFloors` | movement | the Director brief ([director.ts:392](src/llm/director.ts:392)), and whether a journey may take a stair ([journey.ts:162](src/play/journey.ts:162)) — see §12 |
| `gainLevels` | progression | `grantXp`, asked by both payouts ([climb.ts:293](src/play/climb.ts:293), [combat.ts:968](src/play/combat.ts:968)) |
| `takeLoot` | economy | `concludeCombat` skips both rolls together ([combat.ts:976](src/play/combat.ts:976)) |
| `keepMemories` | knowledge | arrival clears the sheet's beliefs, inside the fold ([climb.ts:283](src/play/climb.ts:283)) |
| `holdSettlement` | territory | `validateDelta`, refusing a purchase (`acquirePlace`, [delta.ts:82](src/play/delta.ts:82)); HARSH is born forbidding it to the player ([ruleset.ts:397](src/rules/ruleset.ts:397)) |

The `gainLevels` guard lives INSIDE `grantXp`
([progress.ts:94](src/play/progress.ts:94)) because a law some callers check and
others do not is not a law, and it BANKS the experience rather than burning it,
so an amended law pays out what was earned under it.

**A Signet is a rule exemption.** The exemption rides on the SUBJECT —
`Subject` is a bare kind or `{ kind, exempt }`
([ruleset.ts:274](src/rules/ruleset.ts:274)) — not on a lookup inside
`forbids`, which keeps `src/rules/` free of the play layer that knows what a
Signet is. `playerSubject` builds one from the sheet
([signetbook.ts:202](src/play/signetbook.ts:202)); one Signet per world, the
first to survive the reachability proof, exempts the first law that binds the
player ([signetbook.ts:190](src/play/signetbook.ts:190)). `descend` defaults its
subject to a plain `'player'` ([travel.ts:236](src/world/travel.ts:236)), so a
caller that forgets to say who is asking gets the strictest reading.

**A law can change mid-run.** `amend` returns a new ruleset with one law
rebound, imposed or struck out ([ruleset.ts:453](src/rules/ruleset.ts:453)) —
never editing a preset, which every other run shares — and `AXIS_OF` says which
axis an imposed law lands on ([ruleset.ts:231](src/rules/ruleset.ts:231)). The
change travels as `WorldDelta.amendLaw` ([state.ts:141](src/play/state.ts:141)),
because the delta is what the log stores: a rule changed outside it would replay
as one that never changed.

**Permission and geography are separate questions.** The ground law says who may
dig; `world.depthBelowGround` says how far there is to dig
([ruleset.ts:153](src/rules/ruleset.ts:153), checked at
[travel.ts:251](src/world/travel.ts:251)). Without it, a world that permits
digging had no bottom and every floor down was a model call.

**A law is learned by hitting it.** `forbids` returns the `Law` rather than a
boolean, so a refusal can say which rule it was; `descend` carries it back on
the `TravelResult`, and `applyClimb` writes a firsthand `{ kind: 'rule' }`
`Claim` onto the sheet ([climb.ts:110](src/play/climb.ts:110)). Knowing a rule is
an ordinary belief, exactly as knowing a piece of lore is, so `adopt`, `retell`
and the ambient air carry it with nothing new written. That is also why a
REFUSED crossing is logged: the lesson lives in the fold, and a lesson outside
the log does not survive a reload.

### `src/llm/`
`provider.ts` (the boundary; implementations never import each other) ·
`director.ts` · `writer.ts` · `redact.ts` · `register.ts` (**trust IS the
language**) · `local.ts` / `localProvider.ts` · `similarity.ts` / `canon.ts`.

### `src/db/`, `src/server/`, `app/`
`db/schema.ts` (five tables — `maps` since W2; this said four until W4a's pass) · `db/sessions.ts` (append, fold, snapshot) ·
`db/facts.ts` (pgvector canon) · `db/maps.ts` (a session's stored maps) ·
`server/game.ts` (every view, plus the in-memory fight store) · `server/grid.ts`
(the centre view: a window of the map you stand on, and its doors,
[grid.ts:28](src/server/grid.ts:28)) · `server/views.ts` (the side column, information
and never a control: minimap, floor map, tower view) · nine thin route handlers under `app/api/`
(`walk` since W4a).

---

## 4. Stored data

Five tables ([db/schema.ts](src/db/schema.ts)). `EMBEDDING_DIMENSION = 1024`.

| table | key | holds |
|---|---|---|
| `sessions` | `id` uuid | `seed`, `language`, `premise`, `sheet` jsonb (the **opening** sheet — never `UPDATE`d), timestamps |
| `events` | `(session_id, seq)` | `kind` ∈ `start\|turn\|sheet\|climb`, `payload` jsonb. `seq` is dense and gap-free — it **is** the replay order, allocated inside the INSERT so the PK rejects interleaving ([sessions.ts:62](src/db/sessions.ts:62)) |
| `snapshots` | `(session_id, at_seq)` | `world`, `pc`, `sheet?`, `ended?` jsonb. No `combat` column, deliberately |
| `facts` | `(session_id, fact_id)` | `text`, `region`, `established_turn`, `embedding vector(1024)` with an HNSW cosine index |
| `maps` | `(session_id, map_id)` | `map` jsonb (`GameMap`: id, kind, `rows` of `.` `,` `#`, a field's `ends`), stored on first ask by `mapFor` ([maps.ts:13](src/db/maps.ts:13)) and never redrawn; removed with its session ([schema.ts:90](src/db/schema.ts:90)). Not in snapshots or the log |

### The shapes

**`World`** ([world/types.ts:268](src/world/types.ts:268)) — `seed`, `language`,
`regions: Record<RegionId, RegionRecord>`, `people` (flat, never compressed),
`facts`, `currentRegion`, `currentPlace`, `deepestFloor`, `turn`, `flags`;
`at`, the player's tile on a map, absent meaning the centre of the current place's hub
([types.ts:336](src/world/types.ts:336), [map.ts:51](src/world/map.ts:51)).
`regionIdFor(floor) = 'floor-' + floor` ([:384](src/world/types.ts:384)).
**"One floor is one region is one integer" was true until step 6, and is now
only the default.** `floor` had meant both how DEEP (danger, budgets, depth XP,
the ground law) and what CONNECTS to what, so a world could only be a stack.
Depth stays on `floor`; adjacency moved to `Region.exits`
([:160](src/world/types.ts:160)), and `generateFloor` takes the region id to
build `into` ([floorgen.ts:342](src/world/floorgen.ts:342)); its guard against
overwriting the town keys on that id rather than on depth 0
([floorgen.ts:354](src/world/floorgen.ts:354)), because an outer world may sit
at depth 0 perfectly legally. A region with no
`exits` derives up and down from depth ([travel.ts:193](src/world/travel.ts:193))
— every world saved before this.

Eleven more are OPTIONAL, and absent means *nobody has done that yet* rather than
*off*. Each is stored rather than derived for the same reason: a word or a
relation that came from somewhere other than the seed is lost the next time
anything derives from the seed alone.

- `subjects` · `roles` — seeded shapes wearing the model’s words
  ([subjects.ts:111](src/world/subjects.ts:111)).
- `rules` — the `Ruleset` this world plays by; absent means `STANDARD`. Genesis
  stores the WHOLE preset rather than its name
  ([genesis.ts:700](src/session/genesis.ts:700)), so retuning a preset cannot
  reach into a run already under way. It carries `laws` alongside its dials
  ([world/types.ts:295](src/world/types.ts:295)), which is why a law can change
  mid-run when a generation-time value could not — and `applyDelta` is its only
  mid-run writer ([delta.ts:341](src/play/delta.ts:341)).
- `species` — the kinds of thing that live here, dealt from the seed at genesis
  ([genesis.ts:699](src/session/genesis.ts:699)). Stored for the same reason
  `subjects` is.
- `strata` — the structures this world holds ([types.ts:310](src/world/types.ts:310)).
  Genesis writes the tower, covering floor 0 up
  ([genesis.ts:755](src/session/genesis.ts:755)), and under it, when the creation page
  asks, a loop band for floors 1–10 ([:756](src/session/genesis.ts:756)) and an era band
  for floors 21–30 ([:757](src/session/genesis.ts:757)), each in the tower's kind
  ([:642](src/session/genesis.ts:642), [:651](src/session/genesis.ts:651)); a climb that
  opens a wing adds another, and the first floor built in an era band gives the band
  its `theme` ([floorgen.ts:564](src/world/floorgen.ts:564)) — both installed by the
  crossing ([climb.ts:156](src/play/climb.ts:156)).
- `edges` — who feels what about whom, sparsely. On the World because an edge
  belongs to neither end of it. A grudge toward the player also remembers the
  tick it last rose (`fedAt`, [edge.ts:78](src/social/edge.ts:78)), which is
  what it fades from.
- `clock` — world time in TEN-MINUTE ticks, separate from `turn`
  ([types.ts:328](src/world/types.ts:328)); absent reads the turn count
  ([travel.ts:99](src/world/travel.ts:99)). `turn` stays the count of play turns
  because it seeds every fight. A play turn covers the time its action took: a
  link's `travelTime` — its `linkMinutes`, rounded up to ticks ([travel.ts:73](src/world/travel.ts:73)), a stair's
  `stairCost` ([travel.ts:82](src/world/travel.ts:82)), an hour per rest turn
  ([rest.ts:120](src/play/rest.ts:120)), and at least one tick otherwise. A WALK is
  the exception: it is charged its seconds, and `second` carries what is left inside
  the tick ([types.ts:334](src/world/types.ts:334), [delta.ts:417](src/play/delta.ts:417)),
  so a short walk may cover no whole tick.
- `journeys` — grudges on the road ([types.ts:337](src/world/types.ts:337),
  [journey.ts:21](src/play/journey.ts:21)): who travels, for whom, where they have
  got to, and when they may set out. Stored, because where a traveller is must
  replay; advanced only by the fold.
- `echoes` — weighty deeds done on an era floor ([types.ts:339](src/world/types.ts:339)):
  the engine keeps the `ECHOING` ones only ([deed.ts:63](src/social/deed.ts:63)), in the
  fold ([delta.ts:693](src/play/delta.ts:693)), as NAMES rather than ids since they are
  history; the Director on a higher era floor of the same band hears them with how many
  years back they were ([director.ts:313](src/llm/director.ts:313)). Absent is none.
- `calendar` — the world's WORDS for its reckoning, days, months and seasons
  ([types.ts:341](src/world/types.ts:341)). The shape (7-day weeks, 30-day months,
  12 months, 4 seasons) and the start date are the engine's, dealt from the seed
  and never stored ([calendar.ts:54](src/world/calendar.ts:54)).
- `reputation` — per region, kept here because a region compresses to a
  gazetteer and is REBUILT, and standing would not survive that.
- `ambient` — what is going around per PLACE, not per region.
- `populations` — who lives per PLACE ([types.ts:368](src/world/types.ts:368)):
  cohorts of (subspecies, profession, size). **Absent until something has been
  killed** — a place answers from the seed until then
  ([population.ts:99](src/character/population.ts:99)), so an old world needs no
  migration and a world nobody has killed in stores nothing. Keyed by place for
  the reason `ambient` is, and because 6c makes a province one place with one
  map. Compression folds a floor's places into ONE aggregate keyed by region id
  ([population.ts:150](src/character/population.ts:150),
  [lod.ts:95](src/world/lod.ts:95)), because place ids are the model's own words
  and come back different; 6c removes compression and the aggregate with it.
- `loops` — a loop floor as it stood when you first arrived, with the people and
  first impressions it was built with ([types.ts:374](src/world/types.ts:374)). Copied
  from the crossing's own `built` ([climb.ts:172](src/play/climb.ts:172)), so it is
  already in the log; only loop floors are kept.

**`Region`** ([types.ts:132](src/world/types.ts:132), full detail) — places,
entrance, exit, danger, creatures, optionally `exits: Link[]`, and on a landmark
floor `boss` — the person who HOLDS it ([:169](src/world/types.ts:169)), on the
region because holding is a fact about the floor, with the person themselves in
`World.people`, never compressed, so a rebuilt floor finds its holder again. A `Link`
([:179](src/world/types.ts:179)) carries the far side's DEPTH as well as its id,
because danger and budgets have to answer before that region exists.
**`Place.holder`** ([types.ts:53](src/world/types.ts:53)) — set only when the PLAYER holds a
settlement; anybody else's holding is DERIVED from who is there, the highest standing
first ([holding.ts:14](src/world/holding.ts:14)), so a world stored before ownership has holders and a dead
holder passes it on. A floor where you hold one is never compressed
([lod.ts:90](src/world/lod.ts:90)): its places would come back with new ids, and the holding with them.
**`Gazetteer`** (compressed) — geometry is *destroyed*; name, biome, summary and
known people survive ([lod.ts:40](src/world/lod.ts:40)).

**`Stratum`** ([types.ts:81](src/world/types.ts:81)) — a structure above a
floor: `kind` `static | dynamic`, an optional `parent`, a floor range, and
optional `danger`, `theme`, `loot` and `laws` ([types.ts:99](src/world/types.ts:99)) —
two laws, `reset` from the closed `RESETS` ([:63](src/world/types.ts:63)) and `time`
from the closed `TIMES` ([:70](src/world/types.ts:70)). Strata NEST, so the plan is a
tree and the innermost stratum containing a floor speaks for it
([strata.ts:14](src/world/strata.ts:14)) — except for a LAW, which comes from the
innermost stratum that STATES it, walking up the parents as danger does
([strata.ts:71](src/world/strata.ts:71)). *"Laws are read from the innermost stratum
alone"* was true until `446950e`: a wing the model opened inside the loop band quietly
stopped its floors looping. A law the wing states itself still wins. `static` is
authored once and frozen — never compressed, so never rebuilt
([lod.ts:84](src/world/lod.ts:84)). A LOOP floor (`reset: 'untilCleared'`,
[strata.ts:82](src/world/strata.ts:82)) is not compressed either: leaving it uncleared
puts back the floor exactly as it was built. An ERA floor (`time: 'era'`) is its own
YEAR, whole years back from the world's — hour, season and night stay the world's —
counted down from the band's top floor, 10–100 years a floor, dealt from the seed and
never stored ([strata.ts:100](src/world/strata.ts:100)); an era band with no top floor
is refused rather than read as the world clock ([:106](src/world/strata.ts:106)).

**`Persona`** ([character/persona.ts:295](src/character/persona.ts:295)) — the
core every villager and the player share:

```ts
{ voice, status,
  temperament: Temperament,   // STORED — intuition·feeling·nerve·discipline, −10..+10
  needs: Needs,               // STORED — rest·food·safety·company·purpose, 0..10 = met
  counters: Counters,
  pressure: Temperament,      // hysteresis accumulator
  species?: string }          // an id into World.species; absent is the ordinary kind
```

**`CharacterSheet = Persona & {...}`** ([session/sheet.ts:58](src/session/sheet.ts:58))
— name, language, background, `baseAbilities`, `traits` (ids, in earn order),
level, hitDie, plus optionals: `spentAbilities`, `abilityPoints`, `xp`,
`allocated`, `skillPoints`, `treeBonuses`†, `traitBonuses`†, `signets`,
`learned`, `classId`, `classSpec`, `subclassId`, `library`.

† **denormalised caches**, written only alongside the list they summarise so
they cannot drift ([sheet.ts:79](src/session/sheet.ts:79)).

**`PlayState`** ([play/state.ts:26](src/play/state.ts:26)) — `world`, `sheet`,
`pc {hp, maxHp, conditions, coin, inventory, stamina, mana}`,
`combat` (never persisted), `ended`.

**`PlayEvent`** = `{kind:'start'} | TurnRecord | SheetRecord | ClimbRecord`.
A `TurnRecord` stores the *recorded* roll and the *validated* delta, and a whole
fight is **one event** carrying only the decisions — and, for a parley, the answer
that was heard ([play/combat.ts:502](src/play/combat.ts:502)). A `ClimbRecord` names the
far side in `to` when the crossing is not a stair
([climb.ts:59](src/play/climb.ts:59)), and carries any wing the new floor opened in `built.stratum`
([climb.ts:77](src/play/climb.ts:77)), and the era band it gave its land to in
`built.band` ([:79](src/play/climb.ts:79)) — a world's shape changing is the last
thing a replay should have to guess at.

---

## 5. Derived data

Nothing below is stored. This table is the answer to "where does this number
come from?"

| function | reads | produces |
|---|---|---|
| `dispositionOf` ([persona.ts:208](src/character/persona.ts:208)) | temperament + needs | `warmth·candour·nerve·discipline·intuition·feeling` on ±3. Circumstance colours wiring: warmth needs company, nerve is worn by being unsafe, discipline frays unrested |
| `describeMental` ([persona.ts:260](src/character/persona.ts:260)) | needs | rattled / exhausted / starving / lonely / adrift, and the upside `in good heart` |
| `registerTrust` ([persona.ts:283](src/character/persona.ts:283)) | trust + persona | the trust value a relationship is actually *read* at |
| `finalAbilities` ([sheet.ts:230](src/session/sheet.ts:230)) | base + background + species template + spent + tree + traits + equipment | `Abilities`. **Everything that moves a score must land here** or trait gates read a number the player never sees |
| `maxHpFor` ([sheet.ts:255](src/session/sheet.ts:255)) | VIT, level, tree | `10 + vitMod + (level−1)(6+vitMod)`. **CON and the hit die are deliberately excluded** |
| `armourClassFor` | armour, **AGI**, tree | AC is evasion, so it reads AGI. DEX is accuracy and never touches it |
| `soakOf` ([resolve.ts](src/combat/resolve.ts)) | VIT, the incoming blow | VIT's physical defence. Capped by the stat AND a third of the hit — flat reduction was measured and rejected |
| `resistedRounds` ([conditions.ts](src/combat/conditions.ts)) | VIT or CON, duration | shortens a condition rather than rolling a save. Never reaches immunity |
| `speedFor` / `overloadFor` / `carryCapacityFor` | AGI, STR, carried weight | movement, and what hauling a hoard costs |
| `loreFor` ([lorebook.ts:74](src/play/lorebook.ts:74)) | item id + world seed | the history a thing carries, or nothing — `LORE_CHANCE` 0.35. Depth comes off *floor* depth, so a deep find is worth reading and not merely worth more |
| `resonanceOf` ([lore.ts:65](src/play/lore.ts:65)) | lore `about` ∩ drive want/fear | `Resonance` — whether it touched them at all, and what it moved |
| `maxStaminaFor` / `maxManaFor` ([sheet.ts:332](src/session/sheet.ts:332)) | VIT/CON, level, unmet rest/safety, tree | pool ceilings — the body is docked by going unrested, the mind by feeling unsafe |
| `toCombatant` ([sheet.ts:453](src/session/sheet.ts:453)) | derive + equipped attack | a `Combatant` at full HP and full pools |
| `conditionMet` / `progressOf` ([traits.ts:198](src/play/traits.ts:198)) | `TraitContext` | whether a trait condition holds, and its progress bar |
| `poolFor` / `costOf` ([pools.ts:37](src/skills/pools.ts:37)) | skill stat + effect | which pool, and how much |
| `gateFor` / `isOpen` ([pathgen.ts:135](src/play/pathgen.ts:135)) | path + scores + class lean | which paths a spread opens — **monotonic in the score by design** |
| `stratumAt` / `dangerAt` ([strata.ts:14](src/world/strata.ts:14), [:52](src/world/strata.ts:52)) | `World.strata`, floor | the innermost stratum, and the danger curve — a stratum's own, else its parent's, else the ruleset's |
| `holderOf` ([holding.ts:14](src/world/holding.ts:14)) | a place, `World.people` | who holds a settlement: the player if stored, else the highest standing present |
| `signposted` / `walkRoute` ([travel.ts:277](src/world/travel.ts:277), [:302](src/world/travel.ts:302)) | a region, where you stand, typed text, and the ends of the field you are on | the place names you can know of — one rule, shared by the redaction wall and walking — and the fewest-step route a typed "go to" walks — including back to the place you set out from, when you are on its field |
| `personRef` ([delta.ts:61](src/play/delta.ts:61)) | a name or id the model wrote | who it means: the id, else one name match ignoring case, spaces and punctuation, people here first; else refused, and never guessed |
| `lawFrom` ([strata.ts:71](src/world/strata.ts:71)) | `World.strata`, floor, a law | the innermost stratum that STATES that law — how a wing inside a band keeps the band's laws |
| `eraOf` → `dateOf` / `timeLine` ([strata.ts:100](src/world/strata.ts:100), [calendar.ts:74](src/world/calendar.ts:74), [:184](src/world/calendar.ts:184)) | seed, strata, floor | how many years an era floor lies behind the world's, and the date read on that floor — only the year moves |
| `linksFrom` ([travel.ts:193](src/world/travel.ts:193)) | a region | its ways out: its own `exits`, or up/down derived from depth |
| `routeOf` ([route.ts:17](src/world/route.ts:17)) | seed, a linked pair, its region | the best path across its field map: exactly the link's minutes × 60, one tile a second, the same both ways, blind to the season |
| `drawMap` ([map.ts:79](src/world/map.ts:79)) | seed, a map id, its region | a hub or field's tiles, drawn from the seed alone |
| `portalsOf` ([map.ts:329](src/world/map.ts:329)) | a map + the place graph NOW | its doors, each at a bearing dealt from seed, place and target — never stored, so a revealed way gets a door and no other door moves |
| `positionOf` ([map.ts:51](src/world/map.ts:51)) | `World.at`, the current place | the player's tile: `at`, else the centre of the current place's hub |
| `arenaAt` / `gridOfArena` ([arena.ts:15](src/play/arena.ts:15), [:24](src/play/arena.ts:24)) | the map you stand on, your tile | a 12-square window of real ground as a combat grid: the map's walls, and its rough as difficult ground |
| `ridersOn` / `riderAt` ([onroad.ts:50](src/play/onroad.ts:50), [:65](src/play/onroad.ts:65)) | a field, the journeys on it | who is crossing it, and where each stands at any moment — whole ticks or between them |
| `figuresOn` ([onroad.ts:76](src/play/onroad.ts:76)) | a field | the travellers on it right now, for the view |
| `inView` ([onroad.ts:38](src/play/onroad.ts:38)) | a map, two tiles | whether one can see the other: twelve tiles, and the combat grid's own line of sight |
| `peopleHere` ([onroad.ts:105](src/play/onroad.ts:105)) | state, the map you stand on | who is with you: in view on the road, or the place's people |
| `crowdAround` ([onroad.ts:93](src/play/onroad.ts:93)) | state, a floor | the crowd a fight draws from: a place's own, or BOTH ends' out on a field |
| `walkToTile` ([walker.ts:176](src/play/walker.ts:176)) | state, one tile of the map you stand on, the stored maps | a click's walk: to the tile, THROUGH it if it is a door (a hub's onto its field, a field's end into its place), and `then` a climb, a descent or a way out if it is one |
| `minimapOf` ([views.ts:37](src/server/views.ts:37)) | state, the stored map you stand on | the whole map shrunk by a whole factor to at most 60 cells wide, each cell the best ground in its block, and where you are |
| `floorMapOf` ([views.ts:58](src/server/views.ts:58)) | state | the floor's places — DISCOVERED ONLY, and where you stand — and the roads between them; view-only, it moves nobody |
| `towerOf` ([views.ts:77](src/server/views.ts:77)) | state | strata, every floor held with the year it stands in, what you hold, deepest floor, and grudges on the road of people you have MET, never where |
| `gridOf` ([grid.ts:28](src/server/grid.ts:28)) | state, the stored map you stand on | a 41×25 window around you and EVERY door on the map, each labelled only with a name you could know |
| `walkAlong` ([walker.ts:35](src/play/walker.ts:35)) | state, a route of places, the stored maps | where a typed walk STOPS and what it cost: tile by tile, the first tick that brings a traveller, a need at 3, or night on wild ground |
| `bestPath` ([map.ts:131](src/world/map.ts:131)) | a map, two tiles | seconds along the cheapest way, eight ways, charging each tile entered; Infinity when there is none |
| `playerSubject` ([signetbook.ts:202](src/play/signetbook.ts:202)) | held Signets + the kept catalogue + what is WORN | the `Subject` every law check on the player takes |
| `viewOf` and friends ([game.ts:298](src/server/game.ts:298)) | `PlayState`, the stored map you stand on | the whole `GameView`, rebuilt per request — with the centre grid from the STORED map, so what is shown is what is walked; looking at a map stores it |

---

## 6. Generated, authored, seeded

Three kinds of content, and confusing them is how orphaned ids happen.

**Seeded catalogues** — regenerated deterministically, never stored. Each XORs
the world seed with its own constant so systems do not correlate:

```
paths     seed ^ 0x9a7b5     classes   seed ^ 0xc1a55
traits    seed ^ 0x7a17      signets   seed ^ 0x51672
emergent  seed ^ 0x3e3a      tree      seed ^ hash(background) ^ hash(class)
species   seed ^ 0x59ec
```

**Identity-keyed content** — keyed on the *thing's own id* rather than the world
seed, so the same thing is always the same thing: node grants
`mulberry32(hash(nodeId))` ([skilltree.ts:209](src/play/skilltree.ts:209)),
subclass grants `hash(sub.id)`, book volumes, composed skill names. A node taken
at level 4 still teaches the same thing at level 12.
A lorebook keys the same way ([lorebook.ts:74](src/play/lorebook.ts:74)): a sword
found on floor nine carries the same history on a replay, and none of it travels
in the save.
Who is what kind keys the same way, on the world seed and the person's id
([species.ts:275](src/character/species.ts:275)), weighted 4:1 toward the world's
DOMINANT kind — its own ordinary people, PEOPLE where a world has any, since a
town of beasts is a bestiary ([species.ts:258](src/character/species.ts:258)). And a way out found in play is NAMED from the seed, the region and the
place it leaves from ([delta.ts:286](src/play/delta.ts:286)) rather than drawn,
so the live turn and every replay mint the same destination without it being
logged.
An era floor's year and a family line key the same way, on the seed, the band's id and
the floor ([strata.ts:100](src/world/strata.ts:100),
[floorgen.ts:543](src/world/floorgen.ts:543)): the year is never stored, and a line
travels in the crossing's `built.people`, so a replay deals neither again.

**Seeded shape, stored words** — `subjects` are drawn from the seed, but the
names the model gives them are stored on the `World`
([types.ts:278](src/world/types.ts:278), [subjects.ts:111](src/world/subjects.ts:111)),
because a word derived from nothing would be lost on the next derivation. The
same split as `classSpec` on the sheet. **The ids never change**, so anything that
matched before naming still matches after it.

**Authored** — the pieces that must not vary: `ROLES`, `SHAPES` (the nine
emergent play-patterns), `PATH_WORDS`, the condition price table, the laws
`STANDARD` declares ([ruleset.ts:325](src/rules/ruleset.ts:325)) — still two of
the five constraints the engine checks: the ground is the bottom, and residents
do not cross floors — the eight species `TYPES` with their needs and lean
([species.ts:40](src/character/species.ts:40)), and the four non-ordinary species
the eight closed species `TYPES` with their needs
([species.ts:80](src/character/species.ts:80)), the four `BODY_PLANS` and which
types may be shaped like them ([bodyplan.ts:24](src/character/bodyplan.ts:24)),
and each type's skill grammar ([speciesskill.ts:32](src/character/speciesskill.ts:32)).

**Everything below a type is SEEDED.** A world deals 3–5 types, 2–4 groups each,
1–3 species each, 1–3 subspecies each ([species.ts:158](src/character/species.ts:158)) —
around 40 leaves. Each level moves `points` single points across 2–4 abilities, so
a template sums to zero however many levels stack, and a delta that would push an
ability past `CAP` (±4) is REDRAWN rather than clamped, because clamping a stat
would break the sum that makes a template a trade
([species.ts:143](src/character/species.ts:143)). A GROUP moves nothing: it
categorises, and carries the body, the habitat, the kinship and the standing in
law instead. Being seeded is what lets a stored world read: `readSpecies` finds an
id by dealing the same seed again, the five pre-tree ids still resolve, and an id
from neither scheme throws rather than being guessed
([species.ts:228](src/character/species.ts:228)).

> **The catalogue-agreement invariant**
> ([traitbook.ts:158](src/play/traitbook.ts:158)) — the fold, the tree and the
> panel must all derive the *same* catalogue from `(seed, origin)`, or an earned
> id orphans. This is why `classSpec` is carried **on the sheet** rather than
> looked up, and why `GraftSpec.stat` is a stat (a fixed enum of nine) rather
> than a generated path id.

---

## 7. The LLM contract

Nine calls, all behind `Provider` ([llm/provider.ts:34](src/llm/provider.ts:34)).

| call | schema | may decide | reaches the log? |
|---|---|---|---|
| **Director** ([director.ts:536](src/llm/director.ts:536)) | `DIRECTOR_SCHEMA`, t=0.7 | what your text *means*: a check, who you addressed, a proposed delta — with **all three tier branches pre-committed before any dice exist**. The delta may now name a law change from the closed lists (`amendLaw`, [director.ts:86](src/llm/director.ts:86)) and the PLACE a new way out leaves from (`revealWay`, [:66](src/llm/director.ts:66)) — never where it goes — and the settlement a purchase is for (`acquirePlace`, [director.ts:68](src/llm/director.ts:68)). Every person it names is resolved by `personRef` ([delta.ts:61](src/play/delta.ts:61)): live, it wrote names where ids were asked, and nine "helped" deeds in ten were thrown away | indirectly — only the validated delta and the refusal reasons |
| **Parley** ([director.ts:601](src/llm/director.ts:601)) | `PARLEY_SCHEMA` ([:574](src/llm/director.ts:574)), t=0.7 | mid-fight, which ability the player's words lean on and what ONE foe does on each of hit / partial / miss — `yields`, `withdraws` or `refuses`, all committed before the engine rolls ([turn.ts:424](src/play/turn.ts:424)); an answer outside the list is a refusal ([director.ts:598](src/llm/director.ts:598)). Deliberately not `DIRECTOR_SCHEMA`: a `moveTo` mid-fight would pass `validateDelta` | **yes** — the verdict and roll, inside `combatActions` |
| **Writer** ([writer.ts:244](src/llm/writer.ts:244)) | text, t=0.85 | prose only, from a redacted view | yes — `TurnRecord.prose`, never regenerated |
| **Writer retry** ([writer.ts:261](src/llm/writer.ts:261)) | text, t=0.7 | one regeneration on register drift; a second failure is accepted | same field |
| **Floor** ([floorgen.ts:367](src/world/floorgen.ts:367)) | `floorSchema(floor)`, t=0.9 | a region's places, people, culture (at least the budget minimum of people, [floorgen.ts:129](src/world/floorgen.ts:129); shown the last four floors, [:298](src/world/floorgen.ts:298); a name per place, [:324](src/world/floorgen.ts:324)) — inside a stratum's theme when it has one — and optionally that it opens a WING (`wingName`, [floorgen.ts:140](src/world/floorgen.ts:140)); the engine decides where the wing hangs, how far it runs (1–6 floors) and that it is frozen ([floorgen.ts:580](src/world/floorgen.ts:580)); it may name up to two `LOOT_CATEGORIES` the wing is known for (`wingKnownFor`, [floorgen.ts:143](src/world/floorgen.ts:143)); on a landmark or loop floor it NAMES the holder (`bossName`, `bossOneLine`, [floorgen.ts:145](src/world/floorgen.ts:145)) and the engine decides what they are — lineage from the floor's pack, a veteran's sheet — and returns an existing holder rather than remaking one ([floorgen.ts:653](src/world/floorgen.ts:653), [:659](src/world/floorgen.ts:659)) | **yes, in full** — inside `ClimbRecord.built` |
| **Character** ([genesis.ts:192](src/session/genesis.ts:192)) | `characterSchema(...)` ([schema.ts:124](src/session/schema.ts:124)), t=0.8 | name, background, voice, proposed scores — and, when no class was picked, `classShape`: one of this world's roster ids ([genesis.ts:197](src/session/genesis.ts:197)) | once, into `sessions.sheet` |
| **Ground floor** ([genesis.ts:387](src/session/genesis.ts:387)) | `GROUND_FLOOR_SCHEMA`, t=0.9 | floor 0 and its people | once, into the origin event |
| **Class naming** ([classnames.ts:96](src/character/classnames.ts:96)) | `CLASS_NAMING_SCHEMA`, t=0.9 | **words only** — no mechanics are in the schema | only via the chosen class |
| **Subject naming** ([subjectnames.ts:50](src/world/subjectnames.ts:50)) | `SUBJECT_NAMING_SCHEMA`, t=0.9 | **words only** — the ids are given to it and it invents none | stored on `World.subjects` |
| **Species naming** ([speciesnames.ts:57](src/character/speciesnames.ts:57)) | `SPECIES_NAMING_SCHEMA`, t=0.9 | **words only** — one call for the whole tree, so a lineage sounds like a variant of its people; a repeated word is refused and a model that is down leaves placeholders | stored on `World.species` |

**Zero model calls** for: combat (except a parley), panel actions, suggested actions, interview
questions, loot, or any trait/Signet/tree generation.

Class naming is wrapped in `try/catch` and returns `[]` on failure
([classnames.ts:128](src/character/classnames.ts:128)) — a creation page that
will not render because the model was down is a worse failure than a duller
word.

---

## 8. Workflow A — creating a playthrough

```
app/new/page.tsx
  seed drawn CLIENT-SIDE at mount (:50) ─── the one point real entropy enters
  three questions: world · character · drive
  │
  ├─ optional: POST /api/classes {seed, world, language}
  │     classShapesFor(seed)          pure code, no model — roles DEALT from a
  │                                   shuffled deck, 2 cross + 2 deepen subclasses
  │     nameClasses(...)              the only model call; words only; may fail
  │     buildClass(...)               shape + naming → CharacterClass
  │
  └─ POST /api/sessions {language, answers, draft, seed, rules, structure, species}
        draft carries the class id and its WORDS; the server rebuilds the class
        from classShapesFor(seed) and keeps only the words (genesis.ts:136) —
        it believed the whole object, hit die and skills, until aa09fc8.
        Left to the story, it carries the roster's words instead, and the
        character call picks the class (genesis.ts:152)
        │
        newGame  (server/game.ts:451)
          startInterview + recordAnswer per stage (blanks get canned defaults)
          runGenesis:
            1. generateCharacter  ──► sheet
            2. generateGroundFloor ──► region, people, premise, startPlace
                 (given the sheet, so the town is built around its resident)
          World assembled IN CODE: floor-0, turn 0, deepestFloor 0,
            the chosen preset IN FULL, the kinds from the seed, and the
            strata — the tower, fixed or living, with a loop band and an
            era band under it if asked (genesis.ts:754–758)
          createSession → INSERT sessions + events(seq 0, kind 'start')
          saveSnapshot at seq 0
        │
        → /play/{id}
```

What code fills in regardless of the model: abilities always pass through
`repairAbilities` (clamp 8–15, shave to the 40-point budget); every character
holds a class — picked, inferred by the character call, or else the one leaning
on the strongest ability ([genesis.ts:152](src/session/genesis.ts:152)) — which supplies the starting attack; `hitDie` comes from the class; `level = 1`;
`skillPoints ?? 1` so the tree is live on the first screen; and the starting
inventory turns the declared attack into a **real wielded weapon** plus three
rations, because a short rest spends one.

**No opening prose is generated.** The first passage is your first turn.

---

## 9. Workflow B — one play turn

```
 0  ENGINE ACTS ──────────────────────── no model call at all
       a typed "go to X" naming a place you can know of is walked tile by
       tile over the maps along the fewest-step route (turn.ts:144,
       travel.ts:302, walker.ts:35), stopping on the first tick that brings a
       traveller, somebody NEW in view on the road, a need at its line or
       night on wild ground; the record
       holds where it stopped and WHO it met, so a replay never pathfinds
       and never reads a tile (delta.ts:309, delta.ts:323);
       "rest"/"sleep", "hunt"
       and "buy X" go through validateDelta as if proposed (turn.ts:340);
       a hunt that would open no fight says why (turn.ts:364). One record
       each, and steps 1-7 never run. A CLICK on the map is the same walk
       by another door (walk route → walkTarget, game.ts:667 → walkTile,
       turn.ts:231): checked at the edge, never the model.
 1  canonFacts   ← pgvector nearest-neighbour over this session's facts
 2  DIRECTOR ────────────────────────────────────── model call #1
       sees: place, affordances, "the ONLY legal moveTo values",
             people + their disposition/condition, canon, your pack
       returns: classification, addressed person, a check with all three
             tier branches pre-committed, and a proposed delta
 3  if check.required:
       modifier = abilityMod(finalAbilities[ability]) + edgeFor(skills)
       ENGINE rolls 2d6           ≤6 miss · 7–9 partial · ≥10 hit
       the pre-committed branch is selected and merged — both halves
       spread, so no verb can be dropped (director.ts:266)
 4  validateDelta ─────────────── the trust boundary
       refuses: a move to an unconnected place · trust for someone who does
       not exist · revealing an exit that is already known · combat where
       danger is 0 · using what you do not carry · resting when you may not ·
       a law outside the vocabulary · a way out from a place not here ·
       a walk the model proposed · a purchase O1 forbids
       (a person the model NAMES is first resolved to an id, delta.ts:61)
       (clamps: trust ±3, time 0..3)
 5  applyTurn ───────────────────── the fold
       applyDelta → combat (live or replayed; a finished live fight is
       re-folded by settleFight) → drift causes derived FROM
       THE RECORD → traits awarded LAST
       drift runs by THIS world's rules and each person's kind (delta.ts:776)
 6  toWriterView + assertNoLeak ─── the wall
 7  WRITER ─────────────────────────────────────── model call #2 (+1 retry)
       sees only the redacted view and what already happened
 8  appendTurn(record); snapshot every 20 events
```

The order **is** the design: the Director proposes and commits to every branch,
the engine rolls, the engine validates, and only then does the Writer see
anything.

### What a foe is

Somebody **drawn out of the place's population** — and the compromise in it is
worth knowing, because the curve was nearly lost to it twice.

A place holds cohorts of (subspecies, profession, size), and the draw is weighted
by size ([crowd.ts:83](src/character/crowd.ts:83)), so a lineage that has been
hunted down is rarer to meet. Two readers make that more than bookkeeping: the
encounter fields **no more bodies than live there**
([play/combat.ts:252](src/play/combat.ts:252)), and a place cleared out **opens no
fight at all** ([play/combat.ts:450](src/play/combat.ts:450)). Each body carries
the cohort it came from — `Combatant.kind` and `trade`
([combat/types.ts:168](src/combat/types.ts:168)) — so what dies is taken out of
the population it came from ([play/combat.ts:862](src/play/combat.ts:862)),
whoever won.

"No population here" and "nothing lives here any more" are **different answers**
and the callers keep them apart ([population.ts:99](src/character/population.ts:99)):
collapsing them would let thinning a place to nothing quietly summon back the
statblock foes the population replaced.

The word and the body agree. `Region.creatures` are words the model invented, and
naming a foe `names[i % names.length]` meant a floor of undead could be handed a
wolf's name; the name now **follows the lineage** — whichever creature word maps
to this body is what it is called — and a lineage no word covers wears its own
kind, because the engine invents no words
([play/combat.ts:329](src/play/combat.ts:329)).

`scaleFoe` still decides what it is like to **fight**: hit points, AC,
proficiency, the attack it swings, its speed — and its abilities, **plus its kind's
template** ([play/combat.ts:314](src/play/combat.ts:314)), through the same
`withTemplate` a statblock foe has always had
([statblock.ts:128](src/combat/statblock.ts:128)). Amended 2026-09-13: from 3n
until then a character foe fought with raw `scaleFoe` abilities, so its kind sat
on its sheet and never reached the fight, while an old world's statblock foes
still got theirs. Only the nine scores take the template — hit points and AC stay
anchored, so a `vit` or `agi` shift reaches soak and tempo but not hp or AC, and
only a shift that crosses a modifier boundary does anything. The CHARACTER decides who
it is: which lineage, which group (so body, habitat, kinship, law and prey all
apply), what it knows, and what is on its body to take. Rank stands in for the
statblock role — whelp · ordinary · veteran for minion · regular · elite
([crowd.ts:44](src/character/crowd.ts:44)) — and `levelFor` inverts the sheet's
HP formula against the statblock's so a character of that standing is as tough as
the foe it replaces ([crowd.ts:130](src/character/crowd.ts:130)).

Its **gear** is solved against that same anchor rather than tuned
([crowd.ts:224](src/character/crowd.ts:224)): the catalogue already scales a
weapon and a coat with the depth a thing was found at, so the search walks that
and takes the piece whose BUILT numbers land closest to `scaleFoe`'s. AC lands
within two for an armoured rank; damage per round lands as close as the die ladder
reaches. So what is on a body is what the depth says a body of that standing is
worth, which is what makes foe power and loot value one number.

**Why not let the character's own numbers fight?** Measured 2026-09-12 and the
answer is now firm: **not reachable**, and the obstacle is a design decision
rather than an implementation. **The win rates in this paragraph are CONTAMINATED
past danger 1, re-measure pending** (flagged 2026-09-13): the harness climber fought
on the fixture's 11 hit points whatever its level ([harness.ts:191](src/play/harness.ts:191)
is the fix), in both rows. The three walls are per-term and stand. With AC solved to within two, damage per round as
close as the ladder reaches, and hit points still anchored, melee measured
76/64/48/35/26 against the anchored 94/86/84/47/36; handing hit points back too
gives 59/59/57/42/19 (re-measured 2026-09-13 with the final solve; a figure of
65/65/63 written first came from a solve that still armed foes with slings), and
fielding only whelps below danger 6 barely moves it (61/61/63/57/62), because the
wall is the level-one body rather than its gear. Three walls, each measured:

- **Hit points.** A danger-1 minion has 2 and a regular 8. The frailest level-one
  body is `HP_AT_FIRST` 10, about 12 with any `vit` at all.
- **What it swings.** A shallow foe swings 3.5 a hit; the weakest melee thing the
  catalogue makes is a d6, which in the hands of anything with a positive ability
  modifier is 4.5 — so damage per ROUND floors at 2.25 against an anchored 1.57.
  Solving to the nearest gets no closer, because there is nothing closer.
- **Reach.** Minimising damage alone armed nearly every body with a SLING, since a
  d4 is the closest thing to a shallow swing — and foes that used to spend two
  rounds crossing the arena opened fire on round one. Thirty points of win rate,
  with every printed number matching within one. Fixed by filtering candidates to
  the trade's reach; recorded because it is the clearest evidence that **matching
  a foe term by term is not what a fight measures**.

And the mirror of it: the curve is drawn against `referencePc`, which gets up to
4d8 of damage and AC 14–18 from nothing but its level
([statblock.ts:194](src/combat/statblock.ts:194),
[:207](src/combat/statblock.ts:207)) — a body no character sheet can be either. The
curve assumes a player no sheet describes AND foes no sheet describes; fixing one
end alone is what costs twenty points whichever end is picked. DESIGN 3n-iii holds
the three options and the user's call.

A harness test pins the melee curve between statblock foes and character foes
within SEVEN points at danger 1, 2 and 4
([harness.test.ts:93](src/play/harness.test.ts:93)). It was exact equality until
2026-09-13, which held only because the template was missing; with it the two
differ by −4.5 to +4.3 points, measured with paired seeds, and no consistent sign.

**A landmark floor is held by somebody** (6b stage 4) — and so is every LOOP floor
(6c L2b, [floorgen.ts:639](src/world/floorgen.ts:639)), because a loop floor is
cleared by its holder's death. Floor generation makes the
holder before anyone meets them — a person with a sheet, of the kind that lives
at that depth, decided by the seed and the floor alone so the model's name for
them changes nothing about what they are ([crowd.ts:114](src/character/crowd.ts:114)).
While they live, the fight on that floor is against THEM, alone, on the boss
role's anchor plus their kind on a landmark, and on the ELITE anchor on a loop
floor — notable, not a boss ([play/combat.ts:242](src/play/combat.ts:242)); the
combatant carries `person`, so a holder killed is written dead — the first writer
`Person.alive = false` has had ([play/combat.ts:877](src/play/combat.ts:877)) —
and is never counted out of a population they were not drawn from
([play/combat.ts:868](src/play/combat.ts:868)). After that the floor's fights are
the crowd's. No mutation yet: that arrives with the kin tree, after quests. A floor
generated before this, or one the model named nobody for, keeps the crowd boss; a
loop floor the model named nobody for is still held, by the lineage's own word
([floorgen.ts:673](src/world/floorgen.ts:673)).

**A person with a grudge comes for you** (6b stage 5). Hostility is DERIVED from
the edges, never stored: resentment at `GRUDGE_THRESHOLD` (3) or more, and fear
below the resentment ([edge.ts:115](src/social/edge.ts:115)). Resentment rather
than regard, because contempt is not a grudge; and not `Person.stance`, which is
an order to a companion, not hostility. Whoever qualifies fights alone and in
place of the crowd, on the elite anchor plus their kind
([play/combat.ts:217](src/play/combat.ts:217)). One at a time, the most resentful
first, and a landmark's living holder before any of them
([play/combat.ts:353](src/play/combat.ts:353)). Their sheet is written the first
time they fight, at that fight's danger, and kept
([play/combat.ts:391](src/play/combat.ts:391)); one killed is written dead the way
a holder is.

*"Whoever qualifies is in your next fight … nothing pursues anybody yet"* was true
until 6b stage 7.1b. A grudge now TRAVELS (`play/journey.ts`): it sets out on the
turn it is fed, walks on the world clock, and only a traveller who has ARRIVED
where you stand fights (`arrivedHere`, [journey.ts:56](src/play/journey.ts:56)).
The law is read on the road: a traveller takes a stair only where `crossFloors`
does not forbid them as a resident of their group
([journey.ts:162](src/play/journey.ts:162)), so under `STANDARD` a grudge still
stays on its own floor.

**A grudge on the road** (6b stage 7.1). It SETS OUT on the turn it is fed
([journey.ts:67](src/play/journey.ts:67)): resentment toward the player rose this
turn and is at the threshold, the bearer has some word of where the player is,
and none of their parties is already on the road. WHO goes depends on the bearer
([station.ts:101](src/play/station.ts:101)): the bearer if their nerve is 1 or
more, else somebody they command, else somebody who owes them, else the bearer
anyway. What a bearer may send is their STATION
([station.ts:86](src/play/station.ts:86)), derived and never stored from roles,
trade and status ([station.ts:60](src/play/station.ts:60)). Someone who fled
recovers for a day first ([journey.ts:36](src/play/journey.ts:36)). Each turn a
traveller walks for the time the turn covered, toward the newest word it or its
bearer holds ([journey.ts:96](src/play/journey.ts:96)): the cheapest route through
a region, no further than the entrance of one where fighting is refused, and one
stair at a time where `crossFloors` allows ([journey.ts:148](src/play/journey.ts:148)).
ARRIVING opens the fight, decided from state so a replay opens the same one
([delta.ts:740](src/play/delta.ts:740)). Only an arrived traveller fights, and
only while the bearer's grudge is worth a chase
([combat.ts:347](src/play/combat.ts:347)): 2 or more
([edge.ts:106](src/social/edge.ts:106)), one below what it takes to set out, so a
grudge that fades a point on the road still arrives.

**Word of the player.** A `sighting` is a belief, one per person seen
([belief.ts:44](src/character/belief.ts:44)); for sightings the NEWER account wins,
not the surer ([sighting.ts:37](src/play/sighting.ts:37)). Each turn word passes one
hop along people's edges ([sighting.ts:90](src/play/sighting.ts:90)), then
whoever is where the player stands sees them firsthand
([sighting.ts:81](src/play/sighting.ts:81), in the fold at
[delta.ts:795](src/play/delta.ts:795)). WHO IS OUT is one function
([sighting.ts:55](src/play/sighting.ts:55)): the place's people, less any away on
the road, plus arrived travellers, and at night only guards and night kinds — but OUT
ON A ROAD it is only whoever you MET, since the people of the place you set out from
are a road behind you (W5); tile-free, because the fold reads it
([sighting.ts:71](src/play/sighting.ts:71)). The Director's list of people here and
the Writer's view read it too.

**Grudges fade** ([journey.ts:234](src/play/journey.ts:234)): a point per the
bearer's `fadeDays` unfed, 1 to 5 by temper
([journey.ts:218](src/play/journey.ts:218)), doubled if they owe the player; the
timer restarts at each point lost, and a traveller whose grudge falls below 2
turns back.

**Time** (7.1e). A tick is ten minutes ([calendar.ts:13](src/world/calendar.ts:13)).
The clock reads as a date from the world's start
([calendar.ts:65](src/world/calendar.ts:65)) — on an era floor only its year moves
([:74](src/world/calendar.ts:74)); night is 20:00–06:00
([calendar.ts:175](src/world/calendar.ts:175)); the Director and the Writer are
given the hour, the dark, the season and the date in the world's words — the floor's
own year on an era floor, "N years before" the reckoning behind year 1
([calendar.ts:184](src/world/calendar.ts:184), [:191](src/world/calendar.ts:191); passed
the floor at [director.ts:426](src/llm/director.ts:426) and
[redact.ts:141](src/llm/redact.ts:141)) — which genesis asks for last, so the
game does without them ([calendar.ts:131](src/world/calendar.ts:131)). Needs drain
by the hour marks a turn crossed ([delta.ts:495](src/play/delta.ts:495)), faster in
winter outside a settlement ([delta.ts:498](src/play/delta.ts:498)); winter
([calendar.ts:29](src/world/calendar.ts:29)) also slows a wild link. About one
group in six keeps night hours and one in six keeps to some seasons
([habitat.ts:110](src/character/habitat.ts:110)); a group out of season is left
out of a place's crowd ([combat.ts:184](src/play/combat.ts:184)). *"A floor whose one
group is away fields nobody"* held for a day: since 2026-09-18 another group that lives
at that depth and is out fills in, and a floor stands empty out of season only where
`world.emptyOutOfSeason` allows it ([combat.ts:201](src/play/combat.ts:201)) — a crowd
thinned to nothing still stays gone. A hunter by trade fights at night with the
advantage ([conditions.ts:124](src/combat/conditions.ts:124)).

**Eras** (6c). The deeds `ECHOING` names — helped, killed, spared — done on an era floor
are kept as echoes ([delta.ts:693](src/play/delta.ts:693)) and told on the era floors
ABOVE it in the same band, the five most recent, with the years between
([director.ts:313](src/llm/director.ts:313)); never below — the past does not remember
its future. When an era floor above the band's first is built, one or two of its new
people are dealt a `line`: an ancestor among the LIVING people of the era floor below
([floorgen.ts:543](src/world/floorgen.ts:543)); the Director is told whose line
somebody is ([director.ts:348](src/llm/director.ts:348)).

**Defeat is not death** (6b stage 6). A character foe carries a BREAK LINE
([types.ts:183](src/combat/types.ts:183)), set where it is built
([play/combat.ts:301](src/play/combat.ts:301)): `floor(maxHp × (3 − nerve) / 12)`
([play/combat.ts:408](src/play/combat.ts:408)) — a quarter at nerve 0, half at −3,
none at +3 — and none at all for a kind with no safety need, which is undead,
construct and elemental ([species.ts:84](src/character/species.ts:84)). Nerve is
the person's own for a holder or a grudge; a crowd foe's sheet is a blank persona,
so its nerve is 0 and its KIND decides. A statblock foe and the player carry no
line and never break. At or under the line a foe leaves the board in `settle`,
which runs inside the victory check ([combat/combat.ts:65](src/combat/combat.ts:65)):
it YIELDS if a standing party member is within a square, and FLEES otherwise
([:71](src/combat/combat.ts:71)). Off the board rather than flagged
([types.ts:322](src/combat/types.ts:322)), so every check that asks `dead` still
means "out of the fight". A blow that carries a foe from above its line to nothing
kills it; breaking needs a blow that leaves it standing.

A yielded foe's fate is the PLAYER's once the fight is won: the fight is not
finished while one is waiting ([play/combat.ts:517](src/play/combat.ts:517)), the
only options are `kill` and `spare` ([:525](src/play/combat.ts:525)), and both are
`CombatAction`s, so they ride in `combatActions` and replay like any decision
([:686](src/play/combat.ts:686)). The server holds the fight open on the same test
([game.ts:771](src/server/game.ts:771)) and shows it as not over, so the choice
appears in the ordinary option chips. Killed is killed — thinned, written dead
([play/combat.ts:849](src/play/combat.ts:849)); spared writes the `spared` deed,
toward the person if it was one ([delta.ts:636](src/play/delta.ts:636)), and whoever
was spared is counted present to feel it ([delta.ts:658](src/play/delta.ts:658)).
Fled and spared foes are not thinned. Every foe BEATEN pays XP, not only the dead
([play/combat.ts:967](src/play/combat.ts:967)). Losing or drawing decides nothing:
a yielded foe walks away. `captured` is not built — nothing would read a captive
until step 9, where joining the party gives it one.

**Survivors with a future** (6b stage 7). A foe that FLED BADLY BEATEN — at or under
half its break line ([play/combat.ts:899](src/play/combat.ts:899)) — or that was
SPARED becomes a person. Any other survivor goes back into the crowd, which was
never thinned for it, because `world.people` is never compressed and breaking is
common. A new person's id is the region, the turn and the body
([:905](src/play/combat.ts:905)), so a replay makes the same one. They have the
kind and trade they fought with, at a veteran's standing
([:1040](src/play/combat.ts:1040)), and keep their kind's word for a name: nothing
calls a model when a fight ends. They live where they broke, added to that
place's people ([:917](src/play/combat.ts:917)), so they witness the turn's deeds
firsthand and the Director sees them there. Fleeing badly beaten leaves resentment
`FLED_GRUDGE + BEATEN_GRUDGE`, which is 3 ([:910](src/play/combat.ts:910)):
exactly the grudge threshold, so they come back, and a crowd foe has grown into a
notable. A foe that already was a person gains the grudge and is not made twice. A
spared one is the person the `spared` deed lands on
([:940](src/play/combat.ts:940)).

A world stored before the species tree still meets statblock foes: inventing a
population for it would be inventing the bodies of creatures somebody is already
fighting.

### What a group is for

A group carries no stats — that is the whole reason it exists, so the four things
it DOES carry are not stat math:

| mechanic | what it decides | where |
|---|---|---|
| **body plan** | which of the world's slots this shape has: `beastly` has no hands or feet, `winged` has no back (wings fill it, so no pack), `serpentine` no legs | [bodyplan.ts:24](src/character/bodyplan.ts:24), narrowed for a creature at [body.ts:19](src/play/body.ts:19) |
| **habitat** | a DEPTH band, not a biome — `Region.biome` is a word the model invented for one floor, so matching it would be matching prose. Bands are spread across the tower so every floor has something that really lives there | [habitat.ts:37](src/character/habitat.ts:37) |
| **kinship** | same group is kin (`familiarity +1, trust +1`), another group of the same TYPE is a neighbour (nothing — people are people), another type starts cooler. **Applied once, to the town born at world creation** ([genesis.ts:604](src/session/genesis.ts:604)): a generated floor's arrivals get plain opening edges ([floorgen.ts:523](src/world/floorgen.ts:523)), so people met deeper meet you as nobody in particular, and kin there do not know each other for rumour to run through | [kinship.ts:25](src/character/kinship.ts:25) |
| **law** | a law may bind `{ group }`, and it binds whoever IS one, player or resident: a rule about what somebody is, not where they were born. **No world is born with one**: `STANDARD`'s two laws bind `all` and `residents` ([ruleset.ts:347](src/rules/ruleset.ts:347)), and the only writer of a group binding is the Director's `amendGroup` ([director.ts:253](src/llm/director.ts:253)) | [ruleset.ts:259](src/rules/ruleset.ts:259) |
| **prey** | about one group in three hunts one other, of another type; a hunter attacks its quarry with ADVANTAGE — 46% to 79% between otherwise identical fighters, which is more than any template can say | [prey.ts:22](src/character/prey.ts:22), read at [conditions.ts:117](src/combat/conditions.ts:117) |

A species below it gets one signature skill from `composeSkill`, and a subspecies
the same knack at a thinner budget ([speciesskill.ts:101](src/character/speciesskill.ts:101)).
The type's grammar is a FILTER over the stat grammar and the narrowing is
absolute — a beast never bursts however its body leans — so the KNACK narrows
instead: a creature composes from the best stat its kind can actually use
([speciesskill.ts:71](src/character/speciesskill.ts:71)).

### Combat, inside that

A fight opens mid-turn and the record is **not written** until it ends. The
encounter lives in an in-memory `fights` map on `globalThis`
([game.ts:421](src/server/game.ts:421) — Next gives routes and server components
separate module instances, so a plain module-level `Map` would produce two).

Every roll derives from state —
`combatRng = mulberry32(seed + turn·7919 + log.length)` — so storing the
**decisions** reproduces the identical fight. Options are a legal-move list; an
unaffordable skill is *not offered* rather than offered and refused. When it
concludes, the original turn's draft record plus `combatActions` is appended as
**one event**, and a snapshot is taken unconditionally. Its closing lines come back
beside the finished view ([game.ts:794](src/server/game.ts:794)): the view carries a
log only while a fight is open ([game.ts:267](src/server/game.ts:267)), which dropped
them for every fight until `d579b42`.

The state saved is not the fight as it stands: `settleFight` re-folds the
finished record from the state before the turn
([delta.ts:804](src/play/delta.ts:804)), because the live turn ran drift, deeds
and traits when the fight OPENED and replay runs them after it ends. Live and
replay agree by construction.

**A fight is fought on the ground you stand on** (W7): the board is a window of the
map ([combat.ts:429](src/play/combat.ts:429)), and it is RECORDED on the turn
([state.ts:177](src/play/state.ts:177)) — like a climb records the floor it built,
because the fold holds no tiles and a board re-cut from a map that had changed would
replay a different fight. The record keeps it only when a fight actually opened. A
turn with no position on a map still gets the old bare arena.

**An ambush** (`startedBy: 'them'`) does two things. The foes sort ahead of the
party in the initiative order, though everybody still rolls, so the dice after
it fall the same ([combat/combat.ts:191](src/combat/combat.ts:191)). And they
spawn beside the player instead of across the arena
([play/combat.ts:442](src/play/combat.ts:442)): acting first from 9 squares away
only closes the gap, which measured as an ambush RAISING the player's win rate
by 4–10 points. Adjacent, it costs 0–4. Striking first earns the player nothing.

**A parley** (6b stage 8) is a word to one foe that costs the turn
([play/combat.ts:790](src/play/combat.ts:790)). It is offered for a foe that is
standing, of a kind with a company need, and not yet spoken to this fight
([play/combat.ts:603](src/play/combat.ts:603)) — once, read off the fight's own log
([combat/combat.ts:83](src/combat/combat.ts:83)) — and listed AFTER `end turn`
([play/combat.ts:585](src/play/combat.ts:585)), because a parley logs an event and the
log's length seeds every roll, so a first-option picker like the harness must never
reach one. The server hears it where a provider exists
([game.ts:752](src/server/game.ts:752)): `hearParley` DISCARDS whatever roll and
verdict the client sent, asks the model, rolls in the engine and writes the tier's
answer into the action ([turn.ts:413](src/play/turn.ts:413)); a foe that cannot hear
costs no call ([:416](src/play/turn.ts:416)). The fold only carries the verdict out
([combat/combat.ts:92](src/combat/combat.ts:92)): `yields` and `withdraws` are stage
6's `yielded` and `fled` ([:100](src/combat/combat.ts:100)), so a fate, a survivor and
a deed need nothing new, and `refuses` changes nothing. A foe still standing is above
its break line, so one talked away is never "badly beaten" and gains no grudge. The
fight log shows engine words ([play/combat.ts:1088](src/play/combat.ts:1088)), never
the model's.

---

## 10. The other flows

**Rest** — `canRest` refuses mid-fight; a **short** rest needs a ration; a
**long** rest requires a settlement **on floor 0**, because *"a real night of
sleep means going back down to town"* — otherwise a camp on floor 15 would undo
the whole climb — or at a settlement you HOLD, on any floor
([rest.ts:56](src/play/rest.ts:56)): a base you bought. This is where the difficulty curve lives.
Rest and hunting are recognised by the engine from what you type (§9 step 0).

**Walk by clicking** (W4a) — `POST /walk { map, x, y }` is checked twice: its
shape at the route ([game.ts:667](src/server/game.ts:667)), then that the tile is on
your map, inside it and not a wall ([turn.ts:231](src/play/turn.ts:231)); a bad one is
refused with a reason and nothing is logged. The walk is logged as its own turn
FIRST, then a stair or a way out is taken ([game.ts:590](src/server/game.ts:590)), so a
climb that fails leaves you standing on the stair.

**Climb** — a crossing is a **logged event**. `ClimbRecord.built` carries the
generated region and its people, because `foldPlay` is synchronous and holds no
`Provider`. `applyClimb` is pure and drives **both** the live path and replay,
so the two cannot drift apart ([climb.ts:44](src/play/climb.ts:44)). A crossing
that is not a stair names its destination and goes through `traverse`
([travel.ts:204](src/world/travel.ts:204)), which REFUSES a stair
([:213](src/world/travel.ts:213)) — otherwise a derived down-link would be a way
around the ground law and the world's bottom, both of which live in `descend`.

**Leaving a loop floor uncleared puts it back** ([climb.ts:138](src/play/climb.ts:138),
[:191](src/play/climb.ts:191)) — places, crowd, people and their edges, reputation,
ambient, and the journeys of its people; whoever the run made there goes with it.
The player keeps facts, pack, coin and XP, none of which lives on a floor. Cleared is
DERIVED: the holder dead — the clear condition until quests exist, by decision
(2026-09-18) — and a floor with no holder has nothing to clear
([:196](src/play/climb.ts:196)). What other people believe about an undone run is left
standing, by decision.

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
**It does not hold across a change to the fight rules, and nothing guards it**
(promoted from HANDOFF 2026-09-14). A fight event stores decisions, not outcomes —
a parley's verdict is the one outcome it stores, because a fold holds no provider
([play/combat.ts:502](src/play/combat.ts:502)) — and a fold re-resolves them with today's code ([delta.ts:744](src/play/delta.ts:744)).
Loading folds from the latest snapshot or from origin
([sessions.ts:189](src/db/sessions.ts:189)), and a fight is appended and
snapshotted back to back ([game.ts:778](src/server/game.ts:778)), so normal play
never re-runs an old fight. But delete the snapshots of any session older than a
fight-rule change — stages 2, 3c-ii, 3m, 3n, anchor plus delta, `58095bd`,
which made worn gear count, stage 5 (`1526dfe`), which fields a person with a
grudge in place of the crowd, stage 6, which takes a foe off the board at its
break line, stage 7, which makes some of those foes into people, 7.1b, which opens
a fight when a traveller arrives, and 7.1e, which changes a crowd by season and gives
hunters the night — and its old fights replay differently. No rules
version is stamped anywhere. The test passes because it runs under one version of
the rules.

**2. Dice are recorded, never re-rolled.** Where a roll can be derived from
state instead, it is — which is why a whole fight stores only decisions — except a
parley's roll, which comes from the live path and is recorded
([turn.ts:413](src/play/turn.ts:413)).

**3. The model never decides an outcome.** It proposes; the engine validates and
resolves.

**4. Closed unions, never free text.** `ActiveEffect`, `ItemEffect`,
`WorldDelta`, `TraitCondition`, `Gate`, `CONSTRAINTS`, `BINDINGS`,
`PARLEY_EFFECTS` ([combat/types.ts:291](src/combat/types.ts:291)), `RESETS`
([world/types.ts:63](src/world/types.ts:63)), `TIMES` ([:70](src/world/types.ts:70)) and
`ECHOING` ([social/deed.ts:63](src/social/deed.ts:63)) are all closed, and so is a map tile: `.` `,` `#` ([map.ts:92](src/world/map.ts:92)). A model names things; it never invents a mechanic — nor a law, nor
where a road goes: `revealWay` names the place a way leaves FROM and the engine
mints the far side ([state.ts:100](src/play/state.ts:100)).

**5. The redaction wall is a type, with a runtime backstop.** A place is hidden unless you have DISCOVERED it, on every floor
([redact.ts:208](src/llm/redact.ts:208)) — *"everything on another floor is hidden, discovered or not"* was
true until `8dc4c32`, and refused every turn that mentioned the stair just climbed. Which
names you may WALK to is the same rule ([travel.ts:277](src/world/travel.ts:277)), and so is
the label on a door in the centre view ([grid.ts:41](src/server/grid.ts:41)). A journey is the engine's
secret: the tower view names only travellers you have met, and never where they are
([views.ts:83](src/server/views.ts:83)).

**6. Adding an event kind means adding it to `FOLDED_KINDS`**
([sessions.ts:73](src/db/sessions.ts:73)) — or it is written and silently
dropped on reload. This has already happened once, to panel actions.

**7. Every stored field must have a writer *and* a reader.** See below.

**8. A step with one right answer never reaches the model.** Walking, resting,
hunting and buying are recognised whole and applied by the engine
([turn.ts:144](src/play/turn.ts:144), [:340](src/play/turn.ts:340)): live, the Director refused an adjacent stair three
times, started no fight on five "attack" turns in six, and rested only when it chose
to. Speech that merely contains the words ("rest assured", "attack the warden")
is still the Director's.

**9. A map a session has seen never moves.** It is stored on first ask and never
redrawn ([maps.ts:13](src/db/maps.ts:13)), so a change to the generator cannot shift
walls under a save; its doors are derived from the place graph on every read
([map.ts:329](src/world/map.ts:329)), so a way revealed later never forces a redraw.

**9a. A meeting on the road is RECORDED, not recomputed.** A walk stores who came
into view ([walker.ts:152](src/play/walker.ts:152)); the fold ends that traveller's
journey where you both stand ([delta.ts:323](src/play/delta.ts:323)) and the ordinary
arrival machinery opens the fight — so the log still never depends on a tile.

**10. A position is removed, never set to undefined.** A snapshot is JSON and drops an
undefined key, so a fold that wrote `at: undefined` disagreed with its own snapshot —
the snapshot test caught it in W3. `unplaced` removes the key
([map.ts:64](src/world/map.ts:64); [delta.ts:334](src/play/delta.ts:334), [climb.ts:266](src/play/climb.ts:266)).

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
| **`Signet.grant`** | Generated everywhere, read nowhere. Its only consumer, `abilityOf` ([signet.ts:289](src/play/signet.ts:289)), has zero callers. |
| **`Trait.grants.note`** | Set by every authored, generated and emergent trait; read by nothing. A note is the **only** payout an emergent trait has, so every emergent trait grants literally nothing. |
| **`treeBonuses.attack` / `.damage`** | Accumulated by `applyGrant`, read by no formula. A node granting "+1 to hit" changes nothing. |
| **`ItemEffect.buff`** | `applyEffect` returns state unchanged and narrates *"…feels sharper"*. Drinking it consumes the potion and does nothing. |

**Cleared: a player's gear.** — *the player's inventory never reached a fight*
was true from 2026-09-02 until 2026-09-13, and it belonged in this table without
anyone knowing. `playerCombatant` built the player with `toCombatant` and no
inventory, so every found weapon and coat, every refine, enchant and rarity grant,
and carry weight's drag on speed did nothing in a fight: a player whose sheet said
AC 17 fought at 11, swinging the background's 1d6 with a d12 in hand. `fd16f7a`
gave `toCombatant` the parameter the same day the play path was written without
it, and no test crossed the two. It now passes the inventory
([play/combat.ts:100](src/play/combat.ts:100)). Found building 3o's harness climber:
a geared climber measured identical to an ungeared one.

### Waiting on a reader, by decision

The **`maps` table** had a writer, `mapFor` ([maps.ts:13](src/db/maps.ts:13)), and no
caller when W2 shipped. **Resolved by W3:** the server stores each map on the first walk
across it ([game.ts:547](src/server/game.ts:547)) and the walk reads it back from there.

A foe's **signature skill** is on its sheet and never used, because `combat/ai.ts`
cannot cast at all; step 9's AI rebuild is where that lands.

A foe's **worn gear** is solved against the anchor and carried but does not change
what it is like to fight, since `scaleFoe` holds the curve — it exists to be
looted. This one is no longer waiting on a piece of work: 3n-ii measured that
giving it force **cannot** hold the curve (see *What a foe is*), so it waits on a
decision at 3n-iii rather than on an implementation. Written and read for the
climber today, and not a field pretending to be a mechanic.

**Cleared: `Stratum.laws` had readers and no writer.** — *"no world is born with a
law"* was true until `bfa0f66`: genesis writes a loop band when asked
([genesis.ts:756](src/session/genesis.ts:756)). It was half-live until `d23e612`: a floor with no
holder counts as cleared ([climb.ts:196](src/play/climb.ts:196)), and holders went only
to every tenth floor ([encounter.ts:25](src/combat/encounter.ts:25)); every loop floor
is now held ([floorgen.ts:654](src/world/floorgen.ts:654)). The second law, `time`,
arrived with its writer in the same stage ([genesis.ts:757](src/session/genesis.ts:757)).

**Cleared: `peopleBudget.min` had no reader.** — the floor schema asked for people with
`minItems: 0`, so a floor could come back empty (era floor 21, live, with nobody to
witness a deed or carry a line). It now asks for the budget's minimum
([floorgen.ts:129](src/world/floorgen.ts:129)), and a floor still left empty is a warning, not a silence
([:532](src/world/floorgen.ts:532)).

**Cleared: a parley's roll had no reader.** — *"the fold applies the verdict alone,
and the fight log shows the answer but not the dice, unlike a turn's roll"* was true
until `d579b42`. The roll is still recorded in the action
([play/combat.ts:502](src/play/combat.ts:502)); the log event now carries it
([combat/combat.ts:92](src/combat/combat.ts:92)) and the fight log prints it as the
transcript prints a turn's ([play/combat.ts:1087](src/play/combat.ts:1087)).

**Cleared: a crowd's stored size.** — *"killing does not yet thin a floor"* was
true until 3n-ii. A population is stored per place, the draw is weighted by what
is left, the encounter is capped by it, and a cleared place opens no fight
([population.ts:124](src/character/population.ts:124),
[play/combat.ts:252](src/play/combat.ts:252)).

### Confirmed dead

**Cleared: `Person.sheet`** — *listed here as dead* until 6b stage 4. A landmark
floor's holder is given one at generation ([floorgen.ts:653](src/world/floorgen.ts:653))
and the fight reads it ([play/combat.ts:235](src/play/combat.ts:235)). `recruited`
and `stance` are still dead. Stage 5 gave it a second writer: whoever comes for you
with a grudge gets one at their first fight ([play/combat.ts:391](src/play/combat.ts:391)).

**Cleared: `Person.homeRegion`** — *listed here as dead* until 6b stage 5, which
read it as where a person IS, to decide whether a grudge was on your floor. Since
7.1b it is where a traveller sets out from when no loaded place lists them
([journey.ts:49](src/play/journey.ts:49)). Still written only at generation;
see `crossFloors` under *Enforced by construction*.

`Signet.augments` (display-only; nothing resolves the reference) ·
`Signet.hint` · `Gazetteer.openThreads` (read by the rehydration prompt, written
by nothing — always `[]`) · `Gazetteer.compressedAtTurn` ·
`Person.agenda` / `agendaPace` (and [agenda.ts](src/world/agenda.ts) itself,
which nothing imports) · `Person.recruited` / `stance` ·
`Person.tags` · `Fact.people` (no column — dropped on write) ·
`facts.region` (written, never SELECTed) · `Item.value` (there are no shops) ·
`ItemEffect.restore.supply` (the number is ignored) ·
`CharacterSheet.hitDie` (read by no formula since HP moved to VIT) ·
`Combatant.size` ([types.ts:141](src/combat/types.ts:141)) — written `large` for a
statblock boss and `medium` for everyone else
([statblock.ts:156](src/combat/statblock.ts:156),
[sheet.ts:473](src/session/sheet.ts:473)) and read by nothing, so a landmark holder
fighting at `medium` changes nothing.

**Cleared by the claim path.** — *"`CharacterSheet.signets`: never written by
any code path … the whole branch is inert in play"* was **reversed on
2026-09-05** by `f8bcf9f`, and this document went on asserting it for a day.
`claimSignet` re-checks the gate at the boundary and appends the id
([sheetaction.ts:258](src/play/sheetaction.ts:258)); the skill tree grafts a
branch for every held Signet that `opens` one
([skilltree.ts:637](src/play/skilltree.ts:637)); the panel marks it held
([game.ts:1038](src/server/game.ts:1038)); and
[signet.test.ts:253](src/play/signet.test.ts:253) proves a claimed Signet is on
the sheet and survives replay. Writer and readers both exist. `Signet.grant`
and `Signet.augments` above are NOT cleared by this — a Signet can be held now
and still pay out nothing.

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

**What enhancing grants, as of `e9735c2`.** Rarity `fine` sets one LAW aside
while the thing is worn — the Signet mechanic, on gear. `exemptOf`
([refine.ts:286](src/items/refine.ts:286)) draws it from the laws IN FORCE, since
an exemption from a law no world declares would be a word on a sheet, and seeds
WHICH law from the object, so it is a fixed property of that thing. It survives
later rebirths: the reset takes what was invested, never what the rarity earned.
`playerSubject` reads worn gear beside signets
([signetbook.ts:202](src/play/signetbook.ts:202)), so every `forbids` check
honours it at once — and only while it is worn. DESIGN asks for two more payouts
that are NOT built: a skill (nothing lets an item grant one; `activeSkills` never
sees the inventory) and the full `NodeGrant` shape (`attack` and `damage` are
dead until `resolve.ts` reads them).

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

**`NpcVoice.tics`** is *read* ([register.ts:65](src/llm/register.ts:65)) and
written as `[]` by **every** generator. A reader with no writer.

**Cleared: `CharacterSheet.species`.** — *"read for the player every turn and
written by nothing … the player is always the ordinary kind"* was true until
`50ef7c7`. Drift still reads it ([delta.ts:776](src/play/delta.ts:776)); genesis
now writes it from the player's choice — a kind picked, a kind described and
mapped by the character call, or the seeded draw villagers get
([genesis.ts:326](src/session/genesis.ts:326),
[species.ts:156](src/character/species.ts:156)). Skipping the step still leaves
the climber ordinary, which is now a choice rather than a gap.

**Cleared: `Stratum.danger` and `Stratum.loot`.** — *"read … and written by
nothing outside tests"* was true until `3506255`. A wing's danger is
seeded ([floorgen.ts:611](src/world/floorgen.ts:611)) and its loot comes from
what the model named out of `LOOT_CATEGORIES`
([floorgen.ts:628](src/world/floorgen.ts:628)). The genesis tower still has
neither ([genesis.ts:755](src/session/genesis.ts:755)), which means the
ruleset's curve and the ordinary table — identity, not a gap.

### A knock-on

`CLASSES = []` ([classes.ts:170](src/character/classes.ts:170)) makes
`subclassById` permanently `undefined`, so
[traitbook.ts:204](src/play/traitbook.ts:204) never leans the trait catalogue
toward the chosen subclass — even though `subclassOf`, which reads `classSpec`,
would have worked.

### Enforced by construction

**`crossFloors`** — *"has a reader and no enforcer: the Director is told
residents may not leave, and nothing else checks it — because nothing moves an
NPC, so nobody ever tries."* True until 6b stage 5, when it gained its first
enforcer: a person with a grudge on another floor came for you only when the law
did not forbid them. Since 7.1b NPCs MOVE (journeys), and that movement asks the
law: a traveller takes a stair only where it allows
([journey.ts:162](src/play/journey.ts:162)). For everything else it is still true
by construction: `Person.homeRegion` is written at generation and never updated,
and the Director brief ([director.ts:392](src/llm/director.ts:392)) is the only
check on what gets narrated.

**`Person.line` is always a real id** ([types.ts:245](src/world/types.ts:245)) — by
construction: the engine deals it from people who exist, alive, on the floor below
([floorgen.ts:543](src/world/floorgen.ts:543)); the model never names one.

**Cleared: an object's identity was unique only within one bag.** — *"moving an
object between owners would rename it and silently re-roll what it is worth"* was
true until 3n-ii, and was days from being live: foes now carry gear. `nextInstanceId`
takes a NAMESPACE, so an id is unique across bags and not merely within one
([types.ts:242](src/items/types.ts:242)); `give` moves an existing object and
PRESERVES its id, throwing on a collision rather than renaming
([types.ts:311](src/items/types.ts:311)) — because the only way to survive a
collision is to change what the object is worth, which makes it a bug to hear
about, not to paper over. Minters namespace their ids so it cannot arise: a body's
gear is minted under where that body stands ([crowd.ts:280](src/character/crowd.ts:280)).

One consequence worth knowing, and it is a design property rather than a defect: a
refine's grant is hashed off the instance id by decision — *the thing you traded
your refine for is THIS object* — so the namespace feeds it, and the same veteran
standing in two places wears gear worth a point or so apart. That is why the gear
solve is keyed on the namespace too, and why its AC lands within two of the anchor
rather than on the nose.

**Per-NPC rule knowledge** has no writer for the same reason. The only
`ruleClaim` writer is the player's refused crossing
([climb.ts:116](src/play/climb.ts:116)); the Director is shown the PLAYER's
beliefs about the law ([director.ts:385](src/llm/director.ts:385)).

---

## 12b. How balance is measured

`scripts/balance.ts` and `npm run fight` both drive ONE character: a str
shortsword build that takes the first option offered. Every balance number this
project had came from it, so a change that helped that build and hurt every other
one measured as an improvement — which is how a species lean shipped costing a
default climber 15–19 points of win rate.

`src/play/harness.ts` is the answer: four bodies that cost the same (melee,
ranged, caster, tank) played by a policy that prefers a skill when one is
affordable ([harness.ts:156](src/play/harness.ts:156)), and a matchup chart built
from SHEETS rather than statblocks — a statblock foe's HP comes from danger, so
`vit` would count for nothing and two subspecies differing only in it would read
identical ([harness.ts:261](src/play/harness.ts:261)). `npm run chart` prints
both.

**TWO CURVES, and they are not the same instrument** (since 2026-09-13).

- **The statblock anchor** is the curve every floor was balanced against: melee
  against statblock foes, a level-one climber with its fixture kit. It is pinned
  in tests, not printed — "the difficulty curve is where it was measured"
  ([harness.test.ts:45](src/play/harness.test.ts:45)) and the ±7 pin between
  statblock and character foes. **Its last printed values, at `6da4040`: melee
  97/90/88/46/5 at danger 1/2/3/4/6, ranged 85/83/70/36/4, caster 94/94/91/90/3,
  tank 96/86/78/38/2.** `measure` still gives exactly this by default.
- **The chart's matrix** ([chart.ts:33](scripts/chart.ts:33)) is 3o's instrument:
  the CHARACTER foes a world with kinds meets ([harness.ts:135](src/play/harness.ts:135)),
  fought by a climber at that depth — levelled by `expectedPcLevel`, carrying the
  armour and a weapon of its own reach the tower dropped one floor above, and only
  its starting kit on floor 1 ([harness.ts:97](src/play/harness.ts:97)). Until
  2026-09-13 it measured the statblock anchor, so no change to a crowd foe could
  ever show in it. **Re-pinned 2026-09-17 at 6b stage 7.1e** (night and seasons),
  world 7, pinned. Two things moved it by 1–3 points. The harness clock runs from
  08:00 into the night for later seeds, and a hunter by trade fights with the
  advantage after dark (7.1e-iii). A group that keeps to some seasons is away in
  the others (7.1e-v). That second one also means some trials open NO fight: a
  floor's crowd is one group, so about one trial in ten had nobody out. `measure`
  used to count those as losses, which alone read as an 8-point drop in the ±7 pin.
  It now counts wins over the fights that opened, and reports how many did
  (`fought`, [harness.ts:201](src/play/harness.ts:201)):

  | build | d1 | d2 | d3 | d4 | d6 | d10 | d14 | d20 |
  |---|---|---|---|---|---|---|---|---|
  | melee | 100 | 100 | 100 | 100 | 99 | 80 | 70 | 15 |
  | ranged | 88 | 91 | 83 | 81 | 58 | 16 | 17 | 4 |
  | caster | 93 | 94 | 94 | 94 | 92 | 46 | 31 | 5 |
  | tank | 98 | 100 | 100 | 100 | 97 | 66 | 50 | 6 |

  **Re-pinned again 2026-09-18**, within 2 points of the row above: a floor whose
  only group is away is now filled by another that lives at its depth, so almost
  every trial opens a fight again ([play/combat.ts:201](src/play/combat.ts:201)).

  **Re-pinned 2026-09-15 at 6b stage 6**, world 7 — foes now
  break, so a climber skips the last quarter of each at depth. Measured pinned; the
  committed code before the stage reproduced the first values below exactly, so
  the shift is the stage's and not the machine's:

  | build | d1 | d2 | d3 | d4 | d6 | d10 | d14 | d20 |
  |---|---|---|---|---|---|---|---|---|
  | melee | 100 | 100 | 100 | 100 | 99 | 81 | 73 | 15 |
  | ranged | 88 | 90 | 83 | 85 | 60 | 17 | 19 | 4 |
  | caster | 93 | 94 | 94 | 94 | 92 | 46 | 32 | 5 |
  | tank | 98 | 100 | 100 | 100 | 97 | 68 | 54 | 7 |

  The statblock anchor did not move: a statblock foe carries no break line, and its
  pinned tests pass unchanged. **First values, world 7:**

  | build | d1 | d2 | d3 | d4 | d6 | d10 | d14 | d20 |
  |---|---|---|---|---|---|---|---|---|
  | melee | 99 | 100 | 99 | 99 | 98 | 59 | 49 | 4 |
  | ranged | 85 | 84 | 80 | 76 | 42 | 2 | 3 | 3 |
  | caster | 93 | 94 | 94 | 94 | 87 | 7 | 10 | 3 |
  | tank | 96 | 99 | 99 | 99 | 94 | 45 | 26 | 2 |

  Two rows collapse for reasons in the MODEL, not the game: the only ranged weapon
  the catalogue makes is the sling, so a ranged climber at depth carries one; and a
  caster's power is a skill the harness authors as a flat 6, which no gear grows.

**Re-pinned twice on 2026-09-13**, both in the statblock anchor. First tank, 88/76/69/21/2 → 90/77/70/28/2: its
coat started working when the player's gear began reaching fights at all (see
*Cleared: a player's gear* in §12). Then melee, tank and caster, when the harness
climber began fighting on its own pools rather than the fixture's 11 hit points
([harness.ts:191](src/play/harness.ts:191)) — melee from 96/86/83/40/5, tank from
90/77/70/28/2, caster d6 from 0 (its mana had been clipped too). Ranged did not
move: its maximum is under 11. **Every harness number taken at a level above one
before that fix described a climber on 11 hit points**, whatever its level.

Re-pinned 2026-09-12 at 3n-ii: 3d recorded 97/84/77/46/3 and **3m moved it** without the doc saying
so, which is how "the anchor must not move" was violated without anyone seeing
it. Checked out and re-run, `npm run chart` gives the 3d numbers at `397a454`
and these from `aea03f9` onward. **Re-pin it in the same commit as any stage
that moves it** — a recorded number nobody re-measures is how a regression gets
waved through.

Limits worth knowing before trusting a number from it. The caster's skill is
authored in the harness rather than composed, and the policy prefers a skill
UNCONDITIONALLY, so a skill that does not help reads as a small loss. The climber
at depth is the catalogue's drop one floor up, not a simulated climb — no refine,
no rarity, no choosing between finds. And `scripts/balance.ts` measures something
else again: its `referencePc` gets up to 4d8 and AC 14–18 from its level alone, so
it reads 89/84/86/56/57% at floors 8–30. **Amended 2026-09-13:** this said the
harness climber's gear never improved and only danger 1–5 could be trusted —
true of the statblock anchor's body, not of the chart's.

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
danger curve, which was hardcoded to `danger === floor`, and how deep the world
goes below its ground). `persona` and `world` reach play since step 6 — before
it, `applyTurn`'s drift and `generateFloor`'s danger both used the STANDARD
default. Everything below not marked is still a constant awaiting conversion.

`ruleset.test.ts` holds a `PROVEN` list and asserts it still covers every field
on the type, so ADDING a dial without proving a reader fails there rather than
shipping quietly. It caught `persona.suitSwing` the moment it was added.

Every balance number, and where it lives.

| knob | value | file |
|---|---|---|
| point buy budget / min / max | 40 / 8 / 15 | [sheet.ts:175](src/session/sheet.ts:175) |
| HP at first / per level | 10 / 6 (+VIT mod each) | [sheet.ts:271](src/session/sheet.ts:271) |
| pool base / per level | 8 / 2 | [sheet.ts:319](src/session/sheet.ts:319) |
| skill cost floor / ceiling | 1 / 12 | [pools.ts:54](src/skills/pools.ts:54) |
| turn length in ticks / min action | 6 / 2 | [tempo.ts:25](src/combat/tempo.ts:25) |
| drift threshold / decay | 6 / 1 | [drift.ts:47](src/character/drift.ts:47) |
| **suitability swing** | ±25% on cost, magnitude and ticks | [suit.ts](src/skills/suit.ts), [ruleset.ts](src/rules/ruleset.ts) |
| skill budget per floor | `4 + floor × 0.8` | [book.ts](src/skills/book.ts) |
| effects drawn per skill | up to 3, until 75% of the budget is spent | [compose.ts](src/skills/compose.ts) |
| temperament range | −10..+10 | [persona.ts:84](src/character/persona.ts:84) |
| need range | 0..10 | [persona.ts:125](src/character/persona.ts:125) |
| trust range / max swing per turn | −3..+4 / ±3 | [social/edge.ts:56](src/social/edge.ts:56), [delta.ts](src/play/delta.ts) |
| grudge threshold | resentment ≥ 3, and fear below the resentment | [social/edge.ts:101](src/social/edge.ts:101) |
| survivor grudge | fled at or under half the break line → a person, resentment 2 + 1 | [play/combat.ts:1029](src/play/combat.ts:1029) |
| clock tick | 10 minutes; a day is 144 ticks | [calendar.ts:13](src/world/calendar.ts:13) |
| a place link / a stair | 6–42 min (each end by kind 3/5/7/9, seed 0–10, biome ×1/×1.25/×1.5 by keyword), charged in whole ticks / 1–3 hours, seeded per pair; a wild link +50% in winter | [travel.ts:36](src/world/travel.ts:36), [:45](src/world/travel.ts:45), [:82](src/world/travel.ts:82), [:73](src/world/travel.ts:73) |
| a field's band | legs 8 columns apart (three walls between them), 2 tiles either side of the centreline, a straight run of at least 6 at the end, one-tile spurs 4–8 long off the band | [map.ts:173](src/world/map.ts:173), [:175](src/world/map.ts:175), [:178](src/world/map.ts:178) | [map.ts:173](src/world/map.ts:173), [:178](src/world/map.ts:178) |
| rough ground on a field | 5% / 20% / 35% of the band, by W1's biome keywords | [map.ts:210](src/world/map.ts:210) |
| hub radius | settlement 24, wild 18, landmark and dungeon 14, gate 10 tiles | [map.ts:295](src/world/map.ts:295) |
| difficult ground | rough costs 2 movement to enter, open 1 | [grid.ts:102](src/combat/grid.ts:102) |
| sight on the road | 12 tiles, and not through a wall | [onroad.ts:24](src/play/onroad.ts:24) |
| the centre view | 41×25 tiles around you, clipped to the map | [grid.ts:8](src/server/grid.ts:8) |
| the minimap | at most 60 cells wide | [views.ts:17](src/server/views.ts:17) |
| a walk's stop line | food or rest at 3 or under — the level the game calls "starving" | [walker.ts:17](src/play/walker.ts:17) |
| needs by the hour | −1 food every 4 h, −1 rest every 2 waking h; ×1.5 in winter outside a settlement | [delta.ts:495](src/play/delta.ts:495) |
| night | 20:00–06:00 | [calendar.ts:175](src/world/calendar.ts:175) |
| grudge fade | a point per 1–5 days by temper, ×2 if owed; chase continues at 2 | [journey.ts:218](src/play/journey.ts:218), [edge.ts:106](src/social/edge.ts:106) |
| recovery after fleeing | one day | [journey.ts:36](src/play/journey.ts:36) |
| night kinds / seasonal groups | about 1 group in 6 each | [habitat.ts:110](src/character/habitat.ts:110) |
| break line | `floor(maxHp × (3 − nerve) / 12)`; none with no safety need; yield within 1 square | [play/combat.ts:408](src/play/combat.ts:408), [combat/combat.ts:71](src/combat/combat.ts:71) |
| time per turn | 0..3 | [delta.ts](src/play/delta.ts) |
| short / long rest turns | 1 / 8 | [rest.ts:28](src/play/rest.ts:28) |
| base speed / floor | 6 (+AGI mod) / 3 | [sheet.ts](src/session/sheet.ts) |
| carry base / per STR / overload step | 20 / 2 / 8 | [sheet.ts](src/session/sheet.ts) |
| damage soak ceiling / share of blow | 2 / one third | [resolve.ts](src/combat/resolve.ts) |
| condition resistance floor | 1 round | [conditions.ts](src/combat/conditions.ts) |
| default item weight (equipment/consumable/material/armour) | 3 / 1 / 1 / 8 | [items/types.ts](src/items/types.ts) |
| snapshot cadence | every 20 events | [sessions.ts:23](src/db/sessions.ts:23) |
| **danger** | the stratum's own curve, else its parent's, else `round(dangerBase + floor × dangerPerFloor)`; STANDARD `0 / 1` is identity | [strata.ts:52](src/world/strata.ts:52), [budget.ts:32](src/world/budget.ts:32) |
| depth below ground | 3 | [ruleset.ts:324](src/rules/ruleset.ts:324) |
| species multipliers | whole numbers only — 0 (the need does not apply), 1, 2 | [species.ts:21](src/character/species.ts:21) |
| species tree | 3–5 types · 2–4 groups each · 1–3 species each · 1–3 subspecies each (~40 leaves) | [species.ts:158](src/character/species.ts:158) |
| a level's delta | 2 points across 2–4 abilities for a type and a species, 1 for a subspecies, 0 for a group; sums to zero; redrawn if it would pass `CAP` ±4 | [species.ts:68](src/character/species.ts:68), [:104](src/character/species.ts:104) |
| share of a town who are the dominant kind | 80% | [species.ts:275](src/character/species.ts:275) |
| habitat band | 4–14 floors wide, centred on the group's share of the tower and widened to cover it | [habitat.ts:26](src/character/habitat.ts:26) |
| signature skill budget | 10 for a species, 8 for a subspecies | [speciesskill.ts:92](src/character/speciesskill.ts:92) |
| hunting | about one group in three hunts one other; the edge is ADVANTAGE | [prey.ts:19](src/character/prey.ts:19) |
| a crowd's standing | four ordinary to one whelp to one veteran | [crowd.ts:60](src/character/crowd.ts:60) |
| a rank's gear CAP | whelp common +0, ordinary uncommon +2, veteran rare +4 — a ceiling, not a choice: what it actually carries is solved against the anchor, and only a whelp is bare by rule | [crowd.ts:53](src/character/crowd.ts:53) |
| a place's population | 1–3 trades per lineage, 2–6 of each; small on purpose, since a place holding sixty would never visibly thin inside one playthrough | [population.ts:36](src/character/population.ts:36), [:45](src/character/population.ts:45) |
| how worn looted gear is | `PRISTINE` less 15%, less up to 55% more — 31–85, used but never wrecked | [crowd.ts:343](src/character/crowd.ts:343) |
| the gear solve's reach | 12 draws × 8 depths per slot, one term at a time; the product was 1600 builds a foe | [crowd.ts:235](src/character/crowd.ts:235) |
| wing length | 1–6 floors, whatever the model asks | [floorgen.ts:580](src/world/floorgen.ts:580) |
| wing danger | the danger where it opens, −2..+3, seeded on the wing's id; slope inherited | [floorgen.ts:611](src/world/floorgen.ts:611) |
| what a wing is known for | ×3 on up to two named categories, ×0.5 on the rest | [floorgen.ts:628](src/world/floorgen.ts:628) |
| era gap | 10–100 years a floor, dealt per floor; the top floor is one gap back | [strata.ts:90](src/world/strata.ts:90) |
| era band | floors 21–30 | [genesis.ts:651](src/session/genesis.ts:651) |
| echoes told | the five most recent, from the era floors below in the same band | [director.ts:319](src/llm/director.ts:319) |
| descendants per era floor | 1–2, from the living people of the floor below | [floorgen.ts:554](src/world/floorgen.ts:554) |
| settlement price | 50 × floor (floor 0 counts as 1) — about ten won fights on floor 1, measured live | [holding.ts:24](src/world/holding.ts:24) |
| trust to sell | 2 | [holding.ts:27](src/world/holding.ts:27) |
| floors a new floor is shown | the last 4 | [floorgen.ts:298](src/world/floorgen.ts:298) |
| loot profile | a multiplier per category on the standing chance; absent is ×1 | [catalogue.ts:254](src/items/catalogue.ts:254) |
| places per floor | `clamp(4 + floor/3, 4, 24)` | [budget.ts:14](src/world/budget.ts:14) |
| people per floor | `clamp(2 + floor/6, 2, 10) + 2` | [budget.ts:20](src/world/budget.ts:20) |
| XP to next level | `100 × level` | [progress.ts:20](src/play/progress.ts:20) |
| depth fall-off | `min(1, floor/level)²` | [progress.ts:35](src/play/progress.ts:35) |
| new-depth XP | `60 × floor`, no fall-off | [progress.ts:50](src/play/progress.ts:50) |
| tree rings | 8 | [skilltree.ts:142](src/play/skilltree.ts:142) |
| graft size | 2..5 | [graft.ts:44](src/play/graft.ts:44) |
| emergent branch cap | 3 | [emergent.ts:139](src/play/emergent.ts:139) |
| tower horizon | 30 | [signetbook.ts:58](src/play/signetbook.ts:58) |
| embedding dimension | 1024 (bge-m3) | [schema.ts:21](src/db/schema.ts:21) |

---

## 14. Known deviations

**~~Three of eight scripts are broken~~ — FIXED.** The root cause was one line:
`tsconfig.json`'s `include` covered `src/**` and `app/**` only, so
`npm run typecheck` never looked at `scripts/`. It does now, and all eight
build. `skillgen.ts` measures components; the two embedder scripts call
`rankFacts`, which is what `rankClues` was renamed to when the mystery engine
became the tower.

**`WorldDelta` is still hand-written verbs — ten when this was settled, twelve
since step 6 added `revealWay` and `amendLaw` ([state.ts:100](src/play/state.ts:100),
[:141](src/play/state.ts:141)) — and the question is now SETTLED rather than
deferred.** The design called for it to become a list of `Effect`s
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
a killing that never happened. `drewOn` is charged only when the player struck
first: the Director says who did (`startedBy`, [state.ts:118](src/play/state.ts:118)),
and being jumped is no deed ([delta.ts:628](src/play/delta.ts:628)). A fight
with any kill is one `killed` deed, charged even in an ambush
([delta.ts:632](src/play/delta.ts:632)). `spared` — *"has no writer until 6b stage
6"* — is written when the player spares a foe who yielded
([delta.ts:636](src/play/delta.ts:636)).

Six of the original ten (`moveTo`, `revealExit`, `startCombat`, `useItem`,
`equipItem`, `rest`) are COMMANDS rather than consequences and were never
effect-shaped in the first place. Both new verbs are commands too, which is
evidence for the settlement rather than against it.

**Step 6 left two things out of the approved plan, on purpose.**

*No `Stratum.topology` knob.* The plan had a stratum declare whether it is a
stack or a graph. It does not need to: a region's own `exits` already says, and
a region without them is a stack by derivation
([travel.ts:193](src/world/travel.ts:193)). A knob would be a second source for
one fact.

*No `story` stratum kind.* It would behave exactly like `static` until quests
exist ([types.ts:93](src/world/types.ts:93) has `static | dynamic` only), so it
would be a word with no reader — the signature bug, introduced on purpose. It
arrives with quests (DESIGN step 7).

*Echoes reach the Director, not the Writer.* The Director's context carries them
([director.ts:427](src/llm/director.ts:427)); the Writer's view gets the era's time line
([redact.ts:141](src/llm/redact.ts:141)) and no echoes. Add when the prose never mentions one.

*A descendant outlives an ancestor killed after you met them.* Lines are dealt when a
floor is built ([floorgen.ts:543](src/world/floorgen.ts:543)); a later killing changes
nothing on the floor above. Open in DESIGN *Stratum knobs*.

*A walk arrives in a fixed line, not prose.* "You walk to the covered market." — the
engine walks and no model narrates the arrival ([turn.ts:278](src/play/turn.ts:278)). **W3 decided:** every
stop gets a fixed line, by why it stopped ([turn.ts:269](src/play/turn.ts:269)); the Director on stops waits
for W5, when a stop can mean someone in view (DESIGN 6c §2c).

*There is no way down in the web app.* `godown` exists ([climb.ts:309](src/play/climb.ts:309)) and the view
carried `canDescend`, but no route called the one and nothing in `app/`
read the other, so a climber could never return to the floor-0 town. Walkable maps make
the down stair a portal (DESIGN 6c §2). **Resolved by W4a:** clicking the down stair
walks there and descends ([game.ts:704](src/server/game.ts:704)). **Closed 2026-09-20:**
`canDescend` left the view; `exitStatus` still derives it for the climb path
([climb.ts:334](src/play/climb.ts:334)).

**A world that is not a stack can only GROW sideways — nothing authors one.**
Genesis still writes `floor-0` and a tower
([genesis.ts:755](src/session/genesis.ts:755)); the only writer of
`Region.exits` is a way out found in play ([delta.ts:362](src/play/delta.ts:362)).
An outer world designed as a graph from the first turn is not yet expressible.

**Determinism holes** — the *record* is deterministic; its *production* is not.
The seed falls back to `Date.now()` when the client does not supply one; the
creation page is the single point where real entropy enters
([new/page.tsx:53](app/new/page.tsx:53)); fact retrieval depends on a live
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

**A malformed request is a 500, not a 400.** Six of the eight route handlers turn
every thrown error into `status: 500`, `POST /api/sessions` among them
([route.ts:24](app/api/sessions/route.ts:24)). So a species choice that
`speciesChoiceOf` refuses, with a message naming what was wrong
([game.ts:641](src/server/game.ts:641)), reaches the client as a server fault. The
only 400s are written by hand: a missing seed, a missing combat action, and a
refused climb target.

---

## 15. Glossary

| term | meaning |
|---|---|
| **Director** | The model call that decides what your text *means* mechanically. Sees everything; writes no prose the player reads. The GM's judgement. |
| **Writer** | The model call that narrates what the engine already decided. Sees a redacted view. The GM's mouth. |
| **parley** | A word to one foe mid-fight. The model commits to what it does on each tier, the engine rolls, and the answer — yields, withdraws, refuses — is stored in the action so replay never asks again. |
| **register** | Thai pronoun and particle choice, derived from trust. The signature mechanic: *the trust stat **is** the language*. |
| **path** | A generated name over a stat pair, with a threshold. Replaced the twelve hardcoded disciplines, which broke in any non-fantasy world. |
| **graft** | Growing a branch onto the tree. The one mechanism traits, Signets, subclasses and books all share; they differ only in how the branch is *entered*. |
| **Signet** | A rare, gated reward with a reachability proof. Claimed once its gate is open ([sheetaction.ts:258](src/play/sheetaction.ts:258)), after which it grafts its branch onto the tree. Held, it sets aside one law — one Signet per world is an exemption ([signetbook.ts:190](src/play/signetbook.ts:190)) — but its `grant` still pays nothing; see the ledger. |
| **law** | A `{ axis, constraint, binds }` in a world's ruleset: what a subject may not do. Closed vocabulary; checked per subject by `forbids`. Distinct from a **dial**, which has no subject. |
| **exemption** | A law set aside for one holder. What a Signet is, and what a `fine` object is while worn. Carried on the `Subject`, not looked up. |
| **stratum** | A structure above a floor — a tower, a wing inside it. Strata nest; the innermost speaks for a floor. `static` ones are frozen. |
| **loop** | A stratum law (`reset: 'untilCleared'`): a floor left uncleared goes back to how it was built, until its holder dies. |
| **wing** | A stratum a floor opens mid-climb. The model names it; the engine shapes it. |
| **species** | The third level of the tree: a PEOPLE, with one signature skill. |
| **subspecies** | The leaf, and what every living thing actually is — a lineage of a people. Its template is the sum down its path. |
| **type** | The closed class at the root (humanoid, beast, construct, undead, fey, fiend, elemental, aberration). Sets the needs and the skill grammar. |
| **group** | The second level. Carries no stats: it decides the body plan, the habitat, who counts as kin, and what a law may bind. |
| **dominant kind** | The subspecies most of a world's towns are — what `folk` used to mean, except it is one of this world's own peoples. |
| **profession** | What a member of a crowd does, and so what it fights with: hunter, watcher, brute, raider. |
| **rank** | How good one is: whelp, ordinary, veteran. Stands in for the statblock role, which is what anchors the curve. |
| **prey** | The group a group hunts. A hunter rolls with advantage against it. |
| **profession** | What a member of a crowd does, and so what it fights with. Hunter, watcher, brute, raider. |
| **rank** | How good a member of a crowd is: whelp, ordinary, veteran. Stands in for the statblock role, which is what anchors the curve. |
| **prey** | The group a group hunts. A hunter rolls with advantage against it. |
| **way out** | A `Link` that is not a stair. Found in play, walked with `traverse`. |
| **declared trait** | A goal, shown with a progress bar. |
| **emergent trait** | A *recognition* of a play pattern, never foreshadowed — *"declared traits are goals; these are recognitions"* ([emergent.ts:10](src/play/emergent.ts:10)). |
| **temperament** | Stored wiring: intuition, feeling, nerve, discipline. |
| **needs** | Stored satisfaction: rest, food, safety, company, purpose. 10 is met. |
| **disposition** | **Derived** — how someone comes across, computed from temperament and needs. Not a stored field. |
| **drift** | How people change. Needs move fast; temperament only shifts when accumulated pressure crosses a threshold. |
| **gazetteer** | A compressed region. Geometry is gone; returning is an LLM *rehydration*, not a restore. |
| **tick budget** | The action economy. Replaced one-action-per-round so that being faster can mean something. |
| **fold** | Replaying the event log to rebuild `PlayState`. Synchronous, pure, and holds no `Provider` — which is why anything a model produces must be materialised into the record. |
