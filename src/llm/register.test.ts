import test from 'node:test';
import assert from 'node:assert/strict';
import { bandFor, readPlayerRegister, registerConsequence, registerFor } from './register.ts';
import type { NpcVoice } from '../world/types.ts';

const speaker = (id: string, voice: Partial<NpcVoice>) => ({
  id,
  voice: { selfPronoun: '', underStress: '', addressBands: {}, particleBands: {}, tics: [], ...voice },
});

const bands = { '-3': 'คุณ', '0': 'คุณ', '2': 'เธอ', '4': 'ชื่อเล่น' };

test('bandFor picks the highest floor at or below the trust value', () => {
  assert.equal(bandFor(-3, bands), 'คุณ');
  assert.equal(bandFor(1, bands), 'คุณ');
  assert.equal(bandFor(2, bands), 'เธอ');
  assert.equal(bandFor(3, bands), 'เธอ');
  assert.equal(bandFor(4, bands), 'ชื่อเล่น');
  assert.equal(bandFor(99, bands), 'ชื่อเล่น');
});

test('trust below every band yields no address form', () => {
  assert.equal(bandFor(-9, { '0': 'คุณ' }), null);
});

test('crossing a trust band changes the address form and the particle', () => {
  const n = speaker('doctor', {
    selfPronoun: 'ดิฉัน', addressBands: bands, particleBands: { '-3': 'ค่ะ', '2': 'นะ' },
  });
  const cold = registerFor(n, 0);
  const warm = registerFor(n, 2);
  assert.equal(cold.addressesPlayerAs, 'คุณ');
  assert.equal(cold.particle, 'ค่ะ');
  assert.equal(warm.addressesPlayerAs, 'เธอ');
  assert.equal(warm.particle, 'นะ');
  assert.notEqual(cold.addressesPlayerAs, warm.addressesPlayerAs);
});

test('two NPCs shift differently at the same trust, per their own sheets', () => {
  const a = speaker('a', { selfPronoun: 'ดิฉัน', addressBands: { '0': 'คุณ', '2': 'เธอ' }, particleBands: { '0': 'ค่ะ' } });
  const b = speaker('b', { selfPronoun: 'ข้า', addressBands: { '0': 'เจ้า' }, particleBands: { '0': 'วะ' } });
  assert.notEqual(registerFor(a, 2).addressesPlayerAs, registerFor(b, 2).addressesPlayerAs);
  assert.notEqual(registerFor(a, 2).particle, registerFor(b, 2).particle);
});

test('the player pronoun is read as an input', () => {
  assert.equal(readPlayerRegister('กูไม่เชื่อมึง').tone, 'crude');
  assert.equal(readPlayerRegister('หนูขอถามหน่อยค่ะ').tone, 'deferential');
  assert.equal(readPlayerRegister('ผมมาจากกรุงเทพครับ').tone, 'polite');
  assert.equal(readPlayerRegister('กระผมขอรับ').tone, 'formal');
  assert.equal(readPlayerRegister('I ask about the ledger').tone, 'unknown');
});

test('the formal long form is not miscounted as the polite short form it contains', () => {
  const r = readPlayerRegister('กระผมขอเรียนถาม');
  assert.ok(r.detected.includes('กระผม'));
  assert.ok(!r.detected.includes('ผม'), 'the polite short form must be masked out');
  assert.equal(r.tone, 'formal');
});

test('words that merely contain a pronoun do not trigger it', () => {
  assert.equal(readPlayerRegister('ค้นกูเกิลดู').tone, 'unknown');
});

test('crude wins over polite when both appear', () => {
  assert.equal(readPlayerRegister('กูบอกแล้วนะครับ').tone, 'crude');
});

test('addressing a superior crudely costs trust and raises suspicion', () => {
  assert.deepEqual(registerConsequence('crude', 'superior'), {
    nudges: { trust: -2, respect: -2, resentment: 1 },
    note: 'crude address to a superior',
  });
});

test('deference to a superior buys trust; to a peer it buys nothing', () => {
  assert.equal(registerConsequence('deferential', 'superior').nudges.trust, 1);
  assert.equal(registerConsequence('deferential', 'peer').nudges.trust ?? 0, 0);
});

test('roughness DOWNWARD frightens rather than offends', () => {
  // The asymmetry is the whole of a status system that means anything: the
  // same words cost you respect either way, and only one direction is scary.
  assert.equal(registerConsequence('crude', 'inferior').nudges.fear, 1);
  assert.equal(registerConsequence('crude', 'superior').nudges.fear ?? 0, 0);
  assert.equal(registerConsequence('crude', 'superior').nudges.resentment, 1);
});

test('plain politeness is free in both directions', () => {
  assert.deepEqual(registerConsequence('polite', 'superior'), { nudges: {}, note: null });
  assert.deepEqual(registerConsequence('unknown', 'peer'), { nudges: {}, note: null });
});
