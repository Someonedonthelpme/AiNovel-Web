import test from 'node:test';
import assert from 'node:assert/strict';
import { back, isComplete, questionFor, recordAnswer, setDraft, startInterview, STAGES, transcript } from './interview.ts';
import { abilitiesOf } from './fixtures.ts';

const answerAll = (language: 'th' | 'en' = 'en') => {
  let iv = startInterview(language);
  for (const stage of STAGES) {
    const r = recordAnswer(iv, `answer for ${stage}`);
    assert.equal(r.error, null);
    iv = r.interview;
  }
  return iv;
};

test('the interview opens on the world question', () => {
  const iv = startInterview('en');
  assert.equal(iv.stage, 'world');
  assert.equal(iv.done, false);
  assert.deepEqual(iv.answers, {});
});

test('answering walks the stages in order and then finishes', () => {
  let iv = startInterview();
  const seen: string[] = [];
  for (const _ of STAGES) {
    seen.push(iv.stage);
    iv = recordAnswer(iv, 'something').interview;
  }
  assert.deepEqual(seen, ['world', 'character', 'drive', 'review']);
  assert.equal(iv.done, true);
});

test('a blank answer is refused without advancing', () => {
  const iv = startInterview();
  const r = recordAnswer(iv, '   ');
  assert.match(r.error ?? '', /needs an answer/);
  assert.equal(r.interview.stage, 'world');
  assert.deepEqual(r.interview.answers, {});
});

test('answers are trimmed', () => {
  const iv = recordAnswer(startInterview(), '  a dead city  ').interview;
  assert.equal(iv.answers.world, 'a dead city');
});

test('a finished interview accepts nothing further', () => {
  const done = answerAll();
  const r = recordAnswer(done, 'more');
  assert.match(r.error ?? '', /already finished/);
});

test('you can go back and change an earlier answer', () => {
  let iv = recordAnswer(startInterview(), 'a dead city').interview;
  assert.equal(iv.stage, 'character');

  const b = back(iv);
  assert.equal(b.error, null);
  assert.equal(b.interview.stage, 'world');

  iv = recordAnswer(b.interview, 'a green kingdom').interview;
  assert.equal(iv.answers.world, 'a green kingdom', 'the answer is replaced, not appended');
});

test('you cannot go back past the first question', () => {
  assert.match(back(startInterview()).error ?? '', /already at the first/);
});

test('completeness ignores the review stage', () => {
  let iv = startInterview();
  assert.equal(isComplete(iv), false);
  for (const _ of ['world', 'character', 'drive']) iv = recordAnswer(iv, 'x').interview;
  assert.equal(iv.stage, 'review');
  assert.equal(isComplete(iv), true, 'review is confirmation, not content');
});

test('questions are asked in the play language', () => {
  const en = questionFor('character', 'en');
  const th = questionFor('character', 'th');
  assert.notEqual(en, th);
  assert.match(th, /[฀-๿]/, 'the Thai question is actually in Thai');
  assert.match(en, /Who are you/);
});

test('every stage has a question in both languages', () => {
  for (const stage of STAGES) {
    for (const language of ['en', 'th'] as const) {
      assert.ok(questionFor(stage, language).trim().length > 0, `${stage}/${language} is missing`);
    }
  }
});

test('hand-set choices are kept on the draft for generation to respect', () => {
  const abilities = abilitiesOf({ str: 15 });
  let iv = setDraft(startInterview(), { name: 'Anan', baseAbilities: abilities });
  iv = setDraft(iv, { traits: ['blunt'] });

  assert.equal(iv.draft.name, 'Anan');
  assert.deepEqual(iv.draft.baseAbilities, abilities);
  assert.deepEqual(iv.draft.traits, ['blunt']);
});

test('setting the draft again merges rather than replaces', () => {
  const iv = setDraft(setDraft(startInterview(), { name: 'Anan' }), { backgroundName: 'Soldier' });
  assert.equal(iv.draft.name, 'Anan', 'the earlier field survives');
  assert.equal(iv.draft.backgroundName, 'Soldier');
});

test('the transcript pairs each question with its answer, in order', () => {
  const iv = answerAll('en');
  const text = transcript(iv);
  const order = STAGES.map((s) => text.indexOf(`Q (${s})`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'stages appear in order');
  assert.match(text, /A: answer for world/);
});

test('the transcript omits unanswered stages', () => {
  const iv = recordAnswer(startInterview(), 'a dead city').interview;
  const text = transcript(iv);
  assert.match(text, /Q \(world\)/);
  assert.equal(text.includes('Q (drive)'), false);
});
