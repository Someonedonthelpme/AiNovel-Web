import test from 'node:test';
import assert from 'node:assert/strict';
import { climbTarget } from './game.ts';

test('a climb request names a way out, the stair, or is refused', () => {
  // The route used to turn a body it could not parse into `{}`, which climbs
  // the stair: a broken request moved the player instead of failing.
  assert.deepEqual(climbTarget(''), { to: undefined });
  assert.deepEqual(climbTarget('{"to":"way-abc"}'), { to: 'way-abc' });
  assert.match(climbTarget('{"to":').error ?? '', /malformed/);
});
