import { sword } from '../combat/fixtures.ts';
import type { Abilities } from '../combat/types.ts';
import { neutralTemperament, metNeeds } from '../character/persona.ts';
import type { Background, CharacterSheet, Skill } from './sheet.ts';
import { defaultAbilities } from './sheet.ts';

export function skill(id: string, over: Partial<Skill> = {}): Skill {
  return { id, name: id, description: '', ability: 'str', ...over };
}

export function background(id: string, over: Partial<Background> = {}): Background {
  return {
    id,
    name: id,
    description: '',
    grantsStats: {},
    grantsSkills: [],
    startingGear: [],
    startingAttacks: [sword],
    socialStanding: 'peer',
    ...over,
  };
}

/** Distinct skill sets, to prove backgrounds do not share a pool. */
export const soldier = background('soldier', {
  name: 'Soldier',
  grantsStats: { str: 1, con: 1 },
  grantsSkills: [
    skill('shield-wall', { name: 'Shield Wall', ability: 'con' }),
    skill('read-terrain', { name: 'Read the Ground', ability: 'wis' }),
  ],
  socialStanding: 'peer',
});

export const scholar = background('scholar', {
  name: 'Scholar',
  grantsStats: { int: 2 },
  grantsSkills: [
    skill('recall-lore', { name: 'Recall Lore', ability: 'int' }),
    skill('read-people', { name: 'Read the Room', ability: 'wis' }),
  ],
  socialStanding: 'superior',
});

export function sheet(over: Partial<CharacterSheet> = {}): CharacterSheet {
  return {
    name: 'Anan',
    language: 'en',
    background: soldier,
    baseAbilities: defaultAbilities(),
    traits: ['blunt'],
    level: 1,
    hitDie: 10,
    voice: { selfPronoun: 'I', underStress: 'I', addressBands: {}, particleBands: {}, tics: [] },
    status: 'peer',
    temperament: neutralTemperament(),
    needs: metNeeds(),
    counters: {},
    pressure: neutralTemperament(),
    ...over,
  };
}

export const thaiSheet = (over: Partial<CharacterSheet> = {}): CharacterSheet =>
  sheet({
    language: 'th',
    voice: { selfPronoun: 'ผม', underStress: 'กู', addressBands: {}, particleBands: {}, tics: [] },
    ...over,
  });

export const abilitiesOf = (over: Partial<Abilities> = {}): Abilities => ({
  ...defaultAbilities(),
  ...over,
});
