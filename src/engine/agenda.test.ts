import test from 'node:test';
import assert from 'node:assert/strict';
import { agendaProgress, agendaStepFor } from './agenda.ts';
import { goodBible, npc } from '../worldgen/fixtures.ts';

test('agenda progress is a pure function of clock spent', () => {
  const n = npc('doctor', { agenda: ['a', 'b', 'c'], agendaPace: 3 });
  assert.equal(agendaStepFor(n, 0), 0);
  assert.equal(agendaStepFor(n, 2), 0);
  assert.equal(agendaStepFor(n, 3), 1);
  assert.equal(agendaStepFor(n, 8), 2);
  assert.equal(agendaStepFor(n, 9), 3);
});

test('agendas cap at their last step rather than running off the end', () => {
  const n = npc('doctor', { agenda: ['a', 'b'], agendaPace: 1 });
  assert.equal(agendaStepFor(n, 500), 2);
});

test('a zero or negative pace cannot divide by zero', () => {
  const n = npc('x', { agenda: ['a'], agendaPace: 0 });
  assert.equal(agendaStepFor(n, 1), 1);
});

test('NPCs advance off-screen at their own pace', () => {
  const b = goodBible();
  const at0 = agendaProgress(b, 0);
  assert.deepEqual(at0.find((p) => p.npc === 'doctor')?.done, []);
  assert.equal(at0.find((p) => p.npc === 'doctor')?.next, 'pack her bag');

  const at6 = agendaProgress(b, 6);
  assert.deepEqual(at6.find((p) => p.npc === 'doctor')?.done, ['pack her bag', 'leave for the station']);
  // mali has pace 4, so at clock 6 she is only one step in — different NPCs move
  // at different rates.
  assert.deepEqual(at6.find((p) => p.npc === 'mali')?.done, ['burn the ledger']);
});
