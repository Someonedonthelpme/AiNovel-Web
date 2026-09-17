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
    // A conversational turn is short whatever the brief asked for: a person
    // answering you does not deliver a paragraph.
    view.speaking ? 'One or two sentences.' : LENGTH[view.brief.length],
    '',
    [
      `The player character is ${view.pc.name}.`,
      view.pc.bearing.length ? `They come across as ${view.pc.bearing.join(', ')}.` : '',
      view.pc.condition.length ? `Right now they are ${view.pc.condition.join(', ')}.` : '',
    ].filter(Boolean).join(' '),
  ];

  if (view.speaking) {
    /*
     * A conversation is DIALOGUE, not a paragraph about a conversation.
     *
     * Left to itself the model writes a narrator's account — "Warden Bex
     * watched him impassively, her hand resting on the pommel of her sword" —
     * which reads as a novel describing a scene rather than as somebody
     * talking to you. What the person actually SAYS is the turn; a gesture is
     * allowed alongside it, and nothing else is.
     */
    lines.push(
      '',
      'This is a conversation. Write what the person SAYS, in their own words,',
      'in quotation marks. Lead with the speech.',
      'You may add at most ONE short clause of posture or gesture — a glance, a',
      'hand moving, a step back. Nothing longer.',
      'Do NOT describe the room, the weather, the light, or what the player',
      'character thinks or feels. Do not summarise the exchange from outside it.',
      'If they say nothing, write the gesture alone — but say so with an action,',
      'not with a paragraph about the silence.',
    );
  } else {
    lines.push(
      '',
      'Narration describes the world in the third person. It is NOT spoken by any',
      'character. Never put scene description into the mouth of an NPC.',
      'Only write dialogue for someone the player is actually speaking with.',
    );
  }

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
    view.time ? `Time: ${view.time}` : '',
    view.peoplePresent.length
      ? `Present: ${view.peoplePresent.map((p) => {
          const notes = [...p.disposition, ...p.condition];
          return `${p.name} (${p.oneLine}${notes.length ? `; ${notes.join(', ')}` : ''})`;
        }).join('; ')}`
      : 'Present: nobody',
    /*
     * WHAT THEY THINK, WHICH IS NOT THE SAME AS WHAT IS TRUE.
     *
     * Somebody who saw it should behave like somebody who saw it; somebody who
     * half-heard a story should hedge. And a person holding something FALSE has
     * to be written holding it, or being wrong could never be discovered.
     */
    ...(() => {
      const heard = view.peoplePresent.flatMap((p) => p.believes.map((b) => `- ${p.name} believes: ${b}`));
      return heard.length
        ? ['', 'What they BELIEVE about the player. Write them acting on it, however sure they are.',
           'Never state it as fact in the narration — it is what they think, and they may be wrong.', ...heard]
        : [];
    })(),
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

/**
 * Whether a passage actually contains someone speaking.
 *
 * Quotation marks are the contract, because they are the one thing checkable
 * mechanically. The instruction asks for them explicitly, so a passage without
 * any is one that ignored it — which in practice means the model narrated the
 * conversation instead of writing it.
 *
 * Straight and curly both count: a schema-constrained decoder produces either,
 * and Thai prose uses the same marks.
 */
export const hasDialogue = (prose: string): boolean => /["“”«»]/.test(prose);

/** A gesture before the speech is fine. A paragraph of scenery is not. */
const LEAD_IN_LIMIT = 120;

/**
 * How long a clause can be and still be a gesture rather than a description.
 *
 * "She set down the crate." is a gesture. "You approach Elara Vane, who stands
 * overseeing a shipment of dried fish being unloaded." is the narrator setting
 * a scene, and it is only a little longer — so the threshold has to be tight.
 */
const GESTURE_LIMIT = 60;

/**
 * Cut a scene-setting preamble off the front of a conversational turn.
 *
 * Observed against the local model: asked for dialogue, it still opens with
 * "The Anchor's Rest is alive with activity, merchants hawking wares and
 * children chasing pigeons between the platforms. You approach Elara Vane,
 * who..." and only then lets anyone speak. The instruction says not to; the
 * model does it anyway.
 *
 * Deterministic repair rather than another round-trip, for the same reason
 * `repairVoiceForm` exists: the fix is mechanical, so paying a model call for
 * it would be waste. A SHORT lead-in survives — "She shrugged." before a line
 * is exactly the posture beat that was asked for. What goes is the paragraph.
 */
export function trimSceneSetting(prose: string): string {
  const at = prose.search(/["“”«»]/);
  if (at <= 0) return prose;

  const lead = prose.slice(0, at);
  const sentences = (lead.match(/[.!?。]\s/g) ?? []).length;
  if (lead.length <= LEAD_IN_LIMIT && sentences <= 1) return prose;

  // Keep the last sentence before the speech when there is one worth keeping;
  // it is usually the gesture, and dropping it too reads as abrupt.
  const parts = lead.split(/(?<=[.!?])\s+/).filter(Boolean);
  const gesture = parts.length > 1 ? parts[parts.length - 1] : '';
  const kept = gesture.length > 0 && gesture.length <= GESTURE_LIMIT ? `${gesture.trim()} ` : '';
  return (kept + prose.slice(at)).trim();
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

/** Conversation turns lose their scene-setting; narration is left as written. */
const tidy = (view: WriterView, prose: string): string =>
  (view.speaking ? trimSceneSetting(prose) : prose).trim();

/** What to tell the model when the first attempt has to be thrown away. */
function rewriteRequest(complaint: string, narrated: boolean): string {
  const parts: string[] = [];
  if (narrated) {
    parts.push(
      'That narrated the conversation instead of writing it. Rewrite it as what',
      'the person says, in quotation marks, plus at most one short gesture.',
    );
  }
  if (complaint) parts.push('The register was wrong. Rewrite the passage.', complaint);
  return parts.join('\n');
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

  // A conversation that came back as narration is the same class of failure as
  // register drift — the model was told something structural and ignored it —
  // so it earns the same single correction.
  const narrated = Boolean(view.speaking) && !hasDialogue(first);
  if (drifted.length === 0 && !narrated) {
    return { prose: tidy(view, first), checks, regenerated: false };
  }

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
      { role: 'user', content: rewriteRequest(complaint, narrated) },
    ],
    temperature: 0.7,
    maxTokens: 700,
  });

  // Accept the second attempt either way — looping on a stubborn model would
  // stall the game, and the caller can see it drifted from `checks`.
  return { prose: tidy(view, second), checks: verify(view, second), regenerated: true };
}
