import test from 'node:test';
import assert from 'node:assert/strict';
import { EDGE_AXES, axisOf, edgeBetween } from './edge.ts';
import type { EdgeAxis } from './edge.ts';
import {
  axesTemplatesOpen, converseOf, endOfRef, formRole, heirsOf, idOfRef, MAX_ROLES, MIN_ROLES,
  nameOfRef, OBLIGATIONS, opensAt, owedBy, permittedBy, PERMISSIONS, refFor, roleById,
  ROLE_KINDS, rolesFor, rolesHeld, rolesOf, shapeOfKind,
} from './roles.ts';
import type { Role, RoleKind } from './roles.ts';
import { applyRoleNames, nameRoles } from './rolenames.ts';
import { FakeProvider } from '../llm/provider.ts';
import { runDirector } from '../llm/director.ts';
import { playState } from '../play/fixtures.ts';
import { bondsAmong } from '../world/floorgen.ts';
import { PLAYER } from './edge.ts';

const world = () => rolesFor(7);

/** The first role of a given kind in a world that has one, for a named case. */
const kindIn = (roles: readonly Role[], kind: RoleKind): Role | null =>
  roles.find((r) => r.kind === kind) ?? null;

/** A world guaranteed to contain the kind a test is about. */
const withKind = (kind: RoleKind): Role[] => [{ id: 'role_x', kind, names: ['A', 'B'] }];

/* -------------------------------------------------------------------------- */
/* The pair is the unit                                                        */
/* -------------------------------------------------------------------------- */

test('every role has a converse, because the PAIR is what exists', () => {
  /*
   * Structural rather than checked. The plan called for a converse table kept
   * consistent; making the pair the unit means a role whose opposite does not
   * exist is not expressible, so it cannot be inconsistent.
   */
  for (const role of world()) {
    for (const end of ['a', 'b'] as const) {
      const ref = refFor(role.id, end);
      const back = converseOf(ref);
      assert.notEqual(back, ref, 'the two ends are different ends');
      assert.equal(converseOf(back), ref, 'and it round-trips');
      assert.equal(idOfRef(back), role.id, 'and stays the same relationship');
    }
  }
});

test('a role reference cannot dangle, because it names its own id', () => {
  const roles = world();
  const ref = refFor(roles[0].id, 'b');
  assert.equal(nameOfRef(roles, ref), roles[0].names[1]);
  assert.equal(nameOfRef(roles, 'role_nope/a'), null);
});

test('no two templates have the same shape', () => {
  // A duplicate is a role that adds a word to the world and nothing to how it
  // plays — the same fault "no two stats have the same grammar" guards against.
  const shapes = ROLE_KINDS.map(shapeOfKind);
  assert.equal(new Set(shapes).size, shapes.length, 'two role kinds oblige and allow exactly the same things');
});

test('every obligation and permission comes from the closed list', () => {
  // The safety that lets a world invent its own words: it can name a thing,
  // never oblige something the engine does not enforce.
  const roles = ROLE_KINDS.map((kind, i) => ({ id: `role_${i}`, kind, names: ['a', 'b'] as [string, string] }));
  let edges = {};
  for (const role of roles) edges = formRole(edges, roles, 'x', 'y', refFor(role.id, 'a'));

  for (const o of owedBy(edges, roles, 'x', 'y')) assert.ok((OBLIGATIONS as readonly string[]).includes(o), o);
  for (const p of permittedBy(edges, roles, 'x', 'y')) assert.ok((PERMISSIONS as readonly string[]).includes(p), p);
});

test('every axis a template opens is an axis that exists', () => {
  // A default on an axis nothing declares would be written and read by nobody,
  // which is the bug the whole edge module is built around avoiding.
  for (const axis of axesTemplatesOpen()) {
    assert.ok((EDGE_AXES as readonly EdgeAxis[]).includes(axis), `templates open "${axis}", which is not an axis`);
  }
});

/* -------------------------------------------------------------------------- */
/* Forming one                                                                 */
/* -------------------------------------------------------------------------- */

test('forming a role writes BOTH directions at once', () => {
  // Half a relationship is not a half-built thing; it is a bug that reads as
  // one. "She is my daughter" with nothing coming back is nonsense.
  const roles = withKind('kin');
  const edges = formRole({}, roles, 'elder', 'young', refFor('role_x', 'a'));

  assert.deepEqual(edgeBetween(edges, 'elder', 'young')?.roles, ['role_x/a']);
  assert.deepEqual(edgeBetween(edges, 'young', 'elder')?.roles, ['role_x/b']);
});

