import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRegister, containsForm, isThai } from './register.ts';

const want = { selfPronoun: 'ดิฉัน', addressesPlayerAs: 'คุณ', particle: 'ค่ะ' };

test('a passage that obeys every constraint passes', () => {
  const r = checkRegister('ดิฉันไม่ทราบว่าคุณหมายถึงอะไรค่ะ', want);
  assert.equal(r.ok, true);
  assert.equal(r.score, 1);
  assert.equal(r.usedSelfPronoun, true);
  assert.equal(r.usedAddress, true);
  assert.equal(r.usedParticle, true);
});

test('a missing particle is caught and scored down', () => {
  const r = checkRegister('ดิฉันไม่ทราบว่าคุณหมายถึงอะไร', want);
  assert.equal(r.ok, false);
  assert.equal(r.usedParticle, false);
  assert.equal(r.score, 2 / 3);
});

test('the wrong self-pronoun is caught', () => {
  const r = checkRegister('ฉันไม่ทราบว่าคุณหมายถึงอะไรค่ะ', want);
  assert.equal(r.usedSelfPronoun, false, 'ฉัน is not ดิฉัน');
  assert.equal(r.ok, false);
});

test('the wrong address form is caught', () => {
  const r = checkRegister('ดิฉันไม่ทราบว่าเธอหมายถึงอะไรค่ะ', want);
  assert.equal(r.usedAddress, false, 'เธอ is a different intimacy band from คุณ');
  assert.equal(r.ok, false);
});

test('a banned form showing up fails the passage outright', () => {
  const r = checkRegister('ดิฉันไม่รู้ว่าคุณพูดอะไรค่ะ กูเบื่อ', want, ['กู', 'มึง']);
  assert.deepEqual(r.forbiddenFound, ['กู']);
  assert.equal(r.ok, false, 'every constraint met, but a banned form appeared');
});

test('a word that merely contains a pronoun does not count as using it', () => {
  assert.equal(containsForm('ค้นกูเกิลดู', 'กู'), false);
  assert.equal(containsForm('งานคุณภาพดี', 'คุณ'), false);
  assert.equal(containsForm('คุณสบายดีไหม', 'คุณ'), true);
});

test('English output fails even when the forms are technically absent', () => {
  const r = checkRegister('I do not know what you mean.', want);
  assert.equal(r.isThai, false);
  assert.equal(r.ok, false);
});

test('at full intimacy the particle requirement drops away rather than failing', () => {
  const intimate = { selfPronoun: 'ฉัน', addressesPlayerAs: 'เธอ', particle: '' };
  const r = checkRegister('ฉันรู้ว่าเธอจะมา', intimate);
  assert.equal(r.ok, true, 'particles dropping away is the correct register, not a failure');
  assert.equal(r.score, 1);
});

test('an em dash is treated the same as no particle', () => {
  const r = checkRegister('ฉันรู้ว่าเธอจะมา', { selfPronoun: 'ฉัน', addressesPlayerAs: 'เธอ', particle: '—' });
  assert.equal(r.ok, true);
});

test('a passage meeting nothing scores zero', () => {
  const r = checkRegister('มันไม่เกี่ยวอะไรเลย', want);
  assert.equal(r.score, 0);
  assert.equal(r.ok, false);
});

test('isThai distinguishes scripts', () => {
  assert.equal(isThai('สวัสดี'), true);
  assert.equal(isThai('hello'), false);
  assert.equal(isThai('hello สวัสดี'), true);
});

test('hedging across bands is caught, even when the required form is present', () => {
  // The model used the required intimate address AND a formal one. Mixing bands
  // IS register drift, so "the right pronoun appears somewhere" must not pass.
  const warm = { selfPronoun: 'ฉัน', addressesPlayerAs: 'เธอ', particle: 'นะ' };
  const r = checkRegister('ฉันไม่อยากให้คุณไป เธอเป็นคนดีนะ', warm, ['คุณ']);
  assert.equal(r.usedAddress, true, 'the required form is there');
  assert.deepEqual(r.forbiddenFound, ['คุณ'], 'but so is a competing one');
  assert.equal(r.ok, false);
});

test('a banned form that is a substring of a required one is not a false positive', () => {
  // ฉัน sits inside ดิฉัน, so banning the short form must not fire on the long one.
  const formal = { selfPronoun: 'ดิฉัน', addressesPlayerAs: 'คุณ', particle: 'ค่ะ' };
  const r = checkRegister('ดิฉันไม่ทราบว่าคุณหมายถึงอะไรค่ะ', formal, ['ฉัน']);
  assert.deepEqual(r.forbiddenFound, [], 'the short pronoun only appears inside the long one');
  assert.equal(r.ok, true);
});
