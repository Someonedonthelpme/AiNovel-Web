import test from 'node:test';
import assert from 'node:assert/strict';
import { repairAbilities, repairRegion, repairVoice, repairVoiceForm } from './repair.ts';
import { validateAbilities } from './sheet.ts';
import { validateRegion } from '../world/validate.ts';
import { groundFloor, place, world } from '../world/fixtures.ts';
import { abilitiesOf } from './fixtures.ts';

const people = world().people;

/* -------------------------------------------------------------------------- */
/* Abilities                                                                   */
/* -------------------------------------------------------------------------- */

test('legal scores are left alone', () => {
  const r = repairAbilities(abilitiesOf());
  assert.deepEqual(r.value, abilitiesOf());
  assert.deepEqual(r.repairs, []);
});

test('missing abilities default rather than becoming NaN', () => {
  const r = repairAbilities({ str: 14 });
  assert.equal(r.value.cha, 10);
  assert.ok(r.repairs.some((m) => /cha was missing/.test(m)));
});

test('out-of-range scores are clamped into the buyable band', () => {
  const r = repairAbilities({ str: 20, dex: 3, con: 12, int: 10, wis: 10, cha: 10 });
  assert.equal(r.value.str <= 15, true);
  assert.equal(r.value.dex >= 8, true);
  assert.ok(r.repairs.some((m) => /clamped/.test(m)));
});

test('fractional scores are rounded', () => {
  const r = repairAbilities({ ...abilitiesOf(), dex: 12.6 });
  assert.equal(r.value.dex, 13);
  assert.ok(r.repairs.some((m) => /rounded/.test(m)));
});

test('an overspent build is shaved down to the budget', () => {
  const greedy = { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 };
  const r = repairAbilities(greedy);
  const check = validateAbilities(r.value);
  assert.equal(check.ok, true, check.errors.join('; '));
  assert.ok(check.spent <= 27);
  assert.ok(r.repairs.some((m) => /budget/.test(m)));
});

test('shaving takes from the highest score, preserving the intended shape', () => {
  // A clear specialist: strength should stay the standout even after trimming.
  const r = repairAbilities({ str: 15, dex: 14, con: 14, int: 12, wis: 12, cha: 12 });
  assert.equal(validateAbilities(r.value).ok, true);
  assert.ok(r.value.str >= r.value.int, 'the specialism survives the repair');
});

