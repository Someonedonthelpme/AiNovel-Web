import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { validateRegion } from '../world/validate.ts';
import { generateCharacter, generateGroundFloor, runGenesis } from './genesis.ts';
import { recordAnswer, setDraft, startInterview, STAGES } from './interview.ts';
import type { CharacterDraft } from './interview.ts';
import { classShapesFor } from '../character/classgen.ts';
import { buildClass } from '../character/classbuild.ts';
import type { Interview } from './interview.ts';
import { activeSkills, finalAbilities, validateAbilities, validateSheet } from './sheet.ts';
import { signatureSkill } from '../character/speciesskill.ts';
import { ABILITIES } from '../combat/types.ts';
import { abilitiesOf } from './fixtures.ts';
import type { GeneratedCharacter, GeneratedGroundFloor } from './schema.ts';
import { HARSH, STANDARD } from '../rules/ruleset.ts';
import { dominantOf, groupOf, leavesOf, speciesFor, speciesIdFor, TYPES } from '../character/species.ts';
import { axisOf, PLAYER } from '../social/edge.ts';
import { withKin } from '../character/kinship.ts';
import { eraOf, isLoop, isStatic } from '../world/strata.ts';

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
  personality: { intuition: 1, feeling: 2, nerve: 2, discipline: 0 },
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
  bonds: [],
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
  people: [{
    id: 'ora', name: 'Ora', oneLine: 'sells iron, trusts no one', tags: ['smith'], trust: 0,
    status: 'peer', selfPronoun: 'I', underStress: 'I',
    addressDistant: 'you', addressWarm: 'you', particleDistant: '', particleWarm: '',
    intuition: -2, feeling: 3, nerve: 1, discipline: 2,
  }],
  ...over,
});

/**
 * Naming the world's subjects is the FIRST structured call now, ahead of the
 * character — because the character prompt lists them and asks which two this
 * person climbs for and away from.
 *
 * An empty list is a legitimate answer: `nameSubjects` swallows anything
 * unusable and every subject keeps its fallback word, so these fixtures
 * exercise the path a world takes when the model has nothing useful to say.
 */
const noNames = { subjects: [] as { id: string; name: string }[] };
const noRoleNames = { roles: [] as { id: string; a: string; b: string }[] };

const provider = (c = character(), g = ground()) => new FakeProvider({ structured: [c, g] });

/**
 * `runGenesis` makes two NAMING calls the direct generators do not — the
 * subjects before the character, and the roles before the ground floor, which
 * has to be told what a bond can be before it can propose one.
 */
const noSpeciesNames = { kinds: [] as { id: string; name: string }[] };

const wholeGenesis = (c = character(), g = ground()) =>
  new FakeProvider({ structured: [noNames, noSpeciesNames, c, noRoleNames, g] });

test('a world is born under a named ruleset, and records the one it got', async () => {
  // `World.rules` had no writer at all: every world ever created played by
  // STANDARD, and PLAIN and HARSH existed only in tests. The world stores the
  // whole ruleset rather than the name so that retuning a preset later cannot
  // silently re-tune a run already in progress — the same reason a climb is
  // recorded rather than recomputed.
  const harsh = await runGenesis(wholeGenesis(), completed(), 42, 'harsh');
  assert.equal(harsh.world.rules?.world.dangerPerFloor, HARSH.world.dangerPerFloor);
  assert.equal(harsh.world.rules?.gear.wearPerFight, HARSH.gear.wearPerFight);

  const named = await runGenesis(wholeGenesis(), completed(), 42);
  assert.equal(named.world.rules?.world.dangerPerFloor, STANDARD.world.dangerPerFloor);
  assert.deepEqual(named.world.rules?.laws, STANDARD.laws, 'a world carries its laws, not a pointer to them');

  // Anything a client can post. The fallback is STANDARD, never a throw.
  const junk = await runGenesis(wholeGenesis(), completed(), 42, 'no-such-preset' as never);
  assert.equal(junk.world.rules?.world.dangerPerFloor, STANDARD.world.dangerPerFloor);
});

