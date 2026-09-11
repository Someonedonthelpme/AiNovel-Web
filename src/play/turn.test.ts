import { openingEdges, trustToward } from '../social/edge.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { hasDialogue } from '../llm/writer.ts';
import { mergeDeltas } from '../llm/director.ts';
import { WriterLeakError, assertNoLeak, hiddenStrings, toWriterView } from '../llm/redact.ts';
import { checkedOutput, directorOutput, emptyDelta, outcome, playState } from './fixtures.ts';
import { outcomeFor, playTurn, suggestedActions } from './turn.ts';
import type { Place } from '../world/types.ts';

/** Every die shows its minimum: 2d6 = 2, a certain miss. */
const alwaysLow = () => 0;
/** Every die shows its maximum: 2d6 = 12, a certain hit. */
const alwaysHigh = () => 0.999;

// Quoted, because a conversation turn now has to contain actual speech —
// see `hasDialogue`. The register forms are unchanged.
const COMPLIANT = '"ดิฉันไม่ทราบค่ะ คุณลองถามคนอื่นดูค่ะ"';

const deps = (director: unknown, rng: () => number, writerText = [COMPLIANT]) => ({
  director: new FakeProvider({ structured: [director] }),
  writer: new FakeProvider({ text: writerText }),
  rng,
});

/* -------------------------------------------------------------------------- */
/* The tier commitment                                                         */
/* -------------------------------------------------------------------------- */

test('a forced miss applies the consequences the Director committed to for missing', async () => {
  const s = playState();
  const r = await playTurn(deps(checkedOutput(), alwaysLow), s, 'ask about the forge', 'conversation');

  assert.equal(r.record.roll?.tier, 'miss');
  assert.equal(trustToward(r.state.world.edges, 'smith'), -1, 'the onMiss trust change, not onHit');
  assert.equal(r.state.world.facts.length, 0, 'the onHit fact was never learned');
});

test('a forced hit applies the hit branch instead', async () => {
  const s = playState();
  const r = await playTurn(deps(checkedOutput(), alwaysHigh), s, 'ask about the forge', 'conversation');

  assert.equal(r.record.roll?.tier, 'hit');
  assert.equal(trustToward(r.state.world.edges, 'smith'), 2);
  assert.equal(r.state.world.facts[0]?.text, 'the forge runs at night');
});

test('the same Director output yields different worlds under different dice', async () => {
  // This is the point of committing to every branch before rolling: the model
  // cannot bias an outcome it has not seen.
  const s = playState();
  const output = checkedOutput();
  const miss = await playTurn(deps(output, alwaysLow), s, 'ask', 'conversation');
  const hit = await playTurn(deps(output, alwaysHigh), s, 'ask', 'conversation');

  assert.notEqual(trustToward(miss.state.world.edges, 'smith'), trustToward(hit.state.world.edges, 'smith'));
});

test('the writer is told the tier as a fact it must honour', async () => {
  const s = playState();
  const d = deps(checkedOutput(), alwaysLow);
  await playTurn(d, s, 'ask', 'conversation');
  const sent = (d.writer as FakeProvider).allSentText();
  assert.match(sent, /Outcome \(miss\)/);
  assert.match(sent, /She turns her back/, 'the committed miss narration is passed through');
  assert.equal(/She tells you plainly/.test(sent), false, 'the hit branch never reaches the writer');
});

test('outcomeFor selects the branch matching the tier', () => {
  const o = checkedOutput();
  assert.equal(outcomeFor(o, 'hit').narrate, 'She tells you plainly.');
  assert.equal(outcomeFor(o, 'partial').narrate, 'She tells you, but names her price.');
  assert.equal(outcomeFor(o, 'miss').narrate, 'She turns her back.');
});

test('no dice are rolled when the Director says nothing is at stake', async () => {
  const r = await playTurn(deps(directorOutput(), alwaysLow), playState(), 'look around', 'exploration');
  assert.equal(r.record.roll, null);
});

/* -------------------------------------------------------------------------- */
/* The engine refuses what the model cannot have                               */
/* -------------------------------------------------------------------------- */

test('a Director that invents a place is refused without losing the turn', async () => {
  const output = directorOutput({
    delta: { ...emptyDelta(), moveTo: 'the secret vault', learnFacts: ['the smith is nervous'] },
  });
  const r = await playTurn(deps(output, alwaysLow), playState(), 'go', 'exploration');

  assert.equal(r.state.world.currentPlace, 'town', 'the invented move did not happen');
  assert.match(r.rejected[0], /not connected/);
  assert.equal(r.state.world.facts[0]?.text, 'the smith is nervous', 'the legal part still applied');
});

