import test from 'node:test';
import assert from 'node:assert/strict';
import { climbTarget, eraBandOf, loopBandOf, speciesChoiceOf, walkTarget } from './game.ts';

test('a climb request names a way out, the stair, or is refused', () => {
  // The route used to turn a body it could not parse into `{}`, which climbs
  // the stair: a broken request moved the player instead of failing.
  assert.deepEqual(climbTarget(''), { to: undefined });
  assert.deepEqual(climbTarget('{"to":"way-abc"}'), { to: 'way-abc' });
  assert.match(climbTarget('{"to":').error ?? '', /malformed/);
});

test('a species choice from the client is one of three shapes, or refused', () => {
  assert.equal(speciesChoiceOf(undefined), undefined, 'skipped: the ordinary kind');
  assert.deepEqual(speciesChoiceOf({ pick: 'made' }), { pick: 'made' });
  assert.deepEqual(speciesChoiceOf({ describe: '  brass, never eats ' }), { describe: 'brass, never eats' });
  assert.deepEqual(speciesChoiceOf({ decide: 'world' }), { decide: 'world' });
  assert.throws(() => speciesChoiceOf({ describe: '' }), /species/);
  assert.throws(() => speciesChoiceOf({ pick: 7 }), /species/);
});

test('a loop request that is not true or false is refused at the edge', () => {
  assert.equal(loopBandOf(undefined), false);
  assert.equal(loopBandOf(true), true);
  assert.equal(loopBandOf(false), false);
  assert.throws(() => loopBandOf('yes'), /loop/);
});

test('an era request that is not true or false is refused at the edge', () => {
  assert.equal(eraBandOf(undefined), false);
  assert.equal(eraBandOf(true), true);
  assert.throws(() => eraBandOf('yes'), /era/);
});

// W4a: a click is a map and a tile, checked at the edge. A malformed one is
// refused, never read as some tile — that would walk the player somewhere unasked.
test('a walk request is a map id and two whole numbers, or is refused', () => {
  assert.deepEqual(walkTarget('{"map":"hub:floor-0:town","x":3,"y":4}'), { target: { map: 'hub:floor-0:town', x: 3, y: 4 } });
  for (const bad of ['', '{"map":', '{"x":3,"y":4}', '{"map":"m","x":"3","y":4}', '{"map":"m","x":1.5,"y":4}', '{"map":"","x":1,"y":1}']) {
    assert.match(walkTarget(bad).error ?? '', /walk/, bad);
  }
});