test('the defaults land, so a bond means something the moment it exists', () => {
  const kin = formRole({}, withKind('kin'), 'a', 'b', refFor('role_x', 'a'));
  assert.ok(axisOf(kin, 'a', 'b', 'trust') > 0, 'blood opens warm');

  const feud = formRole({}, withKind('feud'), 'a', 'b', refFor('role_x', 'a'));
  assert.ok(axisOf(feud, 'a', 'b', 'trust') < 0, 'and a quarrel opens hostile');
  assert.ok(axisOf(feud, 'b', 'a', 'resentment') > 0, 'both ways, since a feud is symmetric');
});

test('the two ends of an ASYMMETRIC role open differently', () => {
  // The whole reason a role is a pair rather than a label: a servant fears a
  // master in a way the master does not fear back.
  const edges = formRole({}, withKind('power'), 'master', 'servant', refFor('role_x', 'a'));
  assert.ok(axisOf(edges, 'servant', 'master', 'fear') > 0);
  assert.equal(axisOf(edges, 'master', 'servant', 'fear'), 0);
});

test('a pair can hold SEVERAL roles, because your brother may also be your creditor', () => {
  const roles: Role[] = [
    { id: 'role_k', kind: 'kin', names: ['elder', 'younger'] },
    { id: 'role_e', kind: 'exchange', names: ['creditor', 'debtor'] },
  ];
  let edges = formRole({}, roles, 'a', 'b', refFor('role_k', 'a'));
  edges = formRole(edges, roles, 'b', 'a', refFor('role_e', 'b'));

  assert.deepEqual(rolesHeld(edges, roles, 'a', 'b').sort(), ['creditor', 'elder']);
});

test('forming the same role twice does not double it', () => {
  const roles = withKind('sworn');
  const once = formRole({}, roles, 'a', 'b', refFor('role_x', 'a'));
  const twice = formRole(once, roles, 'a', 'b', refFor('role_x', 'a'));
  assert.deepEqual(edgeBetween(twice, 'a', 'b')?.roles, ['role_x/a']);
});

test('nobody is their own kin, and an unknown role forms nothing', () => {
  assert.deepEqual(formRole({}, withKind('kin'), 'a', 'a', refFor('role_x', 'a')), {});
  assert.deepEqual(formRole({}, withKind('kin'), 'a', 'b', 'role_nope/a'), {});
});

/* -------------------------------------------------------------------------- */
/* What a relationship MEANS                                                   */
/* -------------------------------------------------------------------------- */

test('the two ends owe DIFFERENT things, which a symmetric label cannot say', () => {
  const roles = withKind('power');
  const edges = formRole({}, roles, 'master', 'servant', refFor('role_x', 'a'));

  assert.deepEqual(owedBy(edges, roles, 'servant', 'master'), ['obedience']);
  assert.deepEqual(owedBy(edges, roles, 'master', 'servant').sort(), ['coin', 'shelter']);
});

test('a relationship changes which actions are OFFERED, not just the numbers', () => {
  const roles = withKind('power');
  const edges = formRole({}, roles, 'master', 'servant', refFor('role_x', 'a'));

  assert.ok(permittedBy(edges, roles, 'master', 'servant').includes('command'));
  assert.equal(permittedBy(edges, roles, 'servant', 'master').includes('command'), false);
  assert.deepEqual(permittedBy({}, roles, 'stranger', 'servant'), [], 'a stranger may do none of it');
});

test('THE MATRILINEAL CASE: who inherits resolves without the engine knowing the word', () => {
  /*
   * The case that justifies generating roles at all. A world that inherits
   * through the mother's brother emits a role whose elder end owes
   * `inheritance` — and the question resolves whether that end is called
   * "father", "mother's-brother", or a word nobody has invented yet.
   */
  const roles: Role[] = [{ id: 'role_x', kind: 'kin', names: ['mother’s-brother', 'sister’s-child'] }];
  const edges = formRole({}, roles, 'uncle', 'nibling', refFor('role_x', 'a'));

  assert.deepEqual(heirsOf(edges, roles, 'uncle'), ['nibling']);
  assert.deepEqual(heirsOf(edges, roles, 'nibling'), [], 'and it does not flow back up');
});

