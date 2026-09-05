import test from 'node:test';
import assert from 'node:assert/strict';
import { ABILITIES } from '../combat/types.ts';
import { mulberry32 } from '../engine/roll.ts';
import { neutralTemperament, TEMPER_MAX } from '../character/persona.ts';
import type { Temperament } from '../character/persona.ts';
import { STANDARD, withOverrides } from '../rules/ruleset.ts';
import { composeSkill, forbidden } from './compose.ts';
import { STAT_GRAMMAR } from './statgrammar.ts';
import { budgetForFloor } from './book.ts';
import { flat, instant, self, single } from './effect.ts';
import type { Effect } from './effect.ts';
import { priceOfUse } from './pools.ts';
import { scaleBy, suitOf } from './suit.ts';

const wired = (over: Partial<Temperament> = {}): Temperament =>
  ({ intuition: 0, feeling: 0, nerve: 0, discipline: 0, ...over });

const hurt = (amount: number, shape: Effect['shape'] = single): Effect =>
  ({ role: 'purpose', sign: 'minus', channel: 'hp', who: 'foe', shape, duration: instant, formula: flat(amount) });

const mend = (amount: number): Effect =>
  ({ role: 'purpose', sign: 'plus', channel: 'hp', who: 'own', shape: self, duration: instant, formula: flat(amount) });

const held: Effect = {
  role: 'purpose', sign: 'plus', channel: 'stat', stat: 'wis', who: 'own', shape: self,
  duration: { kind: 'sustained' }, formula: flat(2),
};

const pay = (amount: number): Effect =>
  ({ role: 'cost', sign: 'minus', channel: 'stamina', who: 'own', shape: self, duration: instant, formula: flat(amount) });

/* -------------------------------------------------------------------------- */
/* What suits whom                                                             */
/* -------------------------------------------------------------------------- */

test('a bold person suits an action that reaches out to hurt somebody', () => {
  assert.ok(suitOf([hurt(8)], wired({ nerve: TEMPER_MAX })) > 0);
  assert.ok(suitOf([hurt(8)], wired({ nerve: -TEMPER_MAX })) < 0);
});

test('the same action suits a timid person WORSE, not merely less', () => {
  // The signed half. An unsuited action is not "no bonus" — it is a penalty,
  // which is what lets mismatches pay for matches and needs no upside cap.
  const bold = suitOf([hurt(8)], wired({ nerve: 6 }));
  const timid = suitOf([hurt(8)], wired({ nerve: -6 }));
  assert.equal(bold, -timid, 'the budget should be symmetric about neutral');
});

test('putting somebody back together is values, not nerve', () => {
  assert.equal(suitOf([mend(6)], wired({ nerve: TEMPER_MAX })), 0, 'boldness has nothing to say about it');
  assert.ok(suitOf([mend(6)], wired({ feeling: TEMPER_MAX })) > 0);
});

test('something held is maintained, so it leans on discipline', () => {
  assert.ok(suitOf([held], wired({ discipline: TEMPER_MAX })) > 0);
  assert.ok(suitOf([held], wired({ discipline: -TEMPER_MAX })) < 0);
});

test('catching a crowd asks more of the same nerve than catching one of them', () => {
  const wide = suitOf([hurt(8, { kind: 'burst', radius: 2 })], wired({ nerve: 5 }));
  const narrow = suitOf([hurt(8)], wired({ nerve: 5 }));
  assert.equal(wide, narrow, 'one effect is its own mean, so the weight cancels');

  // It bites where a skill is a MIX, which is the only place a weight can.
  const mixed = suitOf([hurt(8, { kind: 'burst', radius: 2 }), mend(4)], wired({ nerve: 5, feeling: -5 }));
  assert.ok(mixed > 0, 'the wider effect should carry the mean');
});

test('nobody has an opinion about what an action costs THEM', () => {
  assert.equal(
    suitOf([hurt(8), pay(9)], wired({ nerve: 4 })),
    suitOf([hurt(8)], wired({ nerve: 4 })),
    'a cost is not part of the match',
  );
});

test('a persona nobody has read yet suits everything equally', () => {
  // NPC parity: every channel takes a Persona, and an absent one is neutral
  // rather than an error or a silent bonus.
  assert.equal(suitOf([hurt(8)], undefined), 0);
  assert.equal(suitOf([hurt(8)], neutralTemperament()), 0);
});

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

test('the budget is bounded however extreme the wiring', () => {
  const most = wired({ nerve: TEMPER_MAX, feeling: TEMPER_MAX, discipline: TEMPER_MAX, intuition: TEMPER_MAX });
  for (const stat of ABILITIES) {
    for (const seed of [1, 7, 42, 512]) {
      const skill = composeSkill(mulberry32(seed), {
        id: 's', name: '', description: '', ability: stat,
        grammar: STAT_GRAMMAR[stat], budget: budgetForFloor(20),
      });
      const suit = suitOf(skill.effects, most);
      assert.ok(suit >= -1 && suit <= 1, `${stat} suits ${suit}`);
    }
  }
});

test('a perfect match never makes a skill free', () => {
  // The floor the design asks for. A discount that could reach nought would
  // make one build spam a skill for ever, which is worse than any mismatch.
  const cheap = { id: 'c', name: 'c', description: '', ability: 'str' as const, range: 1, effects: [hurt(2), pay(1)] };
  const wild = withOverrides(STANDARD, { persona: { suitSwing: 0.9 } });
  assert.ok(priceOfUse(cheap, { temperament: wired({ nerve: TEMPER_MAX }) }, wild).cost >= 1);
});

test('scaling by an identity swing changes nothing at all', () => {
  // The claim the whole ruleset rests on: simple is the deep code with its
  // dials at neutral, not a second path.
  assert.equal(scaleBy(10, 1, 0), 10);
  assert.equal(scaleBy(10, -1, 0), 10);
});

/* -------------------------------------------------------------------------- */
/* The forbidden pairs                                                         */
/* -------------------------------------------------------------------------- */

test('a pair no stat may produce is caught even when both halves are legal', () => {
  /*
   * The job the per-axis allow-lists cannot do. A grammar holding `mend` and a
   * reach can legally draw "heal" and legally draw "somebody over there", and
   * the COMBINATION is nonsense that neither list forbids on its own.
   */
  assert.match(forbidden([{ ...mend(6), who: 'foe' }]) ?? '', /heals a foe/);
  assert.match(forbidden([{ ...hurt(6), who: 'friend' }]) ?? '', /wounds a friend/);
  assert.match(forbidden([{ ...held, sign: 'plus', who: 'foe' }]) ?? '', /sharpens a foe/);
});

test('a reckless COST is not a violation, which is the whole point of costs', () => {
  // Paying in a condition on yourself is the shape the component model was
  // argued for. Only purposes are checked.
  const reckless: Effect = {
    role: 'cost', sign: 'minus', channel: 'condition', condition: 'prone', who: 'own', shape: self,
    duration: { kind: 'rounds', rounds: 1 }, formula: flat(1),
  };
  assert.equal(forbidden([hurt(12), reckless]), null);
});

test('nothing the composer produces is ever a forbidden pair', () => {
  for (const stat of ABILITIES) {
    for (const floor of [1, 6, 12, 20]) {
      for (const seed of [1, 7, 42, 512, 2024]) {
        const skill = composeSkill(mulberry32(seed), {
          id: 's', name: '', description: '', ability: stat,
          grammar: STAT_GRAMMAR[stat], budget: budgetForFloor(floor),
        });
        assert.equal(forbidden(skill.effects), null, `${stat} floor ${floor} ${forbidden(skill.effects)}`);
      }
    }
  }
});
