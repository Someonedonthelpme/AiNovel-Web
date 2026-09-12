import test from 'node:test';
import assert from 'node:assert/strict';
import { crowdFighter, crowdMember, RANKS } from './crowd.ts';
import { PROFESSIONS, derivePopulation } from './population.ts';
import { leavesUnder, speciesFor } from './species.ts';
import { groupsAt } from './habitat.ts';
import { scaleFoe } from '../combat/statblock.ts';
import { composition } from '../combat/encounter.ts';
import { ROLE_OF } from './crowd.ts';
import { maxHpFor, toCombatant } from '../session/sheet.ts';
import { bow, sword } from '../combat/fixtures.ts';

/** What each trade fights at arm's length or beyond — the table `crowd.ts` keys on. */
const TRADE_REACH = { hunter: bow.range, watcher: sword.range, brute: sword.range, raider: sword.range };
import { addItem, countOf, emptyInventory, findHolding, give } from '../items/types.ts';
import { PRISTINE } from '../items/instance.ts';
import { bonusOf } from '../items/refine.ts';

const kinds = speciesFor(11);
const floor = 4;
const group = groupsAt(11, kinds, floor)[0].id;
const crowd = derivePopulation(11, kinds, group, 'gate', floor);
/** One of them, drawn out of the population at the gate. */
const member = (index: number, at = floor) => crowdMember(11, crowd, at, index)!;

test('a member of a crowd is somebody: a lineage, a trade and a standing', () => {
  for (let i = 0; i < 12; i++) {
    const who = member(i);
    assert.ok(leavesUnder(kinds, group).some((k) => k.id === who.subspecies), `${who.subspecies} is not of ${group}`);
    assert.ok(PROFESSIONS.includes(who.profession), `${who.profession} is no trade`);
    assert.ok(RANKS.includes(who.rank), `${who.rank} is no standing`);
    assert.deepEqual(who, member(i), 'the same crowd, the same person');
  }
});

test('a crowd is mostly ordinary, with a few veterans and whelps', () => {
  const drawn = Array.from({ length: 200 }, (_, i) => member(i).rank);
  const ordinary = drawn.filter((r) => r === 'ordinary').length;
  assert.ok(ordinary > drawn.length / 2, `only ${ordinary} of ${drawn.length} are ordinary`);
  for (const rank of RANKS) assert.ok(drawn.includes(rank), `no ${rank} is ever drawn`);
});

test('a crowd fighter is a CHARACTER — a sheet, not a statblock', () => {
  const who = member(0);
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
      const who = { ...member(0, danger), rank };
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
      const who = { ...member(0, danger), rank };
      const built = crowdFighter(11, kinds, who, danger);
      const mine = maxHpFor(built.sheet, built.inventory);
      const target = scaleFoe(danger, role).hp;
      assert.ok(Math.abs(mine - target) <= target * 0.35, `danger ${danger} ${role}: ${mine} against ${target}`);
    }
  }
});

/*
 * 6b stage 3n-ii, the two prerequisites for looting gear off a body. Gear tier
 * IS refine · enchant · rarity, so what a foe fought with is what it is worth in
 * your bag — which only holds if the object survives the handover intact and
 * arrives having been used.
 */

test('a transfer keeps the OBJECT, so it keeps what it is worth', () => {
  const veteran = { ...member(0), rank: 'veteran' as const };
  const body = crowdFighter(11, kinds, veteran, 6, 'body').inventory;
  const taken = body.held[0];

  // A pack already holding one of exactly that kind — the collision that used
  // to rename the incoming object and re-roll its bonuses into other stats.
  const mine = addItem(emptyInventory(), taken.item);
  const got = give(mine, taken);
  const landed = findHolding(got, taken.instance.id)!;

  assert.equal(landed.instance.id, taken.instance.id, 'the object was renamed on the way in');
  assert.deepEqual(bonusOf(landed.instance), bonusOf(taken.instance), 'and is worth something else now');
  assert.equal(countOf(got, taken.item.id), 2, 'both are in the pack');
});

