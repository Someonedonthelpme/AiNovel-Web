# DESIGN — status index

> Added 2026-09-06. Everything below this index is the plan file copied
> **verbatim** from `~/.claude/plans/`, where `plans/` sits in Claude Code's
> automatic-cleanup path and the file was roughly three weeks from deletion.
> Nothing was reworded, reordered or removed. Git keeps it now.

**How to read this file.** `THE ORDER` is authoritative. Four earlier orderings
survive further down and disagree with it — they are kept as history, not as
instruction. Status below was verified against the source tree on 2026-09-06,
**not** copied from this file's own claims, which are in places out of date.

## THE ORDER — verified against the tree

| # | Step | Status | Evidence |
|---|---|---|---|
| 1 | Ruleset skeleton, convert the constants | **shipped** | `src/rules/ruleset.ts` + `ruleset.test.ts` |
| 2 | Finish the persona, wire the islands | **shipped** | `world/subjects.ts`, `play/lore.ts`, `play/lorebook.ts`, reached from `server/game.ts` and `play/sheetaction.ts` |
| 3 | The component action system | **shipped** | `src/skills/effect.ts`; `ActiveKind` / `usesPerRest` survive only in comments explaining their removal |
| 4 | Relationships and rumour | **shipped** | `social/edge.ts`, `character/belief.ts` |
| 5 | The inventory rework | **shipped** | `items/shape.ts`, `items/parts.ts`, `items/refine.ts`; the last eight commits |
| 6 | World rules and strata | **shipped, less two** | five constraints across all four axes with real checkers; `forbids` per subject; Signets exempt (`Signet.exempts`); amendments as logged events (`WorldDelta.amendLaw`); the stratum layer — nesting, theme, loot, frozen floors, sub-strata a floor can open; depth split from adjacency, so a world can be a graph. **Left:** `crossFloors` has no enforcer and per-NPC rule knowledge no writer — both need NPC movement (step 8). No `story` kind, no `topology` knob (see ARCHITECTURE §14 for why) |
| 6b | Enemies after victory | **in progress** (user's call, 2026-09-11) | stage 0 fixed; stages 1–2 and 3a–3n-ii shipped; anchor plus delta 2026-09-13; **3o all-from-sheet planned, before 4**; re-planned 2026-09-12 (four-level taxonomy, group mechanics, species skills, NO mass foes — every foe is a character); design in [Enemies after victory](#enemies-after-victory--decided-not-built) |
| 6c | The persistent world — ownership, maps, building, crowds | **next after 6b** (user's call, 2026-09-11) | nothing built; design in [The persistent world](#the-persistent-world--decided-not-built) |
| 7 | Quests | **not started** | no quest module; `openThreads` still has readers only (`world/floorgen.ts:237`) — it remains a dead field |
| 8 | NPC agency | **partial** | `world/agenda.ts` exists and is imported by `play/rest.ts`; no scheduler |
| 9 | Companions, summon, shared combat machinery | **not started** | no matching module |
| 10 | The creation page | **partial** | `app/new/page.tsx` has point buy and the interview; not the two-phase redesign with presets and a rules view |
| 11 | The long tail | **not started** | — |

## Where this file disagrees with the code

- **`🏝 four cores … ALL GREEN, ALL UNREACHABLE FROM A TURN`** in *What is
  already done* is **no longer true**. `subjects`, `lore` and `belief` are
  reached from `server/game.ts` and `play/sheetaction.ts`; step 2 wired them.
  `shape` was wired by *"A bag has a shape, and shape.ts is reached from play at
  last"*.
- **`## Progress`** is self-labelled STALE and disagrees with *What is already
  done*. Trust neither — the table above was checked file by file.

## Superseded, kept as history — do not follow

| Section | Superseded by |
|---|---|
| `## Work in order` (under *Traits and Signets*) | `THE ORDER` |
| `## Work order` (under *THE RULE REALIZATION*) | `THE ORDER` |
| `## Work` (under *STEP 1b — EXPRESSING 5D*) | `THE ORDER`; its **decisions still stand** |
| `# THE PLAN` | `THE ORDER` |
| `## Progress` | the status table above |

## The live queue

`# NEXT PASS — under discussion, not yet a plan` and `## Also requested, not yet
designed` are where undecided work lives. Everything else marked *(decided …)*
or *(designed …)* is settled intent awaiting a step above.

## A note on method

Three checks used while building this table gave false answers before being
verified by hand: a filename grep implied `refine`, `belief` and `parts` were
undocumented when the concepts are covered under other names; a `grep ActiveKind`
implied a deletion had not happened when every hit was a comment describing it;
and a citation script reported blank lines as end-of-file. Verify the checker
before trusting what it reports.

## Enemies after victory — decided, not built

Moved here from `~/.claude/plans/so-what-happen-to-delegated-peach.md`, where it
was paused. Today `concludeCombat` discards the encounter: loot comes off the
FLOOR's table rather than the body, `region.creatures` is never depleted, and
`Person.alive` has no `false` writer.

Decided with the user:
- Encounter kinds `mass | notable | epic`; mass can escalate to notable mid-session.
- The model names a race; the engine keeps a closed nature. **One taxonomy**: a
  foe's nature IS its species (`character/species.ts`) — no second vocabulary.
- Notable and epic foes carry sheets.
- Parley is a full Director turn whose verdict is RECORDED into the action, so a
  fight stays one replayable event.
- Defeat is not death: `killed | yielded | fled | captured`.
- The ambusher gets the initiative edge.
- Survivors remember you, tell people, come back, and can be captured or recruited.

**Stage 0 — the ground it stands on** (verified 2026-09-11):
1. **Fixed `a52def8`** (`WorldDelta.startedBy`). Was: `drewOn` charged to the player on every `startCombat`
   (`play/delta.ts:458`), so an ambush costs standing for a fight you did not start.
2. **Fixed `41f53e1`** (the encounter asks the region's depth). Was: `kindForFloor(danger)` (`play/combat.ts:110`, and the fallback at
   `combat/encounter.ts:82`) feeds DANGER to a parameter meaning depth, so since
   step 6 "every tenth floor is a boss" means every tenth danger level.
3. **Fixed in stage 1** (`settleFight` re-folds the finished record from the pre-turn state). Was latent: live combat runs the turn pipeline (drift, deeds,
   traits) when the fight OPENS (`applyTurn`) and concludes outside it
   (`server/game.ts:649`); replay runs it after the fight ends. A spike found no
   divergence today, even with a trait on a kill threshold, because every
   consequence commutes. It stops commuting the moment a kill carries a
   consequence — so it is fixed first, before anything attaches to one.

**Decided with the user, 2026-09-11** (supersedes the stage list in the old plan file):

- **Only foes with a future persist.** A foe that fled, yielded or was captured,
  or that is notable or epic, becomes a `Person`. A dead mass foe becomes a tally
  and a fact, never a person — `world.people` is never compressed, so persisting
  every minion would grow the snapshot, the fold and the Director's context
  without bound.
- **Mass** foes are template × role × danger (today they are role × danger,
  `combat/statblock.ts:54`). **Epic** foes are a species plus one MUTATION — a
  boss or sub-boss, still an NPC foe. **Notable** foes are named people who
  existed BEFORE the fight: a person on the floor whose relationship with you has
  gone bad enough becomes the foe, and gets a sheet from their species template
  the first time they fight.
- **Species are a three-level hierarchy**, D&D-shaped:
  - **Type** — closed and authored: humanoid, beast, construct, undead, fey,
    fiend, elemental, aberration. Each differs mechanically through systems that
    already exist: need multipliers (a type with no safety need never yields or
    flees; with no company need it cannot be parleyed), an ability lean, how it
    behaves when losing. Today's four kinds map onto the first five, so their ids
    stay readable.
  - **Species** — 2–4 per type the world holds (the seed picks 3–5 types). A stat
    template = the type's lean + a seeded shift, SUMMING TO ZERO so no species is
    simply stronger, plus one signature skill composed by the skill composer from
    that lean. The model NAMES them (words only, one call at genesis, like subject
    naming): a high-fantasy world will say elf and dwarf; another world says its
    own words for the same shapes.
  - **Subspecies** — 1–3 per species, a small template delta (high-human,
    dark-elf, ancient-dwarf), also model-named.
  - **"Folk" goes away**: the seed picks a DOMINANT species for the town. The
    player's picker groups type → species → subspecies; "describe it" maps onto a
    subspecies. The player's species applies the same template.
  - Scale: at most ~60 entries per world, stored on the World.
- **Mutations are a `Variant`, not a trait**: `{ id, name, grant: NodeGrant }`
  from a closed authored list (grown, twisted, hungering, ancient, …). A
  subspecies and a mutation are the same shape — a delta on a template — for a
  population and for one individual. Traits stay what they are, EARNED by play
  from a per-player catalogue the fold must agree on; a born-with mutation would
  break both. Only the grant shape is shared (see *Traits and Signets: what a
  reward is* — `resist` and `discount` are not built yet, so templates start as
  ability shifts).

**Decided with the user, 2026-09-12** (supersedes *Species are a three-level
hierarchy* above, its scale line, and stage 9; spikes in the session that
decided it):

- **Four levels, every living thing at the leaf** — like *Homo sapiens
  sapiens*: **type → group → species → subspecies**. Types stay the eight closed,
  authored `TYPES`; the seed picks 3–5, then 2–4 groups per type, 1–3 species per
  group, 1–3 subspecies per species (spike: median 87 entries, 47 subspecies). The
  climber and every person carry a SUBSPECIES id; the levels above are derived.
- **No ~60 cap.** Nothing reads the whole list (the Director sees one person's
  kind, drift one kind, floorgen one id) and storage is a few KB. The real costs
  are the naming call and the picker; if naming is slow, name per type.
- **Leans are dynamic and pass down.** Type, species and subspecies each add a
  seeded delta on 2–4 stats summing to zero; a subspecies' template is the sum
  down its path. Nothing is fixed per type. **A group adds no delta** — its
  purpose is to categorise, not to be a step of evolution.
- **Disadvantage is allowed.** Fairness does not make a single-player game fun;
  a subspecies may be weaker. The one rule kept: the picker SHOWS each
  subspecies' template, so a disadvantage is chosen, never handed out silently
  (folk's −15 points was a trap because nobody chose it).
- **A group has five mechanics**, none of them stat math:
  1. **Body plan** — the slots a body has (hands, hooves, wings), overriding the
     ruleset's one body per world (`items/types.ts:30`): what it can wear and wield.
  2. **Habitat** — home biomes or strata; floorgen draws a floor's creatures from
     the groups that live there, and a pack is one group.
  3. **Kinship** — same-group people start with more familiarity and trust and
     pass news faster between them; other groups start cooler.
  4. **Law** — a group can be a law's subject (`forbids`), joining 6c's
     `territory` axis ("the hollow may not hold land").
  5. **Predator and prey** — an attack edge against a prey group.
- **Species have their own skill.** Type = the GRAMMAR (what kind of skill it
  may be — undead drain and frighten, a construct never heals); species = one
  signature skill from `composeSkill` (`skills/compose.ts:432`), keyed to the
  stat its template raises most; subspecies = a variant of it (budget or stat).
  **The AI does not use skills** (`combat/ai.ts` has none), so foes carry theirs
  unused until step 9 rebuilds the AI with companions — listed in the dead-field
  ledger until then.
- **The matchup chart** is subspecies against subspecies, a REPORT (`npm run
  chart`), not a pass/fail test — there is no fairness for a test to fail on,
  and cycles are not required. Fighters are built from SHEETS (`toCombatant` +
  template), because a foe's HP comes from danger and its `vit` would count for
  nothing. It runs on a build matrix (str melee, dex ranged, caster, tank) with
  the engine's own AI, not one fixed build taking its first option.

**Decided with the user, 2026-09-12, second pass — NO MASS FOES** (supersedes
*Mass foes are template × role × danger* above and the `mass | notable | epic`
encounter kinds; it restores *Crowds are description; individuation CREATES*,
which the 09-11 pass contradicted):

- **Two kinds of foe only: a character drawn from a crowd, and a notable
  character.** Nothing fights without being somebody. That ends the one exception
  to "every living thing is at a subspecies" and gives NPCs the parity of BEING
  the design already asked for.
- **A crowd is a population** — groups of (subspecies, profession, size) — and
  **populations are keyed by PLACE id**, not by region: 6c defines a province as
  one place with one map, so nothing migrates later. Compression destroys places
  (`Gazetteer` keeps only its summary, `world/types.ts:155`), so a compressed
  floor keeps one aggregate; 6c removes compression and the aggregate with it.
- **Killing thins the population** — the reader that stops the crowd being a
  simulation nothing touches. Clear a floor's wolves and later encounters there
  are thinner.
- **A boss is a notable character with a mutation**, created BY FLOOR GENERATION
  before you meet it (`Person.sheet` / `stance` / `recruited` are what it fills,
  `world/types.ts:209`). Then rumour can carry it, the Director sees a person,
  quests have something to point at, and 6c gets a holder to fight for a floor.
  One extra person per landmark floor, which is nothing beside persisting minions.
  `epic` stops being a third kind: it is a notable with a `Variant`.
- **Role becomes two things, both from the crowd**: **profession** (what they do
  — class, skills, gear: a hunter carries a bow) and **rank** (how good — a
  level offset and a gear tier: whelp, ordinary, veteran). `FOE_ROLES` and
  `HP_MULTIPLIER` (`combat/statblock.ts:18`) retire.
- **Gear tier IS refine · enchant · rarity** — no parallel ladder. A veteran
  carries a rare +4; loot off the body is that same object, so foe power and loot
  value are one number. Rank caps it (whelp common +0..1, ordinary uncommon ≤+2,
  veteran rare ≤+4, and no looted piece hands over a law exemption or a skill).
  Gear is DERIVED at individuation from (subspecies, profession, rank, danger)
  and stored only for a character who persists.
- **Two prerequisites, one a bug.** `nextInstanceId` is unique only within one
  bag (`items/types.ts:242`) and `addItem` assembles a NEW id, so looting a
  rare +4 renames it and its bonuses silently re-roll into other stats: ids must
  be unique per object and a transfer must preserve them. And looted gear must
  arrive USED (`instanceOf` defaults to `PRISTINE`), or foe gear skips the smith
  economy that `refineCost` and `enhanceCost` exist to be.
- **Balance is anchored, not re-guessed.** Today's curve is the target: a crowd
  character at rank r and danger d must fight like today's foe at the same
  danger, with `scripts/balance.ts` as the regression and the build-matrix
  harness measuring it. **To be reversed at stage 3o** (decided 2026-09-13, below):
  3n-ii measured the anchor as a made-up body balanced against a made-up body, so
  the target becomes a curve drawn sheet against sheet. Stands until 3o ships.
- **Names:** a crowd character is unnamed — "a young shadow-wolf", its
  subspecies plus a rank word — because the engine invents no words. A survivor
  is model-named at stage 7, as already planned.

**Decided with the user, 2026-09-13** (answers 3n-iii; supersedes *Balance is
anchored, not re-guessed* once stage 3o ships):

- **Anchor plus delta, now.** A REQUIREMENT CHANGE, stated side by side:
  - *Was (3n, `ae9fff7`):* a character foe fights with `scaleFoe`'s abilities,
    exactly — so it fights identically to a statblock foe, and the harness pin
    asserts the two curves EQUAL.
  - *Now:* a character foe fights with `scaleFoe`'s abilities PLUS its kind's
    template — what `makeFoe` has always given a statblock foe. The pin asserts
    the two curves agree within a BAND.
  - *Why:* 3n silently dropped the template, so for every world with kinds the
    subspecies a foe belonged to never reached the fight — it sat on the sheet
    and nothing read it. Found while checking whether stage 4 could stand apart:
    a boss's mutation is the same shape, a delta on a template, and would have
    been just as inert. Measured with paired seeds at 400 trials, the delta moves
    the two curves apart by −4.5 to +4.3 points with no consistent sign — which
    is what "holds on average, and the kind still matters" looks like.
  - *Rejected:* keeping exact equality (keeps a regression to pass a test), and
    going straight to all-from-sheet (floors 1–5 become a flat coin flip until
    the prerequisites in 3o exist).
- **All from sheet is the destination, as stage 3o.** No `scaleFoe`, no
  `referencePc`: a climber is a sheet, so a curve drawn sheet against sheet is
  the only one that describes the game anybody plays. Planned, not built — it has
  prerequisites, below.

**Stages** (each starts with one failing test the user approves; `npm run fight`
after any that touches a fight):

1. **Shipped.** **A kill is a deed** — `killed` is recorded for witnesses; the live path
   re-folds from the pre-turn state so live and replay agree by construction
   (stage 0.3). Decided with the user: one `killed` per fight, not per body, and
   it counts in an ambush too (unlike `drewOn`) — revisit at stage 6.
2. **Shipped.** **Whoever struck first acts first** — `startedBy: 'them'` gives foes the
   first action. Decided with the user: ambushers also spawn ADJACENT, because
   going first across the open arena only closed the gap and measured as a
   player advantage. Striking first gives the player no edge (not decided).
3. **Types and species templates** — split with the user, 2026-09-11:
   **3a shipped** (eight closed `TYPES`, a seeded template per species summing
   to zero INCLUDING the lean; today's ids kept) · **3b shipped** (`readSpecies`: a tolerant reader for
   stored worlds; an unknown untyped id throws) · **3c-i shipped** (the climber carries `speciesTemplate`, a `finalAbilities` layer; no choice means folk's) · **3c-ii shipped** (mass foes carry the template of a species picked from their name, `foeSpecies`) — its simulation found the humanoid lean costs every default climber 15–19 points of win rate; see the open question below · 3c-ii originally: templates reach mass foes, with a fight
   simulation (a zero sum can still be stronger in a fight: `str` outweighs
   `cha`) · the lean fix shipped (`27da4db`). **Re-planned 2026-09-12** after
   the four-level decision above; each is test-first:
   - **3d SHIPPED** the build-matrix harness (`src/play/harness.ts`) and
     `npm run chart`. Four bodies that cost the same (melee/ranged/caster/tank),
     a policy that CASTS rather than always swinging, a chart built from SHEETS
     so `vit` counts, and the melee curve recorded as the anchor 3n must not
     move. First numbers, 2026-09-12: melee 97/84/77/46/3% at danger 1/2/3/4/6,
     ranged 86/81/70/40/4, caster 94/93/91/90/0, tank 91/72/64/22/1.
     **Re-pinned 2026-09-12, 3n-ii:** those numbers are what 3d measured and are
     kept as the record; **3m moved them** and the doc was not updated, which is
     how "must not move" was violated without anyone seeing it. Checked out and
     re-run, `npm run chart` gives melee 97/84/77/46/3 at `397a454` (3d) and
     **96/86/83/40/5 from `aea03f9` (the prey edge) onward** — d3 up six, d4
     down six. **The live anchor is melee 96/86/83/40/5, ranged 85/83/70/36/4,
     caster 94/94/91/90/0, tank 88/76/69/21/2**, unchanged by 3n and by 3n-ii.
     Re-pin it in the same commit as any stage that moves it.
   - **3e SHIPPED** the tree: type → group → species → subspecies (flat on the
     World, parents before children), leans dealt per level and passed down, a
     group moving nothing, every person and the climber at a SUBSPECIES,
     `readSpecies` finding a stored id by dealing the same seed again and the
     five pre-tree ids still readable. Leans may touch any stat with a ±4 cap per
     ability, kept by REDRAWING a delta rather than clamping it, so a template
     still sums to zero. World 42 deals 40 subspecies. Three tests were
     RESPECIFIED (folk is no longer "the ordinary kind") and the harness curve
     re-anchored, because a world with no species list now gives its foes an
     empty body instead of folk's invented template.
   - **3f SHIPPED** `nameSpecies` (`character/speciesnames.ts`): ONE call for the
     whole tree, before the character call so the player's own description maps
     onto named kinds. Words only — the schema carries id and name and nothing
     else. A word for a node that does not exist is ignored, a repeated word is
     refused however it is cased, a skipped node keeps its placeholder, and a
     model that is down leaves a playable world with duller words. Ids never move.
   - **3g SHIPPED** `dominantOf` — a world's own ordinary kind, PEOPLE where a
     world has any (a town of beasts is a bestiary), seeded so the creation page
     and a replay agree without it being stored. It is what `speciesIdFor` weights
     80% toward and what a climber who chose nothing IS: nobody is left without a
     kind. The picker groups type → subspecies in collapsible sections and shows
     every body as words ("con −2 · str +2 · dex +1 · wis −1"), which is the rule
     that keeps a disadvantage chosen rather than handed out — verified in the
     browser. **Known gap:** the picker runs BEFORE genesis, so a lineage shows
     its id and its body but not its name; naming it earlier needs the world
     description, which the same page asks for later.
   - **3h SHIPPED** `character/speciesskill.ts`: a type is a FILTER over the stat
     grammar (a beast never bursts, the dead never mend), a species gets one
     signature skill from `composeSkill` at budget 10, a subspecies the same knack
     at 8 — the same idea bent, not a new one. The narrowing is absolute: where a
     stat and a type share no payload the answer is an empty grammar, and the
     KNACK narrows instead (the best stat its kind can actually use), so no
     creature is ever asked to compose from nothing. The climber sets out with
     theirs in `learned`, so `activeSkills` needs no new reader. Measured at +3/0/−1
     points of win rate at danger 2/3/4 — near free, partly because the harness
     policy prefers a skill over a swing unconditionally, which is its own
     weakness to fix. Foes carry none: `combat/ai.ts` cannot cast until step 9.
   - **3i SHIPPED** body plan (`character/bodyplan.ts`): four authored shapes —
     `upright`, `beastly` (no hands, no feet), `winged` (wings fill the BACK, so no
     pack), `serpentine` (no legs) — allowed per type, dealt per GROUP and
     inherited by its species and lineages, since a body plan is what the category
     is FOR. A plan REMOVES slots rather than declaring its own, so a world that
     adds a slot gets it everywhere and a plan that removes nothing is today's
     behaviour. Readers on day one: `body.ts` narrows the ruleset at both equip
     paths and at CREATION, so a handless climber carries its weapon instead of
     wielding it. A world stored before bodies keeps the world's body.
   - **3j SHIPPED** habitat (`character/habitat.ts`): a group lives in a DEPTH
     band, not a biome — `Region.biome` is a word the model invented for that floor,
     so a habitat keyed on it would be matching prose. Bands are SPREAD across the
     tower (each group centred on its share, jittered, then widened to cover that
     share) so every floor has something that really lives there: drawing freely
     left floor 1 and floors 25–30 empty and only a fallback hid it. Reader:
     `foeSpecies` picks the encounter's group from the ones living at that depth,
     and **a pack is one group** — every creature in a fight comes from one
     population, its lineage still keyed on the model's name for it.
   - **3k SHIPPED** kinship (`character/kinship.ts`): three distances, and the
     middle one is the point — same GROUP is kin (`familiarity +1, trust +1`),
     another group of the same TYPE is a neighbour (nothing, because people are
     people), another TYPE starts cooler (`trust −1`). Two readers for one rule:
     toward the player, so how a town meets you is felt on the first turn through
     the register, and BETWEEN kin, because rumour walks edges (`spreadOf`) — so
     news runs through your own sort first with no second mechanism. Wired at
     genesis UNDER the model's own opening trust, since what it said about this
     person outweighs what their sort would say.
   - **3l SHIPPED** law: `Binding` gains `{ group }`, so a law can be written about
     a KIND of being — "the hollow may not take from the tower" — and it binds
     whoever IS one, player or resident alike, since that is a rule about what
     somebody is rather than where they were born. The vocabulary stays closed the
     way it must: a group id belongs to the world, so `validateDelta` refuses a
     group no world holds AND refuses a species, because law binds a group like
     body, habitat and kinship do. `playerSubject` carries the climber's group;
     `amendGroup` gives the Director the writer, and the brief lists the ids or a
     guess would just be refused. 6c's `territory` axis adds *what* can be
     forbidden; this is *whom*.
   - **3m SHIPPED** predator and prey (`character/prey.ts`): about one group in
     three hunts one other group, always of another TYPE, seeded. The edge is
     ADVANTAGE, not a bonus — a flat `+n` to hit has no reader in `resolve.ts`,
     which is why `treeBonuses.attack` has been dead since it was written — read in
     `attackModifiers` from two new combatant fields, `group` and `hunts`, carried
     in for the player and for every foe. Measured 46% → 79% between otherwise
     identical fighters, which is far more than any template can say and the reason
     a chart beats a ladder. The picker marks a hunted lineage, because an edge
     that large handed out silently is the trap 3g exists to prevent.
3n. **Every foe is a character** — **SHIPPED in part, 2026-09-12.** A foe is drawn
   out of the floor's population (`character/crowd.ts`): a lineage, a PROFESSION
   (what it fights with) and a RANK (whelp · ordinary · veteran, pinned to the
   `FOE_ROLE` it replaces), built as a sheet with derived gear on its body and its
   kind's knack on its sheet. `FOE_ROLES` survive as the anchor rather than as the
   foe. A world stored before kinds still meets statblock foes, since inventing a
   population for it would be inventing the bodies of creatures somebody is already
   fighting.
   **What the curve cost, measured:** built from the sheet alone a danger-1 fight
   fell from 95% to 53% (damage, AC, proficiency and abilities all came from the
   trade and its gear); anchoring hit points alone left it at 75%. `scaleFoe` now
   decides what it is like to FIGHT — hp, ac, proficiency, abilities, attack,
   speed — and the character decides WHO it is: kind, group, prey, knack, gear to
   loot. A harness test pins every cell equal so nobody moves it silently.
   **3n-ii SHIPPED, 2026-09-12, except the curve.** Populations are stored per
   PLACE (`character/population.ts`) — cohorts of (subspecies, profession, size),
   derived from the seed until the first kill writes them down, so no migration
   and a world nobody has killed in stores nothing. The draw comes from the
   cohorts weighted by size, the composition is capped by who is left, and a
   place cleared out opens NO fight; a foe carries its cohort (`Combatant.kind`,
   `trade`) so the dead can be taken out of it. Compression folds a floor's
   places into one aggregate keyed by region id, since place ids are the model's
   words and come back different. The word and the body now agree: the name
   FOLLOWS the lineage, and a lineage no creature word covers wears its own kind.
   Gear is solved against the anchor rather than tuned (`gearFor`), so what is
   on a body scales with depth and is what you would loot; ids are namespaced so
   `give` can hand an object over without renaming it and re-rolling its
   bonuses; and it arrives USED.

   **Left for 3n-iii — re-deriving the curve from sheets. Measured 2026-09-12:
   NOT REACHABLE, and the reason is a design decision, not an implementation.**
   Decided with the user that the anchor is the WIN RATE, not per-foe numbers —
   and the win rate still cannot be held, because `scaleFoe`'s shallow end
   describes things that are not people. Three independent walls, each measured:
   - **Hit points.** A danger-1 minion has 2 and a regular 8; the frailest
     level-one body is `HP_AT_FIRST` 10, about 12 with any `vit` at all.
   - **What it swings.** A shallow foe swings 3.5 a hit; the weakest melee thing
     the catalogue makes is a d6, and in the hands of anything with a positive
     ability mod that is 4.5 — so damage per ROUND floors at 2.25 against an
     anchored 1.57. Solving to the nearest gets no closer; there is nothing
     closer.
   - **Reach.** Minimising damage alone armed nearly every body with a SLING,
     because a d4 is the closest thing to a shallow swing — and foes that used
     to spend two rounds crossing the arena opened fire on round one. That cost
     thirty points of win rate with every printed number matching within one.
     Fixed by filtering candidates to the trade's reach; recorded because it is
     the clearest evidence that per-term matching is not what a fight measures.
   With AC solved to within two, damage per round to the nearest reachable, and
   hit points still anchored, the curve measured **76/64/48/35/26** against the
   anchored **94/86/84/47/36** (melee, at `expectedPcLevel` per depth, 200
   trials). Handing back hit points as well — every number from the sheet — gives
   **59/59/57/42/19** (re-measured 2026-09-13; the 65/65/63 first written here
   came from a solve that still armed foes with slings). Fielding only whelps
   below danger 6 barely moves it — **61/61/63/57/62**, then 4% at danger 6 — because
   the wall is the level-one BODY, not its gear: a whelp and an ordinary are both
   about 12 hit points at the shallow end.

   So `scaleFoe` still decides hit points and the fight, and the character
   decides who it is and what is on it to take. **The user's call, at 3n-iii:**
   (a) re-tune `scaleFoe`'s shallow end to what a character can be and accept
   floors 1–5 getting about twenty points harder, re-measuring `balance.ts`, xp
   and loot pacing against the new curve; (b) keep hit points anchored and
   accept the same twenty points; (c) leave it as it is, exactly anchored, and
   let a foe's own numbers stay what it is worth rather than what it fights
   like. Shipped today is (c). A fourth exists and is bigger: the curve is drawn
   against `referencePc`, which gets up to 4d8 of damage and AC 14–18 from
   nothing but its level — a body no character sheet can be either. The curve
   assumes a player no sheet describes and foes no sheet describes; fixing one
   end without the other is what makes every option above cost twenty points.
   **Answered 2026-09-13:** none of the three. *Anchor plus delta* now (the kind's
   template back on top of the anchor), and the fourth option — everything from
   the sheet, on both sides — planned as stage 3o. See the 2026-09-13 block above.

3o. **All from sheet** — planned 2026-09-13, not built.
   - **What:** a fight between a climber and a foe is decided by their two sheets
     and nothing else. `scaleFoe`, `referencePc` and `scripts/balance.ts` retire;
     the character foe's override in `crowdFoes` is deleted rather than patched.
   - **Why:** the anchored curve is a made-up player (`referencePc`: 4d8, AC 14–18
     from level alone) balanced against made-up foes (`scaleFoe`: a danger-1
     minion with 2 hit points). Neither is a body the game can hold, so the curve
     describes nothing a player meets. And every mechanic that lives on a sheet —
     template, mutation, gear, knack — only bites when the sheet fights.
   - **Measured, so nobody flips it as a flag.** Everything from the sheet today
     gives melee 59/59/57/42/19 at danger 1–5 against the anchored 94/86/84/47/36;
     a tank wins 33% on floor 1. Fielding only whelps below danger 6 barely helps
     (61/61/63/57/62) — the wall is the level-one BODY, about 12 hit points
     whatever its rank — and the curve goes flat then drops to 4% at danger 6.
   - **Prerequisites, in order:**
     1. **The chart measures character foes.** `npm run chart`'s build matrix
        calls `measure` without `kinds` (`scripts/chart.ts:23`), so it has only
        ever measured STATBLOCK foes: every "chart unchanged" said about a crowd
        change measured nothing. Point it at a world's kinds first, or 3o has no
        instrument.
     2. **The harness climber gains gear with depth.** It carries one fixture
        weapon for ever, so past about danger 5 every build reads 0–6% and the
        number measures an under-equipped player. Deep floors cannot be judged
        until it gears up the way a real climber does.
     3. **A frailty dial for bodies that are not climbers.** The one thing rank
        cannot do: make a shallow creature frailer than a level-one climber. Still
        a sheet rule — e.g. a crowd body does not get the first level's hit-point
        grant, or a shallow crowd fields small bodies — so it is "from sheet" with
        a rule separating a rat from a climber.
   - **Decided:** the destination; the three prerequisites; that it reverses
     *Balance is anchored, not re-guessed*; that `balance.ts` retires with
     `referencePc` rather than being kept as a second, contradicting regression.
   - **Open, for the user:** **what should a level-one climber's win rate on floor 1
     be?** Today's answer is 94%. That number is 3o's first approved assertion;
     the shape past it (how fast it falls, where the cliff is) follows from it.
   - **Done means:** `crowdFoes` builds no `scaleFoe` stats; `referencePc` and
     `scripts/balance.ts` are gone; the chart's matrix measures character foes
     against a climber who gears up; and the build matrix sits within the band the
     user approves at every danger it covers.
4. **Bosses are notable characters with a mutation** — created by floor
   generation, so they can be heard about first. (Was: epic foes.)
5. **Notable foes from existing people** — a person whose regard has gone bad
   enough fights you; `Person.sheet` gets its other writer.
6. **Defeat is not death** — `killed | yielded | fled | captured`, resolved by
   the engine from HP, nerve and nature; `alive: false` and `spared` get writers.
   Now that every foe is a character it HAS a persona, so nerve is real here
   rather than deferred: a fearless thing never breaks, and a type with no safety
   need cannot. A first cut of the rules: breaking at a quarter of max HP, yield
   when cornered and flee when not.
7. **Survivors with a future** — become people (model-named, recorded in the
   turn), keep a firsthand belief and a grudge, and the rumour system carries
   their account; a returning survivor covers "mass escalates to notable".
8. **Parley** — a Director turn inside a fight, its verdict recorded in the
   action so the fight stays one replayable event.
9. ~~**Subspecies** — deferred until a world needs them.~~ Folded into stage 3
   (2026-09-12): every living thing is at a subspecies.

**Out of scope here:** recruiting stops at a `stance` of *willing to join*;
joining the party is step 9 (companions).

**Objections recorded:** 60 templates can read alike even when their numbers
differ — accept, revisit with real worlds. **Open (measured 2026-09-11, 3c-ii):**
a zero-sum template is not fight-neutral. The humanoid lean `cha +2 / vit −2`
cost a default climber 1 max HP (11 → 10.2) and 15–19 points of win rate at
danger 1–4 over 300 seeds; `vit` is the only source of HP, so any lean touching
it swings a fight hard. Decided with the user: leans and shifts trade within a group (body `str dex agi`, mind `con int wis cha luk`) and never touch `vit` — folk went from −15..−19 to −1..−5. Body leans were still uneven (`agi −2` costs 5–9 points, `agi +2` gains ~1; `str` gains 3–15).
**Open after 2026-09-12:** whether that body/mind/no-`vit` rule survives
dynamic leans now that disadvantage is allowed (the spikes let a lean touch any
stat, and reached ±6 on one ability of a subspecies); and whether a subspecies
gets a per-ability cap. Parley is the only stage that puts a
model call inside a fight, which is why it is last and the rest stand without it.

## The persistent world — decided, not built

The user's inspiration: manhwa towers that are a PERSISTENT world, where places
can be owned and negotiated for; Ragnarok Online's map screens; D&D battle maps;
Paradox's recursive provinces. Decided with the user, 2026-09-11. Ordered after
6b, before quests.

**The player is a climber who can come to own places** — not a trader, not a
ruler of nations.

### 1. Ownership
- A holder (a person, or the player) on a **province, a floor or a stratum**.
  Which levels can be owned at all is the world's LAW, in a closed vocabulary on
  a new `territory` axis (who may hold land, who may build).
- Acquired by **negotiation** (the Director proposes; the engine checks trust,
  standing and a coin price), **conquest** (6b's defeat outcomes against the
  holder), or **reward** (quests, step 7).
- Every settlement has an NPC holder from the start, so negotiating is dealing
  with a real person with trust, grudges and beliefs.
- **First reader, on day one:** a long rest requires a settlement on floor 0
  (ARCHITECTURE §10). A settlement you hold is a place you can long-rest — a base
  halfway up the tower.

### 2. Maps — the Ragnarok model
- **Every province is one grid map**, joined to its neighbours at PORTALS. The
  existing place graph IS the portal list, so the Director still picks from
  connected places and the engine pathfinds the tiles.
- **Bigger levels are coarser grids**: a floor is a grid whose cells are
  provinces. One grid type at every scale; an interior is a finer grid.
- **Maps are drawn by the engine from the seed and the place's id, never
  stored.** Only changes are stored (what was built, what fell, who died where).
  The model names and themes zones and never draws tiles — it counts and keeps
  adjacency unreliably, the same reason it never sets a stat.
- **Distance is travel time**, so crossing a big forest costs turns and needs.
- **Combat happens on the local map** (decided), in a window around the player.
  **Objection:** balance was measured on fixed open arenas; the window needs a
  size clamp and `npm run fight` re-measured.
- **Objection: text-first becomes map-first.** The grid sits UNDER the graph, so
  nothing in the Director or validation changes — but pacing and UI do.

### 3. The administrative hierarchy — the Paradox model

| level | spatial | administrative |
|---|---|---|
| tile | a cell on a province's grid | — |
| province | one place, one map | holder, crowd, buildings: the atomic unit |
| floor | a coarse grid of provinces | a group of provinces |
| state | — | a stratum |
| region | — | a parent stratum (strata already nest) |
| world | the whole graph of maps | the root |

- Floors are never MERGED into one region: a region keeps one depth, because
  danger, budgets and depth XP key on it. Combining floors means combining
  AUTHORITY — travel, market, government — at the stratum level.
- Laws, markets and holders resolve **innermost-wins, else inherit up** — the
  rule `stratumAt` and `dangerAt` already implement (`world/strata.ts:13`, `:51`).
  Laws gain a scope; today they are world-level only.
- **Stratum membership becomes "these regions"**, with a floor range kept as the
  stack shorthand — a floor range cannot group the outer world's sideways
  regions, which share a depth. The same split adjacency already went through.
- **Objection: the two trees must never disagree.** A province belongs to exactly
  one floor, a floor to exactly one innermost stratum, checked at generation the
  way `validateRegion` checks a map.

### 4. Building
- A closed, law-gated verb: build a settlement on free cells in territory you
  hold, for coin and materials.
- **Objection, and it decides the design:** a compressed floor is REBUILT by the
  model from its gazetteer, which would erase what the player built. Built
  things are stored as diffs on the seeded map and handed to any rebuild as
  fixed canon.

### 5. Crowds, markets and government — the Victoria model
- **The crowd is the compressed form of people** — a population group (species,
  profession, size, pooled needs) per province. A named person is drawn out of a
  group when they start to matter and returns to it when they stop; a dead mass
  foe shrinks one, a survivor with a future is drawn from one.
- **Markets** for a few goods per province, priced by what groups produce versus
  need. Readers: coin (earned everywhere, spent almost nowhere), `Item.value`
  (dead, "there are no shops"), and the price of rations — the difficulty curve.
- **Government**: interest groups by profession; whichever holds a place's power
  gives `amendLaw` its CAUSE.
- **Off-screen ticking waits for step 8's scheduler.** Until then a place moves
  only while you are in it and catches up in one closed-form step on return, as
  compressed floors already do.
- **Objection recorded:** a simulation with nothing the player does to it is the
  dead-field bug at system scale. Every stage here names its reader first.

### 6. The outer world
A graph-topology structure, not `floor-0` — already decided in *Tower decisions
(2026-09-04)*. Needs stratum membership by region (§3).

### 7. The 3D map
A view. The engine only knows the graph and the grids; 3D is a height map of
tiles with floors stacked. Last.

---

# THE ORDER — authoritative, re-derived 2026-09-05

**This supersedes every other ordering in this file.** Four had accumulated
("Work in order", "Work order", "Work", "THE PLAN"), each written before the
next round of design, and they now disagree. Read this one.

## What is already done

```
✅ replay hole      a climb is a logged event; the fold rebuilds the floor
✅ persona core     temperament + needs stored, disposition derived,
                    writer proof (caught 4 bugs on its first run)
✅ physical layer   AC from AGI · VIT soaks, resists and heals · STR carries
                    · speed derived · flat DR measured and rejected
✅ three fixes      pools survive fights · trait notes shown · Signets claimable
✅ sheet panel      one modal, six tabs
✅ ARCHITECTURE.md  + the ~20-entry dead-field ledger
🏝 four cores       shape · instance/components · subjects+lore · belief
                    ALL GREEN, ALL UNREACHABLE FROM A TURN
✅ step 3           component effects: the eight-arm union decomposed, a skill
                    is a LIST of {sign, channel, who, shape, duration, formula}
                    each tagged purpose or cost · ActiveKind, usesPerRest,
                    skillUses and Skill.kind deleted · budget buys EFFECTS now
                    that it no longer buys uses · per-axis allow-lists (`obeys`)
                    + the forbidden-pair table · frightened priced · ONE SIGNED
                    SUITABILITY BUDGET off temperament, dialled by
                    `persona.suitSwing` · three special verbs made real
                    (interrupt, cleanse, taunt; displace held back for want of
                    a grid in the resolver) · scripts/ joins the typecheck and
                    all eight build.  888 tests, 0 failing.
                    DEFERRED to step 4: WorldDelta-as-effects — see below.
```

### Step 4 progress

```
✅ 4a edges        directional, sparse, formed on interaction · Person.trust
                   deleted · registerConsequence revived (it had ZERO callers)
                   and writes four axes · writer proof over every axis
✅ 4b roles        pairs, so the converse is structural · 11 authored templates
                   with closed obligations/permissions/defaults · the world
                   names both ends · matrilineal and oath-sibling both work ·
                   generators propose bonds; the Director is told what each
                   obliges and allows
✅ 4c deeds        witnesses → propagation → reputation · spreads along the
                   SOCIAL graph bounded by degrees of separation · each hop
                   retells (belief.ts wired at last) · guilt and obligation get
                   their writers · Gazetteer.reputation gets its FIRST writer
✅ 4d ambient      a PLACE knows a thing to a degree, nobody modelled · creeps
                   along the map so geography decides what got around · an
                   empty place carries nothing onward · the air CLEARS, since
                   gossip is not memory · anyone present inherits what they do
                   not already know, and their own belief always outranks it
✅ 4+ certainty    Person.beliefs had no reader; the Director and Writer are
                   told what each person THINKS you did and how sure, phrased
                   as belief and never as fact
✅ 4+ delta.deed   the Director NAMES a deed and the mark prices it — the
                   `useItem` division, and `helped` is the act no rule can see
```

**STEP 4 IS DONE.** Still open and named as such: `desire` and `envy` have no
substrate (no NPC drives, no NPC possessions) and arrive with agency or the
economy; `loyalty` arrives with companions; role `lifecycle` arrives when a
deed can end a bond; ambient inheritance is not yet filtered through the
person, which needs `Person.tags` to mean something.

### Why `WorldDelta` did NOT become a list of effects — SETTLED

Deeds are the second producer, so the question could finally be answered on
evidence rather than predicted. It should not, and here is why.

Both producers already speak ONE vocabulary — `Partial<Record<EdgeAxis, number>>`
through `nudgeAll`. That is the shared consequence vocabulary the design asked
for; it simply is not spelled `Effect`.

The `Effect` components are dead weight for a Director's flat answer and
valuable for a SKILL: a social `burst` is everybody who saw it, and a formula
can scale off the caster's nerve. So the `edge` channel joins `Effect` on the
day a skill can produce one, and not before — adding it now is a channel
`resolveSkill` cannot resolve, which is exactly the bug `verbs.test.ts` catches.

And `delta.trust` being trust-only is CORRECT. Trust is the one axis a model can
judge. Respect, resentment, fear, guilt and obligation are earned mechanically,
by the register and by deeds; letting the Director set them would be a model
deciding an effect.

### The old reasoning, kept for the record

Six of its ten verbs (`moveTo`, `revealExit`, `startCombat`, `useItem`,
`equipItem`, `rest`) are COMMANDS, not consequences: they name an action to
take, not a channel and a magnitude. Of the channels the shared vocabulary
would need — trust, temperament, needs, knowledge, quest progress, control —
only `trust` has a reader today, and the Director's schema is deliberately flat
(`trustPerson` + `trustChange`, sentinels rather than nullables) precisely so
the model never authors an effect.

So converting now would buy a shape and no behaviour, and would put effect
components in a model's output — the one thing this codebase does not allow. It
lands with **step 4**, where the relationship edges give the other channels
their readers, and the flat Director schema translates INTO effects rather than
emitting them.

## The principle this order follows

1. **Never build a fifth island.** Four subsystems are tested and reachable
   from nothing. Every foundation step is now followed by wiring it into
   something a player meets.
2. **The original ask does not stay last.** The first request of this whole arc
   was a component-based skill system. Personality got built; components drifted
   behind a dozen newer systems. It moves up.
3. **Chokepoints first, but only when ripe.** The `Ruleset` and the relationship
   edges are what most things need. The Ruleset is ripe now precisely because
   the last several sessions established what its parameters are.

## The order

**1 · Ruleset skeleton, and convert the constants.**
`Ruleset` on the `World`, named presets resolving to parameters, `ruleFor`
resolver. Then turn today's constants into lookups with today's values as the
default preset. Verification is the point: **the whole existing suite must pass
unchanged**, which proves it is a refactor rather than a redesign. Ships nothing
visible; stops every later decision landing as another hardcoded default.

**2 · Finish the persona, and WIRE THE ISLANDS.**
`drive` structured from the interview answer that is already collected and
discarded · preferences · declared/actual archetype · age band · body. Then hang
lore on generated items, make reading one an action, and tell the Director and
Writer who the PC is — today they know less about you than about any villager.
Turns `subjects`, `lore` and `belief` from islands into a working loop, and
proves persona → subject → need end to end.

**3 · The component action system.** *(the original ask)*
One shared consequence vocabulary; `WorldDelta` becomes a list of effects;
per-axis allow-lists plus a forbidden-pair table; the SIGNED suitability budget
reading the persona from step 2; `ActiveKind` and `usesPerRest` deleted;
`frightened` priced; special verbs (displace, interrupt, taunt, grid, tempo,
protection). Fixes the broken `skillgen.ts` on the way past.

**4 · Relationships and rumour.**
Sparse directional edges with generated roles and their six primitives ·
witnesses → propagation → reputation, which finally writes
`Gazetteer.reputation` · ambient knowledge per place, carried by traffic. Wires
the belief core, and unblocks factions, trade, companions and agency.

**5 · The inventory rework.**
Named bags · nested containers · ruleset-defined gear slots · the grid UI and
the data tab · durability and repair · refine, enchant and enhance. Wires
`shape` and `instance`. Large, but self-contained now that both cores exist.

**6 · World rules and strata.**
The four rule axes, each rule naming who it `binds` · amendments as logged
events · **Signets as rule exemptions**, giving `Signet.grant` its first reader
in three commits · nested strata · static floors as frozen generation events ·
danger decoupled from depth · wire `descend`.

**7 · Quests.** The step graph on `TraitCondition[]`; stratum arcs, NPC
purposes, tower trials, PC-authored tasks. `openThreads` gets a writer.

**8 · NPC agency.** The static/reactive/live scheduler, promoted by proximity,
stakes and contact within degrees of separation · decisions logged, not
recomputed · spawning as a standing cast plus arrivals · crowds individuating on
contact · `agenda.ts` revived.

**9 · Companions, summon and the combat machinery they share** — a non-player
combatant on your side, ally AI, mid-fight initiative insertion, the `guard`
redirect hook, `dominate`.

**10 · The creation page.** Two phases, three doors on every input, presets as
whole opening scenarios, the rules view, 9-stat point buy. Last because it needs
all of the above.

**11 · The long tail.** Economy and crafting · factions · law and crime ·
weather, ecology, disease, persistence · species · language and culture ·
death/continuation, ascension rank, carryover · sheet visibility · Director
permissiveness.

## What changed, and why

- **Component effects moved from buried to third.** It was the original request
  and had drifted behind everything designed since.
- **Persona wiring is bundled with persona completion.** Previously they were
  separate steps, which is how four islands happened.
- **Relationships promoted.** I had them scattered across rumour, factions and
  companions; they are a single chokepoint that all three need.
- **Inventory consolidated into one step**, from four scattered ones (gear
  slots, durability, shapes, panel).
- **The Ruleset stays first**, with a better reason than before: it is ripe now,
  because the last several sessions are what established its parameters.

## Standing debt, folded into whichever step touches it

`tsconfig.json` excludes `scripts/`, which is why three of eight scripts broke
silently across two migrations — fix with step 3, which touches `skillgen.ts`.
The ~20-entry dead-field ledger in `ARCHITECTURE.md` is the running list;
each entry names the step that gives it a reader.

---

# Purging classes and disciplines: a stat-driven progression system

## Context

The previous plan — recreating skills, Signets and traits as generation — is
**complete and committed** (commits `1be363b` through `b16c59e`). This plan
replaces it.

Everything in this game is now generated per world: the tower, the background,
the people, traits, Signets, skills, and as of the last commit the classes
themselves. **The twelve disciplines in
[archetypes.ts](src/play/archetypes.ts) are the last hardcoded-fantasy thing
left**, and they break the moment a player describes a world that is not
fantasy. `magic`, `blackMagic` and `flame` are nonsense among rusted freeways —
we generate a `Data Sifter` with a `Signal Rifle` and then hand them a skill
tree made of spellcraft.

Stats do not have that problem. INT is figure-work in a kingdom and electronics
in a wreck; the mechanics are identical and only the words change. Stats also
unlock a combination the discipline system could not express: **the same effect
delivered by a different stat is a different thing.** A `hinder` on STR is
pinning someone; a `hinder` on CHA is getting under their skin. One payload,
nine flavours, chosen by the build rather than by a category.

So: **disciplines** are deleted outright, along with existing saves. Stats
become the axis the whole progression system turns on.

**Classes and subclasses survive**, generated per world as they are now — but
they stop gating disciplines and start leaning on stats. That is the important
correction to an earlier draft of this plan, which deleted them: a class is what
makes two characters with similar spreads still feel different, and the level-3
subclass choice is the one deliberate branch point in the whole progression. Both
were worth keeping; only their *mechanism* was tied to disciplines.

**Explicitly out of scope, flagged for a later pass:** improving combat. AGI's
attack-speed and DEX's cast-time have no meaning in the current turn-based d20
engine, and `speed` is movement squares. They get provisional jobs that work
today (below) and the real treatment comes with the combat pass.

---

## The stat sheet

Nine stats, from [statmean.md](statmean.md), with the CON/VIT collision resolved
as agreed — CON is mind and endurance and grants **no HP**, VIT is body.

| stat | what it does |
|---|---|
| **STR** | melee power, carrying, forcing things |
| **DEX** | accuracy (hit), damage consistency |
| **CON** | concentration, poison, disease, death saves, fatigue — *no HP* |
| **AGI** | initiative and evasion *(ASPD deferred to the combat pass)* |
| **VIT** | max HP, HP recovery, physical DEF, stun resistance |
| **INT** | reasoning, figures, machines — whatever this world's "worked power" is |
| **WIS** | perception, insight, reading a room |
| **CHA** | confidence, influence, getting under someone's skin |
| **LUK** | crit chance, loot quality, and a bounded nudge on rolls |

`ABILITIES` in [combat/types.ts](src/combat/types.ts) goes from 6 to 9. Point
buy needs re-costing — 27 points across 6 stats does not stretch to 9; start at
**40** and tune by playtest.

---

## The design

### 1. The stat supplies the grammar

The single most important piece. Discipline grammar was the only thing stopping
generated skills from being "a bow that heals" — coherence is the hard half of
generation, not balance. **That job moves to the stat**, in a new
`src/skills/statgrammar.ts` shaped exactly like the existing `Grammar` type in
[compose.ts](src/skills/compose.ts), so `composeSkill` needs no change:

```
STR   strike, hinder(grappled/prone), burst(shove)     range 1
DEX   strike, hinder(restrained/blinded)               range 8
CON   mend(self), edge                                 range 0
AGI   strike, hinder(prone), edge(evasion)             range 2
VIT   mend, rally, edge                                range 1
INT   burst, hex, edge                                 range 8
WIS   mend, hinder(blinded), rally, edge               range 4
CHA   rally, hinder(frightened), drain, edge           range 6
LUK   drain, hex, edge                                 range 4
```

Setting-agnostic by construction. INT's `burst` is a fireball or a breaching
charge depending only on what the world is called.

### 2. Paths are world-generated names over stat pairs

A **path** replaces a discipline. It is a name and flavour fitted to the world
by the model, plus the one or two stats it runs on, decided by code. Exactly the
split that made generated classes work — see
[classnames.ts](src/character/classnames.ts), which this mirrors closely enough
to reuse its structure and its fallback discipline.

```
fantasy   Swordwork STR · Figures INT · Field Craft WIS · Physick VIT
sci-fi    Breaching STR · Cybernetics INT · Recon WIS · Field Medicine VIT
```

A world generates a pool of **10–12 paths**. The mechanics underneath two
worlds' paths are the same; the words are not.

### 3. Stats gate which paths are open, and they re-check as you level

This is what replaces `core` / `affinity` / `forbidden`, and it is strictly more
dynamic because a class is fixed at creation and a stat spread is not.

- Every path declares a **stat threshold** to open.
- **3–4 paths are open at the start** — the ones your creation spread qualifies
  for. That is the answer to "how many branches on start": comparable to the 5–7
  the tree opens with today, deliberately a little tighter so growth is visible.
- The rest are on the tree but **sealed**, showing the stat they want. Raise INT
  to 14 and the figure-path opens mid-run.
- Sealed *roots* are visible on purpose — a stat threshold is a goal, and goals
  may be shown. Everything behind the root stays hidden until the root opens.

`SkillNode.requires?: TraitCondition[]` already exists and already supports
`{kind:'ability'}` and `{kind:'carries'}`, and unmet nodes are already not
drawn. **The gating needs almost no new type work** — only generation that uses
what is there.

### 4. Nodes gate on stats and on gear

The combination the request asked for. Node requirements draw from:

- a stat threshold (`ability`, exists)
- carried or equipped gear (`carries`, exists; add an `equipped` condition kind
  for slot/damage-type gates such as "a bludgeoning weapon in hand")

Items already carry `slot` (`weapon`/`armour`/`trinket`), families and floor
provenance ([items/types.ts](src/items/types.ts)), which Signets already gate
on — so the foundation is there.

### 5. A class LEANS on stats; it no longer locks disciplines

Classes keep generating per world exactly as they do now — the machinery in
[classgen.ts](src/character/classgen.ts) / [classbuild.ts](src/character/classbuild.ts)
/ [classnames.ts](src/character/classnames.ts) is reused wholesale. What changes
is what a class *declares*:

```
BEFORE   core: [sword, guard]        always on the tree
         affinity: [survival, bow]   drawn at ~70%
         forbidden: [magic, flame]   never, at any price

AFTER    favours: [STR, VIT]         paths on these open EARLIER, and
                                     creation points are weighted here
         against: [INT]              paths on these need MORE stat
```

**Stat thresholds, not booleans.** A favoured path opens at a lower stat than
normal; a path the class leans against needs more. Nothing is impossible — it is
priced. That is deliberately softer than the old hard `forbidden`, because a
boolean lock is what made classes rigid, and because "raise the stat far enough
and you get there anyway" is the whole promise of a stat system.

`favours` and `against` name **stats, not paths**. Stats are a fixed enum of
nine; paths are generated per world. Keying the class to stats means a class can
never reference a path id that a regenerated pool no longer contains — the same
orphan-proofing that put `classSpec` on the sheet.

`roles.ts` survives, reworked: a role declares stat shapes rather than
discipline shapes (a front-liner favours STR/VIT and leans against INT).

### 6. A subclass is a waiver, and that is the level-3 decision

The `cross`/`deepen` split earns its keep here, better than it did before:

- **cross** — unseals one path **without paying its stat gate at all**. This is
  the genuine shortcut: an INT-8 brawler who takes the right subclass walks into
  the figure-path anyway. It is the only way to hold a path your spread cannot
  justify, which is exactly what made an island worth finding.
- **deepen** — a path you already hold grows further, and its later nodes come
  cheaper.

So level 3 is still specialise-or-broaden, and it is still the one thing on the
tree you plan for. `Subclass`, `SUBCLASS_STAGES` and the stages at 3/6/10 all
stay; only `opens: ArchetypeId` becomes a stat plus a route.

---

## What dies, what survives

**Deleted outright:**

```
src/play/archetypes.ts       the 12 disciplines, their grammars,
                             their 24 authored signature skills
src/character/classes.ts     the AUTHORED eight and their sixteen subclasses
                             (the generated ones replace them entirely)
```

Plus every discipline-shaped field: `SkillNode.archetype`,
`GraftSpec.archetype`, `archetypeForBackground`, `AFFINITY`,
`MIN/MAX_DISCIPLINES`, `keystoneTrade`'s twelve-way switch, and the
`core`/`affinity`/`forbidden` triple on a class.

**Survives, reworked to stats:**

```
src/character/roles.ts       stat shapes instead of discipline shapes
src/character/classgen.ts    favours/against instead of core/affinity/forbidden
src/character/classbuild.ts  unchanged in shape; grants compose from stats
src/character/classnames.ts  unchanged; the brief mentions stats not disciplines
app/api/classes/             unchanged
```

`classId`, `classSpec` and `subclassId` all **stay on the sheet** — the carried
spec is what stops a regenerated roster orphaning a character, and that argument
is unchanged.

**All existing sessions are deleted** — no fallback paths, no dead code, no
migration.

---

## Progress — STALE; see the status block under THE ORDER at the top

```
✅ 1  nine stats, HP onto VIT, AGI initiative, LUK crit      ce9ec5b
✅ 2  stat grammar replaces discipline grammar               72e89bc
✅ +  stamina/mana pools replace usesPerRest                 095c066
✅ +  tick budget, then wind-up casts                        dbd69db, 4337a77
✅ 4  disciplines deleted; the tree grows on paths           66fae81
✅ +  replay hole, persona rebuild, physical layer, panel,
      and four unwired cores                                 f8bcf9f
✅ +  ARCHITECTURE.md and the dead-field ledger               5f70633
```

---

## Traits and Signets: what a reward is

Settled in discussion, and it belongs before step 9 rather than inside it.

**The problem.** `Signet.grant` is a `NodeGrant` that `signetgen` fills in and
**nothing anywhere reads**. `augments` is a string the view prints and nothing
acts on. So a Signet's only real effect is `opens` — making it a trait that
gives no stat and is harder to find, which is backwards for the rare, gated,
proven-reachable thing. The original pitch, "a Signet tops up something you
already have", was never built.

Meanwhile a trait grants `+1` to a stat and nothing else — a reward that
quietly tripled in reach when stats began gating paths and filling pools,
without anyone choosing that.

### The branch is a separate axis

Stated first because it is the easiest thing to misread. `opens` — growing a
branch on the tree — is **orthogonal to the reward** and does not change at
all. It is not one of the reward types and never competes with one:

```
                REWARD / EFFECT                    BRANCH
  trait         one of four reward families        opens?   independent
  signet        its grant + one of three effects   opens?   independent
```

Both roll independently, exactly as the code already does it — `grants` and
`opens` are separate optional fields. A trait may give +1 STR AND grow a
branch, or only one, or only the other. Everything below concerns the reward
column; the branch column is untouched.

### One grant shape for everything

`NodeGrant` widens and becomes the single currency for tree nodes, traits and
Signets alike:

```ts
export type NodeGrant = {
  ability?: Partial<Abilities>;
  maxHp?: number; ac?: number; attack?: number; damage?: number;
  maxStamina?: number; maxMana?: number;
  /** Rounds shaved off a condition landing on you. Capped short of immunity. */
  resist?: Partial<Record<Condition, number>>;
  /** Pool cost shaved off skills keyed to a stat. Floored short of free. */
  discount?: Partial<Record<Ability, number>>;
};
```

`applyGrant` in [allocate.ts](src/play/allocate.ts) already sums this shape with
a sign multiplier — extend it for the new fields and every consumer follows.

### Traits reward four ways

Drawn per theme, so the reward reads as a consequence of what earned it:

```
violence     +1 str · +1 damage · +1 to hit
endurance    +3 max hp · resist stunned · +1 vit
depth        +4 max mana · +1 wis
curiosity    +1 int · discount on INT skills
sociability  +1 cha · discount on CHA skills
craft        resist poisoned · +1 int
solitude     +4 max stamina · +1 con
```

Skill-teaching was considered and **excluded**: it would need the award path to
compose and push into `sheet.learned`, and it is the one reward that changes
what a character can DO rather than how well.

### A Signet does one of three things, and all of them are visible

Every Signet applies its `grant` — totalled onto the sheet as `signetBonuses`,
exactly the way `traitBonuses` already works, and dead until now. On top of
that it draws ONE of three effects, so they vary rather than all reading alike.

All of this is IN ADDITION to `opens`, which is unchanged: a Signet may grow a
branch and carry an effect, and most will.

**AMPLIFY.** `augments` names a node or trait you already hold and applies that
thing's grant a second time. **The panel must say so**, or the strongest of the
three effects becomes the only one a player cannot perceive:

```
  Blooded Count      kills 21 · fights won 16
  +2 str  ◆ doubled by Signet of the Red Hand
```

This is the one that can come to nothing — a Signet naming a trait you never
earned does nothing at all. Deliberate, because it rewards the build you
committed to, but it is why it cannot be the only shape.

**POOL CEILING.** `+N` maximum stamina or mana, beyond what VIT and CON give.
Unmissable — the bar lengthens the moment it is claimed — and nothing else in
the game grants it, so it never overlaps a trait.

**WAIVE A GATE.** Unseals a path the character's spread cannot justify, the way
a `cross` subclass does. The most visible effect there is: a sealed branch
opens. **Depends on step 4**, so it lands after the demolition; the other two
do not and can go whenever.

Together these make a Signet the rare, deep, hunted thing it was always
described as, rather than a trait with a gate in front of it.

### The seams that need care

- `resist` is consumed in `addCondition` ([conditions.ts:8](src/combat/conditions.ts)),
  a single clean chokepoint — but `Combatant` must carry the totals, set in
  `toCombatant`, the way `ticks` and the pools now are.
- `discount` is consumed in `costOf`/`priceOfUse` ([pools.ts](src/skills/pools.ts)),
  which currently sees only an effect and will need the holder.
- Both need caps: resistance must never reach immunity, and a discount must
  never take a skill below `MIN_COST`.

---

## Work in order — SUPERSEDED by THE ORDER at the top of this file

1. **Stats: 6 → 9.** `ABILITIES`, point buy re-costed to ~40, `derive`,
   `abilityMod`, the genesis schema and `repair.ts`. HP comes off VIT instead of
   a class hit die. Give AGI initiative + evasion and LUK a crit chance in
   [resolve.ts](src/combat/resolve.ts). **Get this green before touching the
   tree** — it is the foundation and it is separately testable.
2. **`statgrammar.ts`**, and point `composeSkill` at it. Reuse the measurement
   script [scripts/skillgen.ts](scripts/skillgen.ts) to confirm pricing holds.
3. **`pathgen.ts` + `pathnames.ts`** — stat pairs and thresholds in code, names
   from the model with a working fallback, mirroring `classgen`/`classnames`.
   The naming call can share the one already made for classes.
4. **Rebuild the tree on paths.** `SkillNode.archetype` → `path`/`stat`;
   `GraftSpec.archetype` → `stat` (a fixed enum, so a graft can never be
   orphaned by a regenerated path pool); node names composed via `nameFor`;
   keystone trades keyed on the path's stat rather than a 12-way switch.
5. **Stat and gear gates on nodes**, including the new `equipped` condition.
6. **Rework classes onto stats.** `roles.ts` declares stat shapes;
   `core`/`affinity`/`forbidden` become `favours`/`against`; the class shifts
   path thresholds and weights creation points. `checkShape` keeps proving
   soundness, against the new invariants.
7. **Rework subclasses.** `opens: ArchetypeId` → a stat plus a route; `cross`
   waives a path's stat gate outright, `deepen` extends a held path and
   discounts its later nodes. Stages at 3/6/10 unchanged.
8. **Creation page**: point-buy 9 stats, class grid stays but its cards show
   favoured stats instead of `opens:`/`never:`; preview which paths the current
   spread opens.
9. **Repoint traits, Signets and books** — their `opens` specs reference a stat
   instead of a discipline.
10. **Widen `NodeGrant`** and extend `applyGrant`; teach `traitgen` to draw a
    reward per theme; apply `Signet.grant` as `signetBonuses`; give a Signet an
    amplify or a pool ceiling, and **show the amplify in the panel**. Consume
    `resist` in `addCondition` and `discount` in `costOf`, both capped.
11. **Signets that waive a path's stat gate** — after step 4, since there are no
    paths to unseal before it.

Steps 1-2 are done and the pools landed ahead of schedule; the combat pass is
in flight. **Step 10 does not depend on the demolition** and can land whenever —
it touches the grant economy, not the tree's shape. Step 11 does depend on it.

---

## Verification

- `npm run check` at every step. The existing reachability proof
  (`signetgen.test.ts`), the counter-writer proof (`counters.test.ts`) and the
  grammar tests (`compose.test.ts`) are the ones to watch — the grammar tests
  must be rewritten against stats, not deleted.
- `scripts/skillgen.ts` — generated skills must still obey their grammar and
  spend their budget; no stat may produce a payload outside its list.
- `npm run fight -- 6 6` — the difficulty curve must survive HP moving to VIT.
  Expect to retune.
- **New property tests**: every path resolves to real stats; a character's open
  paths follow from their spread AND class alone; **raising a stat only ever
  OPENS a path and never closes one** (the monotonicity property that keeps a
  held path from vanishing mid-run — the same class of bug as an orphaned
  trait); two worlds generate different path names over the same stat pairs; no
  node requires gear the tower never drops.
- **Class and subclass tests**: a favoured path opens at a lower stat than an
  unfavoured one; nothing a class leans against is impossible, only dearer; a
  `cross` subclass opens a path the character's spread could NOT have opened;
  a `deepen` subclass only ever targets a path already held.
- **EVERY GRANT FIELD HAS A READER.** The proof that would have caught
  `Signet.grant` sitting dead through three commits, and the generalisation of
  the counter-writer proof in `counters.test.ts`: for each field on
  `NodeGrant`, drive a sheet holding a grant that sets it and assert something
  downstream actually moves. A field generated and read by nobody is the
  recurring failure of this codebase — `people_met` had no writer, `mental`
  gated nothing, `Signet.grant` had no reader.
- **Reward tests**: resistance never reaches immunity however it stacks; a
  discount never takes a skill below `MIN_COST`; a Signet whose `augments`
  names something you do NOT hold grants nothing; one that names something you
  do hold doubles exactly that and nothing else.
- **Browser end to end**: create a fantasy character and a sci-fi one, confirm
  the paths are named for their settings and that the same stat pair produces
  the same mechanics in both. Raise a stat and watch a sealed path open. Take a
  `cross` subclass at level 3 and watch a path unseal that the spread did not
  earn.

---
---

# NEXT PASS — under discussion, not yet a plan

Everything above is the stat purge and is largely done. What follows is the
NEXT body of work, still being designed with the user. Recorded here so the
decisions survive a context compaction.

## What the user asked for

1. **Recreate the skill system as components.** A skill becomes
   `{ id, name, description, effects[], requires }` where each effect carries:
   sign (plus/minus), channel (stat, hp, mp, stamina, condition, spawn,
   special), when (time to finish), how long (duration), where (shape — around,
   cone, …), who (foe/friend/own), and how (a formula). A skill has a PURPOSE
   effect and a COST effect.
2. **Add personality as a second kind of stat**, from
   [5D_Human_Psychology_Model.md](5D_Human_Psychology_Model.md) — HOW (MBTI,
   cognition), WHY (Enneagram, motivation), WHAT (Jungian archetype), WHERE
   (context), WHEN (life stage).

## Settled in discussion

- **Effects are a LIST, not a fixed pair.** More than two is allowed. `drain`
  and `hex` are already secretly two effects fused into one union arm, which is
  the strongest argument for the component design.
- **`special` is a closed verb registry, never free text.** It is the slot for
  "does something that isn't a number moving". Seeded with verbs the engine can
  already resolve; `summon` held back as the expensive one.
- **Delete saves again.** No migration path, no fallback branches.
- **PC personality: the model infers it from the interview, the player adjusts
  it** before committing. Today the model invents the five axes with zero prose
  guidance and the player never sees them.
- **NPCs get FULL PARITY with the PC** — driven by the long-term ambition
  (dynamic towers, floor-ranges as worlds, an outer world, NPCs as real people
  the player can do anything with). Parity of BEING: everyone carries the same
  persona shape. Parity of DOING is separate and optional — see the agency
  levels under the tower decisions; some world types keep static NPCs.
- **Personality carries real mechanical weight**: skills, traits, Signets,
  in- and out-of-combat actions, and the main chat. Talk shifts a persona and
  the persona answers back. A skill that SUITS your persona is buffed.

## Also requested, not yet designed

- **Physical attire / body** — an appearance shaped by background, class, and
  what the person does now. "Good to have", user's words.
- **NPCs with their own purpose** — not idle characters waiting to be
  interacted with. Includes how NPCs SPAWN into the game.

## Tower findings (2026-09-04)

Explored before designing. What today's code assumes:

1. **`Region ≡ Floor ≡ one integer`**, keyed by
   `regionIdFor(floor) = \`floor-${floor}\`` ([types.ts:148](src/world/types.ts:148)).
   The de-facto primary key of the region map. One floor cannot be several
   regions; several floors cannot be one world. **This one line blocks
   floor-ranges-as-one-world.**
2. **Exactly two floors are held in full detail** — `compressExcept` at
   [travel.ts:84](src/world/travel.ts:84). Every other region becomes a
   `Gazetteer` and its GEOMETRY IS DESTROYED (places, connections, entrance,
   exit, `discovered`). A 10-floor world would compress eight of its own floors.
3. **Returning to a floor is an LLM rehydration, not a restore**
   ([floorgen.ts:174](src/world/floorgen.ts:174)). A static persistent dungeon
   is impossible by construction.
4. **`danger === floor`** exactly ([budget.ts:24](src/world/budget.ts:24)), and
   every combat number derives from it. Difficulty cannot be decoupled from
   depth.
5. **No task/quest/objective type exists anywhere.** `WorldDelta` has no
   task-shaped verb; `world.flags` is the Director's entire extensibility
   budget.
6. **Two ghosts of a task system, both dead:**
   - [agenda.ts](src/world/agenda.ts) is complete, correct and deterministic,
     and **imported by nobody**. Nothing populates `Person.agenda`, nothing
     calls `agendaProgress`, there is no test.
   - `Gazetteer.openThreads` is READ by the rehydration prompt and WRITTEN by
     nothing, so it is always `[]`.

   Both sit exactly where NPC purpose needs to go. Two more instances of this
   codebase's signature bug.
7. **Floor 0 is the outer world**, generated by a separate function with a
   separate prompt and jammed into the same map at `floor-0`. `descend`/`godown`
   exists but is wired to no route and no UI.
8. **One global `turn`, one flat `people` registry, one flat `facts` array, one
   global `flags` map.** No per-floor, per-world or per-arc scoping except
   `Fact.region`.
9. **No DDL migration is needed** for anything here — `world` and `payload` are
   `jsonb` and Postgres does not know their shape. But old snapshots must keep
   loading, and `facts.region` is a real text column.

### The replay hole — fix this first

[state.ts:16](src/play/state.ts:16) states the contract: the log is truth,
`PlayState` is a fold, snapshots are a disposable cache. A test asserts that
deleting every snapshot changes nothing but load time.

**It is already false.** Floor generation is an LLM call that is NOT written to
the event log; a generated floor survives only in the snapshot blob. Replay a
climbed session with snapshots deleted and you reach `currentRegion: 'floor-3'`
with no `floor-3` in `regions` — and `foldPlay` is synchronous with no
`Provider`, so it cannot regenerate it.

Every dynamic-world feature collides here. Anything that changes the world
between turns must be either a pure function of `world.turn` (the shape
`agenda.ts` was written for) or its own logged event kind added to
`FOLDED_KINDS` ([sessions.ts:72](src/db/sessions.ts:72)).

- **More gear slots.** Today `Item.slot` is only `weapon` / `armour` /
  `trinket`. Wanted: ring, bracelet, necklace, head, body, leg, foot, main
  weapon, offhand — with two-handed weapons consuming both hands. Touches
  `equippedGrants` (which feeds `finalAbilities`) and the planned `equipped`
  node gate, so it wants deciding before either lands.

## Tower decisions (2026-09-04)

**A WORLD HOLDS STRUCTURES; A TOWER IS ONE KIND.** This is the correction that
reframed everything. The user's examples: no tower at all; one tower of 20
floors; a tower that spawns another tower; a tower destroyed by completing it;
an outer world that upgrades, is explorable, and expands on the horizontal axis
into an ordinary world. So the top level is a World holding zero or more
structures — some vertical (a stack of floors), some horizontal (a connected
map). "Ten floors is one world" was only an EXAMPLE; the arrangement is dynamic
and mixable, not a rule.

- **Stratum** is the agreed name for the level above a floor.
- **Strata NEST.** "4 dungeons inside a 20-floor tower" means a dungeon is a
  sub-stratum. The tower plan is a TREE, not a list.
- **Strata own loot** — items, skill books, gear sets. A world's economy is
  regional and a gear set lives somewhere specific.
- **The outer world is a structure with graph topology**, not `floor-0`. (User
  had no preference; taken from their own example of coming down to the ground
  and expanding sideways.)
- **Static floor = authored once by the model, then frozen.** Never rehydrated.
- **Floor generation becomes a logged event** added to `FOLDED_KINDS`. This
  fixes the replay hole AND provides the durable store a frozen floor needs —
  a static floor is one whose generation event is never superseded; a dynamic
  floor is one permitted a second generation event. One mechanism, two
  behaviours, both replay.

### World creation has three paths

1. A free-text description of the world (as today).
2. Selectable customization across many subjects.
3. A preset, combinable with 1 and 2.

So the world's STRUCTURE is a player-facing creation choice, not only a seed
draw. Scenarios the user wants reachable: no floor 0; a 20-floor static tower
with 4 dungeons and a save floor; an upgradeable explorable outer world; a
tower that spawns another; a tower destroyed on completion; dynamic floors
linked to the tower; tutorial floors; floors combining several task types; a
world where floor 0 is the outer world and people come DOWN into it.

### Stratum knobs

kind (static / dynamic / story) · danger curve decoupled from depth · theme,
culture and people pool · topology (stack or graph) · loot (items, skill books,
gear sets) · nesting.

### Quests — a full dynamic quest system

Sources, all wanted: the stratum's own arc; NPCs pursuing their own purposes;
the tower itself gating ascent behind a trial; and **the PC creating tasks** in
scenarios where the PC is not a climber but, say, a ruler operating something.
Director-authored quests were NOT selected.

**NPCs can be independent agents** — climbing on their own, taking tasks
themselves, coming back down to the ground. That is a simulation running
whether or not the player is watching, and it is the most expensive thing
described.

**BUT AGENCY IS A KNOB, NOT A UNIVERSAL.** Some world types still have STATIC
NPCs: people who stay put, hold a shop or a role, and never pursue anything of
their own. A world of independent climbers and a world of villagers are both
valid, and the cost difference between them is large.

The distinction that makes this work: **parity of BEING, not parity of DOING.**
Every person carries the same full persona — who they are, how they speak, what
they want, what their body is like — because the player must be able to treat
any of them as a real person. Only some carry an AGENDA. Those are separable
concerns and conflating them is what would make every villager expensive.

### Agency is a SCHEDULER, not a taxonomy (user's design)

The tier is a COMPUTE BUDGET, and it SHIFTS at runtime. Nobody authors an NPC
as live; NPCs BECOME important. My first version had this as an authored
per-stratum property, which was wrong.

```
  static     no calculation at all
  reactive   calculated while the player is on the same floor
  live       calculated always, wherever the player is
```

**Promotion by proximity.** The player arrives on floor 12 and the shopkeeper
shifts static → reactive. She now runs a ROUTINE and small PURPOSES: keep the
shop open, reorder stock after the player buys something. Leaving demotes her.

**Promotion by stakes.** Talking, flirting, ordinary business — she stays
reactive. Then a real event fires: she falls in love with the PC and wants to
follow him. She becomes LIVE, because her purpose is now ABOUT the player and
cannot be computed only when he is standing there.

**Promotion by contact.** A live character interacting with a lower-tier
character pulls them up. Agency spreads along the SOCIAL GRAPH rather than
being sprayed by a population budget — so the simulation follows the story
instead of the map.

This is level-of-detail for PEOPLE, exactly parallel to `compressExcept`'s LOD
for regions ([travel.ts:84](src/world/travel.ts:84)) — with one improvement:
region LOD is decided by adjacency alone, this is decided by adjacency AND
stakes.

It also keeps `persona.ts`'s doc true — "deliberately cheap, every villager can
afford one" was written about the PERSONA, and the persona stays cheap. It is
the AGENDA that is dear, and now only the people who earned one carry it.

A stratum still sets a DEFAULT and probably a CEILING (a sleepy village caps at
reactive; a contested tower makes live common), but the live tier is dynamic
per person.

## WORLD RULES — the system that governs all of it

The user's answer to demotion, and it is much bigger than demotion.

**NPCs behave according to the WORLD/TOWER RULES.** If the rules say they
cannot go further, they do not — unless a new rule comes to apply to them.
Demotion is therefore not a budget mechanism. It is the world's law, and the
compute budget falls OUT of the fiction rather than being imposed on it.

The worked example, in full:

```
  tower rules  · an NPC cannot travel between floors
               · memories do not reset
               · they may learn about the outside world

  The shopkeeper on f12 goes live: she loves the MC and wants to follow him.
  The RULE forbids leaving the floor, so that purpose is impossible.
  Her ROUTINE is rewritten instead — at 12:00 she goes to the teleporter and
  waits for her lover to come back. That is a reactive routine.
  The MC leaves the floor; there is nothing left to compute; she goes STATIC.

  Later a LIVE character arrives on f12. She runs her turn and catches a
  RUMOUR: people like her CAN climb or leave the tower — with a Signet.
  The rule did not change. HER KNOWLEDGE OF IT did.
```

**This makes "each type of world has its own way" mechanical.** A world type
IS a ruleset.

### Rules are hidden, discoverable and exemptable

Three views of one law:

```
  true         the full ruleset. Debug view only.
  player       what the player has actually worked out.
  per-NPC      what each person knows. They do not know the rules at first.
```

Rumours propagate knowledge along the social graph — the same graph agency
spreads along.

**A SIGNET IS A RULE EXEMPTION.** This is the job `Signet.grant` and `augments`
have been missing: they are generated and read by nobody through three commits.
A Signet that lets its holder — player OR NPC — break a tower rule is exactly
the rare, gated, hunted thing Signets were always described as.

### The four rule axes (all in scope)

```
  movement & access      who may cross floors, descend, leave the tower, enter
                         a stratum, use a teleporter
  memory, knowledge      what resets and what persists — floor resets, memory
  & death                resets, permanent death, what may be learned of outside
  progression & power    who may level, learn skills, hold Signets; the ceilings
  economy & loot         what drops where, what may be carried between floors
                         or out of the tower, whether trade crosses strata
```

### A rule names who it binds

**Whether the PLAYER is bound is itself part of the rule.** So a rule is
`{ axis, constraint, binds }`, and every rule check takes a SUBJECT — there is
no hardcoded "the player is exempt" anywhere in the engine. One world makes the
player an ordinary resident under the same law as everyone; another makes them
the anomaly. That is authored, not assumed.

Today's code has exactly the assumption this removes: `descend` hardcodes a
refusal at floor 0 ([travel.ts:118](src/world/travel.ts:118)), and NPCs are
bound to a single `homeRegion` by construction with no rule saying so.

### Constraints this imposes

- **The rule vocabulary must be CLOSED.** A model that can write "rule: NPCs
  cannot lie" produces a rule nothing enforces. Rules must be a typed enum the
  engine actually checks, same principle as `ActiveEffect` and `WorldDelta`.
  The model names and dresses a rule; it never invents one.
- **Rule knowledge is per-person state** and must propagate. New field on
  `Person`, and rumour spread has a cost.
- **The three views need redaction discipline** — which already exists:
  `redact.ts` and `assertNoLeak` do exactly this job for the Writer today.
- **Rule changes and knowledge gains must be logged events**, or replay
  diverges.

### The live cap

World/tower rules are a **soft cap** in most scenarios — if NPCs cannot cross
floors, the live set is bounded by the floor for free. That soft cap disappears
in open-world and climb-down scenarios where people genuinely move.

So: **soft cap from the rules, plus a hard cap on DEPTH — "seven person
theory", i.e. degrees of separation.**

**This is a depth bound, NOT a headcount.** (I recorded it as "a cap of seven
live NPCs" and the user corrected me: seven PERSON THEORY — the chain of
acquaintance, not the population.) Agency propagates outward from the player
along the social graph and stops after so many hops. Who is live is therefore
decided by CONNECTION rather than by a quota, which is why it follows the story
rather than the map — and it means nobody has to be evicted to make room.

The practical ceiling comes from the world's own rules (a floor nobody can
leave bounds the graph for free) rather than from a number in the engine.

### Remaining gaps in the scheduler

1. **Determinism.** Promotion must be a function of LOGGED state, resolved at
   turn boundaries in a FIXED order; the contact cascade must terminate
   identically on replay.
2. **Routine vs purpose.** "Keep the shop open" (recurring, ambient, no
   completion) and "order stock because the player bought something" (has a
   completion) are different objects. The quest system covers the second; the
   first is cheaper and needs no completion state. The shopkeeper example shows
   a PURPOSE degrading into a ROUTINE when a rule blocks it — that conversion
   is a real mechanism and needs specifying.
3. **Frozen time.** "static = no cal" means nothing happens while away. A shop
   that has not restocked in 50 turns may read wrong — a one-shot catch-up ON
   PROMOTION is cheap and may be worth it.

## PERSONA — the full-parity shape (decided 2026-09-04)

> **SUPERSEDED IN PART.** The `personality` five-axis line below was later
> replaced: disposition axes give way to NEEDS + DRIVES + a stable TEMPERAMENT,
> and `mental` is rebuilt as needs. See "PERSONA REBUILD" further down. The
> drive / archetype / age / body / knows / tier decisions all stand.

Everyone carries this. It is parity of BEING; the agenda is what's optional.

```ts
Persona = {
  // ---- exists today ----
  voice: NpcVoice
  status: Status
  personality: Personality   // 5 axes → SEVEN, see HOW below
  mental: MentalState        // stress, morale, fatigue
  counters: Counters
  pressure: Personality      // drift accumulator

  // ---- 5D model ----
  drive: Drive               // WHY  — a want and a fear. Shape still open;
                             //        belongs to the creation-page discussion.
  archetype: { declared }    // WHAT — declared stored; ACTUAL is derived
  age: AgeBand               // WHEN — child|young|prime|late|old
  body: Body                 // structured and MUTABLE

  // ---- world rules ----
  knows: RuleId[]            // which rules this person has learned

  // ---- agency scheduler ----
  tier: static|reactive|live // dynamic, see the scheduler section
  routine?: Routine          // recurring, ambient, no completion
  purpose?: Quest            // has a completion
}
```

### HOW — two new axes, not four

`personality` goes from five axes to **seven**: the existing warmth, nerve,
discipline, candour, loyalty, plus

```
  intuition   concrete ↔ abstract     (MBTI S/N)
  feeling     logic ↔ values          (MBTI T/F)
```

Two rather than four because **MBTI's other two duplicate what exists**: E/I is
essentially `warmth`, J/P is essentially `discipline`. Adding them would measure
the same thing twice and let drift push a pair in contradictory directions.

The two new axes inherit everything the five already have for free: the −3..+3
scale, `clampPersonality`, drift and `pressure`, `describePersonality`, the
`{kind:'personality'}` `TraitCondition`, and the UI's `AxisBar` row. They also
become **formula inputs for the component skill system** — the join between the
two halves of this work.

### WHAT — declared AND actual

- **declared** — who they think they are. Stored; chosen or generated.
- **actual** — who their counters and axes say they have BEEN. Derived, the way
  emergent trait `SHAPES` already are ([traits.ts:136](src/play/traits.ts:136)).

**THE GAP BETWEEN THEM IS THE CHARACTERISATION.** This extends the codebase's
own axiom from [emergent.ts:10](src/play/emergent.ts:10) — *"declared traits are
goals; these are recognitions"* — to the person as a whole.

### WHEN — a stored age band plus a derived arc

`age` is stored (NPCs genuinely need it; a run is far too short to change life
stage). Arc position is **derived** — from level and depth for the PC, from a
purpose's progress for an NPC.

### WHERE — fully derived, nothing stored

Context is which world and stratum they are in, which rules bind them, and who
is present. All of that is already in `PlayState`. No field.

### Body — structured, and it MOVES

A closed vocabulary (build, height, bearing, marks, wear) generated from
background and class, then **changed by play**: scars from real wounds, leanness
from hunger, hardening from what gets carried. The model writes prose over the
structure; the structure is what anything mechanical or systematic can read.

Directly answers the user's "what they do now affects their body".

## CREATION (decided 2026-09-04)

### Three doors, applied to EVERY input

The user's three paths for world creation generalise: **describe it · select it ·
take a preset**. The same three doors work for the world, the drive, the
personality and the body. This is what keeps creation from becoming a wall —
it now carries world structure, rules, class, 9-stat point buy, 7 personality
axes, a drive and a body, and the fast door has to stay fast.

### Two phases, everything collapsed by default

Phase 1 builds the WORLD, phase 2 builds a CHARACTER in it. The page is already
two-phase in effect — the world answer generates the class roster before the
player picks from it ([app/new/page.tsx:119](app/new/page.tsx:119)).

Every section starts CLOSED with a sensible default already filled in and opens
only on demand. Three clicks to "begin", or an hour if you want one.

### Rules: authored through structures and presets, with a rules VIEW

The player picks structures and a preset; the ruleset FOLLOWS from them and is
shown as a readable list, each entry individually overridable. Nobody has to
author rules to start; anyone who wants to, can. This also delivers the debug
view of the true ruleset for free.

### The drive: all three doors

Write it and the model structures the prose into a want and a fear; or pick
from drives the world generated; or take the preset's. The existing interview
question — *"What do you want badly enough to climb for, and what are you
leaving behind at the bottom?"* ([interview.ts:58](src/session/interview.ts:58))
— stays, and its answer stops being discarded.

### A preset is a whole opening scenario

World structure + ruleset + tone + the situation you start in. E.g. *"a 20-floor
static tower, no floor 0, memories persist, you wake on floor 1 with no idea how
you got there."* One click to playable, and each preset teaches a different
shape of the game.

## PEOPLE AND QUESTS (decided 2026-09-04)

### Spawning: a standing cast, plus arrivals

Each stratum generates its OWN cast when its content is first authored — people
who belong to that world. On top of that, new people ARRIVE: a live NPC travels
in (rules permitting), or the world needs a role filled that nobody present can
fill. Residents plus traffic, which is what makes somewhere feel inhabited
rather than staffed.

Replaces today's model: `peopleBudget(floor)` generates 2–12 people bound to one
`homeRegion` forever ([budget.ts:18](src/world/budget.ts:18),
[floorgen.ts:269](src/world/floorgen.ts:269)).

### Crowds are description; individuation CREATES

A crowd is prose on a `Place`, not modelled people. The moment the player picks
someone out of it — speaks to them, fights them, notices them — a full persona
is created on the spot, **deterministically from the seed** so it replays.

The point: nothing cheap ever has to be upgraded, because nothing cheap exists.
This is how full parity survives a market of two hundred.

### Party: full companions, in scope

Recruited NPCs travel with the player, fight with their own sheet, and keep
their own persona, drive and purpose — so they can disagree, leave, or want
something the player does not. `Person.sheet`, `recruited` and `stance` already
exist and are wired to nothing ([world/types.ts:102](src/world/types.ts:102));
this is what they were anticipating.

This is what makes "NPCs are real people" actually pay off, and it pulls ally
AI and party initiative into the combat work.

### A quest is a GRAPH OF STEPS — all three shapes at once

The user asked for all three shapes. They are not three systems; they are one
type whose degenerate cases are the other two:

```
  Step = { id, requires: TraitCondition[], next: StepId[] }

  next.length === 0   terminal
  one step, no next   → A GOAL          (done / not done)
  a chain             → ORDERED STEPS   (a middle, and progress)
  several successors  → A BRANCH        (forks on what you did)
```

**Completion reuses `TraitCondition[]` wholesale** — the union already supports
counter, ability, personality, level, carries and shape
([traits.ts:21](src/play/traits.ts:21)), and `progressOf`
([traits.ts:234](src/play/traits.ts:234)) already renders progress bars against
it. Quests therefore replay for free and display for free.

**One quest object serves every source**: a stratum's arc, an NPC's purpose, a
tower trial gating ascent, and a task the PC creates. A `Routine` stays separate
— recurring, ambient, no completion.

## COMPONENT EFFECTS (decided 2026-09-04)

### Grammar: per-axis allow-lists + a forbidden-pair table

Components multiply the space — sign(2) × channel(7) × who(4) × shape(5) ×
duration(3) ≈ 840 before formulas — and most are nonsense. So:

- each stat keeps a per-axis allow-list, **exactly the shape `STAT_GRAMMAR` has
  today** ([statgrammar.ts:40](src/skills/statgrammar.ts:40)) — widened from
  `payloads[]` to one list per axis;
- plus a SHORT table of pairs that are never legal for any stat (heal a foe,
  hinder a friend). ~20 lines, and the only genuinely new thing.

### Suitability: derived, overridable

A skill's suitability is DERIVED from its own components via a small
component→axis table, so every generated skill gets it free and none can be
authored wrong. A skill may override with an explicit affinity.

**What it does when it fires — all four:**

```
  cheaper    a pool discount        reuses the planned NodeGrant `discount`
  stronger   scales the formula     the persona↔skill join
  faster     fewer ticks            reuses castTicks; personality reaches tempo
  and out of combat too             where edgeFor already lands
```

Needs caps on all of them: discount floors at `MIN_COST`, ticks floor at
`MIN_ACTION_TICKS`, formula scale bounded.

### Special verbs

All four confirmed: **displace · interrupt/cleanse · taunt · summon.**

Summon puts mid-fight initiative insertion in scope — `CombatState.order` is
currently "fixed for the encounter" ([types.ts:233](src/combat/types.ts:233)) —
plus a statblock source and AI for the summon. The one expensive verb.

Plus, confirmed: **grid control** (terrain — `Grid.walls` is a `Set<string>`, so
near free; blink) · **tempo** (delay, haste — reuses `tempo.ts`, makes the tick
budget a target) · **protection** (guard, stabilise — `dying`/`deathSaves`
exist; guard needs one redirect hook in `resolve.ts`).

**Social verbs are NOT skills.** Rumour, bind and exempt were rejected on the
right grounds: they are actions, consequences and events in the world, not
things you cast. The line is **skills act on the tactical layer; the world layer
handles social causation.**

### `ActiveKind` DIES

"Use a skill as you please, like D&D." Today `combat|social|utility` gates what
a skill may do — `isCombatUsable` blocks `edge` mid-fight
([active.ts:74](src/skills/active.ts:74)) and `composeSkill` splits the payload
list by kind ([compose.ts:208](src/skills/compose.ts:208)). If a skill is just a
skill, that gate deletes: less code, more freedom, more combination.

`isCombatUsable`, `needsTarget` and `radiusOf` all become plain reads off the
components.

### Suitability is a SIGNED shared budget

All four channels draw from one budget, and **the budget can go NEGATIVE**: a
badly-matched skill is costlier, weaker AND slower.

This is the best mechanism in the design. It needs no upside cap, because
mismatches pay for matches, and it turns personality into a genuine build
constraint rather than a free bonus.

## INVENTORY REWORK (designed 2026-09-04)

### What breaks today

```ts
export const SLOTS = ['weapon','armour','trinket'] as const;  // fixed, three
export type ItemStack = { item: Item; count: number };         // collapses by id
export type Equipped  = Partial<Record<Slot, string>>;         // slot → item ID
export type Inventory = { stacks: ItemStack[]; equipped: Equipped };
```

1. **Durability breaks stacking** — two axes at different wear are not one object
   with a count. This is the model change; everything else is plumbing.
2. **`Item` conflates type and instance** — `id` is a TYPE id used for stacking,
   while `foundOn` is already instance data smuggled on. That is exactly why
   durability does not fit.
3. `Slot` is hardcoded; the ruleset must define slots per world.
4. Nothing expresses a two-hander or a second ring.
5. One inventory, one owner — companions, stashes, shops and corpses need one.

### Decided

- **TWO INVENTORY MODELS, ONE EQUIPMENT MODEL**, both as ruleset parameters
  rather than separate code:

```
  weight model  (Fallout, Cyberpunk, FF)   weightLimit set · grid null
  slot model    (PoE, RE, Minecraft)       grid set        · weightLimit null
  both / neither                           parameters, one code path
```

- **Shapes are arbitrary polyominoes, not rectangles.** A two-headed axe is a T,
  a one-headed axe an L; a longsword eats 5–6 cells, a dagger 2. **Containers
  have their own shape too** — an irregular board, not a rectangle. This is the
  RE4 attaché case, and it is a genuinely large subsystem: shape representation,
  rotation, fit/placement, and drag-and-drop. The model and the fit algorithm
  are pure testable code; the UI is the expensive half.
- **An owner holds NAMED inventories** — `carried`, `stash`, `vault` — each with
  its own capacity and model. Extends to companions, shops, containers, corpses.
- **Item instances vs stacks**: fungibles (rations, materials) stack by type;
  anything that can wear becomes an instance.

### Transfer between bags is rule-gated, on five axes

depth/rank/progress (the floor-24 example) · place and time (only at a bank, or
with a delay) · what the item is (quest items never leave the tower) · cost and
loss (a fee, a tax, spoilage in transit) · and the one the user added:

> **THE STASH IS A LOGISTICS SERVICE, NOT A MENU.** Transfer can fail because
> there is no deliverer, because there is a war on the road, or because of an
> event. Access is something the world provides and can take away.

### Trade — all four in scope

B2C (shops sell to you) · C2C (barter with individuals, priced by their needs,
preferences and their edge toward you) · **B2B (businesses supply each other
WITHOUT the player** — what makes a shortage real and a price move for a reason,
and the expensive one because it runs unwatched) · theft, gifts and inheritance.

### Shapes: the pure core is BUILT ✅ (`src/items/shape.ts`, 26 tests)

`Cell` · `Shape` · `Board` · `shapeFrom(mask)` / `maskOf` · `join` (assembly) ·
`rotate` / `orientations` (distinct only) · `fits` · `firstFit` · `packAll`
(greedy, largest-first) · `shapeOf(item)` in `items/types.ts`.

Guarantees pinned by test: placement and packing are DETERMINISTIC and
order-independent (the fold depends on it) · nothing packed ever overlaps ·
boards may be irregular and the notch is respected · nothing is ever shapeless.

Bug the tests caught: `weapon_greataxe_d12` contains "axe", so scanning
archetypes in declaration order drew a two-headed weapon as a one-headed one.
Longest name now wins.

Still to build: instances, named bags, nested containers, transfer rules, the
ruleset parameters, and the grid UI.

### Shapes are ASSEMBLED FROM SQUARES

A shape is a set of unit cells, and a finished silhouette is built by combining
them — a haft plus one head is an L, a haft plus two heads is a T. That means a
generated weapon can get its shape COMPOSITIONALLY from the parts it was
generated with, rather than needing a mask authored per item. Archetypes carry
hand-drawn masks; anything else assembles one from kind and size.

### References, and what they imply

**Weight model → Project Zomboid. Slot model → Tarkov.** Both share something
neither of my proposals had: **NESTED CONTAINERS.** A bag inside a bag, and
loot is a container you open rather than a list you receive. Corpses, crates and
shops are all containers. So an inventory is a tree, not a flat bag.

**Placement is a RULE**: auto-place on pickup · manual only · both (auto with
drag to rearrange). Rotation is a rule too — 90° steps, or never.

### Order: the PANEL FIRST (user's call)

I recommended model-first and flagged that the panel gets built twice. It is
cheaper than that implies: **five of the six tabs do not touch the inventory
model.** Status, skill, trait and signet re-home panels that already exist;
quest is an honest empty state. Only the INVENTORY tab depends on the model, so
it ships as today's flat list and is upgraded when shapes land.

### The panel, from `design/*.png`

**ONE modal, six tabs**: `status · inventory · skill · trait · signet · quest`,
replacing today's two separate modals and adding a quest tab for a system that
does not exist yet.

```
  status     left: 2D portrait or 3D model     right: stats and status
             bottom: an expandable strip — full status, buffs, any stack
  inventory  left: equipment paper-doll        right: the pack
```

The portrait panel is where the `body` field finally has somewhere to live.

## ITEM SYSTEMS — refine, enchant, enhance, components, crafting (2026-09-05)

From RO, Genshin and Tarkov. **Everything here is rule-parameterised at
identity values** — a world that wants none of it sets the dials to zero and
the code path is unchanged.

### Refine · Enchant · Enhance

```
  refine    a level on the instance. Raises base stats, with RANDOMNESS —
            lv1→lv2 might take atk 1→2 and crit 0.2→0.5. Deterministic from
            (instance id, level) so it replays.
  enchant   at refine MILESTONES, buy an option — %atk, %crit — at a cost.
  enhance   raises RARITY (common → uncommon → …) and grants one of:
              · a stat grant   (the NodeGrant shape nodes/traits/Signets use)
              · a skill        (the component effect system)
              · a RULE EXEMPTION while held — the Signet mechanic on gear
              **SHIPPED 2026-09-12** (`e9735c2`): `fine` grants
              `ItemInstance.exempts`, drawn from the laws IN FORCE and seeded
              from the object, kept through later rebirths; `playerSubject`
              reads worn gear beside signets. Still missing: the SKILL payout
              (nothing lets an item grant one — `activeSkills` never sees the
              inventory), and widening the bonus to the full `NodeGrant`
              (`maxHp`, pools, `ac` need their readers extended; `attack` and
              `damage` are dead until `resolve.ts` reads them, and granting
              them first would be the dead-field bug again)
            Expensive; some need conditions, some need materials.
            **ENHANCING RESETS REFINE AND ENCHANT.**
```

That reset is the interesting decision: enhance is a rebirth. You trade
everything you invested for rarity and a new power, so *when* to enhance is a
real choice rather than a straight upgrade.

**Refine failure is a RULE**, not a fixed answer — RO breaks items, Genshin
cannot fail, and both are reachable from one code path:
`never · stall (materials lost, item intact) · drop a level · destroy`.

### Components (Tarkov)

- An item is a TREE of parts. A sword is blade + guard + handle; a handle is
  wood + cover + pommel.
- **The silhouette comes from the assembly** — the item's grid shape is its
  components joined via `join` in [shape.ts](src/items/shape.ts), which already
  exists and is tested. A longer haft is literally longer in your bag.
- **Parts carry their own durability.** A handle wears out while the blade is
  fine; repair replaces the part that failed.
- **Parts carry STATS. Skills belong to the ITEM, not the part** — a skill
  expresses what the thing IS, and that is a property of the whole.
- **Recursion is bounded by a FUSED boundary, not a depth cap.** The user's
  example: a x3 scope on a 30mm rail cannot be swapped for a x4 — you recreate
  the assembly. So parts are detachable down to a level, and below it they are
  made together. One flag, and the tree terminates naturally.

### Crafting — a life, not a shop

- **Recipes, quality from stats and practice.** Anyone may attempt anything;
  a career is an advantage, NEVER a gate. That is the "not a blocker" ask.
- **NPCs craft, and it is their PURPOSE** in the quest sense — they need
  materials, they produce, they trade. This is what makes B2B supply and a real
  shortage possible.
- **Commissions** — you can ask someone to make you something, and be asked.
  Price, waiting, obligation and trust all bear on it. The social half.
- **Discovery and invention** — recipes learned, deduced, or invented.
- **Recipes can be books.** [book.ts](src/skills/book.ts) already drops books
  gated by `requires` that carry what they teach into the save; a recipe is the
  same object with a different payload.

## LORE SATISFIES A WANT (2026-09-05)

The correction that makes lore a mechanic rather than decoration: as first
built it was a string the Writer might quote. **Lore should satisfy a
character's want** — which makes an item worth keeping for a reason its numbers
do not express, the thing loot economies almost never manage.

### One mechanism, items first

**Content that is ABOUT things, meeting a character who WANTS things.** An
item's history is the first carrier; a story an NPC tells, a song, a view from
a high floor, a shared meal are the same object later. The matching function
does not change, so the social and travel systems get it free.

### What it feeds

```
  purpose    the drive being served — and this gives `purpose` its FIRST
             mechanical reader; drift writes it and nothing has ever read it
  company    when the lore is SHARED — learned from someone, or told to them
  pressure   a deep match nudges a temperament axis. Rare and slow, so it can
             change WHO SOMEBODY IS over time, not just how they feel today
```

### Matching: a subject vocabulary GENERATED PER WORLD

The user asked for "something dynamic but cheap and effective". Neither a
hardcoded enum (static), nor a model judging each match (expensive, and a model
deciding a mechanical outcome), nor embeddings (opaque, untestable).

**The vocabulary is generated per world.** A drowned coast mints subjects like
*the flood · the old highways · salvage · the people who left*; a kingdom mints
others. Closed WITHIN a world, so matching is a set intersection — cheap,
checkable, exactly testable. Same split as paths, classes and traits: code
fixes the structure and the rule, the world supplies the words.

**And it buys a proof.** Because a world's drives and its lore are drawn from
the SAME generated pool, they are guaranteed to speak the same language — so
every drive can be proven to have lore that could satisfy it, exactly as
`admissible` proves every Signet reachable. Free text cannot promise that;
embeddings can only score it.

### Depletion: once, but RE-TELLABLE

Learning is a one-time event recorded on the persona — which the knowledge
system needs anyway, since knowing a thing is what lets you tell it. Telling
someone who does not know it meets THEIR purpose and BOTH parties' company. So
knowledge becomes worth carrying between people, which is exactly what the
rumour system wants.

**Dependency:** this needs `drive` on the persona, which is designed (step 1b)
and not built. The subject vocabulary and the matching function are pure and
can be built and tested first, with the drive passed in.

## RUMOURS AND BELIEF (designed 2026-09-05)

Asked "how do rumours work?" — they do not yet. `tell` in
[lore.ts](src/play/lore.ts) is one HOP of propagation and is built; everything
that makes it happen on its own is designed and unbuilt.

### Knowledge moving is not the same system as rumour

The design had been eliding these. Propagation is a true fact reaching more
people. A RUMOUR is a claim that may be false, distorts in the telling, and is
believed to different degrees.

**BELIEFS CAN BE WRONG**, and that is the whole point. Knowledge becomes what
somebody HOLDS TRUE, separately from what IS true. The rules system already
wants exactly this: it has three views (true / player-known / per-NPC-known),
and per-NPC knowledge being ABSENT is far less interesting than it being WRONG.

### The correction arc (the user's own example, completed)

```
  she believes she cannot leave the floor      a TRUE belief
  a rumour says people like her can            she holds it — and it is FALSE
  she acts on it                               goes to the stair
  reality contradicts her                      the belief is CORRECTED
  she learns she was lied to                   the teller's credibility falls
```

A belief is not merely present or absent — it can be **wrong, acted upon, and
corrected by contact with the world**, and the correction lands on whoever told
her. That needs `trust` and the relationship edges to have somewhere to put the
damage, which they do.

### Distortion is what makes it a rumour

Each retelling may exaggerate, swap a name, or lose a detail — DETERMINISTIC,
seeded from (claim, teller, hop), so it needs no model call and replays.
Hearing your own deed come back wrong is the most memorable thing this system
can produce.

### What makes somebody tell

**NPCs and companions have their OWN TURNS AND ACTIONS** — telling is an action
taken on a turn, not a background process. Motives, all already modelled:

- **the company need** — telling meets company for both, so a lonely person
  spreads news because they want the conversation. The motive is already built.
- **value to the listener** — the same subject matching lore uses, so what
  reaches you tends to be about you.
- **standing and obligation** — you tell people you trust, owe, or want
  something from. Secrets travel along loyalty rather than proximity.

### Player-facing

NPCs say it in conversation · you can ASK AROUND (an action, and a reason a
settlement exists beyond shops) · **it changes how people treat you before
anybody speaks** — which is where reputation stops being a number and becomes a
door already shut.

**And a new DATA tab on the sheet panel** — an encyclopedia of knowledge,
rumour, lore, people and the relationship graph. Note the distinction: NOT a
rumour checklist to chase, but a record of what you have come to know.
Tabs become: `status · inventory · skill · trait · signet · quest · data`.

### CROWDS DO NOT TAKE TURNS — the scaling correction

The user spotted a real problem in how I stated this: "if a person has to take
an action it means creating more NPCs than I can imagine". Correct, and the fix
was already decided — I described it badly.

- **Crowds are prose.** A city market has ZERO modelled people until somebody
  is individuated out of it.
- **Only `live` NPCs take turns** — bounded by DEGREES OF SEPARATION from the
  player ("seven person theory"), not by a headcount.

So a rumour must NOT be simulated person-by-person. **Model the medium, not the
messengers**, in two layers:

```
  dramatic   ≤7 live NPCs telling each other, on turns. WHO told WHOM matters.
             Lies, credibility and the correction arc live here.
  ambient    a PLACE knows a thing to a degree. No people involved.
             Anyone individuated inherits from it.
```

They meet at both ends: a live NPC arriving seeds the ambient field, and the
field is what a stranger already believes. Same shape as the region LOD — two
floors in full detail, the rest a gazetteer. **Ambient knowledge is the
gazetteer of rumour.**

Decided:

- **Ambient knowledge lives PER PLACE.** The market knows, the gate does not
  yet. Spreads along the map's existing connections, so geography shapes what
  has got around and asking in the right place is worth something.
- **Traffic moves it — news travels with people.** It stops when a road closes
  or a war cuts the way, which is exactly what the transfer-rule answer wanted
  (no deliverer, no delivery) and makes a cut road felt rather than announced.
- **An individuated stranger believes only what their own persona would
  plausibly know** — the place's field filtered through their trade, standing
  and interests. I had flagged this as "inverting the lazy order"; that was
  WRONG. Individuation already generates the persona as its first step, so
  filtering through it costs nothing extra.

### Dependencies

The belief model itself is UNBLOCKED and can be built now — it is a persona
field plus a closed `Claim` union plus correction. Spreading needs the sparse
social graph and the agency scheduler, neither of which is built. The data tab
can be built over whatever exists.

### Items on the DISCOVERY path — quest and lore

Clarifying a question I first misread. Two links, both cheap:

- **QUEST → ITEM.** A quest leads you to an item, or grants one as a reward.
  Half of this already exists: quest steps complete on `TraitCondition[]`, and
  that union already has `carries` — "holds item X, at least N" — so *"find the
  Ashen Key"* is expressible today. Only granting an item as a reward is new.
- **LORE lives on the INSTANCE, not the type.** A type has a description; THIS
  sword has a history — who carried it, what it was made for, how it is meant
  to be used. That is precisely what instances are for, and it is safe model
  territory because it is pure flavour, with `stripMechanics` already guarding
  the line where flavour tries to invent numbers.

Refine randomness is **seeded from `(instance id, level)`** — so refining this
axe to +4 always gives the same numbers, on replay and again after an enhance
reset. Same keying as node grants and subclass skills, which are deliberately
keyed on their own id rather than the world seed.

### Scope, honestly

With shapes, instances, durability, components, refine/enchant/enhance,
crafting, containers, transfer rules and trade, **the item system is now larger
than combat.**

## GEAR SLOTS — the ruleset defines them

> **FLAGGED, TO DISCUSS BEFORE BUILDING:** the INVENTORY SYSTEM is reworked in
> the same pass as gear. Slots, durability, repair kits, materials and
> encumbrance all land on it at once, and the current inventory is a flat stack
> list with a three-slot `equipped` map — it will not carry that weight. Do not
> start the gear work until the inventory design is settled.


Slots are **per-world, declared by the ruleset** (the economy/loot axis), not a
fixed enum. Wanted baseline: ring, bracelet, necklace, head, body, leg, foot,
main weapon, offhand — two-handers consuming both hands.

Consequence: every item, node gate and UI grid must handle a slot set it cannot
know in advance. `Item.slot` stops being a union
([items/types.ts](src/items/types.ts)) and `equippedGrants` — which feeds
`finalAbilities` — iterates whatever the world declared. The planned `equipped`
node condition gates on a slot id that must be validated against the ruleset.

## OUTSTANDING PRE-EXISTING WORK, and where it lands

```
  node stat + gear gates, `equipped`   old step 5    → gear slots
  NodeGrant widen (resist, discount)   old step 10   → component effects
  Signet.grant / augments DEAD         3 commits     → world rules (exemption)
  Signets waive a path gate            old step 11   → world rules
  9-stat point buy, class cards        old step 8    → creation page
  usesPerRest vestigial                             → component effects (delete)
  `frightened` missing CONDITION_PRICE               → component effects
  scripts/skillgen.ts BROKEN           imports a deleted file
  agenda.ts dead                                     → NPC agency
  Gazetteer.openThreads never written                → quests
  godown/descend unwired                             → world rules (movement)
  combat.ts:268 `spent` unmutated                    → dies with usesPerRest
  bonus actions / reactions            combat pass   → reactions pair with guard
  path gate tuning 10–15 vs 12–13                    → after persona
  .env.example LAN IP 192.168.0.108    PUBLIC        → standalone, one line
```

New combat machinery the design pulls in: mid-fight initiative insertion
(summon) · ally AI and party initiative (companions) · a damage redirect hook
(guard) · temporary stat modifiers with a timer (the `stat` channel) · a
duration clock for sustained effects.

## ACTION IS THE PRIMITIVE (decided 2026-09-04)

User: *"action is basic in this game, skill is one kind of action"*, and
*"it should not be a narrative/flavored text, action make consequence"*.

**I DREW AN EARLIER LINE WRONG.** I said "skills act on the tactical layer, the
world handles social causation". The real objection to rumour/bind/exempt was
that they need not be SKILLS — not that the effects are wrong. Their home is
action consequences.

### One shared consequence vocabulary

The component system is not the skill system — it is the **action system**. The
same components describe a sword blow, a conversation and an enslavement.
Channels widen past hp/stamina/mana/stat/condition to include **trust,
temperament, needs, knowledge, quest progress and control**.

`WorldDelta` — today ten hand-written verbs
([state.ts:57](src/play/state.ts:57)) — becomes a list of these effects. One
pricer, one resolver, one validator. Skills are one CAUSE of effects; most
social effects are caused by other actions.

**Skills work outside combat too.** `ActiveKind` is already dying; mind control
used outside a fight is enslavement, and that is a legitimate use, not an
exception.

### Consequence needs three things that do not exist

1. **Witnesses** — who saw it. Nothing tracks this.
2. **Propagation** — deeds spread along the social graph exactly as rule
   knowledge does. ONE mechanism for rules, rumours and deeds.
3. **Reputation** — `Gazetteer.reputation` exists, defaults to 0, and is
   written by nobody ([lod.ts:46](src/world/lod.ts:46)). This is its job.
   **Fifth dead field.**

So enslaving someone is not a paragraph. It is: `stance` flips and their purpose
is replaced by yours · trust collapses · witnesses learn it · the deed
propagates · reputation drops where it reached · a counter increments · your
ACTUAL archetype drifts from your declared one · and if the ruleset forbids
compulsion you have broken a rule, which is itself a fact people can know.

### NPC decisions are LOGGED, not recomputed

Every NPC decision is an event. Volume is trivial (~3,500 over a 500-turn run
with 7 live NPCs). What it buys is the thing that matters: **the decision
function stops being part of the save format.** Recomputing means tuning the
scoring retroactively rewrites what every NPC did in every existing run.

**Non-determinism and replay do not conflict.** Score the options from
temperament, drives and needs, then ROLL among them on a per-NPC-per-turn
seeded stream — the same trick `combatRng` already uses
([combat.ts:61](src/play/combat.ts:61)). Same persona and same purpose yields a
DISTRIBUTION, not an answer. Unpredictable to the player, exact for the engine.

### Simulation depth is a world setting

*"tower and world rule they got difference situation"* — economy depth, and
simulation depth generally, are RULES. A small tower runs code-only decisions
and no economy; a deep social world spends model calls on the live set and
tracks trade. Default cheap, opt in to expensive.

### The social graph is SPARSE

NPCs hold trust and disposition toward EACH OTHER, but an edge forms only where
they actually interact — a shared place, purpose or deed. Not N². This is the
graph deed and rumour propagation travels along, so it pays for itself twice.

`loyalty` therefore lives on an EDGE, not on a person. That is why it never had
a reader: "devoted" was never a property of somebody on their own.

## PERSONA REBUILD — needs, drives, temperament (decided 2026-09-04)

### What was wrong with the old shape

- **Three models bolted together.** warmth ≈ Agreeableness, nerve ≈ inverse
  Neuroticism, discipline ≈ Conscientiousness — Big Five with Openness missing.
  `candour` is a behaviour, not a trait. `loyalty` is a relationship.
- **Disposition is not one of the 5D dimensions — it is their OUTPUT.** The
  source document's own conclusion says behaviour is the end result of hardware,
  drives, role, environment and time.
- **`morale` is filed wrong** — −3..+3 like an axis, sitting among 0..10
  resources.
- **`mental` duplicates the pools** — stress docks max mana, fatigue docks max
  stamina, but CON and VIT already own those.
- **Everything is a deficit.** Exhausted, rattled, demoralised — never rested,
  steady, inspired.

### The new shape

```
  temperament   STABLE   how someone is wired. Does not emerge from need.
                         intuition · feeling · nerve · discipline
  preferences   STABLE   likes and dislikes. What makes two people with the
                         same needs act differently.
  drives        SLOW     want + fear. What they are chasing.
  needs         FAST     rest · safety · food · company · purpose  (0..10)
  ---------------- derived, not stored ----------------
  disposition   warmth, candour and the rest, computed as OUTPUT for prose,
                trust registers and checks
  mental        "rattled", "exhausted" — computed from unmet needs
```

**Temperament is `intuition · feeling · nerve · discipline`.** None of these
emerge from being hungry or unsafe. `warmth` and `candour` become DERIVED,
because how warm or how open someone is genuinely does depend on who they are
with and what they need from them.

**All five needs confirmed**: rest (was `fatigue`, docks stamina) · food (new —
what gives an economy something to be about) · safety (was `stress`, docks
mana) · company (unmet by isolation — makes a solo climb cost something
measurable, and gives companions a mechanical reason to exist) · purpose (was
`morale` — high when actions serve the drive, low when they betray it; the join
between the WHY layer and the fast layer, and what makes an NPC abandon a
purpose going nowhere).

### PREFERENCES — the Sims layer

User: *"like the sim i think. on top of that add want too. something prefer,
likes."*

Needs are universal; **preferences are what individuate.** A short list of
likes and dislikes per person, drawn from a CLOSED vocabulary (same principle as
everywhere else — the model dresses a preference, never invents one).

This is the cheap route to real variety: four temperament numbers can only make
so many distinct people, but a handful of likes from a wide vocabulary makes
everyone distinct. It also feeds the seeded decision roll with something
characterful rather than merely random.

Preferences range over all four categories: **people** (by trait, tag,
standing) · **places** (kind, biome) · **activities** (action kind) · **things**
(items, food, creatures).

They push on **decision bias, need satisfaction and trust formation** (defaulted
— user did not object): a liked action scores higher, a liked thing satisfies
its need further, and shared likes or clashing dislikes move trust when two
people meet.

**THE PAYOFF IS EMERGENT CHARACTER TYPES.** User: *"so it make people have
BDSM, manipulator, Holy saint, pure evil, planed culprits, hot-head idiot,
timid guy etc."* — none of those are authored labels. They fall out of
temperament + preferences + drives + deeds, which is exactly what the DERIVED
archetype (the WHAT dimension) computes. The loop closes: no archetype table is
needed, because an archetype is a reading of the other layers.

**Needs are one mechanism with two consumers**: they are the player's condition
AND the NPC decision function's input, which is exactly the "they have an
economy, live and continue their life" ask. The economy sits on the same
substrate.

### Scale: −10..+10 stored, bands shown

Stored wide so drift is gradual and formulas (and the signed suitability budget)
have room; rendered as the same handful of words the player already sees. Only
`clampPersonality` and the UI `AxisBar` care. Drift stops being a step function
of one-sixth of the range — which is what `pressure` was invented to work
around.

## RELATIONSHIPS (decided 2026-09-04)

Today an edge is ONE number: `Person.trust`, NPC→player only, and
`registerTrust` merely shifts how it is READ
([persona.ts:155](src/character/persona.ts:155)). That is the entire model.

**Edges are DIRECTIONAL and form on interaction** — a shared place, purpose or
deed. A→B and B→A may disagree completely, which is what makes unrequited love,
one-sided grudges and mistaken trust expressible. The shopkeeper who loves the
MC needs exactly this.

**Most axes are STORED.** User's call, made after the risk was flagged:

```
  stored    trust · regard · fear · desire · obligation · loyalty · respect ·
            resentment · envy · guilt · familiarity
            + roles (see below) · history (deeds) · secrecy
  derived   dependence — falls out of the needs system for free; storing it
            would duplicate state
```

### Roles, not "relation kind"

A relation is not a symmetric label. It is a **role, and roles come in converse
pairs** — the edge stores A's role toward B, and a converse table keeps B→A
consistent and checkable.

```
  father ↔ son/daughter      husband ↔ wife       master ↔ servant
  uncle  ↔ nephew/niece      seducer ↔ seducee    creditor ↔ debtor
```

- **A pair holds SEVERAL roles at once** — your brother may also be your
  creditor and your rival. Roles are a SET per edge.
- **Triangle roles are DERIVED, never stored.** Cuckold is not an edge: A is
  married to B, B has a secret lover C, so A stands in that relation to C. It is
  a reading of the graph. Same for in-law, step-kin, heir, love-rival,
  kin-of-your-victim.
- **Secrecy is per-KNOWER, not a boolean** — and it is free, because **a
  relationship is a FACT**. `world.facts` already exists and already propagates;
  who knows that B and C are lovers travels the same machinery as rule knowledge
  and deeds. One mechanism, third use.

### The world GENERATES its roles

User's call, over the cheaper options. Justified by two cases a fixed set cannot
express: matrilineal inheritance through the mother's brother (right word, wrong
SHAPE), and oath-siblings — kin obligation between non-kin, which degrades to
"friend" without its own slot.

**Made safe by composing mechanics from closed primitives.** The world invents
the role and its name; each generated role must declare:

```
  converse       mandatory — every role names its opposite
  obligations    from a closed list: obedience · support · coin · secrecy ·
                 inheritance · protection · shelter — and which way it flows
  permissions    what it allows that a stranger cannot — give orders, enter
                 their home, use their goods, be alone with them
  prohibitions   what it forbids
  defaults       what the axes open at (a father edge starts high on obligation
                 and regard; a captor edge high on fear) + secret by default?
  lifecycle      what creates it — birth, oath, purchase, conquest, a rite —
                 and what ends it: death, payment, betrayal, release
```

So a matrilineal world emits `mother's-brother ↔ sister's-child` with
`obliges: inheritance`, and the engine answers "who inherits?" without knowing
the word. Same split as everywhere: **the model dresses, the code decides.**

Permissions matter more than they look: a relationship changes **which actions
are offered**, not merely the numbers on them.

Seed shapes for the generator (templates, not a fixed list): kin · bonded ·
power · exchange · standing · sworn/chosen (oath-sibling, adopted kin) · life
debt · blood feud (**propagates along the kin graph automatically** — killing
one person can make a family into enemies with nobody authoring it) · custodial
(carer, healer, protector — sits on the needs system) · creator/created
(summoner, maker — explains a summon's loyalty through the same edge machinery
rather than a combat special case) · ritual · territorial (host/guest) ·
professional · antagonistic · reputational · illicit · tower-specific (sponsor,
party-leader, rival climber, warden).

`loyalty` moves here off the persona. It never had a reader because "devoted"
was never a property of one person on their own.

**THE RISK, AND ITS MITIGATION.** The failure mode of a rich relationship model
is a dozen numbers all hovering near zero because nothing pushes any one of them
hard enough. The fix is not fewer axes — it is proving each is written:

> **Every stored edge axis must have at least one writer, proved by a test.**

This is the generalisation of the existing writer proof in `counters.test.ts`
([traits.ts:96](src/play/traits.ts:96)), and it is the same discipline that
would have caught `people_met`, `mental`, `Signet.grant`, `agenda.ts`,
`openThreads` and `Gazetteer.reputation`.

## Scope, stated honestly

This is now NINE systems: replay fix · world structures · quests · NPC agency ·
persona parity · body/appearance · gear slots · component skills · a
world-creation flow to configure it all. That is a rewrite, not a pass.
Sequencing is the live question.

---

# THE RULE REALIZATION — every system becomes rule-driven

> User: *"every system must rely on rule so they can go from deepest realism to
> simple game… convert them to use rule, have every rule deepest, widest and
> efficient."*

## Context

`ARCHITECTURE.md` is written and the codebase is understood. This is the
directive that reshapes all of it: **the ruleset becomes the master
configuration of the whole game.** Every system is implemented at maximum depth
and dialed *down* by rule, so one engine serves both a survival sim and a light
tower game.

## The core principle: IDENTITY VALUES, ONE CODE PATH

**Never branch on a rule. Always run the deepest implementation, and let
"simple" be that same code with its dials at neutral.**

```
  hydration off      the need is pinned at MET      → every formula unchanged
  durability off     wear rate = 0                  → items never degrade
  no permadeath      death-save failure cap = ∞
  agency simple      promotion cap = 0              → the tier never rises
  abstract combat    grid = 1×1                     → everyone is in reach
  nobody changes     drift threshold = ∞
  no economy         NPC trade radius = 0
```

Why this and not `if (rules.survival === 'simple')`: fifteen systems × N modes
is a combinatorial test surface, and the simple path rots because nobody plays
it. With identity values there is **one path, always exercised**, and adding a
rule later is free because the deep path already exists.

**Corollary — the plumbing is small.** Rules only need to reach the places that
WRITE (decay, wear, promotion, spawn) and the places that GATE (may this person
move, may this be claimed). Everything that merely READS derived state is
untouched: `maxStaminaFor` never learns whether hydration is tracked, because an
untracked need is simply MET.

## The Ruleset is a game config, created with the world

Same three doors as everything else: **describe it** (inferred from the world
background), **take a preset**, **set it by hand**. Named presets resolve to
parameters; the code only ever sees numbers. A preset is overridable field by
field.

**Plumbing** — `Ruleset` lives on the `World` (jsonb, so it replays for free and
needs no migration) and is threaded as an argument to the pure functions that
read it. Two additions beyond the obvious:

1. **Amendments are logged events.** Rules must be able to change mid-run or a
   Signet exemption, a learned rule and a story that alters the law are all
   impossible.
2. **One resolver: `ruleFor(world, subject, axis)`.** A rule names who it binds
   and an exemption is per-person, so effective rule = base + amendments +
   the subject's exemptions.

## Every system, converted

| system | parameters | identity (simple) | deepest |
|---|---|---|---|
| **Survival** | which needs tracked · decay per need · environmental multipliers | all needs pinned MET, decay 0 | rest·food·water·safety·company·purpose·warmth·air·hygiene, each decaying, with temperature and altitude multiplying decay |
| **Health** | regen rate · death saves · permadeath · wounds | full regen, no permadeath | food and water drive regen; lasting wounds; death is final |
| **Pools** | cost multiplier · ceiling formula · regen | cost ×0 — skills are free | needs cap ceilings, casts overdraw, exhaustion |
| **Combat** | grid size · tick budget · casts · morale · summons · ally AI · friendly fire | grid 1×1, one action each | full tactical: positioning, LOS, tempo, wind-ups, morale breaks, summons |
| **Gear** | slot set · wear rate · repair · encumbrance | wear 0, weight ∞, 3 slots | 9+ slots, two-handers, durability, repair kits and materials, carry weight |
| **Economy** | trade radius · price elasticity · production | radius 0 — no NPC trade | NPC needs drive demand, scarcity moves prices, production chains |
| **Progression** | XP rates · level cap · tree size · gate thresholds | current values | deep tree, hard gates, respec cost |
| **Persona** | dimensions tracked · drift threshold · decay | threshold ∞ — nobody changes | full 5D, preferences, drift, derived labels |
| **Relationships** | axes tracked · roles on · propagation radius · secrecy | trust only, radius 0 | every edge axis, generated roles with obligations, rumour, reputation |
| **NPC agency** | max tier · promotion DEPTH (degrees of separation) · decision driver | max tier = static | live NPCs climbing, taking tasks, colliding with you |
| **Knowledge** | visibility of others · rule discovery · witnesses · rumour speed | all visible, rules known | nothing known until learned; deeds propagate; secrecy per knower |
| **World** | strata · topology · static/dynamic · danger curve · floor count | one stratum, stack, danger = floor | nested strata, graph topology, frozen floors, arbitrary danger curves |
| **Quests** | sources enabled · graph depth | none | stratum arcs, NPC purposes, tower trials, PC-authored, branching |
| **Access** | who may cross · descend · leave | player unbound, NPCs home-bound | every movement governed, exemptions by Signet |
| **Time** | granularity · day/night · calendar | turn counter only | clock time, day/night affecting needs and NPC routines |

## The wider rule set (all confirmed)

| system | parameters | identity (simple) | deepest |
|---|---|---|---|
| **Death & continuation** | permadeath · heir · checkpoint · **time loop** | respawn | the loop is feasible because the log already replays — "the floor resets, memories do not" is a rule, not a rewrite. An heir inherits relationships and reputation, not a sheet |
| **Ascension rank** | rank ladder · what each gates | rank always sufficient | the tower formally grades you; floors gate on rank rather than depth, giving the climb a second progression axis |
| **Carryover** | what survives a run | nothing | knowledge of rules, reputation, a stash |
| **Factions** | groups · standing · quarrels | none | mostly COMPOSITION of the relationship edges, quest objects and NPC agency already planned |
| **Law & crime** | what is illegal · enforcement · sentencing | no law | gives the witness → propagation → reputation chain teeth; not being seen becomes a build |
| **Language** | tongues · who speaks what · translation | everyone understands you | the world already carries `language` and `register.ts` already models HOW people speak; a translator becomes a valuable companion |
| **Culture & taboo** | customs · greeting forms · taboos | one culture | `Region.culture` exists and is decorative. Register keys on trust today; culture becomes its second key |
| **Weather & seasons** | patterns · severity | none | drives the survival needs — cold burns food and rest faster, a storm closes a route |
| **Ecology** | population · depletion · recovery | infinite spawns | clearing a floor has consequences; hunting is a resource decision |
| **Disease** | contagion rate · vectors · cures | none | rides the SAME propagation graph as rumour and deeds — one mechanism, third use |
| **Persistence** | what stays changed · rebuild rate | nothing changes | the difference between a world you visit and one you affect |
| **Power & corruption** | source · who may draw · permanent cost | power is free | the cost-as-effect design makes corruption nearly free: a skill whose cost takes something that does not come back |
| **Species & kind** | kinds · their needs · lifespans | one kind | a construct does not eat. Multiplies the persona system with almost no new machinery, since needs are already per-person |
| **Sheet visibility** | what the player may see of themselves | everything shown | a world where you must infer your own strength — a redaction rule, not a system |
| **Director permissiveness** | how readily the world says yes | current strictness | highest ratio of felt change to code on the whole list |

## THE PHYSICAL LAYER IS THINNER THAN ITS OWN DOCUMENTATION

Found while answering "what does the physical system do now". **This blocks the
survival and durability work** — both assume a physical layer that is not there.

Works today: HP and its ceiling from VIT · stamina docked by unmet rest · the
eight conditions with real combat effects · the tick budget from AGI · grid
position, size and line of sight · death saves.

Claimed and NOT implemented:

```
  VIT physical DEF      AC = armour + DEX mod. VIT contributes nothing
  VIT stun resistance   nothing anywhere reads VIT for a save
  VIT HP recovery       a short rest heals a flat maxHp/4; VIT sets the max only
  STR carrying          NO weight or encumbrance exists at all — and
                        `stripMechanics` actively deletes "Weight: 3 lbs"
                        from generated item text
  STR forcing           STR is only ever a weapon's attack ability
  AGI evasion           AC never reads AGI; AGI drives only tick cost
  CON poison/disease    no disease exists; poison never consults CON
  speed                 a hardcoded 6, derived from nothing
```

**Encumbrance is the load-bearing gap.** Durability, repair kits and materials
all assume carrying has a cost. Either make these claims true or correct the
documentation — but do it BEFORE layering survival depth on top.

## Work order — SUPERSEDED by THE ORDER at the top of this file

0. **Close the physical gap** — encumbrance from STR, VIT into defence and
   saves and recovery, AGI into evasion, speed derived. Or correct the stat
   docs. Survival and durability depend on it.
1. `Ruleset` type + presets + `ruleFor` resolver; stored on `World`.
2. Convert the systems that already exist to read parameters instead of
   constants — **survival, pools, health, gear, persona, progression**. Each is
   a constant becoming a lookup, with today's value as the default preset, so
   nothing changes behaviour on day one.
3. Rule amendments as a logged event kind; Signet exemptions on top.
4. The creation-page rules view (three doors, overridable).
5. New depth only after the dial exists for it: hydration and the wider needs,
   durability and repair, economy, agency, quests, strata.

## Verification

- **Default preset reproduces today's behaviour exactly** — the whole existing
  test suite must pass unchanged after step 2. This is the proof that the
  conversion is a refactor and not a redesign.
- **Identity values are genuinely neutral**: a world with every dial at identity
  must produce the same numbers as one with the system removed.
- **No rule is read by nothing** — extend the writer/reader proof to the
  `Ruleset`, since a config field with no consumer is the same bug in a new hat.
- `npm run fight` across presets: the difficulty curve must hold at each depth.

---

# STEP 1a½ — ARCHITECTURE.md ✅ DONE

Written to `ARCHITECTURE.md` at the repo root. Keep it current as the rewrite
proceeds — in particular the dead-field ledger and the tuning-knob table, which
the rule realization turns into the `Ruleset`'s parameter list.

Findings it produced, which reshaped the plan:

- **Signets are half-built, not unbuilt.** `SignetView.available` says "can be
  claimed" and the panel renders a "within reach" tag, but no action claims one.
- **Pools reset to full every fight** — `playerCombatant` does not carry
  `pc.stamina`/`pc.mana` in, `concludeCombat` does not carry them out.
- **`Trait.grants.note` has no reader.** Correction to an earlier overstatement:
  emergent traits are NOT payout-less — they always grant `opens`, and the
  note being flavour-only is deliberate ([emergent.ts:166](src/play/emergent.ts:166)).
  What is lost is the twelve authored traits' distinct notes.
- **Three of eight scripts are broken**, because `tsconfig.json`'s `include`
  covers `src/**` and `app/**` only — `npm run typecheck` has never looked at
  `scripts/`.
- ~20 dead fields catalogued.

## Contents

1. **Every system** — the directory map, what each module owns, the layer
   boundaries and which layer may import which.
2. **All stored data** — the DB schema and every persisted shape, field by
   field, with what is a denormalised cache called out.
3. **How they work together** — the dependency shape, and what is DERIVED
   rather than stored (`derive`, `finalAbilities`, `dispositionOf`,
   `toCombatant`, the pool ceilings, `registerTrust`, `progressOf`).
4. **The workflows** — creation from the new-game page to the first playable
   turn, and one play turn from typed text to prose, including the combat
   sub-flow, rest, climb and panel actions.
5. **Invariants, and why each exists** — the determinism contract (log is
   truth, state is a fold, snapshots are a cache), the `redact.ts` wall, closed
   unions never free text, "the code supplies structure, the model supplies
   flavour". These are what a future change must not break.
6. **The dead-field ledger** — every field generated and read by nobody, plus
   the writer/reader proof pattern that catches them. This codebase's signature
   bug, written down so the ninth instance does not happen.
7. **Tuning knobs in one table** — point buy, `HP_AT_FIRST`, `POOL_BASE`,
   `TURN_LENGTH`, `PERSONALITY_THRESHOLD`, `danger === floor`, every generation
   budget. Currently scattered across a dozen files with no index.
8. **Generated vs authored vs seeded**, and the full LLM contract — every
   schema, what each call may and may not decide, temperatures, and the
   fallback when the model is unavailable.
9. **Glossary** — path, stratum, Signet, declared vs emergent trait,
   temperament vs disposition, register, Director vs Writer.
10. **Known deviations** — where the code does not yet match the design intent.

## Verification

Every claim carries a `file:line`. Spot-check the load-bearing ones against the
source rather than trusting the summary — particularly the derived-vs-stored
table and the dead-field ledger, since both are claims about absence.

---

# STEP 1b — EXPRESSING 5D  (its WORK list is superseded; the decisions stand)

## Context

Step 1's persona core has LANDED and is green (707 tests): temperament
(`intuition · feeling · nerve · discipline`, −10..+10) and needs
(`rest · food · safety · company · purpose`, 0..10) are stored, disposition and
mental phrases are derived, and `writers.test.ts` proves every stored field is
written by something the engine can emit. That proof immediately caught four
real bugs, including `rest` being a `DriftCause` that `causesFor` never emitted.

Two problems remain, and the user asked to fix both.

**`food` and `purpose` are written and read by nobody.** Only `describeMental`
touches them, and that is prose. Same bug class as the six dead fields already
on record — the writer proof checks that fields get WRITTEN, not that anything
READS them.

**Only 2 of 5 dimensions reach the surface.** HOW is direct in the disposition
formula and WHERE arrives through needs. WHY has its channel built (`purpose`)
but capped. WHAT is downstream by design. WHEN does not exist.

## Decisions

- **`food` → HP regeneration**, per turn, out of combat, scaled by satisfaction.
  There is NO regen anywhere today — HP returns only from rest and heal items —
  so this creates a channel rather than modifying one, which is the point: food
  becomes a continuous pressure instead of mattering only at camp.
- **Everything applies to NPCs too.** `Persona` is already shared; the
  constraint is that every new channel reads a `Persona`, never a
  `CharacterSheet`. HP regen is the exception (PC and companions only).
- **`dispositionOf` is reworked.** As written, `pull` clamps to −3..0 against a
  `bandOf` of −3..+3, so circumstance can cancel wiring entirely and a starving
  hunted person's temperament stops showing. **Circumstance colours, wiring
  dominates**: cap the needs contribution at about half. It also takes a whole
  `Persona`, so age and drive can modulate without a growing argument list.
- **Framework labels are DERIVED, never stored.** A stored "INFP" is a label
  over the axes: two sources of truth that drift apart (this codebase's
  signature bug), 16 buckets that cannot scale a formula or the signed
  suitability budget, and an Enneagram type IS a (desire, fear) pair — the same
  information as the drive, stored twice.

```
  HOW    MBTI          S/N=intuition · T/F=feeling · J/P=discipline
                       E/I has no clean source; company need as an
                       acknowledged proxy
  WHY    Enneagram     a (core desire, core fear) pair — REQUIRES the drive
                       to come from a closed set, not free text
  WHAT   Jungian 12    the "actual" archetype, from temperament + needs +
                       counters + deeds. Emerges from play.
  WHEN   developmental Erikson-shaped, from age band + arc position
  WHERE  none          no taxonomy exists — derive a SENTENCE (stratum,
                       standing, which rules bind them, who is present)
```

Rule: **derive a label where a real framework has a closed taxonomy our stored
data determines; derive a sentence where it does not.**

Labels go to the Director, the Writer AND the panel — but always ALONGSIDE the
numbers and prose, never instead of them. A model handed "INFP" alone writes the
internet's INFP rather than this person; the specifics are what override the
cliché.

- **VISIBILITY IS A RULE.** What the player may see about another person belongs
  in the ruleset (the memory/knowledge axis), not hardcoded. One world shows a
  full profile on sight — the tower-manga appraisal window; another shows only
  what you have learned by interacting. It reuses `redact.ts` and `assertNoLeak`,
  the wall that already exists, and later becomes a target for a `read` skill or
  a Signet exemption.

## Work

1. **Rework `dispositionOf`** ([persona.ts](src/character/persona.ts)) — take a
   `Persona`; cap the needs contribution so wiring dominates; wire
   **`purpose` → nerve and discipline** (someone with nothing to hold together
   FOR frays). Closes the WHY channel.
2. **HP regen from food.** New, in the fold so it replays — alongside the drift
   application in `applyTurn` ([delta.ts:292](src/play/delta.ts:292)). Out of
   combat only. PC and companions.
3. **Combat carries persona** — it reaches no fight at all today:
   - condition resistance: `nerve` vs frightened, `discipline` vs stunned, at
     the single chokepoint in [conditions.ts](src/combat/conditions.ts), capped
     short of immunity (pairs with the planned `NodeGrant.resist`)
   - death saves nudged by `purpose` — the most evocative place a drive reads
   - morale: low `nerve` + low `safety` breaks a wounded foe ([ai.ts](src/combat/ai.ts))
   - AI targeting reads persona — enemies as people, not a policy
4. **Cognition → checks** ([turn.ts:120](src/play/turn.ts:120)) — temperament
   biases the check modifier by ability, reusing the existing `edge` slot. Both
   sides: the NPC's too, via `oppositionOf`.
5. **Cognition → voice** ([register.ts](src/llm/register.ts)) — the best surface
   there is. Metaphor vs plain speech, ledger vs values, and age.
6. **Director and Writer learn the PC** — today the Director gets three lines
   ([director.ts:207](src/llm/director.ts:207)) and the Writer gets a name and a
   pronoun ([redact.ts:50](src/llm/redact.ts:50)), strictly less than either
   knows about a villager.
7. **The missing dimensions**: `drive` (want + fear, structured from the
   discarded interview answer, **closed vocabulary** so Enneagram maps),
   `archetype` (declared stored, actual derived), `age` band, and `body`
   (structured, mutable). Touches `schema.ts`, `genesis.ts`, `floorgen.ts`.
8. **Derived labels** — `mbtiOf`, `enneagramOf`, `archetypeOf`, `stageOf`, and a
   context sentence for WHERE.
9. **Persona visibility as a rule** — a simple flag now, promoted to a proper
   ruleset entry at step 3.
10. **Extend the proof to READERS.** `writers.test.ts` checks writers; add the
    other half — every stored temperament axis, need and (later) edge axis must
    have a MECHANICAL consumer, not merely a prose one. This is what would have
    caught `food` and `purpose` at birth.

## Verification

- `npm run check` at every step.
- The new **reader proof** must fail before step 1 and pass after.
- **NPC parity**: assert every channel is driven from a `Persona`, so an NPC and
  the PC take the same path — no channel may require a `CharacterSheet`.
- **Circumstance never erases wiring**: a bold person and a timid one under
  identical deprivation must still differ on `nerve`.
- **Labels never disagree with their source**: for random personas, the derived
  MBTI letters must follow the sign of the axes they come from.
- **Regen replays**: a session folded from the log reaches the same HP as the
  live run, with no snapshot.
- `npm run fight -- 6 6` after condition resistance and morale land — both are
  difficulty-curve levers.
- **Browser**: create a character, confirm the panel shows needs, disposition and
  the derived labels; talk to an NPC and watch register shift; go hungry and
  watch regeneration stop.

---

# THE PLAN — SUPERSEDED by THE ORDER at the top of this file

Sequencing was never picked, so it is DEFAULTED to the order below. Two
constraints forced it: gear slots come after world rules (the ruleset defines
the slots), and companions/summon/mind-control share machinery so they build
together.

Pre-existing debt is **folded into the step that touches it** — no cleanup
phase. Only the LAN IP goes alone, because it is public now.

### Step 0 — unblock
- `.env.example`: replace `LOCAL_LLM_URL=http://192.168.0.108:1234/v1` with a
  placeholder. It is committed to a public repo.
- **Log floor generation as a `{kind:'floor'}` event**; add to `FOLDED_KINDS`
  ([sessions.ts:72](src/db/sessions.ts:72)). Restores the stated invariant that
  snapshots are a disposable cache — currently false for any session that has
  climbed. Everything dynamic depends on this.
- Delete all saves.

### Step 1 — persona and relationships
- `Personality` → **temperament** (`intuition · feeling · nerve · discipline`),
  stored −10..+10, rendered as bands.
- **Needs** (`rest · food · safety · company · purpose`, 0..10) replace
  `mental`. `stress`→safety, `fatigue`→rest, `morale`→purpose.
- **Preferences** — closed vocabulary over people, places, activities, things.
  Push on decision bias, need satisfaction and trust formation.
- **Drive** (want + fear) — structured from the interview answer that is
  currently discarded ([interview.ts:58](src/session/interview.ts:58)).
- **Archetype** declared (stored) + actual (derived from temperament,
  preferences, drives, deeds). No archetype table needed.
- `age` band; structured mutable `body`.
- Disposition and mental-state descriptions become DERIVED.
- **Relationship edges**: directional, formed on interaction, sparse. Axes as
  listed above; generated roles with the six primitives; triangle roles derived.
  `loyalty` moves off the persona onto the edge.
- **Director and Writer finally get the PC's persona** — today
  ([director.ts:207](src/llm/director.ts:207)) the PC gets three lines while
  NPCs get `describePersonality` + `describeMental`.
- Proof: every stored temperament/need/edge axis has a writer, as
  `counters.test.ts` proves for counters.

### Step 2 — actions and component effects
- One shared consequence vocabulary. `WorldDelta`'s ten verbs become a list of
  effects. Skills are one CAUSE of effects.
- Effect components: sign · channel · who · shape · when · duration · formula,
  each tagged `purpose` or `cost`. Effects are a LIST (drain and hex were always
  two effects fused).
- Grammar: per-axis allow-lists per stat (widening `STAT_GRAMMAR`) + a short
  forbidden-pair table.
- **Suitability**: derived from components, overridable; ONE SIGNED shared
  budget across cost, magnitude, ticks and out-of-combat checks. Mismatch goes
  negative.
- Special verbs: displace · interrupt/cleanse · taunt · grid (terrain, blink) ·
  tempo (steal, echo, overdraft, freeze) · protection (guard, stabilise) ·
  identity (swap HP, transfer, mirror, bank) · rule abuse (suspend, reroll,
  contradict, chain).
- **Deletions**: `ActiveKind`, `usesPerRest`, `usesLeft`, `refreshUses`,
  `SkillUses`, `combat.ts:268`'s unmutated `spent`. Price `frightened`. Fix or
  delete the broken `scripts/skillgen.ts`.
- New machinery: temporary ability modifiers with a timer; a duration clock.

### Step 3 — world rules, strata, gear
- Rule vocabulary over four axes (movement/access · memory,knowledge,death ·
  progression/power · economy/loot). Every rule declares `binds`; every check
  takes a SUBJECT. Removes the hardcoded `descend` refusal at floor 0.
- Three views (true / player / per-NPC) via the existing `redact.ts` +
  `assertNoLeak`. Rule knowledge per person, propagating.
- **A Signet is a rule exemption** — gives `Signet.grant`/`augments` their first
  reader in three commits.
- Strata: a nested TREE above floors, owning kind (static/dynamic/story), danger
  curve decoupled from depth, theme/culture/people, topology (stack or graph),
  and loot pools. A static floor is one whose generation event is never
  superseded. The outer world becomes a graph-topology structure, not `floor-0`.
- **Gear slots defined by the ruleset** (baseline: ring, bracelet, necklace,
  head, body, leg, foot, main, offhand; two-handers take both). `Item.slot`
  stops being a union; `equippedGrants` iterates what the world declared. Node
  `equipped` gates validate against the ruleset.
- Wire `godown`/`descend`.

### Step 4 — quests
- `Quest = { steps: Step[] }`, `Step = { id, requires: TraitCondition[], next }`.
  One step = a goal; a chain = ordered; several successors = a branch.
- Completion reuses `TraitCondition[]` and `progressOf` wholesale, so quests
  replay and display for free.
- Sources: stratum arc · NPC purpose · tower trial gating ascent · PC-created.
- `Gazetteer.openThreads` gets its first writer.

### Step 5 — NPC agency, spawning, economy
- Scheduler: `static | reactive | live`, promoted by proximity, stakes and
  contact along the social graph; demotion follows the WORLD RULES, not a timer.
  Soft cap from the world's rules + a hard cap on DEPTH (degrees of
  separation from the player), never a headcount.
- Decision function: temperament + preferences + drives + needs score the closed
  action vocabulary, then a **seeded per-NPC-per-turn roll** picks among them —
  a distribution, not an answer. Decisions are **logged as events** so tuning
  the scoring never rewrites existing runs.
- Revive `agenda.ts` (complete, correct, imported by nobody).
- **Witnesses → propagation → reputation.** `Gazetteer.reputation` gets its
  first writer. One propagation mechanism for rules, rumours, deeds and
  relationship facts.
- Spawning: a standing cast per stratum plus arrivals. **Crowds are prose;
  individuation creates a full persona on the spot, deterministically from the
  seed.**
- Economy rides on the needs substrate; its depth is a rule.

### Step 6 — companions, summon, combat machinery
Built together because they share everything: a non-player combatant on your
side, ally AI, and mid-fight insertion into `CombatState.order` (today "fixed
for the encounter"). Adds party initiative, the `guard` redirect hook in
`resolve.ts`, and `dominate` (flip `side`, or `controlledBy` so the player gets
their options).

### Step 7 — creation page
Two phases (world, then character), every section collapsed with a default
filled in. Three doors on every input: describe · select · preset. A preset is a
whole opening scenario. Rules shown as an overridable list. 9-stat point buy and
class cards showing favoured stats (old step 8). Personality proposed by the
model from the interview, adjustable before committing.

---

## Verification

- `npm run check` at every step.
- **Writer proofs, generalised** — the discipline that would have caught all six
  dead fields (`people_met`, `mental`, `Signet.grant`, `agenda.ts`,
  `openThreads`, `Gazetteer.reputation`): for every stored field on a temperament,
  a need, an edge axis and a `NodeGrant`, drive state that sets it and assert
  something downstream moves.
- **Replay determinism** — the existing `sessions.test.ts` claim (delete every
  snapshot, nothing changes but load time) must go from false to TRUE after
  step 0, and stay true through every later step.
- **Effect grammar** — no stat may produce a combination outside its allow-list;
  no forbidden pair is ever generated. Rewrite `compose.test.ts` against
  components.
- **Suitability is signed and bounded** — a mismatched skill is measurably
  worse; discount never breaches `MIN_COST`, ticks never breach
  `MIN_ACTION_TICKS`.
- **Rule checks take a subject** — no code path assumes the player is exempt.
- **Role converse consistency** — every generated role's converse exists and
  round-trips; obligations resolve to the closed primitive list.
- **Agency terminates** — the promotion cascade is bounded and produces an
  identical live set on replay.
- `npm run fight -- 6 6` — retune after needs replace stress/fatigue on the
  pools.
- **Browser end to end** — create a fantasy and a sci-fi world; confirm paths,
  classes and roles are named for their settings while the mechanics match.
  Raise a stat and watch a sealed path open. Enslave someone and watch the
  consequence graph fire: stance, trust, witnesses, propagation, reputation,
  archetype drift, and a broken rule if the world forbids compulsion.