test('a world is born holding one structure, and it can be a frozen one', async () => {
  // `World.strata` needs a writer or it is one more field that looks like a
  // mechanic and does nothing. Every world gets its tower; whether that tower
  // is FROZEN — authored once, never rebuilt behind you — is a creation choice.
  const ordinary = await runGenesis(wholeGenesis(), completed(), 42);
  const tower = ordinary.world.strata?.['tower'];
  assert.ok(tower, 'every world holds at least the structure it is climbing');
  assert.equal(tower.kind, 'dynamic');
  assert.equal(tower.from, 0, 'the ground is part of the tower, not a separate hub');

  const frozen = await runGenesis(wholeGenesis(), completed(), 42, 'standard', 'static');
  assert.equal(frozen.world.strata?.['tower'].kind, 'static');
});

test('a world holds kinds, and the people in it are one of them', async () => {
  // `Persona.species` with no writer would be one more field that looks like a
  // mechanic and does nothing — the bug this codebase keeps having.
  const r = await runGenesis(wholeGenesis(), completed(), 42);

  assert.ok((r.world.species ?? []).length > 0, 'a world names the kinds that live in it');
  // RESPECIFIED 2026-09-12 (3e): the first node is a TYPE, not folk, and a
  // person is a SUBSPECIES — a type or a group is a category, not a body.
  assert.ok(TYPES.some((t) => t.id === r.world.species?.[0].id), 'the tree starts at a type');

  const townsfolk = Object.values(r.world.people);
  assert.ok(townsfolk.length > 0, 'the ground floor has to have people to be a test');
  for (const person of townsfolk) {
    assert.ok(person.species, `${person.id} is not any kind of thing`);
    assert.ok(
      leavesOf(r.world.species ?? []).some((k) => k.id === person.species),
      `${person.id} is a ${person.species}, which is not a subspecies this world holds`,
    );
  }
});

test('Session Zero produces a valid character and a playable ground floor', async () => {
  const result = await runGenesis(wholeGenesis(), completed(), 42);

  assert.equal(validateSheet(result.sheet).ok, true);
  assert.equal(result.sheet.name, 'Anan');
  assert.equal(result.sheet.level, 1);

  const region = result.world.regions['floor-0'];
  assert.equal(region.detail, 'full');
  if (region.detail !== 'full') return;
  assert.equal(validateRegion(region, result.world.people).ok, true);

  assert.equal(result.world.currentRegion, 'floor-0');
  assert.equal(result.world.currentPlace, 'square', 'you start in the town, not the gateway');
  assert.equal(result.world.seed, 42);
  assert.equal(result.premise, 'The tower opened again last winter.');
});

