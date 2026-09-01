import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../engine/roll.ts';
import { attack, attackOptions, checkVictory, currentActor, endTurn, movementOptions, moveTo, startCombat } from './combat.ts';
import { addCondition } from './conditions.ts';
import { cellKey } from './grid.ts';
import { abilities, bow, combatant, d20Sequence, sword } from './fixtures.ts';
import type { CombatState, Combatant, Grid } from './types.ts';

const open = (w = 12, h = 12): Grid => ({ width: w, height: h, walls: new Set() });

const hero = (over: Partial<Combatant> = {}) =>
  combatant('hero', { side: 'party', pos: { x: 0, y: 0 }, ...over });
const orc = (over: Partial<Combatant> = {}) =>
  combatant('orc', { side: 'foe', pos: { x: 1, y: 0 }, ...over });

test('initiative sorts highest first and is deterministic under ties', () => {
  // Identical dexterity and identical rolls: order falls back to id.
  const a = combatant('zed', { abilities: abilities({ dex: 10 }) });
  const b = combatant('amy', { abilities: abilities({ dex: 10 }) });
  const s = startCombat(d20Sequence(10), [a, b], open());
  assert.deepEqual(s.order, ['amy', 'zed']);
});

test('a higher initiative roll acts first regardless of id', () => {
  const s = startCombat(d20Sequence(3, 18), [hero(), orc()], open());
  assert.equal(s.order[0], 'orc', 'orc rolled 18 to the hero 3');
  assert.equal(currentActor(s)?.id, 'orc');
});

test('the first actor starts with full movement and an unused action', () => {
  const s = startCombat(d20Sequence(18, 3), [hero({ speed: 6 }), orc()], open());
  assert.equal(currentActor(s)?.id, 'hero');
  assert.equal(s.movementLeft, 6);
  assert.equal(s.actionUsed, false);
  assert.equal(s.round, 1);
});

test('moving spends exactly the path cost', () => {
  const s = startCombat(d20Sequence(18, 3), [hero({ pos: { x: 0, y: 0 }, speed: 6 }), orc({ pos: { x: 9, y: 9 } })], open());
  const r = moveTo(s, { x: 2, y: 2 });
  assert.equal(r.error, null);
  assert.equal(r.state.movementLeft, 4, 'two diagonal steps');
  assert.deepEqual(r.state.combatants['hero'].pos, { x: 2, y: 2 });
});

test('moving out of reach is refused without changing state', () => {
  const s = startCombat(d20Sequence(18, 3), [hero({ speed: 2 }), orc({ pos: { x: 9, y: 9 } })], open());
  const r = moveTo(s, { x: 8, y: 8 });
  assert.match(r.error ?? '', /cannot reach/);
  assert.deepEqual(r.state.combatants['hero'].pos, { x: 0, y: 0 });
});

test('an out-of-range attack is refused', () => {
  const s = startCombat(d20Sequence(18, 3), [hero({ attacks: [sword] }), orc({ pos: { x: 6, y: 0 } })], open());
  const r = attack(mulberry32(1), s, 'orc', 'sword');
  assert.match(r.error ?? '', /out of range/);
  assert.equal(r.state.actionUsed, false);
});

test('a wall blocks a ranged attack even within range', () => {
  const grid: Grid = { width: 12, height: 12, walls: new Set(['3,0']) };
  const s = startCombat(d20Sequence(18, 3), [hero({ attacks: [bow] }), orc({ pos: { x: 6, y: 0 } })], grid);
  const r = attack(mulberry32(1), s, 'orc', 'bow');
  assert.match(r.error ?? '', /line of sight/);
});

test('only one action per turn', () => {
  const s = startCombat(d20Sequence(18, 3), [hero(), orc({ hp: 200 })], open());
  const first = attack(mulberry32(4), s, 'orc', 'sword');
  assert.equal(first.error, null);
  const second = attack(mulberry32(4), first.state, 'orc', 'sword');
  assert.match(second.error ?? '', /already used/);
});