test('a Director that invents a person is refused', async () => {
  const output = directorOutput({ delta: { ...emptyDelta(), trustPerson: 'ghost', trustChange: 3 } });
  const r = await playTurn(deps(output, alwaysLow), playState(), 'talk', 'conversation');
  assert.match(r.rejected.join(' '), /no such person/);
});

/* -------------------------------------------------------------------------- */
/* Redaction                                                                   */
/* -------------------------------------------------------------------------- */

test('undiscovered places never reach the writer', async () => {
  const s = playState();
  const d = deps(directorOutput(), alwaysLow);
  await playTurn(d, s, 'look', 'exploration');

  const sent = (d.writer as FakeProvider).allSentText();
  for (const secret of ['the first stair', 'the dry well', 'the covered market']) {
    assert.equal(sent.includes(secret), false, `writer payload leaked "${secret}"`);
  }
});

/**
 * At the low gate only the town is connected, so everything beyond it is out of
 * sight. Standing in the town instead would make these names public — the map
 * labels every connected place and the game offers "go to <name>" as a
 * suggestion, so they are not secrets there.
 */
const outOfSight = () => playState({ currentPlace: 'gate' });

test('a brief that names an undiscovered place is caught, not narrated', async () => {
  // The Director is not trusted to keep secrets; the boundary is enforced.
  const leaky = directorOutput({
    brief: { intent: 'hint at the first stair', mustInclude: ['the first stair'], mustNotMention: [], tone: 'sly', length: 'short' },
  });
  await assert.rejects(
    () => playTurn(deps(leaky, alwaysLow), outOfSight(), 'look', 'exploration'),
    WriterLeakError,
  );
});

test('the hidden set covers unvisited places and spares the one you are standing in', () => {
  const s = outOfSight();
  const hidden = hiddenStrings(s.world);
  assert.ok(hidden.includes('the first stair'));
  assert.ok(hidden.includes('the dry well'));
  assert.ok(!hidden.includes('the low gate'), 'you can see where you are standing');

  const view = toWriterView(s, {
    brief: { intent: '', mustInclude: [], mustNotMention: [], tone: '', length: 'short' },
  });
  assert.doesNotThrow(() => assertNoLeak(view, s.world));
});

test('a place the map already labels is not treated as a secret', () => {
  // Regression: this made the game unplayable. The suggested actions and the
  // local map both name every connected place, so calling those names secrets
  // meant any turn whose prose mentioned a neighbour died with a leak error
  // instead of being written.
  const hidden = hiddenStrings(playState().world);
  for (const neighbour of ['the low gate', 'the covered market', 'the dry well', 'the first stair']) {
    assert.ok(!hidden.includes(neighbour), `"${neighbour}" is on the player's own map`);
  }
});

test('a view carrying a secret fails the assertion loudly', () => {
  const s = outOfSight();
  const view = toWriterView(s, {
    brief: { intent: '', mustInclude: [], mustNotMention: [], tone: '', length: 'short' },
    canonFacts: ['someone mentioned the dry well'],
  });
  assert.throws(() => assertNoLeak(view, s.world), WriterLeakError);
});

/* -------------------------------------------------------------------------- */
/* Conversations are dialogue, not paragraphs about dialogue                   */
/* -------------------------------------------------------------------------- */

test('a conversation narrated instead of spoken is written again', async () => {
  // Left to itself the model writes a novelist's account of the exchange —
  // "Warden Bex watched him impassively, her hand on the pommel" — which reads
  // as a scene being described rather than somebody talking to you.
  const narrated = 'ช่างตีเหล็กมองเขาอย่างเงียบ ๆ แล้วหันกลับไปทำงานต่อ';
  const r = await playTurn(
    deps(talkingTo('smith'), alwaysLow, [narrated, COMPLIANT]),
    playState(), 'ask', 'conversation',
  );
  assert.equal(r.writer.regenerated, true, 'narration in a conversation earns one correction');
  assert.equal(r.record.prose, COMPLIANT);
});