test('repair always produces a legal build, for any garbage input', () => {
  const garbage: Partial<Record<string, number>>[] = [
    {},
    { str: -100, dex: 999 },
    { str: Number.NaN, dex: Number.POSITIVE_INFINITY, con: 12 },
    { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 },
    { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
  ];
  for (const input of garbage) {
    const r = repairAbilities(input as never);
    const check = validateAbilities(r.value);
    assert.equal(check.ok, true, `${JSON.stringify(input)} -> ${check.errors.join('; ')}`);
  }
});

/* -------------------------------------------------------------------------- */
/* Regions                                                                     */
/* -------------------------------------------------------------------------- */

test('a sound region is left alone', () => {
  const r = repairRegion(groundFloor());
  assert.deepEqual(r.repairs, []);
  assert.equal(validateRegion(r.value, people).ok, true);
});

test('a one-way corridor is made two-way', () => {
  const region = groundFloor();
  region.places = region.places.map((p) =>
    p.id === 'town' ? { ...p, connections: p.connections.filter((c) => c !== 'well') } : p,
  );
  const r = repairRegion(region);
  assert.ok(r.repairs.some((m) => /two-way/.test(m)));
  assert.equal(validateRegion(r.value, people).ok, true);
});

test('an edge pointing at nothing is dropped', () => {
  const region = groundFloor();
  region.places = region.places.map((p) =>
    p.id === 'well' ? { ...p, connections: [...p.connections, 'nowhere'] } : p,
  );
  const r = repairRegion(region);
  assert.ok(r.repairs.some((m) => /no such place/.test(m)));
  assert.equal(validateRegion(r.value, people).ok, true);
});

test('a self-connection is dropped', () => {
  const region = groundFloor();
  region.places = region.places.map((p) => (p.id === 'well' ? { ...p, connections: [...p.connections, 'well'] } : p));
  const r = repairRegion(region);
  assert.ok(r.repairs.some((m) => /self-connection/.test(m)));
  assert.equal(validateRegion(r.value, people).ok, true);
});

test('a stranded room is attached to the entrance rather than losing the floor', () => {
  const region = groundFloor();
  region.places = [...region.places, place('vault')];
  const r = repairRegion(region);
  assert.ok(r.repairs.some((m) => /stranded/.test(m)));

  const check = validateRegion(r.value, people);
  assert.equal(check.ok, true);
  assert.deepEqual(check.unreachable, [], 'nothing is left unreachable');
});

test('an unreachable way up is repaired, because that would trap the player', () => {
  const region = groundFloor();
  region.places = region.places.map((p) => {
    if (p.id === 'stair') return { ...p, connections: [] };
    return { ...p, connections: p.connections.filter((c) => c !== 'stair') };
  });
  assert.equal(validateRegion(region, people).ok, false, 'broken before repair');

  const r = repairRegion(region);
  const check = validateRegion(r.value, people);
  assert.equal(check.ok, true, check.errors.map((e) => e.code).join(', '));
  assert.ok(check.reachable.includes('stair'), 'the stair can now be walked to');
});

test('an entrance that does not exist falls back to a real place', () => {
  const r = repairRegion({ ...groundFloor(), entrance: 'nowhere' });
  assert.ok(r.repairs.some((m) => /entrance/.test(m)));
  assert.equal(validateRegion(r.value, people).ok, true);
});

test('an exit that does not exist becomes "not yet found" rather than an error', () => {
  const r = repairRegion({ ...groundFloor(), exit: 'nowhere' });
  assert.equal(r.value.exit, null);
  assert.equal(validateRegion(r.value, people).ok, true);
});

test('repair is idempotent', () => {
  const region = groundFloor();
  region.places = [...region.places, place('vault')];
  const once = repairRegion(region);
  const twice = repairRegion(once.value);
  assert.deepEqual(twice.repairs, [], 'a repaired region needs no further repair');
  assert.deepEqual(twice.value, once.value);
});

/* -------------------------------------------------------------------------- */
/* Voice                                                                       */
/* -------------------------------------------------------------------------- */

test('a slash-joined pair is reduced to a single usable form', () => {
  // Observed live: the generator answered "which particle?" with both genders,
  // producing a string no prose could ever contain.
  const r = repairVoiceForm('ครับ/ค่ะ');
  assert.equal(r.value, 'ครับ');
  assert.equal(r.repaired, true);
});

test('a single form is left alone', () => {
  const r = repairVoiceForm('ค่ะ');
  assert.equal(r.value, 'ค่ะ');
  assert.equal(r.repaired, false);
});

test('other ways of offering alternatives are also reduced', () => {
  assert.equal(repairVoiceForm('ผม, ฉัน').value, 'ผม');
  assert.equal(repairVoiceForm('ผม or ฉัน').value, 'ผม');
  assert.equal(repairVoiceForm('  ครับ  ').value, 'ครับ');
});

test('repairing a voice fixes every band and reports what it changed', () => {
  const r = repairVoice({
    selfPronoun: 'ผม/ดิฉัน',
    underStress: 'กู',
    addressBands: { '-3': 'คุณ', '2': 'เธอ/แก' },
    particleBands: { '-3': 'ครับ/ค่ะ', '2': 'นะ' },
    tics: [],
  });
  assert.equal(r.value.selfPronoun, 'ผม');
  assert.equal(r.value.addressBands['2'], 'เธอ');
  assert.equal(r.value.particleBands['-3'], 'ครับ');
  assert.equal(r.value.particleBands['2'], 'นะ', 'untouched bands stay untouched');
  assert.equal(r.repairs.length, 3);
});
