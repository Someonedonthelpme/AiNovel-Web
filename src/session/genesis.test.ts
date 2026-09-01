import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { validateRegion } from '../world/validate.ts';
import { generateCharacter, generateGroundFloor, runGenesis } from './genesis.ts';
import { recordAnswer, setDraft, startInterview, STAGES } from './interview.ts';
import type { Interview } from './interview.ts';
import { validateAbilities, validateSheet } from './sheet.ts';
import { abilitiesOf } from './fixtures.ts';
import type { GeneratedCharacter, GeneratedGroundFloor } from './schema.ts';

function completed(language: 'th' | 'en' = 'en'): Interview {
  let iv = startInterview(language);
  for (const stage of STAGES) iv = recordAnswer(iv, `an answer about ${stage}`).interview;
  return iv;
}

const character = (over: Partial<GeneratedCharacter> = {}): GeneratedCharacter => ({
  name: 'Anan',
  traits: ['blunt', 'sleeps badly'],
  hitDie: 10,
  voice: { selfPronoun: 'I', underStress: 'I' },
  baseAbilities: { str: 13, dex: 13, con: 13, int: 12, wis: 12, cha: 12 },
  background: {
    id: 'gate-guard',
    name: 'Gate Guard',
    description: 'Eleven years on the low wall.',
    grantsStats: { str: 1, con: 1 },
    grantsSkills: [
      { id: 'hold-the-line', name: 'Hold the Line', description: '', ability: 'con', kind: 'combat' },
      { id: 'know-the-faces', name: 'Know the Faces', description: '', ability: 'wis', kind: 'social' },
    ],
    startingGear: [{ id: 'spear', name: 'a chipped spear', description: '' }],
    startingAttacks: [
      { id: 'spear', name: 'spear', ability: 'str', proficient: true, range: 1,
        damage: { count: 1, sides: 6, bonusAbility: 'str', type: 'piercing' } },
    ],
    socialStanding: 'peer',
  },
  ...over,
});

const ground = (over: Partial<GeneratedGroundFloor> = {}): GeneratedGroundFloor => ({
  premise: 'The tower opened again last winter.',
  region: {
    name: 'Ashfall',
    biome: 'ash plain',
    culture: 'a guarded trading town',
    places: [
      { id: 'gate', name: 'the low gate', kind: 'gate', description: '', connections: ['square'], people: [], affordances: ['watch the road'] },
      { id: 'square', name: 'the square', kind: 'settlement', description: '', connections: ['gate', 'stair'], people: ['ora'], affordances: ['ask around'] },
      { id: 'stair', name: 'the first stair', kind: 'gate', description: '', connections: ['square'], people: [], affordances: ['climb'] },
    ],
    entrance: 'gate',
    exit: 'stair',
  },
  people: [{ id: 'ora', name: 'Ora', oneLine: 'sells iron, trusts no one', tags: ['smith'], trust: 0 }],
  ...over,
});

const provider = (c = character(), g = ground()) => new FakeProvider({ structured: [c, g] });

test('Session Zero produces a valid character and a playable ground floor', async () => {
  const result = await runGenesis(provider(), completed(), 42);

  assert.equal(validateSheet(result.sheet).ok, true);
  assert.equal(result.sheet.name, 'Anan');
  assert.equal(result.sheet.level, 1);

  const region = result.world.regions['floor-0'];
  assert.equal(region.detail, 'full');
  if (region.detail !== 'full') return;
  assert.equal(validateRegion(region, result.world.people).ok, true);

  assert.equal(result.world.currentRegion, 'floor-0');
  assert.equal(result.world.currentPlace, 'gate', 'you start at the entrance');
  assert.equal(result.world.seed, 42);
  assert.equal(result.premise, 'The tower opened again last winter.');
});

test('the code fills in what the model should not decide', async () => {
  const region = (await runGenesis(provider(), completed())).world.regions['floor-0'];
  if (region.detail !== 'full') return assert.fail('expected a full region');
  assert.equal(region.id, 'floor-0');
  assert.equal(region.floor, 0);
  assert.equal(region.danger, 0, 'ground level is safe by construction, not by request');
});

test('an unfinished interview is refused', async () => {
  await assert.rejects(() => generateCharacter(provider(), startInterview()), /not finished/);
});

