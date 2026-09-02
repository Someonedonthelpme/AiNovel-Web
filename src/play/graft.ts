import type { Rng } from '../engine/roll.ts';
import { ABILITIES } from '../combat/types.ts';
import type { Ability } from '../combat/types.ts';
import { PATH_WORDS } from './pathwords.ts';
import { STAT_GRAMMAR } from '../skills/statgrammar.ts';
import { composeSkill, generatorFor, nameFor } from '../skills/compose.ts';
import type { NodeGrant, SkillNode } from './skilltree.ts';

/**
 * Grafts — branches that grow onto the tree because of something you did.
 *
 * Four systems used to hand out a flat bonus and stop there. A trait gave +1 to
 * a score, a Signet a small grant, a subclass one skill and a two-node stub, a
 * skill book one active and then it was spent. None of them changed the SHAPE
 * of what was in front of you, so the tree stopped being interesting the moment
 * it was drawn.
 *
 * They now share one mechanism: each can GRAFT a branch of two to five nodes
 * onto the tree. The causality is legible in a way the old anonymous islands
 * never were — a branch appears because you earned Blooded, or read a
 * particular book, not because a hidden tally crossed a line nobody told you
 * about.
 *
 * WHAT VARIES IS HOW A BRANCH IS ENTERED. That is the whole design:
 *
 *   sequence      needs one held node, like everywhere else on the tree.
 *   parallel      needs NOTHING held. It free-stands, because the thing that
 *                 earned it was the entry price. A skill book's set is this:
 *                 you did not walk there, you read your way in.
 *   combination   needs two or more held nodes before it opens at all. The only
 *                 branches you have to plan for rather than walk to.
 *
 * A graft may anchor on ANOTHER graft, so the tree grows outward in layers
 * rather than sprouting disconnected tufts.
 *
 * And it is meant to outgrow you. Points arrive one per level; branches arrive
 * with every trait, Signet, book and subclass stage. A tree you can finish is a
 * tree that stops asking you anything.
 */

export const ENTRY_RULES = ['sequence', 'parallel', 'combination'] as const;
export type EntryRule = (typeof ENTRY_RULES)[number];

export const GRAFT_MIN = 2;
export const GRAFT_MAX = 5;

export type GraftSpec = {
  /**
   * Which STAT it belongs to — its colour, and through `statgrammar`,
   * everything it can teach.
   *
   * A stat rather than a path id, deliberately: stats are a fixed enum of
   * nine and paths are generated per world, so a graft stored on a sheet can
   * never point at a path a regenerated pool no longer contains. The same
   * orphan-proofing that put `classSpec` on the sheet.
   */
  stat: Ability;
  entry: EntryRule;
  /** Two to five. Clamped, because an authored typo should not warp a tree. */
  size: number;
  /** `combination` only: how many held nodes it takes to open. Two by default. */
  needs?: number;
};

/** Where a branch came from, so the panel can say why it is there. */
export type GraftSource = {
  kind: 'trait' | 'signet' | 'subclass' | 'book';
  id: string;
  /** Shown to the player: "earned from Blooded". */
  name: string;
};

const clampSize = (n: number): number => Math.max(GRAFT_MIN, Math.min(GRAFT_MAX, Math.round(n)));

/**
 * What a branch's notable has to spend.
 *
 * Bigger branches were harder to earn and harder to walk, and a subclass is a
 * permanent choice rather than a tally crossed — so both buy more.
 */
const SOURCE_WORTH: Record<GraftSource['kind'], number> = {
  trait: 1,
  book: 1,
  signet: 1.3,
  subclass: 1.5,
};

const budgetFor = (source: GraftSource, size: number): number => (4 + size * 1.6) * SOURCE_WORTH[source.kind];

/**
 * Power scales with size, not with depth.
 *
 * A graft hangs off wherever it attached, so its ring number says nothing about
 * how far it was to get here. The earning was the distance.
 */
function grantFor(rng: Rng, stat: Ability, notable: boolean): NodeGrant {
  if (notable) return { ability: { [stat]: 1 }, maxHp: 3 };
  const roll = rng();
  if (roll < 0.5) return { ability: { [stat]: 1 } };
  if (roll < 0.8) return { maxHp: 3 };
  // A grafted branch has no second stat of its own — it is a spur off one
  // thing — so the alternative is staying power rather than another score.
  return { maxStamina: 3 };
}

const describe = (grant: NodeGrant, language: 'th' | 'en'): string => {
  const parts: string[] = [];
  for (const [ability, n] of Object.entries(grant.ability ?? {})) parts.push(`+${n} ${ability}`);
  if (grant.maxHp) parts.push(`+${grant.maxHp} hp`);
  if (grant.ac) parts.push(`+${grant.ac} armour`);
  if (grant.attack) parts.push(`+${grant.attack} to hit`);
  if (grant.damage) parts.push(`+${grant.damage} damage`);
  return parts.join(', ') || (language === 'th' ? 'ทางผ่าน' : 'a step along the way');
};

export type GraftInput = {
  id: string;
  spec: GraftSpec;
  source: GraftSource;
  /**
   * Candidate anchors, already held or not — anything on the tree, including
   * nodes from earlier grafts. `parallel` ignores these entirely.
   */
  anchors: SkillNode[];
  language: 'th' | 'en';
  /** Where to draw it when it has no anchor to grow away from. */
  drift?: { x: number; y: number };
};

/**
 * Grow a branch onto the tree.
 *
 * Every node is visible from the moment it exists. The earning WAS the gate,
 * and gating it a second time would mean unlocking a branch and watching
 * nothing appear.
 */