test('two bodies never mint the same object', () => {
  const who = { ...member(0), rank: 'veteran' as const };
  const one = crowdFighter(11, kinds, who, 6, 'town:0').inventory;
  const two = crowdFighter(11, kinds, who, 6, 'town:1').inventory;
  const ids = new Set([...one.held, ...two.held].map((h) => h.instance.id));
  assert.equal(ids.size, one.held.length + two.held.length, 'two bodies carry one object between them');
});

test('gear off a body arrives USED, and still worth taking', () => {
  for (const rank of RANKS) {
    const { inventory } = crowdFighter(11, kinds, { ...member(0), rank }, 6, 'body');
    assert.ok(inventory.held.length > 0, `a ${rank} carries nothing`);
    for (const h of inventory.held) {
      assert.ok(h.instance.condition < PRISTINE, `a ${rank}'s ${h.item.id} came off a body pristine`);
      assert.ok(h.instance.condition > PRISTINE / 4, `a ${rank}'s ${h.item.id} arrived worthless — used, not wrecked`);
    }
  }
});

/*
 * Gear is SOLVED against the anchor rather than tuned, so what is on a body is
 * worth what the depth says a body of that standing is worth — which is what
 * makes loot off the body and foe power one number.
 */

test('what a body carries lands on the anchor: AC within two, reach kept', () => {
  /*
   * TWO, not one, and measured rather than chosen: a refine's grant is hashed
   * off the instance id by decision, so the same veteran standing in two places
   * wears gear worth a point or so apart and the solve cannot land on the nose.
   * Across every rank, depth and namespace the worst miss is 2.
   *
   * Whelps are left out on purpose — one carries nothing worth taking, so it
   * wears no coat at all and is up to 7 under the anchor at depth. That is what
   * "nothing worth taking" means, and it costs no balance while hit points are
   * the anchored term.
   */
  for (const danger of [1, 2, 3, 5, 8, 16, 26]) {
    for (const rank of ['ordinary', 'veteran'] as const) {
      const who = { ...member(0, danger), rank };
      const { sheet, inventory } = crowdFighter(11, kinds, who, danger, 'body');
      const built = toCombatant(sheet, 'f', inventory);
      const anchor = scaleFoe(danger, ROLE_OF[rank]);

      assert.ok(
        Math.abs(built.ac - anchor.ac) <= 2,
        `d${danger} ${rank}: ac ${built.ac} against the anchored ${anchor.ac}`,
      );
      // A trade decides reach. Solving damage without it armed nearly every
      // body with a sling and cost thirty points of the player's win rate.
      const ranged = TRADE_REACH[who.profession] > 1;
      assert.equal(built.attacks[0].range > 1, ranged, `d${danger} ${who.profession}: wrong reach`);
    }
  }
});

test('gear grows with the depth it was taken from', () => {
  const shallow = crowdFighter(11, kinds, { ...member(0, 1), rank: 'veteran' }, 1, 'a');
  const deep = crowdFighter(11, kinds, { ...member(0, 26), rank: 'veteran' }, 26, 'b');
  const dice = (i: typeof shallow) => i.inventory.held[0].item.attack!.damage.sides;
  assert.ok(dice(deep) > dice(shallow), `a depth-26 blade (d${dice(deep)}) is no better than a depth-1 one`);
});

test('a rank caps what can come off the body, however deep', () => {
  for (const danger of [1, 8, 26]) {
    for (const [rank, cap] of [['whelp', 0], ['ordinary', 2], ['veteran', 4]] as const) {
      const { inventory } = crowdFighter(11, kinds, { ...member(0, danger), rank }, danger, 'body');
      for (const h of inventory.held) {
        assert.ok((h.instance.refine ?? 0) <= cap, `d${danger} ${rank}: +${h.instance.refine} past its cap`);
        assert.ok(!h.instance.exempts, 'a looted piece hands over a law exemption');
      }
    }
  }
});
