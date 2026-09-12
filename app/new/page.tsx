'use client';

import { useEffect, useState } from 'react';
import { ABILITIES } from '../../src/combat/types.ts';
import type { Abilities } from '../../src/combat/types.ts';
import {
  defaultAbilities, POINT_BUY_BUDGET, POINT_BUY_MAX, POINT_BUY_MIN, pointBuyCost, validateAbilities,
} from '../../src/session/sheet.ts';
import type { CharacterClass } from '../../src/character/classes.ts';
import { dominantOf, groupOf, leavesOf, speciesFor, TYPES } from '../../src/character/species.ts';
import { huntedBy } from '../../src/character/prey.ts';
import type { Species } from '../../src/character/species.ts';
import { questionFor, STAGES } from '../../src/session/interview.ts';
import type { Language } from '../../src/session/interview.ts';

/**
 * Character creation.
 *
 * Session Zero was always meant to be a conversation rather than a form — the
 * GM asks what kind of world, who you are, and what you want — and until now it
 * ran with canned answers because there was no page to ask them on.
 *
 * The two promised routes both live here: answer in prose and let the model
 * build the sheet, or pin down a name and a point-buy spread by hand. Anything
 * set by hand outranks what the model proposes; that is the contract, and
 * `runGenesis` already honours it.
 */

/** The three questions worth asking. `review` happens on the sheet itself. */
const ASKED = STAGES.filter((s) => s !== 'review');

type Answers = Partial<Record<string, string>>;

/**
 * What a body is worth, in words — "str +2 · vit −1".
 *
 * The whole reason the picker exists: a template is a TRADE, and a player choosing
 * a kind has to be able to see which way it trades before they live with it.
 */
function bodyOf(kind: Species | undefined): string {
  const template = kind?.template ?? {};
  return Object.entries(template)
    .filter(([, by]) => by)
    .sort((a, b) => Math.abs(b[1] ?? 0) - Math.abs(a[1] ?? 0))
    .map(([ability, by]) => `${ability} ${(by ?? 0) > 0 ? '+' : '−'}${Math.abs(by ?? 0)}`)
    .join(' · ');
}