test('THE OATH-SIBLING CASE: kin obligation between people who are not kin', () => {
  // The second case a fixed list cannot express — it degrades to "friend",
  // which obliges nothing.
  const roles = withKind('sworn');
  const edges = formRole({}, roles, 'a', 'b', refFor('role_x', 'a'));

  for (const [x, y] of [['a', 'b'], ['b', 'a']]) {
    assert.deepEqual(owedBy(edges, roles, x, y).sort(), ['protection', 'secrecy', 'support']);
  }
});

test('two people with no bond owe each other nothing', () => {
  assert.deepEqual(owedBy({}, world(), 'a', 'b'), []);
  assert.deepEqual(heirsOf({}, world(), 'a'), []);
});

/* -------------------------------------------------------------------------- */
/* A world's own roles                                                         */
/* -------------------------------------------------------------------------- */

test('a world deals its roles rather than drawing them, so none repeats', () => {
  for (const seed of [1, 7, 42, 512, 2024]) {
    const roles = rolesFor(seed);
    assert.ok(roles.length >= MIN_ROLES && roles.length <= MAX_ROLES);
    assert.equal(new Set(roles.map((r) => r.kind)).size, roles.length, `seed ${seed} dealt a kind twice`);
    assert.equal(new Set(roles.map((r) => r.id)).size, roles.length);
  }
});

test('the same world always has the same roles', () => {
  assert.deepEqual(rolesFor(11), rolesFor(11));
  assert.notDeepEqual(rolesFor(11).map((r) => r.kind), rolesFor(12).map((r) => r.kind));
});

test('a world that has been named keeps its words; one that has not falls back', () => {
  const named = applyRoleNames(rolesFor(3), [{ id: 'role_0', a: 'the elder', b: 'the young' }]);
  assert.equal(rolesOf({ seed: 3, roles: named })[0].names[0], 'the elder');
  assert.deepEqual(rolesOf({ seed: 3 })[0].names, rolesFor(3)[0].names);
});

test('naming is COSMETIC: the mechanics are identical whatever it is called', () => {
  // Two worlds, the same shape, different words — and the same answer to
  // "who inherits?". That is the whole split this design rests on.
  const plain = withKind('kin');
  const fancy = applyRoleNames(plain, [{ id: 'role_x', a: 'mother’s-brother', b: 'sister’s-child' }]);

  const a = formRole({}, plain, 'x', 'y', refFor('role_x', 'a'));
  const b = formRole({}, fancy, 'x', 'y', refFor('role_x', 'a'));
  assert.deepEqual(owedBy(a, plain, 'x', 'y'), owedBy(b, fancy, 'x', 'y'));
  assert.deepEqual(opensAt(plain, 'role_x/a'), opensAt(fancy, 'role_x/a'));
});

/* -------------------------------------------------------------------------- */
/* Naming                                                                      */
/* -------------------------------------------------------------------------- */

test('BOTH ends or neither — half a pair reads as a bug', () => {
  const roles = withKind('kin');
  assert.deepEqual(applyRoleNames(roles, [{ id: 'role_x', a: 'father', b: '' }])[0].names, roles[0].names);
  assert.deepEqual(applyRoleNames(roles, [{ id: 'role_x', a: '  ', b: 'child' }])[0].names, roles[0].names);
  assert.deepEqual(applyRoleNames(roles, [{ id: 'role_x', a: 'father', b: 'child' }])[0].names, ['father', 'child']);
});

test('a name for a role this world does not have is ignored', () => {
  const roles = world();
  assert.deepEqual(applyRoleNames(roles, [{ id: 'role_9999', a: 'x', b: 'y' }]), roles);
});

test('the model is told the SHAPE and asked only for words', async () => {
  const p = new FakeProvider({ structured: [{ roles: [] }] });
  await nameRoles(p, world(), 'a drowned coast of rusted freeways', 'en');

  const sent = p.allSentText();
  assert.match(sent, /drowned coast/, 'it is told what the world is');
  assert.match(sent, /role_0/, 'and which ids to answer for');
  assert.match(sent, /obeys|inherit|owes|shelter|quarrel|work/i, 'and what each relationship MEANS');
  assert.doesNotMatch(sent, /obedience.*from the list|OBLIGATIONS/, 'but never asked to choose an obligation');
});