test('narration outside a conversation is left alone', () => {
  // The guard binds to who is being spoken to. An exploration turn has nobody
  // talking, and demanding speech from it would be the mirror of the bug that
  // made NPCs narrate the world.
  assert.equal(hasDialogue('เขาเดินผ่านประตูไป'), false);
  assert.equal(hasDialogue('"ไปทางนั้น" เธอบอก'), true);
  assert.equal(hasDialogue('“this way,” she said'), true);
});

/* -------------------------------------------------------------------------- */
/* The register guard                                                          */
/* -------------------------------------------------------------------------- */

const talkingTo = (id: string) => directorOutput({ addressedPerson: id });

test('prose that drifts out of register is regenerated once', async () => {
  const drifted = '"ไม่รู้ ไปถามคนอื่น"';
  const r = await playTurn(
    deps(talkingTo('smith'), alwaysLow, [drifted, COMPLIANT]),
    playState(), 'ask', 'conversation',
  );
  assert.equal(r.writer.regenerated, true);
  assert.equal(r.record.prose, COMPLIANT);
  assert.ok(r.writer.checks.every((c) => c.check.ok));
});

test('compliant prose is accepted without a second call', async () => {
  const d = deps(talkingTo('smith'), alwaysLow, [COMPLIANT]);
  const r = await playTurn(d, playState(), 'ask', 'conversation');
  assert.equal(r.writer.regenerated, false);
  assert.equal((d.writer as FakeProvider).calls.length, 1);
});

test('a stubbornly drifting model does not loop forever', async () => {
  const bad = 'ไม่รู้เลย';
  const d = deps(talkingTo('smith'), alwaysLow, [bad, bad]);
  const r = await playTurn(d, playState(), 'ask', 'conversation');

  assert.equal((d.writer as FakeProvider).calls.length, 2, 'exactly one retry');
  assert.equal(r.writer.regenerated, true);
  assert.ok(r.writer.checks.some((c) => !c.check.ok), 'and the failure is reported rather than hidden');
});

/* -------------------------------------------------------------------------- */
/* Suggested actions                                                           */
/* -------------------------------------------------------------------------- */

test('every suggested action is real — affordances, people here, and true exits', () => {
  const s = playState();
  const actions = suggestedActions(s);
  assert.ok(actions.includes('Talk to Ora the smith'));
  assert.ok(actions.some((a) => a.startsWith('Go to ')));
  assert.equal(actions.includes('Go to the first stair'), true, 'the stair is connected to the town');
});

test('suggestions never offer a place you cannot walk to', () => {
  const s = playState();
  const region = s.world.regions['floor-0'];
  if (region.detail !== 'full') return assert.fail('expected a full region');
  const here = region.places.find((p) => p.id === s.world.currentPlace);
  const offered = suggestedActions(s).filter((a) => a.startsWith('Go to '));

  for (const action of offered) {
    const name = action.slice('Go to '.length);
    const target: Place | undefined = region.places.find((p) => p.name === name);
    assert.ok(target, `offered an unknown place: ${name}`);
    assert.ok(here?.connections.includes(target.id), `${name} is not connected`);
  }
});

test('narration is bound to no register, and no NPC is made to narrate', async () => {
  // Asking to look around is scene description. Demanding an NPC's pronouns of
  // it is what made the old woman narrate the harbour at the player.
  const d = deps(directorOutput({ addressedPerson: '' }), alwaysLow, ['ประตูไม้ใหญ่ตั้งตระหง่านอยู่ตรงหน้า']);
  const r = await playTurn(d, playState(), 'look around', 'exploration');

  assert.deepEqual(r.writer.checks, [], 'nothing to check when nobody speaks');
  assert.equal(r.writer.regenerated, false);
  assert.match((d.writer as FakeProvider).allSentText(), /Never put scene description into the mouth of an NPC/);
});

test('a conversation does bind the speaker to their register', async () => {
  const d = deps(talkingTo('smith'), alwaysLow, [COMPLIANT]);
  const r = await playTurn(d, playState(), 'ask her about the forge', 'conversation');
  assert.equal(r.writer.checks.length, 1);
  assert.equal(r.writer.checks[0].person, 'Ora the smith');
});

test('only the person being spoken to is checked, not everyone in the room', async () => {
  // The warden is also present, but the player is talking to the smith.
  const d = deps(talkingTo('smith'), alwaysLow, [COMPLIANT]);
  const r = await playTurn(d, playState(), 'ask', 'conversation');
  assert.deepEqual(r.writer.checks.map((c) => c.person), ['Ora the smith']);
});

