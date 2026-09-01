import test from 'node:test';
import assert from 'node:assert/strict';
import { hasDialogue, trimSceneSetting } from './writer.ts';

/**
 * A conversation should read as somebody talking to you, not as a novelist's
 * account of an exchange. The prompt asks for that; these are the mechanical
 * backstops for when the model does it anyway.
 */

const OBSERVED =
  "The Anchor's Rest is alive with activity, merchants hawking wares and children "
  + 'chasing pigeons between the platforms. You approach Elara Vane, who stands '
  + 'overseeing a shipment of dried fish being unloaded. “The tower?” she asks. '
  + '“It is our hope.”';

test('a paragraph of scenery before the speech is cut', () => {
  const trimmed = trimSceneSetting(OBSERVED);
  assert.equal(trimmed.startsWith('“The tower?'), true, `got: ${trimmed.slice(0, 60)}`);
  assert.equal(trimmed.includes('hawking wares'), false, 'the scene-setting goes');
  assert.equal(trimmed.includes('It is our hope'), true, 'the speech stays');
});

test('a short gesture before the speech survives', () => {
  // This is the posture beat that was asked for, not scenery.
  const gesture = 'She shrugged. “Not since the storm.”';
  assert.equal(trimSceneSetting(gesture), gesture);
});

test('a passage that opens on speech is untouched', () => {
  const clean = '“Not since the storm,” she says, eyes on the horizon.';
  assert.equal(trimSceneSetting(clean), clean);
});

test('narration with no speech in it is left alone', () => {
  // Nothing to trim to. The regeneration guard handles this case instead.
  const narration = 'The smith watched him go, then turned back to the anvil.';
  assert.equal(trimSceneSetting(narration), narration);
});

test('speech is recognised in either quoting style, and Thai', () => {
  assert.equal(hasDialogue('“this way,” she said'), true);
  assert.equal(hasDialogue('"ไปทางนั้น" เธอบอก'), true);
  assert.equal(hasDialogue('เขาเดินผ่านประตูไป'), false);
});

test('trimming keeps the gesture nearest the speech, not the scenery before it', () => {
  const mixed =
    'Rain hammered the roof of the market hall and somebody was shouting about prices. '
    + 'She set down the crate. “Ask someone else.”';
  const trimmed = trimSceneSetting(mixed);
  assert.equal(trimmed.startsWith('She set down the crate.'), true, `got: ${trimmed.slice(0, 40)}`);
  assert.equal(trimmed.includes('Rain hammered'), false);
});