test('the code fills in what the model should not decide', async () => {
  const region = (await runGenesis(wholeGenesis(), completed())).world.regions['floor-0'];
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
  const result = await runGenesis(wholeGenesis(), completed());
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

test("the model's hit die is never used: the class decides it", async () => {
  // Requirement changed by the user, 2026-09-19 (class inference). Old: a character
  // with no class took the model's hit die, repaired to 8 when implausible. New:
  // every character holds a class, and the class decides the die — the model's
  // number is ignored, implausible or not.
  const odd = character({ hitDie: 7 });
  const { sheet } = await generateCharacter(provider(odd), completed());
  assert.equal(sheet.hitDie, sheet.classSpec?.hitDie);
  assert.equal(validateSheet(sheet).ok, true);
});

/* -------------------------------------------------------------------------- */
/* The opening turn must not be empty                                          */
/* -------------------------------------------------------------------------- */

test('the game opens in the settlement, not standing in a gateway', async () => {
  // A gate is deserted by nature. Opening there gave a first turn with nobody to
  // talk to, nothing worth doing, and no way to climb.
  const r = await runGenesis(wholeGenesis(), completed());
  const region = r.world.regions['floor-0'];
  if (region.detail !== 'full') return assert.fail('expected a full region');

  const start = region.places.find((p) => p.id === r.world.currentPlace);
  assert.equal(start?.kind, 'settlement');
  assert.notEqual(r.world.currentPlace, region.entrance);
  assert.equal(region.entrance, 'gate', 'the way in from outside is unchanged');
});

test('somebody is always present on the opening turn', async () => {
  const empty = ground();
  // The model put everyone somewhere the player will not be.
  empty.region.places = empty.region.places.map((p) => ({ ...p, people: [] }));

  const sheet = (await generateCharacter(provider(), completed())).sheet;
  const r = await generateGroundFloor(new FakeProvider({ structured: [empty] }), completed(), sheet);

  const start = r.region.places.find((p) => p.id === r.startPlace);
  assert.ok((start?.people.length ?? 0) > 0, 'the first turn would have had nobody in it');
  assert.ok(r.repairs.some((m) => /starting place/.test(m)));
});

test('a town that already has people is left alone', async () => {
  const sheet = (await generateCharacter(provider(), completed())).sheet;
  const r = await generateGroundFloor(new FakeProvider({ structured: [ground()] }), completed(), sheet);
  assert.equal(r.startPlace, 'square');
  assert.deepEqual(r.region.places.find((p) => p.id === 'square')?.people, ['ora']);
  assert.equal(r.repairs.some((m) => /starting place/.test(m)), false);
});

test('with no settlement at all, it falls back to wherever the people are', async () => {
  const wild = ground();
  wild.region.places = wild.region.places.map((p) =>
    p.kind === 'settlement' ? { ...p, kind: 'landmark' } : p,
  );

  const sheet = (await generateCharacter(provider(), completed())).sheet;
  const r = await generateGroundFloor(new FakeProvider({ structured: [wild] }), completed(), sheet);
  const start = r.region.places.find((p) => p.id === r.startPlace);
  assert.ok((start?.people.length ?? 0) > 0);
});

test('the model is told the settlement is where play begins', async () => {
  const sheet = (await generateCharacter(provider(), completed())).sheet;
  const p = new FakeProvider({ structured: [ground()] });
  await generateGroundFloor(p, completed(), sheet);
  assert.match(p.allSentText(), /player BEGINS there/);
});

test('the climber chooses their kind: picked, described, or left to the world', async () => {
  // Every villager got a kind and the climber never did, so `applyDrift` read a
  // species for the player that nothing had written.
  const kinds = speciesFor(42);
  const other = leavesOf(kinds)[1];   // a SUBSPECIES: what a climber can be

  const picked = await runGenesis(wholeGenesis(), completed(), 42, 'standard', 'dynamic', { pick: other.id });
  assert.equal(picked.sheet.species, other.id, 'a kind the world holds, chosen by name');

  const drawn = await runGenesis(wholeGenesis(), completed(), 42, 'standard', 'dynamic', { decide: 'world' });
  assert.equal(drawn.sheet.species, speciesIdFor(42, PLAYER, kinds), 'the same seeded draw a villager gets');

  const asked = wholeGenesis(character({ species: other.id }));
  const described = await runGenesis(asked, completed(), 42, 'standard', 'dynamic', { describe: 'brass, never eats' });
  assert.equal(described.sheet.species, other.id, 'the character call maps the words onto a kind');
  assert.match(asked.allSentText(), /brass, never eats/, 'and was shown them');

  const invented = await runGenesis(wholeGenesis(character({ species: 'dragon' })), completed(), 42, 'standard', 'dynamic', { describe: 'x' });
  assert.ok(leavesOf(kinds).some((k) => k.id === invented.sheet.species), 'never a kind the world lacks');
});

test('the climber is born with their kind\'s template, on top of point buy', async () => {
  const other = leavesOf(speciesFor(42))[1];   // a SUBSPECIES: what a climber can be
  const { sheet } = await runGenesis(wholeGenesis(), completed(), 42, 'standard', 'dynamic', { pick: other.id });
  const without = finalAbilities({ ...sheet, speciesTemplate: undefined });
  for (const a of ABILITIES) assert.equal(finalAbilities(sheet)[a], without[a] + (other.template?.[a] ?? 0), a);
});


test('a world stores the words its model gave its kinds, and none of the ids move', async () => {
  const tree = speciesFor(42);
  const provider = new FakeProvider({
    structured: [
      { subjects: [] },
      { kinds: tree.map((n, i) => ({ id: n.id, name: `kind ${i}` })) },
      character(),
      { roles: [] },
      ground(),
    ],
  });

  const r = await runGenesis(provider, completed(), 42);
  assert.deepEqual(r.world.species?.map((k) => k.id), tree.map((n) => n.id), 'ids are untouched');
  assert.deepEqual(r.world.species?.map((k) => k.name), tree.map((_, i) => `kind ${i}`), 'and the words are the world\'s own');
});

test('a climber who chose nothing IS the dominant kind, not a kind of nobody', async () => {
  const kinds = speciesFor(42);
  const dominant = dominantOf(42, kinds);
  const { sheet } = await runGenesis(wholeGenesis(), completed(), 42);
  assert.equal(sheet.species, dominant, 'everybody alive is some particular kind');
  assert.deepEqual(sheet.speciesTemplate, kinds.find((k) => k.id === dominant)?.template);
});

test('the climber sets out knowing what their kind can do', async () => {
  const kinds = speciesFor(42);
  const mine = leavesOf(kinds)[2];
  const { sheet } = await runGenesis(wholeGenesis(), completed(), 42, 'standard', 'dynamic', { pick: mine.id });

  const theirs = signatureSkill(42, kinds.find((k) => k.id === mine.id)!);
  assert.ok((sheet.learned ?? []).some((s) => s.id === theirs.id), `no sign of ${theirs.name}`);
  assert.ok(activeSkills(sheet).some((s) => s.id === theirs.id), 'and it is usable, not just stored');
});

test('the town a climber wakes in already knows what they are', async () => {
  // The WIRING, not the rule: two climbers into one world, one of the town's own
  // kind and one of another. Asserting on a single generated town's mix proves
  // nothing — the draw is weighted 80% to the dominant kind, so every townsperson
  // of world 42 is the same kind and there was nobody to compare them to.
  const kinds = speciesFor(42);
  const own = dominantOf(42, kinds);
  const stranger = leavesOf(kinds).find((k) => groupOf(kinds, k.id) !== groupOf(kinds, own))!;

  const asKin = await runGenesis(wholeGenesis(), completed(), 42, 'standard', 'dynamic', { pick: own });
  const asOther = await runGenesis(wholeGenesis(), completed(), 42, 'standard', 'dynamic', { pick: stranger.id });

  const trust = (r: typeof asKin) =>
    Object.values(r.world.people).reduce((sum, p) => sum + axisOf(r.world.edges, p.id, PLAYER, 'trust'), 0);

  assert.ok(trust(asKin) > trust(asOther), `as kin ${trust(asKin)}, as a stranger ${trust(asOther)}`);
});

/* 6c loop L2a: a world may be BORN with a loop band — the first writer `Stratum.laws` has. */

const withBand = (p = wholeGenesis(), structure: 'dynamic' | 'static' = 'dynamic') =>
  runGenesis(p, completed(), 42, 'standard', structure, undefined, true);

test('a world may be born with a loop band: floors 1–10 loop, and nothing else does', async () => {
  const looped = await withBand();
  assert.deepEqual([0, 1, 10, 11].map((f) => isLoop(looped.world, f)), [false, true, true, false]);
  assert.equal(looped.world.strata?.loop?.parent, 'tower');
});

test('a world born without one holds no law at all', async () => {
  const plain = await runGenesis(wholeGenesis(), completed(), 42);
  assert.equal(Object.values(plain.world.strata ?? {}).some((s) => s.laws), false);
});

test("the band keeps the tower's kind, so a frozen world's loop floors stay frozen", async () => {
  const frozen = await withBand(wholeGenesis(), 'static');
  assert.equal(isStatic(frozen.world, 5), true);
});

test("the band costs no model call, and is named in the engine's words", async () => {
  const plainCalls = wholeGenesis();
  await runGenesis(plainCalls, completed(), 42);
  const bandCalls = wholeGenesis();
  const looped = await withBand(bandCalls);
  assert.equal(bandCalls.calls.length, plainCalls.calls.length);
  assert.equal(looped.world.strata?.loop?.name, 'the loop');
});

/* 6c era E2: a world may be BORN with an era band, floors 21–30, beside the loop band. */

const withEra = (structure: 'dynamic' | 'static' = 'dynamic', loop = false) =>
  runGenesis(wholeGenesis(), completed(), 42, 'standard', structure, undefined, loop, true);

test('a world may be born with an era band: floors 21–30 keep their own years, nothing else does', async () => {
  const w = (await withEra()).world;
  assert.deepEqual([20, 21, 30, 31].map((f) => eraOf(w, f) !== 0), [false, true, true, false]);
  assert.equal(w.strata?.era?.parent, 'tower');
});

test('both bands at once: floors 1–10 loop, 21–30 are eras, and neither law leaks into the other', async () => {
  const w = (await withEra('dynamic', true)).world;
  assert.deepEqual([1, 10, 21].map((f) => isLoop(w, f)), [true, true, false]);
  assert.deepEqual([1, 10, 21].map((f) => eraOf(w, f) !== 0), [false, false, true]);
});

test("the era band keeps the tower's kind", async () => {
  assert.equal((await withEra('static')).world.strata?.era?.kind, 'static');
});

test("the era band costs no model call, and is named in the engine's words", async () => {
  const plainCalls = wholeGenesis();
  await runGenesis(plainCalls, completed(), 42);
  const bandCalls = wholeGenesis();
  const w = (await runGenesis(bandCalls, completed(), 42, 'standard', 'dynamic', undefined, false, true)).world;
  assert.equal(bandCalls.calls.length, plainCalls.calls.length);
  assert.equal(w.strata?.era?.name, 'the eras');
});

/*
 * CLASS INFERENCE (approved 2026-09-19). The creation page's default, "let the
 * story decide", promised "a class is inferred from what you wrote above", and
 * nothing inferred one: a player who kept the default was silently classless,
 * and two live probe climbers died in their first floor-1 fight. Now the
 * character call picks from this world's roster; a bad pick falls back to the
 * class leaning on the character's strongest ability. And a class from the
 * client is REBUILT from the seed — only its words are taken.
 */
const shapes = classShapesFor(42);
const completedWith = (draft: CharacterDraft) => setDraft(completed(), draft);
const characterCall = (p: FakeProvider) => {
  const call = p.calls.find((c) => c.kind === 'structured' && c.req.schemaName === 'character');
  assert.ok(call?.kind === 'structured', 'the character call was made');
  return call.req;
};

test("no class chosen: the character call picks one of this world's classes, and it is held", async () => {
  const r = await runGenesis(wholeGenesis(character({ classShape: shapes[1].id })), completed(), 42);
  assert.equal(r.sheet.classSpec?.id, shapes[1].id);
  assert.equal(r.sheet.hitDie, shapes[1].hitDie, 'the class decides the die');
});

test("the model is offered exactly this world's classes", async () => {
  const p = wholeGenesis(character({ classShape: shapes[1].id }));
  await runGenesis(p, completed(), 42);
  const schema = characterCall(p).schema as { properties: { classShape: { enum: string[] } } };
  assert.deepEqual(schema.properties.classShape.enum, shapes.map((s) => s.id));
});

test('a bad or missing pick falls back to the class leaning on the strongest ability — never classless', async () => {
  const top = shapes[2].primary;
  const strongest = Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha', 'agi', 'vit', 'luk']
    .map((a) => [a, a === top ? 15 : 10]));
  for (const classShape of ['nonsense', undefined]) {
    const r = await runGenesis(wholeGenesis(character({ classShape, baseAbilities: strongest as never })), completed(), 42);
    assert.ok(r.sheet.classSpec, `never classless (${classShape})`);
    assert.equal(r.sheet.classSpec.primary, top, `leans on ${top} (${classShape})`);
    assert.ok(r.repairs.some((m) => /class inferred/.test(m)), 'and says so');
  }
});

test('a class picked on the page still wins over the model', async () => {
  const picked = await runGenesis(wholeGenesis(character({ classShape: shapes[0].id })),
    completedWith({ classId: shapes[2].id, classSpec: buildClass(shapes[2], null, 'en') }), 42);
  assert.equal(picked.sheet.classSpec?.id, shapes[2].id);
});

test("the page's own words name the inferred class; the numbers stay the seed's", async () => {
  const named = await runGenesis(wholeGenesis(character({ classShape: shapes[1].id })),
    completedWith({ roster: [{ shapeId: shapes[1].id, name: 'Harbour Guard', description: 'keeps the quay', weaponName: 'boathook', subclasses: [] }] }), 42);
  assert.equal(named.sheet.classSpec?.name.en, 'Harbour Guard');
  assert.equal(named.sheet.hitDie, shapes[1].hitDie);
});

test('a forged class from the client keeps its words and loses its numbers', async () => {
  const real = buildClass(shapes[0], null, 'en');
  const forged = { ...real, hitDie: (real.hitDie === 12 ? 6 : 12) as 6 | 12, name: { en: 'Forged', th: 'Forged' } };
  const r = await runGenesis(wholeGenesis(), completedWith({ classId: shapes[0].id, classSpec: forged }), 42);
  assert.equal(r.sheet.hitDie, shapes[0].hitDie, "the die is the seed's");
  assert.equal(r.sheet.classSpec?.name.en, 'Forged', 'the words are theirs');
});