export function graftFor(rng: Rng, input: GraftInput): SkillNode[] {
  const { id, spec, source, anchors, language } = input;
  const stat = ABILITIES.includes(spec.stat) ? spec.stat : ABILITIES[0];
  const words = PATH_WORDS[stat];

  const size = clampSize(spec.size);

  /*
   * What the branch can actually be, given what there is to hang it from.
   *
   * A bridge needs two banks: with one anchor a combination is a sequence
   * wearing a `requiresAll` of length one, which is the same rule written
   * confusingly. With no anchor at all, only a free-standing branch is
   * possible — and refusing to generate would leave whatever earned it paying
   * out nothing.
   */
  const entry: EntryRule =
    spec.entry === 'parallel' ? 'parallel'
      : anchors.length === 0 ? 'parallel'
        : spec.entry === 'combination' && anchors.length < 2 ? 'sequence'
          : spec.entry;

  const needs = Math.max(2, Math.min(anchors.length, spec.needs ?? 2));

  const nodes: SkillNode[] = [];
  let taught = 0;

  /** Somewhere to start drawing from. */
  const origin = anchors.length > 0
    ? anchors[Math.floor(rng() * anchors.length)]
    : { x: input.drift?.x ?? 50, y: input.drift?.y ?? 50 };

  const make = (
    suffix: string,
    from: { x: number; y: number },
    step: number,
    spread: number,
    parents: string[],
    notable: boolean,
    extras: Partial<SkillNode> = {},
  ): SkillNode => {
    // Pushed outward from the centre, so a branch grows away from the tree
    // rather than back through it.
    const angle = Math.atan2(from.y - 50, from.x - 50) + spread;
    const reach = 5 + step * 4.4;
    const grant = grantFor(rng, stat, notable);

    const node: SkillNode = {
      id: `graft_${id}_${suffix}`,
      name: notable
        ? words.notables[Math.min(1, taught)]
        : words.minors[Math.floor(rng() * words.minors.length)],
      description: describe(grant, language),
      kind: notable ? 'notable' : 'minor',
      // A graft belongs to its STAT and to no path — it is a spur the world
      // grew, not part of the web the spread laid out.
      path: `graft_${id}`,
      stat,
      // Past the rim, so nothing in the main web mistakes these for its own.
      ring: 11,
      x: from.x + Math.cos(angle) * reach,
      y: from.y + Math.sin(angle) * reach,
      connections: parents,
      grant,
      grafted: source,
      ...extras,
    };

    if (notable) {
      /*
       * COMPOSED, not drawn from the discipline's authored pair.
       *
       * Two venom branches in one run used to teach the same two skills,
       * because every notable of a discipline reached for the same two specs.
       * Composing against a budget means each branch teaches its own thing —
       * which is most of what this system was for.
       *
       * The seed is the node's own id, so a branch teaches the same skill on
       * every reload rather than a differently lucky one.
       */
      const own = generatorFor(node.id);
      const composed = composeSkill(own, {
        id: `skill_${node.id}`,
        name: '',
        description: '',
        kind: 'combat',
        ability: stat,
        grammar: STAT_GRAMMAR[stat],
        budget: budgetFor(source, size),
      });
      node.teaches = { ...composed, name: nameFor(own, composed.effect, language) };
      taught += 1;
    }

    nodes.push(node);
    return node;
  };

  /* ---------------------------------------------------------------- entry */

  let head: SkillNode;

  if (entry === 'parallel') {
    /*
     * Free-standing. No edge to anything, and `freeStanding` says so: the book
     * or the trait that produced it already paid the entry, so contiguity has
     * nothing to say here. This is the one place on the tree you can spend a
     * point without having walked to it.
     */
    head = make('in', origin, 1, rng() * Math.PI * 2, [], false, { freeStanding: true });
  } else if (entry === 'combination') {
    /*
     * Opens only when SEVERAL held nodes line up. `requiresAll` is checked in
     * `canAllocate` instead of the usual "any neighbour" rule, which makes this
     * the only kind of branch you have to plan for rather than walk to.
     */
    const chosen = [...anchors].sort(() => rng() - 0.5).slice(0, needs);
    head = make('in', origin, 1, (rng() - 0.5) * 0.4, chosen.map((a) => a.id), false, {
      requiresAll: chosen.map((a) => a.id),
    });
  } else {
    const anchor = anchors[Math.floor(rng() * anchors.length)];
    head = make('in', anchor, 1, (rng() - 0.5) * 0.5, [anchor.id], false);
  }

  /* ----------------------------------------------------------- the body */

  const remaining = size - 1;
  if (remaining <= 0) return nodes;

  // A short branch is a road; a longer one forks, so even a graft has a shape
  // to it rather than being a queue.
  const forks = remaining >= 3 && rng() < 0.55;

  if (forks) {
    const arms = 2;
    const each = Math.floor(remaining / arms);
    const spare = remaining - each * arms;

    for (let arm = 0; arm < arms; arm++) {
      let previous = head;
      const length = each + (arm === 0 ? spare : 0);
      for (let step = 1; step <= length; step++) {
        previous = make(
          `a${arm}_${step}`,
          previous,
          step,
          arm === 0 ? -0.34 : 0.34,
          [previous.id],
          step === length,
        );
      }
    }
    return nodes;
  }

  let previous = head;
  for (let step = 1; step <= remaining; step++) {
    previous = make(`s${step}`, previous, step, (rng() - 0.5) * 0.3, [previous.id], step === remaining);
  }
  return nodes;
}
