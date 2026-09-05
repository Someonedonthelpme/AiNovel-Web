import test from 'node:test';
import assert from 'node:assert/strict';
import { hasLore, loreFor } from './lorebook.ts';
import { knowsLore } from './lore.ts';
import { applySheetAction } from './sheetaction.ts';
import { playState } from './fixtures.ts';
import { subjectsFor } from '../world/subjects.ts';
import { addItem } from '../items/types.ts';
import type { Item } from '../items/types.ts';
import type { PlayState } from './state.ts';

const thing = (id: string, over: Partial<Item> = {}): Item =>
  ({ id, name: id, description: '', kind: 'material', stackable: false, value: 0, ...over });

/** A seed and an item that definitely produce a history together. */
function storied(seed = 1): { item: Item; state: PlayState } {
  for (let n = 0; n < 200; n++) {
    const item = thing(`relic_${n}`, { foundOn: 20 });
    if (!hasLore(item, { seed })) continue;
    const base = playState();
    return {
      item,
      state: {
        ...base,
        world: { ...base.world, seed },
        pc: { ...base.pc, inventory: addItem(base.pc.inventory, item, 1) },
      },
    };
  }
  throw new Error('no storied item found — LORE_CHANCE may be broken');
}

/* -------------------------------------------------------------------------- */
/* Where a history comes from                                                  */
/* -------------------------------------------------------------------------- */

test('the same object always carries the same story', () => {
  // Keyed on the item and the world, like every other generated thing here —
  // a node taken at level four still teaches the same skill at twelve.
  const item = thing('weapon_axe_d8', { foundOn: 9 });
  assert.deepEqual(loreFor(item, { seed: 42 }), loreFor(item, { seed: 42 }));
});

test('two worlds tell different stories about the same object', () => {
  const item = thing('weapon_axe_d8', { foundOn: 9 });
  const a = loreFor(item, { seed: 42 });
  const b = loreFor(item, { seed: 43 });
  if (a && b) assert.notEqual(a.text, b.text);
});

test('most things are just things', () => {
  // If everything came with a paragraph, reading would be a chore and none of
  // it would mean anything.
  const many = Array.from({ length: 200 }, (_, i) => thing(`t${i}`));
  const withStory = many.filter((i) => hasLore(i, { seed: 7 })).length;
  assert.ok(withStory > 0, 'but some things do');
  assert.ok(withStory < many.length * 0.75, 'and most do not');
});

test('a deep find carries more of a story than a first-room one', () => {
  const deep = Array.from({ length: 120 }, (_, i) => loreFor(thing(`d${i}`, { foundOn: 24 }), { seed: 5 }))
    .filter((l) => l !== null);
  const shallow = Array.from({ length: 120 }, (_, i) => loreFor(thing(`d${i}`, { foundOn: 0 }), { seed: 5 }))
    .filter((l) => l !== null);

  const mean = (xs: { depth: number }[]) => xs.reduce((n, x) => n + x.depth, 0) / Math.max(1, xs.length);
  assert.ok(mean(deep) > mean(shallow), 'which is what makes a deep find worth reading, not just worth more');
});

test('a history is always about something this world actually has', () => {
  // The guarantee the generated subject vocabulary exists for: a drive and a
  // history are drawn from the same pool, so they can always meet.
  const known = new Set(subjectsFor(11).map((s) => s.id));
  for (let n = 0; n < 60; n++) {
    const lore = loreFor(thing(`x${n}`, { foundOn: 12 }), { seed: 11 });
    if (lore) for (const about of lore.about) assert.ok(known.has(about), `${about} is not a subject of this world`);
  }
});

/* -------------------------------------------------------------------------- */
/* Reading it — the loop, end to end                                           */
/* -------------------------------------------------------------------------- */

test('reading something that speaks to you meets purpose', () => {
  // The whole chain: a world mints subjects, a character wants one of them, an
  // object turns out to be about it, and reading it feeds a need.
  const { item, state } = storied();
  const lore = loreFor(item, state.world)!;
  const wanting: PlayState = {
    ...state,
    sheet: { ...state.sheet, drive: { want: lore.about[0], fear: 'sub_0' }, needs: { ...state.sheet.needs, purpose: 3 } },
  };

  const after = applySheetAction(wanting, { type: 'read', item: item.id });
  assert.equal(after.error, null);
  assert.ok(after.state.sheet.needs.purpose > 3, 'it was about what they are climbing for');
  assert.equal(knowsLore(after.state.sheet, lore.id), true);
});

test('the same object leaves somebody else cold', () => {
  // An item mattering for a reason its numbers do not express — and only to
  // the person it is about.
  const { item, state } = storied();
  const lore = loreFor(item, state.world)!;
  const indifferent: PlayState = {
    ...state,
    sheet: {
      ...state.sheet,
      drive: { want: 'no_such_subject', fear: 'nor_this' },
      needs: { ...state.sheet.needs, purpose: 3 },
    },
  };

  const after = applySheetAction(indifferent, { type: 'read', item: item.id });
  assert.equal(after.error, null);
  assert.equal(after.state.sheet.needs.purpose, 3, 'it did not touch them');
  assert.equal(knowsLore(after.state.sheet, lore.id), true, 'but they have still read it');
});

test('a paragraph cannot be read twice for the same comfort', () => {
  const { item, state } = storied();
  const once = applySheetAction(state, { type: 'read', item: item.id }).state;
  assert.match(applySheetAction(once, { type: 'read', item: item.id }).error ?? '', /have read it/);
});

test('reading something you are not carrying is refused', () => {
  assert.match(
    applySheetAction(playState(), { type: 'read', item: 'not_in_the_pack' }).error ?? '',
    /not carrying/,
  );
});

test('a thing with no story says so rather than pretending', () => {
  const base = playState();
  let plain: Item | null = null;
  for (let n = 0; n < 200 && !plain; n++) {
    const candidate = thing(`plain_${n}`);
    if (!hasLore(candidate, base.world)) plain = candidate;
  }
  assert.ok(plain, 'some item must be ordinary');

  const carrying: PlayState = { ...base, pc: { ...base.pc, inventory: addItem(base.pc.inventory, plain, 1) } };
  assert.match(applySheetAction(carrying, { type: 'read', item: plain.id }).error ?? '', /nothing to it/);
});

test('a keepsake always has a history', () => {
  // Most things are just things — but the objects a character SETS OUT with
  // are the ones that came from somewhere by definition, and it means a new
  // player meets the reading of them rather than meeting an absence.
  const kept = thing('divingMask', { storied: true });
  for (let seed = 1; seed <= 40; seed++) {
    assert.ok(hasLore(kept, { seed }), `a keepsake should have a history in world ${seed}`);
  }
});

test('being storied does not change WHICH story it is', () => {
  // The roll still happens, so a thing that would have had a history gets the
  // one it would have had; storied only stops it being turned away.
  const plain = thing('relic_1', { foundOn: 20 });
  const same = thing('relic_1', { foundOn: 20, storied: true });
  for (let seed = 1; seed <= 20; seed++) {
    const rolled = loreFor(plain, { seed });
    if (rolled) assert.deepEqual(loreFor(same, { seed }), rolled);
  }
});
