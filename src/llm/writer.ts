import type { Provider } from './provider.ts';
import type { WriterView } from './redact.ts';
import { checkRegister, competingForms } from './register.ts';
import type { RegisterCheck } from './register.ts';

/**
 * The Writer turns a redacted view into prose.
 *
 * It accepts **only** a `WriterView`, so passing it world state is a compile
 * error. It never learns what is upstairs, what is behind an undiscovered door,
 * or what an NPC is lying about.
 *
 * Register is emitted as an explicit instruction and then VERIFIED, because it
 * is the first constraint a model drops and the mechanic this game is built
 * around. One regeneration on drift; a second failure is accepted and reported
 * rather than looping forever.
 */

export type WriterResult = {
  prose: string;
  /** Register verification per person present. Empty outside Thai. */
  checks: { person: string; check: RegisterCheck }[];
  /** True when the first attempt drifted and a second was needed. */
  regenerated: boolean;
};

const LENGTH = { short: 'Two or three sentences.', medium: 'A short paragraph.' } as const;

function systemPrompt(view: WriterView): string {
  const lines = [
    view.language === 'th'
      ? 'You write short passages of Thai prose for a tower-climbing RPG.'
      : 'You write short passages of English prose for a tower-climbing RPG.',
    'Write only the passage. No commentary, no headings, no options list.',
    LENGTH[view.brief.length],
    '',
    `The player character is ${view.pc.name}.`,
  ];

  lines.push(
    '',
    'Narration describes the world in the third person. It is NOT spoken by any',
    'character. Never put scene description into the mouth of an NPC.',
    'Only write dialogue for someone the player is actually speaking with.',
  );

  const speakers = view.peoplePresent.filter((p) => p.id === view.speaking);
  if (view.language === 'th' && speakers.length) {
    lines.push(
      '',
      'REGISTER for the person speaking — obey exactly. It encodes the',
      'relationship, and getting it wrong is worse than writing nothing:',
    );
    for (const p of speakers) {
      const r = p.register;
      lines.push(
        `- ${p.name} calls themselves "${r.selfPronoun}", addresses the player as ` +
          `"${r.addressesPlayerAs}"` +
          (r.particle ? `, and ends sentences with "${r.particle}".` : ', and uses no polite ending particle.'),
      );
      if (r.tics.length) lines.push(`  Mannerisms: ${r.tics.join('; ')}`);
    }
  }

  if (view.canonFacts.length) {
    lines.push('', 'Already true. Do not contradict any of it:');
    for (const fact of view.canonFacts) lines.push(`- ${fact}`);
  }

  return lines.join('\n');
}

function userPrompt(view: WriterView): string {
  const lines = [
    `Place: ${view.place.name}. ${view.place.description}`,
    view.peoplePresent.length
      ? `Present: ${view.peoplePresent.map((p) => {
          const notes = [...p.disposition, ...p.condition];
          return `${p.name} (${p.oneLine}${notes.length ? `; ${notes.join(', ')}` : ''})`;
        }).join('; ')}`
      : 'Present: nobody',
    '',
    `What happens: ${view.brief.intent}`,
  ];

  if (view.outcome) {
    // The tier is a FACT the passage must honour, not a suggestion.
    const framing = {
      hit: 'This succeeded cleanly.',
      partial: 'This succeeded, but at a cost. The cost must land in the prose.',
      miss: 'This failed. It must still move the scene forward, not stall it.',
    }[view.outcome.tier];
    lines.push('', `Outcome (${view.outcome.tier}): ${framing}`, view.outcome.narrate);
  }

  if (view.brief.mustInclude.length) {
    lines.push('', `Must include: ${view.brief.mustInclude.join('; ')}`);
  }
  if (view.brief.mustNotMention.length) {
    lines.push(`Must not mention: ${view.brief.mustNotMention.join('; ')}`);
  }
  if (view.shifts.length) {
    // Something changed in them. Let it show, without announcing it.
    lines.push('', `Show, without stating it outright, that the speaker ${view.shifts.join(' and ')}.`);
  }
  lines.push('', `Tone: ${view.brief.tone}`);

  if (view.recentTurns.length) {
    lines.push('', 'Just before this:', ...view.recentTurns.slice(-3));
  }
  return lines.join('\n');
}

function verify(view: WriterView, prose: string) {
  // Register is a property of dialogue. A narration-only turn has nobody to
  // check, and demanding pronouns from it is what made NPCs narrate.
  if (view.language !== 'th' || !view.speaking) return [];
  return view.peoplePresent.filter((p) => p.id === view.speaking).map((p) => {
    const want = {
      selfPronoun: p.register.selfPronoun,
      addressesPlayerAs: p.register.addressesPlayerAs,
      particle: p.register.particle,
    };
    return { person: p.name, check: checkRegister(prose, want, competingForms(want)) };
  });
}

export async function runWriter(provider: Provider, view: WriterView): Promise<WriterResult> {
  const system = systemPrompt(view);
  const user = userPrompt(view);

  const first = await provider.text({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.85,
    maxTokens: 700,
  });

  const checks = verify(view, first);
  const drifted = checks.filter((c) => !c.check.ok);
  if (drifted.length === 0) return { prose: first.trim(), checks, regenerated: false };

  // One correction attempt, naming exactly what went wrong.
  const complaint = drifted
    .map((d) => {
      const person = view.peoplePresent.find((p) => p.name === d.person);
      const r = person?.register;
      const missing = [
        d.check.usedSelfPronoun ? '' : `must use "${r?.selfPronoun}" for themselves`,
        d.check.usedAddress ? '' : `must address the player as "${r?.addressesPlayerAs}"`,
        d.check.usedParticle ? '' : `must end sentences with "${r?.particle}"`,
      ].filter(Boolean);
      return `${d.person}: ${missing.join(', ')}`;
    })
    .join('\n');

  const second = await provider.text({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
      { role: 'assistant', content: first },
      { role: 'user', content: `The register was wrong. Rewrite the passage.\n${complaint}` },
    ],
    temperature: 0.7,
    maxTokens: 700,
  });

  // Accept the second attempt either way — looping on a stubborn model would
  // stall the game, and the caller can see it drifted from `checks`.
  return { prose: second.trim(), checks: verify(view, second), regenerated: true };
}
