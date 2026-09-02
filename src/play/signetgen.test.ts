import test from 'node:test';
import assert from 'node:assert/strict';
import { admissible } from './signet.ts';
import type { Gate } from './signet.ts';
import { GATEABLE_FLAGS, generateSignets, THEMES } from './signetgen.ts';
import {
  candidateSignetsFor, MAX_ABILITY, reachableIn, SETTABLE_FLAGS, signetsFor, TOWER_HORIZON,
} from './signetbook.ts';
import { TRAITS, traitsFor } from './traitbook.ts';
import { WRITTEN_COUNTERS } from './traits.ts';
import { playState } from './fixtures.ts';
import type { PlayState } from './state.ts';

const SEEDS = [1, 3, 7, 21, 42, 108, 512, 2024, 31337];

const generate = (seed: number) =>
  generateSignets({ seed, horizon: TOWER_HORIZON, maxAbility: MAX_ABILITY, traits: TRAITS, language: 'en' });

/** Walk a gate and hand back every leaf. */
function leaves(gate: Gate): Gate[] {
  if (gate.kind === 'all' || gate.kind === 'any') return gate.of.flatMap(leaves);
  return [gate];
}

const worldFor = (seed: number): PlayState => {
  const base = playState();
  return { ...base, world: { ...base.world, seed } };
};

/* -------------------------------------------------------------------------- */
/* The proof, which is now load-bearing                                        */
/* -------------------------------------------------------------------------- */

test('every generated Signet can actually be obtained', () => {
  /*
   * The claim the whole design leans on. `admissible` used to reject nothing,
   * because four authored gates were written to be satisfiable — it was a
   * formality. Under generation it is the only thing between the player and an
   * unsolvable mystery, because a hidden Signet behind a broken gate is
   * indistinguishable from one that is merely well concealed.
   */
  for (const seed of SEEDS) {
    const checked = signetsFor(worldFor(seed));
    assert.deepEqual(
      checked.discarded.map((d) => `${d.signet.id}: ${d.why.join('; ')}`),
      [],
      `seed ${seed} generated something unobtainable`,
    );
    assert.ok(checked.kept.length > 0, `seed ${seed} left the world with no Signets`);
  }
});

test('a gate only ever names a counter something writes', () => {
  // The failure that made `people_met` unearnable, now impossible to author by
  // accident because the terms are drawn from a declared pool.
  for (const seed of SEEDS) {
    for (const signet of generate(seed)) {
      for (const leaf of leaves(signet.gate)) {
        if (leaf.kind === 'condition' && leaf.condition.kind === 'counter') {
          assert.ok(
            WRITTEN_COUNTERS.includes(leaf.condition.counter),
            `${signet.id} gates on ${leaf.condition.counter}, which nothing increments`,
          );
        }
      }
    }
  }
});

test('a gate never asks for a depth the tower does not reach', () => {
  for (const seed of SEEDS) {
    for (const signet of generate(seed)) {
      for (const leaf of leaves(signet.gate)) {
        if (leaf.kind === 'itemFromDepth') {
          assert.ok(leaf.minFloor <= TOWER_HORIZON, `${signet.id} wants floor ${leaf.minFloor}`);
        }
      }
    }
  }
});

test('a gate never asks for a flag nothing raises', () => {
  for (const seed of SEEDS) {
    for (const signet of generate(seed)) {
      for (const leaf of leaves(signet.gate)) {
        if (leaf.kind === 'flag') {
          assert.ok(SETTABLE_FLAGS.has(leaf.flag), `${signet.id} gates on ${leaf.flag}`);
          assert.ok(GATEABLE_FLAGS.includes(leaf.flag as never), `${leaf.flag} is not a gate term`);
        }
      }
    }
  }
});

test('a gate never asks for a score that cannot be reached', () => {
  for (const seed of SEEDS) {
    for (const signet of generate(seed)) {
      for (const leaf of leaves(signet.gate)) {
        if (leaf.kind === 'condition' && leaf.condition.kind === 'ability') {
          assert.ok(leaf.condition.atLeast <= MAX_ABILITY, `${signet.id} wants ${leaf.condition.atLeast}`);
        }
      }
    }
  }
});

/* -------------------------------------------------------------------------- */
/* Themes keep it coherent                                                     */
/* -------------------------------------------------------------------------- */

test('a gate is two or three terms, not a checklist', () => {
  // More than three and a gate stops describing a person and starts being a
  // list nobody could hold in mind, which is also a thing no name fits.
  for (const seed of SEEDS) {
    for (const signet of generate(seed)) {
      const count = leaves(signet.gate).length;
      assert.ok(count >= 2 && count <= 3, `${signet.id} has ${count} terms`);
    }
  }
});