test('a model that fails outright costs a world its words and nothing else', async () => {
  const broken = new FakeProvider({ structured: [] });
  const out = await nameRoles(broken, world(), 'anywhere', 'en');
  assert.deepEqual(out.map((r) => r.id), world().map((r) => r.id));
  assert.deepEqual(out.map((r) => r.kind), world().map((r) => r.kind));
});

test('a world with no roles asks nothing', async () => {
  assert.deepEqual(await nameRoles(new FakeProvider({ structured: [] }), [], 'anywhere', 'en'), []);
});

/* -------------------------------------------------------------------------- */
/* Sanity on the deck                                                          */
/* -------------------------------------------------------------------------- */

test('every kind can actually be dealt by some world', () => {
  // A template no seed ever reaches is a role the game claims to have and
  // never makes.
  const seen = new Set<RoleKind>();
  for (let seed = 0; seed < 200; seed++) for (const r of rolesFor(seed)) seen.add(r.kind);
  for (const kind of ROLE_KINDS) assert.ok(seen.has(kind), `no world ever deals "${kind}"`);
});

test('an end reads back as the end it is', () => {
  const roles = world();
  const role = kindIn(roles, roles[0].kind)!;
  assert.equal(endOfRef(refFor(role.id, 'a')), 'a');
  assert.equal(endOfRef(refFor(role.id, 'b')), 'b');
  assert.equal(roleById(roles, role.id)?.id, role.id);
});

/* -------------------------------------------------------------------------- */
/* The reader: a role nothing acted on would be another island                 */
/* -------------------------------------------------------------------------- */

test('THE DIRECTOR IS TOLD what a bond obliges and allows', async () => {
  /*
   * Without this the whole module is an island: bonds would be generated,
   * stored, named — and change nothing about what a turn can do. A
   * relationship changes which actions are OFFERED, and the Director is what
   * offers them.
   */
  const base = playState();
  const roles: Role[] = [{ id: 'role_x', kind: 'power', names: ['guildmaster', 'bound apprentice'] }];
  const state = {
    ...base,
    world: {
      ...base.world,
      roles,
      edges: formRole(base.world.edges, roles, 'warden', 'smith', refFor('role_x', 'a')),
    },
  };

  const p = new FakeProvider({ structured: [] });
  await runDirector(p, state, 'look around', 'exploration', []).catch(() => {});

  const sent = p.allSentText();
  assert.match(sent, /guildmaster/, 'the world\'s own word for the bond');
  assert.match(sent, /bound apprentice/, 'and for the other end of it');
  assert.match(sent, /may command/, 'and what it lets them actually DO');
  assert.match(sent, /owes obedience/, 'and what is owed, in which direction');
});

test('a bond with the player is told too, and only the directions that exist', async () => {
  const base = playState();
  const roles: Role[] = [{ id: 'role_x', kind: 'exchange', names: ['creditor', 'debtor'] }];
  const state = {
    ...base,
    world: {
      ...base.world,
      roles,
      edges: formRole(base.world.edges, roles, 'smith', PLAYER, refFor('role_x', 'a')),
    },
  };

  const p = new FakeProvider({ structured: [] });
  await runDirector(p, state, 'talk', 'conversation', []).catch(() => {});
  assert.match(p.allSentText(), /is creditor to you/);
});

test('a world where nobody is anybody says nothing about relationships', async () => {
  const p = new FakeProvider({ structured: [] });
  await runDirector(p, playState(), 'look', 'exploration', []).catch(() => {});
  assert.doesNotMatch(p.allSentText(), /What they are to each other/);
});

test('a bond the model invented is dropped, not minted', () => {
  // Two ways a proposed bond can be wrong, and neither is worth failing a
  // floor over: naming somebody who was never created, and naming a
  // relationship this world does not have.
  const roles = withKind('kin');
  const repairs: string[] = [];
  const edges = bondsAmong({}, roles, { a: 1, b: 1 }, [
    { a: 'a', b: 'ghost', role: 'role_x' },
    { a: 'a', b: 'b', role: 'role_nope' },
    { a: 'a', b: 'b', role: 'role_x' },
  ], repairs);

  assert.equal(repairs.length, 2, 'and both are reported rather than swallowed');
  assert.deepEqual(rolesHeld(edges, roles, 'a', 'b'), ['A']);
  assert.equal(edgeBetween(edges, 'a', 'ghost'), null);
});