test('you cannot attack yourself, a corpse, or a stranger', () => {
  // A living foe has to remain, or the fight would already be won.
  const roster = [hero(), orc({ id: 'corpse', dead: true }), orc({ id: 'orc', pos: { x: 5, y: 5 } })];
  const s = startCombat(d20Sequence(20, 3, 3), roster, open());
  assert.equal(s.over, false);
  assert.match(attack(mulberry32(1), s, 'hero', 'sword').error ?? '', /yourself/);
  assert.match(attack(mulberry32(1), s, 'corpse', 'sword').error ?? '', /already dead/);
  assert.match(attack(mulberry32(1), s, 'ghost', 'sword').error ?? '', /no such target/);
});

test('ending a turn passes to the next combatant and wraps the round', () => {
  const rng = mulberry32(2);
  let s = startCombat(d20Sequence(18, 3), [hero(), orc()], open());
  assert.equal(s.round, 1);
  const first = currentActor(s)?.id;
  s = endTurn(rng, s).state;
  assert.notEqual(currentActor(s)?.id, first);
  assert.equal(s.round, 1);
  s = endTurn(rng, s).state;
  assert.equal(currentActor(s)?.id, first);
  assert.equal(s.round, 2, 'a full cycle advances the round');
});

test('the party wins when the last foe falls', () => {
  const s = startCombat(d20Sequence(18, 3), [hero(), orc({ hp: 1, ac: 1 })], open());
  const r = attack(d20Sequence(20), s, 'orc', 'sword');
  assert.equal(r.state.combatants['orc'].dead, true);
  assert.equal(r.state.over, true);
  assert.equal(r.state.victor, 'party');
  assert.ok(r.state.log.some((e) => e.kind === 'combatEnd'));
});

test('a downed party member does not end the fight until the saves run out', () => {
  const s = startCombat(d20Sequence(3, 18), [hero({ hp: 1, ac: 1 }), orc()], open());
  const r = attack(d20Sequence(20), s, 'hero', 'sword');
  assert.equal(r.state.combatants['hero'].dying, true);
  assert.equal(r.state.combatants['hero'].dead, false);
  assert.equal(r.state.over, true, 'nobody on the party side is still standing');
  assert.equal(r.state.victor, 'foe');
});

test('a dying character rolls a death save instead of taking a turn', () => {
  const dying = hero({ hp: 0, dying: true });
  const s = startCombat(d20Sequence(18, 3), [dying, orc(), combatant('ally', { side: 'party', pos: { x: 5, y: 5 } })], open());
  const saves = s.log.filter((e) => e.kind === 'deathSave');
  assert.ok(saves.length >= 1, 'the dying hero rolled a death save');
  assert.notEqual(currentActor(s)?.id, 'hero', 'and did not get a turn');
});

test('no action is accepted once combat is over', () => {
  const s = startCombat(d20Sequence(18, 3), [hero(), orc({ hp: 1, ac: 1 })], open());
  const done = attack(d20Sequence(20), s, 'orc', 'sword').state;
  assert.equal(done.over, true);
  assert.match(moveTo(done, { x: 1, y: 1 }).error ?? '', /combat is over/);
  assert.match(endTurn(mulberry32(1), done).error ?? '', /combat is over/);
});

test('option lists only ever contain legal choices', () => {
  const s = startCombat(d20Sequence(18, 3), [hero({ speed: 3 }), orc({ pos: { x: 1, y: 0 } })], open());
  for (const cell of movementOptions(s)) {
    assert.equal(moveTo(s, cell).error, null, `movementOptions offered an illegal cell ${cellKey(cell)}`);
  }
  for (const target of attackOptions(s, 'sword')) {
    assert.equal(attack(mulberry32(1), s, target.id, 'sword').error, null);
  }
});

