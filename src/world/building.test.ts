import test from 'node:test';
import assert from 'node:assert/strict';
import { canUpgrade, modulesNeeded } from './building.ts';

/*
 * A building's footprint is a combination of modules, not a fixed shape
 * (DESIGN 6c §3f): a module holds 1-3 workstations, and growing past what a
 * settlement's free plots allow is blocked. Literal tile shapes/positions
 * aren't decided yet — this is the resource accounting underneath them.
 */

test('modules pack 1-3 workstations each, closed', () => {
  assert.equal(modulesNeeded(0), 0);
  assert.equal(modulesNeeded(1), 1);
  assert.equal(modulesNeeded(3), 1);
  assert.equal(modulesNeeded(4), 2);
  assert.equal(modulesNeeded(6), 2);
  assert.equal(modulesNeeded(7), 3);
});

test('growing past what free plots allow is blocked', () => {
  assert.equal(canUpgrade(1, 2, 0), false);
});

test('growing within free plots succeeds', () => {
  assert.equal(canUpgrade(1, 2, 1), true);
});

test('only the delta beyond current modules is charged against free plots', () => {
  assert.equal(canUpgrade(2, 3, 1), true);
});
