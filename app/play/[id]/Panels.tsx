'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameView } from '../../../src/server/game.ts';
import type { SheetAction } from '../../../src/play/sheetaction.ts';
import type { Slot } from '../../../src/items/types.ts';

/**
 * The pop-up panels.
 *
 * Everything a panel does goes to the server as an EVENT, never as a local
 * mutation — state is a fold of the log, so a change that only happened in the
 * browser is a change that vanishes on reload.
 */

type Act = (action: SheetAction) => void;

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="modal-close" onClick={onClose}>close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Character: what you carry, and where unspent points go                      */
/* -------------------------------------------------------------------------- */

export function CharacterPanel({ view, act, busy, onClose }: {
  view: GameView; act: Act; busy: boolean; onClose: () => void;
}) {
  const c = view.character;

  return (
    <Modal title={c.name} onClose={onClose}>
      <div className="tabs">
        <span className="tag">level {c.level}</span>
        <span className="tag">{c.xp} / {c.xpToNext} xp</span>
        <span className="tag">{c.coin} coin</span>
        {c.abilityPoints > 0 && (
          <span className="points">{c.abilityPoints} ability point{c.abilityPoints > 1 ? 's' : ''} unspent</span>
        )}
      </div>

      <p className="label">Abilities</p>
      {Object.entries(c.abilities).map(([key, value]) => (
        <div className="row" key={key}>
          <div><strong>{key}</strong> <span className="muted">{value}</span></div>
          <button
            className="mini"
            disabled={busy || c.abilityPoints <= 0 || value >= 20}
            onClick={() => act({ type: 'spendAbility', ability: key as 'str' })}
          >
            {value >= 20 ? 'maxed' : '+1'}
          </button>
        </div>
      ))}

      <p className="label" style={{ marginTop: '1.2rem' }}>Carrying</p>
      <div className="row purse">
        <div><strong>coin</strong> <span className="muted">what you have on you</span></div>
        <div className="coin">{c.coin}</div>
      </div>
      {view.inventory.stacks.length === 0 && <p className="muted">Nothing else but what you stand in.</p>}
      {view.inventory.stacks.map((item) => (
        <div className="row" key={item.id}>
          <div>
            <strong>{item.name}</strong>
            {item.count > 1 && <span className="muted"> ×{item.count}</span>}{' '}
            <span className="tag">{item.kind}</span>
            {item.equipped && <span className="tag" style={{ color: 'var(--amber)' }}>worn</span>}
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>{item.description}</p>
          </div>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            {item.usable && (
              <button className="mini" disabled={busy} onClick={() => act({ type: 'use', item: item.id })}>use</button>
            )}
            {item.wearable && !item.equipped && (
              <button className="mini" disabled={busy} onClick={() => act({ type: 'equip', item: item.id })}>equip</button>
            )}
            {item.equipped && item.slot && (
              <button
                className="mini"
                disabled={busy}
                onClick={() => act({ type: 'unequip', slot: item.slot as Slot })}
              >
                remove
              </button>
            )}
          </div>
        </div>
      ))}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Skills: the tree, the traits, and what has been found                       */
/* -------------------------------------------------------------------------- */

/**
 * The passive tree.
 *
 * Taken nodes are lit, reachable ones outlined, and anything still hidden is
 * not drawn at all — a node you cannot yet earn should not be a locked door you
 * can count and plan around.
 */
/**
 * A colour per discipline.
 *
 * Eight branches that all looked the same was the visual version of the problem
 * the tree had mechanically — nothing about a route told you what it was.
 */
const DISCIPLINE: Record<string, { hue: string; label: string }> = {
  sword: { hue: '#c96442', label: 'sword' },
  bow: { hue: '#7fa76a', label: 'bow' },
  guard: { hue: '#6f8fae', label: 'shield' },
  wisdom: { hue: '#d9a441', label: 'the long look' },
  magic: { hue: '#8a7fc4', label: 'figures' },
  blackMagic: { hue: '#a4547f', label: 'the cost' },
  guile: { hue: '#c8a06a', label: 'the quiet word' },
  survival: { hue: '#8a9a6b', label: 'the long walk' },
  flame: { hue: '#d97b41', label: 'kindling' },
  venom: { hue: '#6fae8f', label: 'the slow cup' },
  shadow: { hue: '#6a6f8c', label: 'the blind side' },
  song: { hue: '#c47fa8', label: 'the carrying voice' },
};

const hueOf = (archetype: string): string => DISCIPLINE[archetype]?.hue ?? '#9c8f7d';

function SkillTree({ view, act, busy }: { view: GameView; act: Act; busy: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const byId = new Map(view.tree.nodes.map((n) => [n.id, n]));
  const shown = hover ? byId.get(hover) : null;
  const spent = view.tree.nodes.filter((n) => n.taken && n.id !== 'start').length;

  return (
    <div>
      <div className="legend">
        {/* Only what this tree holds. Listing the rest would advertise branches
            this character can never take. */}
        {view.tree.disciplines.map((id) => (
          <span className="legend-item" key={id} style={{ opacity: view.tree.home === id ? 1 : 0.6 }}>
            <i style={{ background: hueOf(id) }} />
            {DISCIPLINE[id]?.label ?? id}{view.tree.home === id ? ' · yours' : ''}
          </span>
        ))}
      </div>

      <p className="muted" style={{ fontSize: '0.8rem', margin: '0.4rem 0' }}>
        A point can only go somewhere touching what you already hold. {spent} spent.
        {view.character.skillPoints > 0 && (
          <span className="points"> {view.character.skillPoints} to spend.</span>
        )}
      </p>

      <svg viewBox="-4 -4 108 108" style={{ width: '100%', height: 'auto', background: '#100e0c', borderRadius: 8 }}>
        {view.tree.nodes.map((node) =>
          node.connections
            // Each edge once: both ends list it, so only draw the lower id.
            .filter((to) => to > node.id)
            .map((to) => {
              const other = byId.get(to);
              if (!other) return null;
              const lit = node.taken && other.taken;
              const crossing =
                node.archetype !== other.archetype && node.id !== 'start' && other.id !== 'start';
              return (
                <line
                  key={`${node.id}-${to}`}
                  x1={node.x} y1={node.y} x2={other.x} y2={other.y}
                  stroke={lit ? hueOf(node.archetype) : '#241f1a'}
                  strokeWidth={lit ? 0.8 : 0.4}
                  // A link between disciplines is the hybrid route; dashing it
                  // makes the shape of the web readable at a glance.
                  strokeDasharray={crossing ? '1.4 1.2' : undefined}
                />
              );
            }),
        )}

        {view.tree.nodes.map((node) => {
          const r = node.kind === 'keystone' ? 3.2 : node.kind === 'notable' ? 2.4 : 1.5;
          // Reachable draws the route; affordable decides whether it can be
          // clicked. Showing one without the other is what makes a tree legible.
          const open = node.reachable && !busy && view.character.skillPoints > 0;
          const hue = hueOf(node.archetype);
          return (
            <g key={node.id}>
              {node.taken && node.kind !== 'minor' && (
                <circle
                  cx={node.x} cy={node.y} r={r + 1.4}
                  fill="none" stroke={hue} strokeWidth={0.4} opacity={0.5}
                />
              )}
              <circle
                cx={node.x} cy={node.y} r={r}
                fill={node.taken ? hue : node.reachable ? '#3a3025' : '#1c1815'}
                stroke={node.taken || node.reachable ? hue : '#2b2620'}
                strokeWidth={node.reachable && !node.taken ? 0.6 : 0.4}
                style={open ? { cursor: 'pointer' } : undefined}
                onMouseEnter={() => setHover(node.id)}
                onMouseLeave={() => setHover(null)}
                onClick={open ? () => act({ type: 'allocate', node: node.id }) : undefined}
              >
                <title>{node.name} — {node.description}</title>
              </circle>
              {/* Keystones carry a mark, because they are the decisions. */}
              {node.kind === 'keystone' && (
                <circle cx={node.x} cy={node.y} r={0.9} fill={node.taken ? '#12100e' : hue} />
              )}
            </g>
          );
        })}
      </svg>

      <div className="node-read">
        {shown ? (
          <>
            <strong style={{ color: hueOf(shown.archetype) }}>{shown.name}</strong>{' '}
            <span className="tag">{shown.kind}</span>
            <span className="tag">{DISCIPLINE[shown.archetype]?.label ?? shown.archetype}</span>
            <p className="muted">{shown.description}</p>
            {shown.teaches && <p className="teaches">teaches {shown.teaches}</p>}
          </>
        ) : (
          <p className="muted">
            Hover a node to read it. Larger nodes are notables, which teach a skill;
            ringed ones are keystones, which trade something away.
          </p>
        )}
      </div>
    </div>
  );
}

/** Progress is shown per condition, because they do not average into anything. */
function TraitList({ view }: { view: GameView }) {
  return (
    <div>
      {view.traits.map((trait) => (
        <div className="row" key={trait.id}>
          <div>
            <strong style={{ color: trait.held ? 'var(--amber)' : undefined }}>{trait.name}</strong>{' '}
            {trait.held && <span className="tag" style={{ color: 'var(--good)' }}>earned</span>}
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>{trait.description}</p>
            {!trait.held && (
              <div style={{ marginTop: '0.3rem' }}>
                {trait.progress.map((p) => (
                  <span className={p.met ? 'cond met' : 'cond'} key={p.label} style={{ marginRight: '0.8rem' }}>
                    {p.label} ({p.have}/{p.need})
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SignetList({ view }: { view: GameView }) {
  if (view.signets.length === 0) {
    return (
      <p className="muted">
        Nothing yet. Signets are not listed — they are found, and some give no warning at all.
      </p>
    );
  }

  return (
    <div>
      {view.signets.map((s) => (
        <div className="row" key={s.id}>
          <div>
            <strong style={{ color: s.held ? 'var(--amber)' : undefined }}>{s.name}</strong>{' '}
            {s.held && <span className="tag" style={{ color: 'var(--good)' }}>held</span>}
            {s.available && !s.held && <span className="tag" style={{ color: 'var(--amber)' }}>within reach</span>}
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>{s.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkillsPanel({ view, act, busy, onClose }: {
  view: GameView; act: Act; busy: boolean; onClose: () => void;
}) {
  const [tab, setTab] = useState<'tree' | 'traits' | 'signets'>('tree');

  return (
    <Modal title="Skills" onClose={onClose}>
      <div className="tabs">
        <button className={tab === 'tree' ? 'tab on' : 'tab'} onClick={() => setTab('tree')}>
          tree{view.character.skillPoints > 0 ? ` (${view.character.skillPoints})` : ''}
        </button>
        <button className={tab === 'traits' ? 'tab on' : 'tab'} onClick={() => setTab('traits')}>traits</button>
        <button className={tab === 'signets' ? 'tab on' : 'tab'} onClick={() => setTab('signets')}>signets</button>
      </div>

      {tab === 'tree' && <SkillTree view={view} act={act} busy={busy} />}
      {tab === 'traits' && <TraitList view={view} />}
      {tab === 'signets' && <SignetList view={view} />}
    </Modal>
  );
}