test('an incapacitated combatant loses its turn without stalling the fight', () => {
  const stunned = addCondition(orc(), 'stunned', 1);
  let s = startCombat(d20Sequence(3, 18), [hero(), stunned], open());
  // The orc rolled higher but is stunned, so play should reach the hero.
  const guard = 10;
  for (let i = 0; i < guard && currentActor(s)?.id !== 'hero'; i++) s = endTurn(mulberry32(3), s).state;
  assert.equal(currentActor(s)?.id, 'hero');
});

/* ------------------------------------------------------------------ */
/* Property test: random play must never produce an invalid state.     */
/* ------------------------------------------------------------------ */

function assertInvariants(s: CombatState, note: string) {
  assert.ok(s.round >= 1, `${note}: round went below 1`);
  assert.ok(s.turn >= 0 && s.turn < s.order.length, `${note}: turn index ${s.turn} out of range`);
  assert.equal(s.order.length, Object.keys(s.combatants).length, `${note}: roster changed size`);
  if (s.over) assert.notEqual(s.victor, null, `${note}: finished with no victor`);

  const seen = new Map<string, string>();
  for (const c of Object.values(s.combatants)) {
    assert.ok(c.hp >= 0 && c.hp <= c.maxHp, `${note}: ${c.id} hp ${c.hp} outside 0..${c.maxHp}`);
    assert.ok(!(c.dead && c.dying), `${note}: ${c.id} is both dead and dying`);
    assert.ok(c.deathSaves.successes <= 3 && c.deathSaves.failures <= 3, `${note}: ${c.id} death saves overflowed`);
    assert.ok(
      c.pos.x >= 0 && c.pos.y >= 0 && c.pos.x < s.grid.width && c.pos.y < s.grid.height,
      `${note}: ${c.id} left the grid`,
    );
    assert.equal(s.grid.walls.has(cellKey(c.pos)), false, `${note}: ${c.id} stands inside a wall`);
    if (c.dead) continue;
    const key = cellKey(c.pos);
    const other = seen.get(key);
    assert.equal(other, undefined, `${note}: ${c.id} shares a square with ${other}`);
    seen.set(key, c.id);
  }
}

test('random encounters never reach an invalid state and always terminate', () => {
  for (let seed = 0; seed < 60; seed++) {
    const rng = mulberry32(seed);
    const roster: Combatant[] = [
      hero({ id: 'hero', pos: { x: 0, y: 0 }, hp: 14, attacks: [sword] }),
      combatant('archer', { side: 'party', pos: { x: 0, y: 2 }, hp: 10, attacks: [bow] }),
      orc({ id: 'orc', pos: { x: 5, y: 1 }, hp: 12, attacks: [sword] }),
      combatant('wolf', { side: 'foe', pos: { x: 6, y: 4 }, hp: 8, speed: 8, attacks: [sword] }),
    ];
    const grid: Grid = { width: 10, height: 10, walls: new Set(['3,3', '3,4', '4,3']) };

    let s = startCombat(rng, roster, grid);
    assertInvariants(s, `seed ${seed} start`);

    let steps = 0;
    const cap = 4000;
    while (!s.over && steps < cap) {
      steps++;
      const actor = currentActor(s);
      if (!actor) break;

      // Prefer attacking so fights actually resolve; otherwise close distance.
      const targets = attackOptions(s, actor.attacks[0]?.id ?? '')
        .filter((t) => t.side !== actor.side);

      if (targets.length > 0 && rng() < 0.8) {
        const pick = targets[Math.floor(rng() * targets.length)];
        s = attack(rng, s, pick.id, actor.attacks[0].id).state;
      } else {
        const moves = movementOptions(s);
        if (moves.length > 0 && rng() < 0.7) {
          s = moveTo(s, moves[Math.floor(rng() * moves.length)]).state;
        } else {
          s = endTurn(rng, s).state;
        }
      }
      assertInvariants(s, `seed ${seed} step ${steps}`);
    }

    assert.ok(s.over, `seed ${seed}: combat did not terminate within ${cap} steps`);
    assert.ok(steps < cap, `seed ${seed}: hit the step cap`);
    assert.equal(checkVictory(s), s.victor, `seed ${seed}: recorded victor disagrees with the board`);
  }
});
