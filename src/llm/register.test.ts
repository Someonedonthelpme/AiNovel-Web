import test from 'node:test';
import assert from 'node:assert/strict';
import { bandFor, readPlayerRegister, registerConsequence, registerFor } from './register.ts';
import { npc } from '../worldgen/fixtures.ts';

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
  const n = npc('doctor', {
    voice: { selfPronoun: 'ดิฉัน', addressBands: bands, particleBands: { '-3': 'ค่ะ', '2': 'นะ' }, tics: [] },
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
  const a = npc('a', { voice: { selfPronoun: 'ดิฉัน', addressBands: { '0': 'คุณ', '2': 'เธอ' }, particleBands: { '0': 'ค่ะ' }, tics: [] } });
  const b = npc('b', { voice: { selfPronoun: 'ข้า', addressBands: { '0': 'เจ้า' }, particleBands: { '0': 'วะ' }, tics: [] } });
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
  assert.deepEqual(registerConsequence('crude', 'superior'), { trust: -2, suspicion: 1, note: 'crude address to a superior' });
});

test('deference to a superior buys trust; to a peer it buys nothing', () => {
  assert.equal(registerConsequence('deferential', 'superior').trust, 1);
  assert.equal(registerConsequence('deferential', 'peer').trust, 0);
});

test('plain politeness is free in both directions', () => {
  assert.deepEqual(registerConsequence('polite', 'superior'), { trust: 0, suspicion: 0, note: null });
  assert.deepEqual(registerConsequence('unknown', 'peer'), { trust: 0, suspicion: 0, note: null });
});