export default function NewCharacter() {
  const [language, setLanguage] = useState<Language>('en');
  // The world's ruleset. Not the two-phase rules view step 10 wants — three
  // presets, so the dials a world is born under are a choice rather than a
  // constant nobody could reach.
  const [rules, setRules] = useState<'standard' | 'plain' | 'harsh'>('standard');
  // Whether the tower is authored once and frozen, or rebuilt as you return to
  // it. A frozen world never spends a model call on a floor twice.
  const [structure, setStructure] = useState<'dynamic' | 'static'>('dynamic');
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);

  /*
   * The run's seed, drawn HERE rather than at genesis.
   *
   * It has to be: the class roster below is generated from it, so the world
   * the player ends up in must be the one whose classes they were shown. It
   * travels with the submission and `runGenesis` uses it verbatim.
   */
  const [seed] = useState(() => Math.floor(Math.random() * 2147483647));

  // What KIND of being the climber is. The kinds come from the same seed, so
  // the ones offered are exactly the ones the world will hold — and are dealt
  // after mount, because the server renders with a different random seed and
  // a list drawn from it would not hydrate.
  const [kinds, setKinds] = useState<Species[]>([]);
  useEffect(() => setKinds(speciesFor(seed)), [seed]);
  // Everybody alive is a SUBSPECIES; a type and a group are categories to choose
  // WITHIN, not bodies. The ordinary chip is this world's own dominant kind.
  const leaves = leavesOf(kinds);
  const dominant = kinds.length ? dominantOf(seed, kinds) : '';
  const byType = TYPES
    .map((t) => ({ type: t.id, leaves: leaves.filter((k) => k.type === t.id) }))
    .filter((g) => g.leaves.length > 0);

  /*
   * What hunts your sort, shown for the same reason the body is: a hunter rolls
   * with ADVANTAGE on its prey, which is worth more in a fight than any template
   * (46% to 79% between otherwise identical fighters). A disadvantage the player
   * picked is the game; one nobody mentioned is a trap.
   */
  const huntersOf = (kind: Species): number => {
    const group = groupOf(kinds, kind.id);
    return group ? huntedBy(seed, kinds, group).length : 0;
  };
  const [kindMode, setKindMode] = useState<'ordinary' | 'pick' | 'describe' | 'world'>('ordinary');
  const [kindPick, setKindPick] = useState('');
  const [kindWords, setKindWords] = useState('');
  const species = kindMode === 'pick' && kindPick ? { pick: kindPick }
    : kindMode === 'describe' && kindWords.trim() ? { describe: kindWords }
      : kindMode === 'world' ? { decide: 'world' as const }
        : undefined;

  const [roster, setRoster] = useState<CharacterClass[] | null>(null);
  const [rosterFor, setRosterFor] = useState<string | null>(null);
  const [rosterBusy, setRosterBusy] = useState(false);

  const [classId, setClassId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [background, setBackground] = useState('');
  const [abilities, setAbilities] = useState<Abilities>(defaultAbilities());
  const [handBuilt, setHandBuilt] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spread = validateAbilities(abilities);
  const left = POINT_BUY_BUDGET - spread.spent;

  /**
   * Whether a score can move that way at all.
   *
   * Used to DISABLE the button rather than only to refuse the click. The
   * default spread costs exactly the budget, so without this the plus buttons
   * all look live and none of them do anything — the player has to guess that
   * something must come down before anything goes up.
   */
  function canAdjust(ability: keyof Abilities, by: number): boolean {
    const score = abilities[ability] + by;
    if (score < POINT_BUY_MIN || score > POINT_BUY_MAX) return false;
    return validateAbilities({ ...abilities, [ability]: score }).spent <= POINT_BUY_BUDGET;
  }

  function adjust(ability: keyof Abilities, by: number) {
    if (!canAdjust(ability, by)) return;
    setAbilities({ ...abilities, [ability]: abilities[ability] + by });
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const draft: Record<string, unknown> = {};
      if (name.trim()) draft.name = name.trim();
      if (background.trim()) draft.backgroundName = background.trim();
      if (handBuilt) draft.baseAbilities = abilities;
      if (classId) {
        draft.classId = classId;
        // The resolved class travels too. A generated one is in no global
        // list, so the id alone would resolve to nothing on the server.
        const chosen = roster?.find((c) => c.id === classId);
        if (chosen) draft.classSpec = chosen;
      }

      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, answers, draft, seed, rules, structure, species }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'generation failed');
      window.location.href = `/play/${data.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const world = (answers.world ?? '').trim();

  /**
   * Fetch the roster this world offers.
   *
   * Deliberately NOT an effect on every keystroke — it is a model call, and
   * firing one per character typed would be both slow and rude. The player
   * asks for it, and asks again if they change their mind about the world.
   */
  async function loadRoster() {
    setRosterBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, world, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'could not read this world');
      setRoster(data.classes ?? []);
      setRosterFor(world);
      setClassId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRosterBusy(false);
    }
  }

  const stage = ASKED[step];
  const answered = (answers[stage] ?? '').trim().length > 0;

  if (busy) {
    return (
      <main className="shell narrow">
        <h1 className="title">Session Zero</h1>
        <div className="panel">
          <p className="muted">
            <span className="spinner">▚</span> Building a world and a character from what you said. This
            takes a minute — a town, its people and their voices are being written from scratch.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="shell narrow">
      <h1 className="title">Session Zero</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Answer however you like. Anything you leave vague gets filled in; anything you pin down stays.
      </p>

      <section className="panel">
        <p className="label">Language</p>
        <div className="chips">
          <button
            className={language === 'en' ? 'chip on' : 'chip'}
            onClick={() => setLanguage('en')}
          >
            English
          </button>
          <button
            className={language === 'th' ? 'chip on' : 'chip'}
            onClick={() => setLanguage('th')}
          >
            ไทย
          </button>
        </div>
      </section>

      <section className="panel">
        <p className="label">Rules</p>
        <div className="chips">
          {([
            ['standard', 'standard', 'the tuning everything was balanced against'],
            ['plain', 'plain', 'nothing presses: no soak, no drift, no load, one danger'],
            ['harsh', 'harsh', 'things hurt more, gear wears, the climb bites'],
          ] as const).map(([id, label, why]) => (
            <button
              key={id}
              className={rules === id ? 'chip on' : 'chip'}
              onClick={() => setRules(id)}
              title={why}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="chips" style={{ marginTop: '0.6rem' }}>
          {([
            ['dynamic', 'a living tower'],
            ['static', 'a fixed tower'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              className={structure === id ? 'chip on' : 'chip'}
              onClick={() => setStructure(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: '0.78rem', marginBottom: 0 }}>
          {structure === 'static'
            ? 'A fixed tower is written once. Come back to a floor and it is the same floor, down to the doorways.'
            : 'A living tower is rewritten from what it was when you return to it.'}
        </p>
        <p className="muted" style={{ fontSize: '0.78rem', marginBottom: 0 }}>
          {rules === 'plain'
            ? 'Nothing presses on you: no soak, no drift, no carry limit, every floor as dangerous as the first.'
            : rules === 'harsh'
              ? 'Wounds soak through, gear wears out, people change faster, and depth bites.'
              : 'The tuning everything else was balanced against.'}
        </p>
      </section>

      <section className="panel">
        <p className="label">What you are</p>
        <div className="chips">
          <button className={kindMode === 'ordinary' ? 'chip on' : 'chip'} onClick={() => setKindMode('ordinary')}>
            ordinary here{bodyOf(kinds.find((k) => k.id === dominant)) ? ` · ${bodyOf(kinds.find((k) => k.id === dominant))}` : ''}
          </button>
          <button className={kindMode === 'describe' ? 'chip on' : 'chip'} onClick={() => setKindMode('describe')}>
            describe it
          </button>
          <button className={kindMode === 'world' ? 'chip on' : 'chip'} onClick={() => setKindMode('world')}>
            let the world decide
          </button>
        </div>
        {/*
          * Grouped type → species → subspecies, and every body SHOWN: a
          * disadvantage the player chose is part of the game, one handed out
          * silently is a trap. The first humanoid lean cost a climber 15–19
          * points of win rate and nothing on this page said so.
          */}
        {byType.map((group) => (
          <details key={group.type} style={{ marginTop: '0.5rem' }}>
            <summary className="label" style={{ cursor: 'pointer' }}>
              {group.type} · {group.leaves.length}
            </summary>
            <div className="chips" style={{ marginTop: '0.4rem' }}>
              {group.leaves.map((k) => (
                <button
                  key={k.id}
                  className={kindMode === 'pick' && kindPick === k.id ? 'chip on' : 'chip'}
                  onClick={() => { setKindMode('pick'); setKindPick(k.id); }}
                  title={k.id}
                >
                  {k.name === k.id ? k.id.split('.').slice(1).join(' ') : k.name}
                  {bodyOf(k) ? <span className="muted"> · {bodyOf(k)}</span> : null}
                  {huntersOf(k) > 0 ? <span className="muted"> · hunted</span> : null}
                </button>
              ))}
            </div>
          </details>
        ))}
        {kindMode === 'describe' && (
          <div className="field" style={{ marginTop: '0.6rem' }}>
            <input
              value={kindWords}
              placeholder="in your own words — it becomes whichever of this world's kinds is closest"
              onChange={(e) => setKindWords(e.target.value)}
            />
          </div>
        )}
        <p className="muted" style={{ fontSize: '0.78rem', marginBottom: 0 }}>
          {kindMode === 'world'
            ? 'Drawn the way everyone else here was drawn — most people are the kind this world is.'
            : 'A kind changes what your body is worth and which needs wear on you. Some are worse in a fight; that is yours to pick.'}
        </p>
      </section>

      {/* --------------------------------------------------- the interview */}
      <section className="panel">
        <div className="steps">
          {ASKED.map((s, i) => (
            <span key={s} className={i === step ? 'step on' : answers[s] ? 'step done' : 'step'}>
              {s}
            </span>
          ))}
        </div>

        <p className="question">{questionFor(stage, language)}</p>
        <textarea
          className="answer"
          rows={4}
          value={answers[stage] ?? ''}
          placeholder={language === 'th' ? 'พิมพ์คำตอบ…' : 'Say as much or as little as you like…'}
          onChange={(e) => setAnswers({ ...answers, [stage]: e.target.value })}
        />

        <div className="chips" style={{ marginTop: '0.6rem' }}>
          <button className="chip" disabled={step === 0} onClick={() => setStep(step - 1)}>back</button>
          <button
            className="chip"
            disabled={step >= ASKED.length - 1}
            onClick={() => setStep(step + 1)}
          >
            next
          </button>
          {!answered && (
            <span className="muted" style={{ fontSize: '0.78rem', alignSelf: 'center' }}>
              leave it blank and the model decides
            </span>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------- the class */}
      <section className="panel">
        <p className="label">What are you</p>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
          This decides your hit die, what you set out holding, and — the part that matters — which
          disciplines your skill tree can ever hold. What a class is locked out of stays locked out;
          the only way across is a path you choose at level 3, or a book you find in the tower.
        </p>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          These belong to the world you just described, and to no other. Say what kind of world it
          is first, then read what people become in it.
        </p>

        {roster === null ? (
          <div className="chips">
            <button className="chip" onClick={loadRoster} disabled={rosterBusy || world.length === 0}>
              {rosterBusy ? 'reading the world…' : 'see what people become here'}
            </button>
            {world.length === 0 && (
              <span className="muted" style={{ fontSize: '0.78rem', alignSelf: 'center' }}>
                answer the first question and this fills in
              </span>
            )}
          </div>
        ) : (
          <div className="chips" style={{ marginBottom: '0.6rem' }}>
            <button className="chip" onClick={loadRoster} disabled={rosterBusy}>
              {rosterBusy ? 'reading the world…' : 'draw a different set'}
            </button>
            {rosterFor !== world && (
              <span className="muted" style={{ fontSize: '0.78rem', alignSelf: 'center' }}>
                the world changed — these are from the old one
              </span>
            )}
          </div>
        )}

        <div className="class-grid">
          {(roster ?? []).map((held) => {
            const chosen = classId === held.id;
            return (
              <button
                key={held.id}
                className={chosen ? 'class-card on' : 'class-card'}
                onClick={() => setClassId(chosen ? null : held.id)}
              >
                <span className="class-head">
                  <strong>{held.name[language]}</strong>
                  <span className="class-die">d{held.hitDie}</span>
                </span>
                <span className="class-note">{held.description[language]}</span>
                <span className="class-line">
                  <b>{held.primary}</b> · {held.secondary}
                </span>
                <span className="class-line class-core">leans on: {(held.favours ?? []).join(', ')}</span>
                <span className="class-line class-barred">away from: {(held.against ?? []).join(', ')}</span>
              </button>
            );
          })}
        </div>

        <div className="chips" style={{ marginTop: '0.7rem' }}>
          <button className={classId === null ? 'chip on' : 'chip'} onClick={() => setClassId(null)}>
            let the story decide
          </button>
          {classId === null && (
            <span className="muted" style={{ fontSize: '0.78rem', alignSelf: 'center' }}>
              a class is inferred from what you wrote above
            </span>
          )}
        </div>
      </section>

      {/* ------------------------------------------------ the hand-built half */}
      <section className="panel">
        <p className="label">By hand, if you want to</p>

        <div className="field">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            value={name}
            placeholder={language === 'th' ? 'เว้นว่างให้ระบบตั้งให้' : 'leave blank to be named'}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="bg">Background</label>
          <input
            id="bg"
            value={background}
            placeholder="soldier, scholar, dock thief…"
            onChange={(e) => setBackground(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="pb">Abilities</label>
          <button
            id="pb"
            className={handBuilt ? 'chip on' : 'chip'}
            onClick={() => setHandBuilt(!handBuilt)}
          >
            {handBuilt ? 'setting them myself' : 'let the model decide'}
          </button>
        </div>

        {handBuilt && (
          <div className="buy">
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              {POINT_BUY_BUDGET} points. Scores run {POINT_BUY_MIN}–{POINT_BUY_MAX}, and the last few cost
              more than the first.{' '}
              <span className={left > 0 ? 'points' : 'muted'}>{left} left</span>
              {left <= 0 && ' — lower one score to raise another.'}
            </p>

            {ABILITIES.map((ability) => (
              <div className="row" key={ability}>
                <div>
                  <strong>{ability}</strong>{' '}
                  <span className="muted">{abilities[ability]}</span>{' '}
                  <span className="cond">costs {pointBuyCost(abilities[ability]) ?? '—'}</span>
                </div>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <button className="mini" disabled={!canAdjust(ability, -1)} onClick={() => adjust(ability, -1)}>
                    −
                  </button>
                  <button
                    className="mini"
                    disabled={!canAdjust(ability, 1)}
                    title={left <= 0 ? 'nothing left to spend — lower another score first' : undefined}
                    onClick={() => adjust(ability, 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}

            {/* Leaving points unspent hands out a worse character than the rules allow. */}
            {left > 0 && (
              <p className="cond" style={{ marginTop: '0.5rem' }}>
                {left} unspent — you can begin anyway, but nothing gives them back later.
              </p>
            )}
          </div>
        )}
      </section>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="chips" style={{ marginTop: '1rem' }}>
        <button onClick={create}>Begin</button>
        <a className="chip" href="/">back to your runs</a>
      </div>
    </main>
  );
}
