import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOT_CATEGORIES } from './catalogue.ts';

test('the goods vocabulary is closed to the eleven decided categories', () => {
  assert.deepEqual([...LOOT_CATEGORIES], [
    'rations', 'draught', 'weapon', 'armour', 'pack', 'part', 'material', 'book',
    'seed', 'tool', 'ingredient',
  ]);
});
