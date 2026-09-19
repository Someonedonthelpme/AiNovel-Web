import test from 'node:test';
import assert from 'node:assert/strict';
import { holderOf, priceOf } from './holding.ts';
import { firstFloor, place } from './fixtures.ts';
import { compressExcept } from './lod.ts';
import { isFull } from './types.ts';
import type { Place, Region } from './types.ts';
import { playState } from '../play/fixtures.ts';
import { applyTurn, validateDelta } from '../play/delta.ts';
import { canRest } from '../play/rest.ts';
import type { PlayState, TurnRecord, WorldDelta } from '../play/state.ts';
import { nudge, PLAYER } from '../social/edge.ts';
import { forbids, presetNamed, RULE_AXES, AXIS_OF } from '../rules/ruleset.ts';
import { runDirector } from '../llm/director.ts';
import { FakeProvider } from '../llm/provider.ts';

/*
 * 6c ownership O1 (DESIGN *The persistent world* §1): a settlement has a holder,
 * the player can buy it by negotiation, and a settlement you hold is somewhere
 * you can sleep, on any floor.
 */

const people = () => playState().world.people;
const ground = (state: PlayState): Region => {
  const r = state.world.regions['floor-0'];
  assert.ok(isFull(r));
  return r;
};
const placeOf = (state: PlayState, id: string): Place => ground(state).places.find((p) => p.id === id)!;
const town = () => placeOf(playState(), 'town');
const market = () => placeOf(playState(), 'market');
const settlement = (who: string[]) => place('hamlet', { kind: 'settlement', people: who });

const withTown = (state: PlayState, over: Partial<Place>, floor = 0): PlayState => {
  const r = ground(state);
  return {
    ...state,
    world: {
      ...state.world,
      regions: { ...state.world.regions, 'floor-0': { ...r, floor, places: r.places.map((p) => (p.id === 'town' ? { ...p, ...over } : p)) } },
    },
  };
};
const turn = (delta: WorldDelta): TurnRecord => ({
  kind: 'turn', input: '', mode: 'conversation', classification: 'NEUTRAL',
  addressed: 'warden', roll: null, delta, rejected: [], prose: '',
});

/* O1a — who holds a place ---------------------------------------------------- */

test('a settlement is held by the highest standing present, and only a settlement is held', () => {
  assert.equal(holderOf(town(), people()), 'warden', 'the highest standing present');
  assert.equal(holderOf(settlement(['smith']), people()), 'smith');
  assert.equal(holderOf({ ...town(), holder: PLAYER }, people()), PLAYER);
  assert.equal(holderOf(settlement([]), people()), null);
  assert.equal(holderOf(market(), people()), null, 'only a settlement is held');
});

test('a dead holder passes it on', () => {
  const p = people();
  assert.equal(holderOf(town(), { ...p, warden: { ...p.warden, alive: false } }), 'smith');
});

test('the Director is told who holds the place you are in', async () => {
  const provider = new FakeProvider({ structured: [] });
  await runDirector(provider, playState(), 'look around', 'exploration', []).catch(() => {});
  assert.match(provider.allSentText(), /held by Warden Bex/);
});

/* O1b — the territory law ---------------------------------------------------- */

test('holding a settlement is a territory law, forbidden to the player only in harsh', () => {
  assert.deepEqual([...RULE_AXES], ['movement', 'knowledge', 'progression', 'economy', 'territory']);
  assert.equal(AXIS_OF.holdSettlement, 'territory');
  const on = (preset: string) => ({ ...playState().world, rules: presetNamed(preset) });
  assert.deepEqual(['standard', 'plain', 'harsh'].map((p) => Boolean(forbids(on(p), 'player', 'holdSettlement'))), [false, false, true]);
});

/* O1c — buying it ------------------------------------------------------------ */

const ready = (trust = 2, coin = 50): PlayState => {
  const s = playState();
  return { ...s, pc: { ...s.pc, coin }, world: { ...s.world, edges: nudge(s.world.edges, 'warden', PLAYER, 'trust', trust) } };
};

test('a settlement is bought from its holder, for coin, when they trust you', () => {
  const bought = applyTurn(ready(), turn({ acquirePlace: 'town' })).state;
  assert.equal(holderOf(placeOf(bought, 'town'), bought.world.people), PLAYER);
  assert.equal(bought.pc.coin, 0);
  assert.equal(priceOf(0), 50);
  assert.equal(priceOf(5), 250);
});

test('the engine refuses a purchase it should not allow, and says why', () => {
  const harsh = (): PlayState => { const s = ready(); return { ...s, world: { ...s.world, rules: presetNamed('harsh') } }; };
  const inMarket = (): PlayState => { const s = ready(); return { ...s, world: { ...s.world, currentPlace: 'market' } }; };
  const empty = (): PlayState => withTown(ready(), { people: [] });
  const cases: [string, PlayState, string, RegExp][] = [
    ['low trust', ready(1), 'town', /trust/],
    ['too poor', ready(2, 49), 'town', /coin/],
    ['the law', harsh(), 'town', /law/],
    ['not a settlement', inMarket(), 'market', /settlement/],
    ['nobody to deal with', empty(), 'town', /holder/],
  ];
  for (const [why, state, where, reason] of cases) {
    const v = validateDelta(state, { acquirePlace: where });
    assert.equal(v.delta.acquirePlace, undefined, why);
    assert.match(v.rejected.join(' '), reason, why);
  }
});

/* O1d — sleeping there ------------------------------------------------------- */

test('you can long-rest at a settlement you hold, on any floor', () => {
  assert.equal(canRest(withTown(playState(), { holder: PLAYER }, 5), 'long').ok, true);
  assert.equal(canRest(withTown(playState(), {}, 5), 'long').ok, false, 'otherwise, still the ground floor');
});

/* O1e — it survives leaving -------------------------------------------------- */

test('a floor where you hold a settlement is never compressed', () => {
  const five = (holder?: string): PlayState => {
    const s = playState();
    const f = firstFloor();
    const region: Region = { ...f, id: 'floor-5', floor: 5, places: f.places.map((p) => (p.id === 'camp' && holder ? { ...p, holder } : p)) };
    return { ...s, world: { ...s.world, regions: { ...s.world.regions, 'floor-5': region } } };
  };
  assert.equal(compressExcept(five(PLAYER).world, ['floor-0'], 9).regions['floor-5'].detail, 'full');
  assert.equal(compressExcept(five().world, ['floor-0'], 9).regions['floor-5'].detail, 'gazetteer', 'an unheld floor still compresses');
});
