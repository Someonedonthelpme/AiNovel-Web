import test from 'node:test';
import assert from 'node:assert/strict';
import { dangerAt, eraOf, isLoop, stratumAt } from './strata.ts';
import { world } from './fixtures.ts';
import { rollCoin, rollLoot } from '../items/catalogue.ts';
import { mulberry32 } from '../engine/roll.ts';
import { FakeProvider } from '../llm/provider.ts';
import { runDirector } from '../llm/director.ts';
import { playState } from '../play/fixtures.ts';
import type { Stratum } from './types.ts';

/**
 * STRATA NEST. "Four dungeons inside a twenty-floor tower" means a dungeon is a
 * SUB-stratum, so the plan is a tree rather than a list — and the innermost one
 * containing a floor is the one that speaks for it.
 */
const tower: Stratum = { id: 'tower', name: 'The Tower', kind: 'dynamic', from: 1, to: 20 };
const dungeon: Stratum = {
  id: 'sunken', name: 'The Sunken Wing', kind: 'static', parent: 'tower', from: 8, to: 11,
  danger: { base: 20, perFloor: 0 },
};

const nested = () => world({ strata: { tower, sunken: dungeon } });

test('the innermost stratum containing a floor is the one that speaks for it', () => {
  assert.equal(stratumAt(nested(), 3)?.id, 'tower');
  assert.equal(stratumAt(nested(), 9)?.id, 'sunken', 'a dungeon inside a tower is still the dungeon');
  assert.equal(stratumAt(nested(), 40), null, 'and a floor outside every stratum belongs to none');
});

test('a stratum without its own curve inherits its parent, not the global dial', () => {
  const shallow: Stratum = { id: 'cellar', name: 'The Cellar', kind: 'static', parent: 'tower', from: 2, to: 3 };
  const w = world({ strata: { tower: { ...tower, danger: { base: 5, perFloor: 2 } }, cellar: shallow } });

  assert.equal(dangerAt(w, 3), 5 + 2 * 3, 'the cellar has no curve of its own, so the tower answers');
  assert.equal(dangerAt(nested(), 9), 20, 'and a stratum that does set one is not overruled by its parent');
});

test('a world with no strata at all still has a danger curve', () => {
  // Every world today. The stratum layer is additive: nothing is required to
  // declare one, and the ruleset dials remain the answer when nobody does.
  assert.equal(dangerAt(world(), 4), 4);
});

test('the Director is told which structure the player is standing in', async () => {
  // The reader that keeps `Stratum.name` from being one more stored word
  // nothing ever says. A dungeon inside a tower should read as the dungeon.
  const base = playState();
  const inside = {
    ...base,
    world: {
      ...base.world,
      strata: {
        tower: { id: 'tower', name: 'the tower', kind: 'dynamic' as const, from: 0 },
        sunken: { id: 'sunken', name: 'the Sunken Wing', kind: 'static' as const, parent: 'tower', from: 0, to: 2 },
      },
    },
  };

  const p = new FakeProvider({ structured: [] });
  await runDirector(p, inside, 'look around', 'exploration', []).catch(() => {});
  assert.match(p.allSentText(), /Sunken Wing/);
});

/* -------------------------------------------------------------------------- */
/* STRATA OWN LOOT                                                             */
/* -------------------------------------------------------------------------- */

test('a stratum owns its loot: one depth pays differently in two wings', () => {
  // "A world's economy is regional and a gear set lives somewhere specific."
  // `rollLoot` keyed on depth alone, so every floor of every structure paid
  // from one table and no wing could be known for anything.
  // Seed 13 at depth 5 drops a shortsword and a padded coat, so silencing the
  // categories is observable rather than vacuously true.
  const at = (loot?: Parameters<typeof rollLoot>[2]) => rollLoot(mulberry32(13), 5, loot);

  const ordinary = at();
  assert.ok(ordinary.some((d) => d.item.slot), 'this seed arms you in an ordinary wing');

  const barren = at({ weights: { weapon: 0, armour: 0, pack: 0 } });
  assert.ok(
    !barren.some((d) => d.item.slot),
    'and a wing that arms nobody drops nothing you can wear or swing',
  );
  assert.ok(barren.length < ordinary.length, 'the rest of the table is untouched');
});

test('one profile, one stream: a wing pays the same on every replay', () => {
  // The invariant replay actually needs. A profile is authored with the world
  // and never changes under a run, so the same fight rolls the same pack every
  // time it is folded. (Two DIFFERENT profiles do not produce comparable
  // streams — a silenced category skips its builder's draws too — which is why
  // this is stated as replay rather than as comparability.)
  const wing = { weights: { weapon: 0, armour: 0, book: 4 } };

  const first = mulberry32(13);
  const lootA = rollLoot(first, 5, wing);
  const coinA = rollCoin(first, 5);

  const second = mulberry32(13);
  const lootB = rollLoot(second, 5, wing);
  const coinB = rollCoin(second, 5);

  assert.deepEqual(lootB.map((d) => d.item.id), lootA.map((d) => d.item.id));
  assert.equal(coinB, coinA);
});

/* -------------------------------------------------------------------------- */
/* LAWS INHERIT (6c era E3a): a wing the model opens inside a band keeps the    */
/* band's laws, read from the innermost stratum that STATES each one.          */
/* -------------------------------------------------------------------------- */

const lawTower: Stratum = { id: 'tower', name: 'the tower', kind: 'dynamic', from: 0 };
const loopBand: Stratum = { id: 'loop', name: 'the loop', kind: 'dynamic', parent: 'tower', from: 1, to: 10, laws: { reset: 'untilCleared' } };
const eraBand: Stratum = { id: 'era', name: 'the eras', kind: 'dynamic', parent: 'tower', from: 21, to: 30, laws: { time: 'era' } };
const wingIn = (parent: string, from: number, laws?: Stratum['laws']): Stratum =>
  ({ id: `wing-${from}`, name: 'a wing', kind: 'static', parent, from, to: from + 2, ...(laws ? { laws } : {}) });
const banded = (...wings: Stratum[]) =>
  world({ strata: { tower: lawTower, loop: loopBand, era: eraBand, ...Object.fromEntries(wings.map((s) => [s.id, s])) } });

test("a wing inside a band keeps the band's laws", () => {
  const withWings = banded(wingIn('loop', 3), wingIn('era', 24));
  assert.equal(isLoop(withWings, 4), true, 'a wing inside the loop band still loops');
  assert.equal(eraOf(withWings, 24), eraOf(banded(), 24), 'and inside the era band keeps its year');
});

test("a law the wing states itself wins over its parent's", () => {
  assert.equal(isLoop(banded(wingIn('loop', 3, { reset: 'never' })), 4), false);
});