test('hand-set choices override whatever the model proposes', async () => {
  const pinned = setDraft(completed(), {
    name: 'Kanya',
    baseAbilities: abilitiesOf({ str: 8, cha: 15 }),
    traits: ['never raises her voice'],
  });
  const { sheet } = await generateCharacter(provider(), pinned);

  assert.equal(sheet.name, 'Kanya', 'not the generated name');
  assert.equal(sheet.baseAbilities.cha, 15);
  assert.equal(sheet.baseAbilities.str, 8);
  assert.deepEqual(sheet.traits, ['never raises her voice']);
});

test('the pinned facts are actually put in front of the model', async () => {
  const p = provider();
  await generateCharacter(p, setDraft(completed(), { name: 'Kanya', backgroundName: 'Archivist' }));
  const sent = p.allSentText();
  assert.match(sent, /Kanya/);
  assert.match(sent, /Archivist/);
  assert.match(sent, /do not contradict/i);
});

test('an overspent build from the model is repaired, not rejected', async () => {
  const greedy = character({ baseAbilities: { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 } });
  const result = await generateCharacter(provider(greedy), completed());

  assert.equal(validateAbilities(result.sheet.baseAbilities).ok, true);
  assert.ok(result.repairs.some((m) => /budget/.test(m)), 'and the repair is reported, not hidden');
});

test('a broken region from the model is repaired into something playable', async () => {
  const broken = ground();
  // A one-way corridor and a stranded room: both fatal, both mechanically fixable.
  broken.region.places = [
    { ...broken.region.places[0], connections: ['square'] },
    { ...broken.region.places[1], connections: ['gate'] },
    { ...broken.region.places[2], connections: [] },
  ];
  // generateGroundFloor makes a single structured call, so it must be first in
  // the script.
  const sheet = (await generateCharacter(provider(), completed())).sheet;
  const result = await generateGroundFloor(new FakeProvider({ structured: [broken] }), completed(), sheet);

  const check = validateRegion(result.region, result.people);
  assert.equal(check.ok, true, check.errors.map((e) => e.message).join('; '));
  assert.ok(check.reachable.includes('stair'), 'the way up can be walked to');
  assert.ok(result.repairs.length > 0);
});

test('a reference to a person the model never defined is dropped, not fatal', async () => {
  const g = ground();
  g.region.places = g.region.places.map((p) => (p.id === 'square' ? { ...p, people: ['ora', 'phantom'] } : p));

  const sheet = (await generateCharacter(provider(), completed())).sheet;
  const result = await generateGroundFloor(new FakeProvider({ structured: [g] }), completed(), sheet);

  const square = result.region.places.find((p) => p.id === 'square');
  assert.deepEqual(square?.people, ['ora']);
  assert.ok(result.repairs.some((m) => /phantom/.test(m)));
  assert.equal(validateRegion(result.region, result.people).ok, true);
});

test('people from the ground floor land in the registry', async () => {
  const result = await runGenesis(provider(), completed());
  assert.equal(result.world.people['ora'].name, 'Ora');
  assert.equal(result.world.people['ora'].homeRegion, 'floor-0');
  assert.equal(result.world.people['ora'].alive, true);
});

test('a Thai session instructs the model to write natively rather than translate', async () => {
  const p = provider();
  await generateCharacter(p, completed('th'));
  const sent = p.allSentText();
  assert.match(sent, /natively in Thai/);
  assert.match(sent, /Do not translate/);
});

test('an English session does not ask for Thai', async () => {
  const p = provider();
  await generateCharacter(p, completed('en'));
  assert.equal(/natively in Thai/.test(p.allSentText()), false);
});

test('the interview transcript is what the model is given, not a bag of fields', async () => {
  const p = provider();
  await generateCharacter(p, completed());
  const sent = p.allSentText();
  assert.match(sent, /Q \(world\)/);
  assert.match(sent, /A: an answer about character/);
});

test('a background with no attack still yields a character who can fight', async () => {
  const unarmed = character();
  unarmed.background.startingAttacks = [];
  const { sheet } = await generateCharacter(provider(unarmed), completed());
  assert.ok(sheet.background.startingAttacks.length > 0, 'a fallback weapon is supplied');
});

test('an implausible hit die is replaced rather than failing the sheet', async () => {
  const odd = character({ hitDie: 7 });
  const { sheet } = await generateCharacter(provider(odd), completed());
  assert.equal(sheet.hitDie, 8);
  assert.equal(validateSheet(sheet).ok, true);
});
