import test from 'node:test';
import assert from 'node:assert/strict';
import { dangerAt, stratumAt } from './strata.ts';
import { world } from './fixtures.ts';
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