test('a model saying "none" for an optional field is not treated as a place', async () => {
  // Observed live: the Director answered revealExit with "none", producing a
  // refusal for a location by that name on every single turn.
  const output = directorOutput({
    delta: { ...emptyDelta(), revealExit: 'none', moveTo: 'null', trustPerson: 'ไม่มี', trustChange: 2 },
  });
  const r = await playTurn(deps(output, alwaysLow), playState(), 'look', 'exploration');
  assert.deepEqual(r.rejected, [], `sentinels leaked through: ${r.rejected.join('; ')}`);
});

test('a real value is still honoured alongside the sentinels', async () => {
  const output = directorOutput({
    delta: { ...emptyDelta(), revealExit: 'none', moveTo: 'market', trustPerson: '', trustChange: 0 },
  });
  const r = await playTurn(deps(output, alwaysLow), playState(), 'go', 'exploration');
  assert.equal(r.state.world.currentPlace, 'market');
  assert.deepEqual(r.rejected, []);
});

/* -------------------------------------------------------------------------- */
/* Personality is audible                                                      */
/* -------------------------------------------------------------------------- */

test('a warm person and a cold one are addressed differently at the same trust', async () => {
  // This is the payoff of the persona: disposition is not a number on a sheet,
  // it changes the words the player actually hears.
  const bands = { '-3': 'คุณ', '2': 'เธอ' };
  const voice = { selfPronoun: 'ฉัน', underStress: 'กู', addressBands: bands, particleBands: { '-3': 'ค่ะ', '2': 'นะ' }, tics: [] };

  const base = playState();
  // The same trust, held as an EDGE — so the only difference between these two
  // worlds is who the smith is.
  const edges = openingEdges({}, [{ id: 'smith', trust: 1 }]);
  const warmWorld = {
    ...base.world,
    edges,
    people: {
      ...base.world.people,
      smith: { ...base.world.people['smith'], voice, temperament: { intuition: 0, feeling: 9, nerve: 0, discipline: 0 } },
    },
  };
  const coldWorld = {
    ...base.world,
    edges,
    people: {
      ...base.world.people,
      smith: { ...base.world.people['smith'], voice, temperament: { intuition: 0, feeling: -9, nerve: 0, discipline: 0 } },
    },
  };

  const warmView = toWriterView({ ...base, world: warmWorld }, {
    brief: { intent: '', mustInclude: [], mustNotMention: [], tone: '', length: 'short' },
    speaking: 'smith',
  });
  const coldView = toWriterView({ ...base, world: coldWorld }, {
    brief: { intent: '', mustInclude: [], mustNotMention: [], tone: '', length: 'short' },
    speaking: 'smith',
  });

  const warmForm = warmView.peoplePresent.find((p) => p.id === 'smith')?.register.addressesPlayerAs;
  const coldForm = coldView.peoplePresent.find((p) => p.id === 'smith')?.register.addressesPlayerAs;

  assert.equal(warmForm, 'เธอ', 'warmth opens the band a step early');
  assert.equal(coldForm, 'คุณ', 'coldness holds it back');
});

test('the writer is told who it is writing, not just their name', async () => {
  const base = playState();
  const world = {
    ...base.world,
    people: {
      ...base.world.people,
      smith: {
        ...base.world.people['smith'],
        temperament: { intuition: 0, feeling: -9, nerve: 0, discipline: 0 },
        needs: { rest: 10, food: 10, safety: 2, company: 0, purpose: 10 },
      },
    },
  };
  const d = deps(talkingTo('smith'), alwaysLow, [COMPLIANT]);
  await playTurn(d, { ...base, world }, 'ask', 'conversation');

  const sent = (d.writer as FakeProvider).allSentText();
  assert.match(sent, /cold/);
  assert.match(sent, /badly rattled/);
});

test('a dice check never drops what either side of the delta named', () => {
  // `mergeDeltas` rebuilt the delta from a hand-kept field list, and step 6's
  // `amendLaw` and `revealWay` were not on it: any turn with a check lost them.
  const merged = mergeDeltas(
    { amendLaw: { constraint: 'crossFloors', binds: 'all' }, revealWay: 'market' },
    { timeSpent: 1 },
  );
  assert.deepEqual(merged.amendLaw, { constraint: 'crossFloors', binds: 'all' });
  assert.equal(merged.revealWay, 'market');
});