test('every term in a gate comes from one theme', () => {
  /*
   * The coherence claim. Drawing freely produces "forty kills AND read the
   * ledger AND discipline two" — mechanically fine, describes nobody, and no
   * name fits it.
   */
  const describe = (gate: Gate): string => {
    if (gate.kind === 'itemFromDepth') return `item:${gate.family}`;
    if (gate.kind === 'flag') return `flag:${gate.flag}`;
    if (gate.kind === 'condition') {
      const c = gate.condition;
      return c.kind === 'counter' ? `counter:${c.counter}`
        : c.kind === 'ability' ? `ability:${c.ability}`
          : c.kind === 'personality' ? `personality:${c.axis}` : c.kind;
    }
    return gate.kind;
  };

  const themeTerms = THEMES.map((theme) => new Set(theme.terms.map((t) =>
    t.kind === 'counter' ? `counter:${t.counter}`
      : t.kind === 'item' ? `item:${t.family}`
        : t.kind === 'ability' ? `ability:${t.ability}`
          : t.kind === 'personality' ? `personality:${t.axis}` : `flag:${t.flag}`)));

  for (const seed of SEEDS) {
    for (const signet of generate(seed)) {
      const terms = leaves(signet.gate).map(describe);
      const fits = themeTerms.some((set) => terms.every((t) => set.has(t)));
      assert.ok(fits, `${signet.id} mixes themes: ${terms.join(' + ')}`);
    }
  }
});

test('every Signet is named, described and grows something', () => {
  for (const seed of SEEDS) {
    for (const signet of generate(seed)) {
      assert.match(signet.name, /^Signet of the /, `got ${signet.name}`);
      assert.ok(signet.description.length > 10, `${signet.id} has no rumour`);
      assert.ok(signet.opens, `${signet.id} grows nothing`);
      assert.ok(signet.opens!.size >= 2 && signet.opens!.size <= 5);
    }
  }
});

test('a Signet strengthens a trait this world actually offers', () => {
  // Pointing at a trait the run does not contain would leave a Signet
  // described as topping up something unearnable.
  for (const seed of SEEDS) {
    const traits = traitsFor(seed);
    const offered = new Set(traits.map((t) => t.id));
    const signets = generateSignets({
      seed, horizon: TOWER_HORIZON, maxAbility: MAX_ABILITY, traits, language: 'en',
    });
    for (const signet of signets) {
      assert.ok(offered.has(signet.augments.id), `${signet.id} augments the absent ${signet.augments.id}`);
    }
  }
});

/* -------------------------------------------------------------------------- */
/* Different worlds, same world twice                                          */
/* -------------------------------------------------------------------------- */

test('two worlds hide genuinely different Signets', () => {
  const shape = (seed: number) => generate(seed).map((s) => `${s.name}|${JSON.stringify(s.gate)}`).sort();
  assert.notDeepEqual(shape(1), shape(999));
  assert.notDeepEqual(shape(42), shape(2024));
});

test('the same world hides the same ones', () => {
  // Signets are read during play; a set that shifted between loads would make
  // a gate the player was working toward simply vanish.
  assert.deepEqual(generate(42), generate(42));
  assert.deepEqual(candidateSignetsFor(7), candidateSignetsFor(7));
});

test('both discoveries occur across worlds', () => {
  // Some carry a rumour and some never announce themselves at all; a run of
  // only one kind would lose half the point of the branch.
  const kinds = new Set(SEEDS.flatMap((seed) => generate(seed).map((s) => s.discovery)));
  assert.equal(kinds.size, 2, `only saw ${[...kinds].join(', ')}`);
});

test('an alternative gate is offered sometimes, but is the rarer shape', () => {
  // Two routes in is what makes a Signet feel found rather than assigned, and
  // it is also far easier to open — so it should not be the common case.
  const all = SEEDS.flatMap((seed) => generate(seed));
  const anys = all.filter((s) => s.gate.kind === 'any').length;
  assert.ok(anys > 0, 'never offered a second route');
  assert.ok(anys < all.length / 2, 'two-route gates should be the exception');
});

test('a generated set still faces the walk, not just the construction', () => {
  // Built to be provable AND proved. If the construction ever drifts from the
  // limits, this is what says so rather than the player discovering it.
  const reach = reachableIn(playState());
  for (const seed of SEEDS) {
    const checked = admissible(generate(seed), reach);
    assert.equal(checked.discarded.length, 0, `seed ${seed}: ${checked.discarded.length} unobtainable`);
  }
});

test('a world never offers the same Signet twice', () => {
  // Regression: themes were drawn rather than dealt, so a world could roll one
  // twice and coincide on the terms as well — two identical Signets of the
  // Ledger Hand, same name, same gate.
  for (const seed of SEEDS) {
    const signets = generate(seed);
    const gates = signets.map((s) => JSON.stringify(s.gate));
    const names = signets.map((s) => s.name);

    assert.equal(new Set(gates).size, gates.length, `seed ${seed} repeated a gate`);
    assert.equal(new Set(names).size, names.length, `seed ${seed} repeated a name`);
  }
});

test('a world uses every theme before repeating one', () => {
  for (const seed of SEEDS) {
    const themes = generate(seed).map((s) => s.id.split('_')[1]);
    const distinct = new Set(themes).size;
    assert.ok(
      distinct >= Math.min(THEMES.length, themes.length),
      `seed ${seed} used ${distinct} themes for ${themes.length} Signets`,
    );
  }
});
