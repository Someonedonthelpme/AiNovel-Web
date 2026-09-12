import test from 'node:test';
import assert from 'node:assert/strict';
import { crowdFighter, crowdMember, PROFESSIONS, RANKS } from './crowd.ts';
import { leavesUnder, speciesFor } from './species.ts';
import { groupsAt } from './habitat.ts';
import { scaleFoe } from '../combat/statblock.ts';
import { composition } from '../combat/encounter.ts';
import { ROLE_OF } from './crowd.ts';
import { maxHpFor } from '../session/sheet.ts';

const kinds = speciesFor(11);
const floor = 4;
const group = groupsAt(11, kinds, floor)[0].id;

test('a member of a crowd is somebody: a lineage, a trade and a standing', () => {
  for (let i = 0; i < 12; i++) {
    const who = crowdMember(11, kinds, group, floor, i);
    assert.ok(leavesUnder(kinds, group).some((k) => k.id === who.subspecies), `${who.subspecies} is not of ${group}`);
    assert.ok(PROFESSIONS.includes(who.profession), `${who.profession} is no trade`);
    assert.ok(RANKS.includes(who.rank), `${who.rank} is no standing`);
    assert.deepEqual(who, crowdMember(11, kinds, group, floor, i), 'the same crowd, the same person');
  }
});

test('a crowd is mostly ordinary, with a few veterans and whelps', () => {
  const drawn = Array.from({ length: 200 }, (_, i) => crowdMember(11, kinds, group, floor, i).rank);
  const ordinary = drawn.filter((r) => r === 'ordinary').length;
  assert.ok(ordinary > drawn.length / 2, `only ${ordinary} of ${drawn.length} are ordinary`);
  for (const rank of RANKS) assert.ok(drawn.includes(rank), `no ${rank} is ever drawn`);
});

test('a crowd fighter is a CHARACTER — a sheet, not a statblock', () => {
  const who = crowdMember(11, kinds, group, floor, 0);
  const { sheet, inventory } = crowdFighter(11, kinds, who, floor);

  assert.equal(sheet.species, who.subspecies, 'it is a kind of thing');
  assert.ok(sheet.background.startingAttacks.length > 0, 'and it fights with something');
  assert.ok(inventory.held.length > 0, 'which it is actually carrying');
});

test('a character of a given standing is as tough as the foe it replaces', () => {
  /*
   * The anchor: swapping statblocks for characters must not move the curve.
   *
   * With one floor, stated rather than fudged: a character cannot be frailer than
   * a level-one body (about 12 hp), and a minion at danger 1 has TWO. So a rank
   * matches its role wherever the role is tougher than that — which is everywhere
   * the role is actually used, since `composition` sends minions only at danger 16
   * and up, where a minion has about 10.
   */
  const FLOOR = 12;
  for (const danger of [1, 2, 4, 8, 16, 26]) {
    for (const [rank, role] of [['whelp', 'minion'], ['ordinary', 'regular'], ['veteran', 'elite']] as const) {
      const who = { ...crowdMember(11, kinds, group, danger, 0), rank };
      const { sheet, inventory } = crowdFighter(11, kinds, who, danger);
      const target = scaleFoe(danger, role).hp;
      const mine = maxHpFor(sheet, inventory);

      if (target < FLOOR) {
        assert.ok(mine <= FLOOR + 4, `danger ${danger} ${rank}: ${mine} hp is well past a level-one body`);
        continue;
      }
      assert.ok(
        Math.abs(mine - target) <= Math.max(3, target * 0.35),
        `danger ${danger} ${rank}: ${mine} hp against a ${role}'s ${target}`,
      );
    }
  }
});

test('the roles a crowd actually fields are the ones that match', () => {
  // The floor above only bites where nothing is fielded, and this is what says so.
  for (const danger of [16, 20, 26, 30]) {
    for (const role of composition(danger)) {
      const rank = (Object.entries(ROLE_OF).find(([, r]) => r === role) ?? ['ordinary'])[0] as 'whelp' | 'ordinary' | 'veteran';
      const who = { ...crowdMember(11, kinds, group, danger, 0), rank };
      const built = crowdFighter(11, kinds, who, danger);
      const mine = maxHpFor(built.sheet, built.inventory);
      const target = scaleFoe(danger, role).hp;
      assert.ok(Math.abs(mine - target) <= target * 0.35, `danger ${danger} ${role}: ${mine} against ${target}`);
    }
  }
});
