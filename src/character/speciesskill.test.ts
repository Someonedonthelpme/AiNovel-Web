import test from 'node:test';
import assert from 'node:assert/strict';
import { obeys } from '../skills/compose.ts';
import { grammarFor, signatureSkill, TYPE_GRAMMAR } from './speciesskill.ts';
import { speciesFor } from './species.ts';
import { ABILITIES } from '../combat/types.ts';

const nodes = (seed = 11) => speciesFor(seed);

test('every people and every lineage has a signature skill, legal in its grammar', () => {
  for (let seed = 0; seed < 12; seed++) {
    for (const node of nodes(seed).filter((n) => n.level === 'species' || n.level === 'subspecies')) {
      const skill = signatureSkill(seed, node);
      assert.ok(skill, `${node.id} has no skill`);
      assert.equal(obeys(skill, grammarFor(node.type, skill.ability)), null, `${node.id}: ${skill.name} breaks its grammar`);
      assert.ok(skill.effects.some((e) => e.role === 'purpose'), `${node.id}: a skill that does nothing`);
    }
  }
});

test('a skill is keyed to the best stat its KIND can use', () => {
  // Not simply the best stat: a beast whose body leans on INT does not get
  // spellcraft for it, because the type's narrowing is absolute. Narrowing the
  // STAT is what keeps that true while leaving every kind able to do something.
  for (let seed = 0; seed < 12; seed++) {
    for (const node of nodes(seed).filter((n) => n.level === 'species')) {
      const ability = signatureSkill(seed, node).ability;
      const usable = ABILITIES.filter((a) => grammarFor(node.type, a).payloads.length > 0);
      assert.ok(usable.includes(ability), `${node.id}: ${ability} is not something a ${node.type} can use`);
      for (const other of usable) {
        assert.ok((node.template[ability] ?? 0) >= (node.template[other] ?? 0), `${node.id}: ${other} leans harder than ${ability}`);
      }
    }
  }
});

test('a type narrows what its creatures can do at all', () => {
  // A wolf has no spellcraft and the dead do not mend: the grammar is where that
  // is true, rather than a model being asked to be tasteful about it.
  assert.ok(!TYPE_GRAMMAR.beast?.payloads?.includes('burst'), 'beasts do not throw fire');
  assert.ok(!TYPE_GRAMMAR.undead?.payloads?.includes('mend'), 'the dead do not heal');

  for (let seed = 0; seed < 12; seed++) {
    for (const node of nodes(seed).filter((n) => n.level === 'subspecies')) {
      const allowed = TYPE_GRAMMAR[node.type]?.payloads;
      if (!allowed) continue;
      const grammar = grammarFor(node.type, signatureSkill(seed, node).ability);
      assert.ok(grammar.payloads.every((p) => allowed.includes(p)), `${node.id} may ${grammar.payloads.join('/')}`);
      assert.ok(grammar.payloads.length > 0, `${node.id} may do nothing at all`);
    }
  }
});

test('a lineage bends its people\'s skill rather than inventing its own', () => {
  const tree = nodes();
  const lineage = tree.find((n) => n.level === 'subspecies')!;
  const people = tree.find((n) => n.id === lineage.parent)!;

  const theirs = signatureSkill(11, lineage);
  const parent = signatureSkill(11, people);
  assert.equal(theirs.ability, parent.ability, 'the same knack');
  assert.notDeepEqual(theirs.effects, parent.effects, 'but not the same skill');
});

test('the same world composes the same skills', () => {
  const node = nodes().find((n) => n.level === 'species')!;
  assert.deepEqual(signatureSkill(11, node), signatureSkill(11, node));
});
