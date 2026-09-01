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

/** The SVG is drawn in a -4..104 box; this puts a node back on the wrapper in %. */
const VIEW_MIN = -4;
const VIEW_SPAN = 108;
const asPercent = (n: number): number => ((n - VIEW_MIN) / VIEW_SPAN) * 100;

type TreeNode = GameView['tree']['nodes'][number];

/**
 * What a node is, floating beside it.
 *
 * A fixed reader panel underneath meant the tree had a permanent block of text
 * under it explaining itself, and your eye had to travel from the node to the
 * bottom of the modal and back. The card comes to the node instead, and when
 * nothing is hovered there is nothing there at all.
 */
function NodeCard({ node }: { node: TreeNode }) {
  const hue = hueOf(node.archetype);
  const left = asPercent(node.x);
  const top = asPercent(node.y);

  // Flip across the node when it would otherwise run off the edge.
  const flipX = left > 62;
  const flipY = top > 66;

  return (
    <div
      className="node-card"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        borderLeftColor: hue,
        transform: `translate(${flipX ? 'calc(-100% - 1.1rem)' : '1.1rem'}, ${flipY ? '-100%' : '0'})`,
      }}
    >
      <div className="node-card-head">
        <strong style={{ color: hue }}>{node.name}</strong>
        <span className="node-kind">{node.kind}</span>
      </div>
      <p className="node-discipline">{DISCIPLINE[node.archetype]?.label ?? node.archetype}</p>
      <p className="node-grant">{node.description}</p>
      {node.teaches && <p className="teaches">teaches {node.teaches}</p>}
      {node.taken && <p className="node-state held">held</p>}
      {!node.taken && node.reachable && <p className="node-state open">one point away</p>}
    </div>
  );
}

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

      <p className="muted" style={{ fontSize: '0.8rem', margin: '0.4rem 0 0.6rem' }}>
        A point can only go somewhere touching what you already hold. {spent} spent.
        {view.character.skillPoints > 0 && (
          <span className="points"> {view.character.skillPoints} to spend.</span>
        )}
      </p>

      <div className="tree-frame">
        <svg viewBox="-4 -4 108 108" className="tree-svg">
          <defs>
            {/* A held node glows in its own colour; one filter per discipline. */}
            {view.tree.disciplines.map((id) => (
              <radialGradient id={`glow-${id}`} key={id}>
                <stop offset="0%" stopColor={hueOf(id)} stopOpacity={0.5} />
                <stop offset="100%" stopColor={hueOf(id)} stopOpacity={0} />
              </radialGradient>
            ))}
          </defs>

          {view.tree.nodes.map((node) =>
            node.connections
              // Each edge once: both ends list it, so only draw the lower id.
              .filter((to) => to > node.id)
              .map((to) => {
                const other = byId.get(to);
                if (!other) return null;
                const lit = node.taken && other.taken;
                const live = node.taken !== other.taken && (node.reachable || other.reachable);
                const crossing =
                  node.archetype !== other.archetype && node.id !== 'start' && other.id !== 'start';
                return (
                  <line
                    key={`${node.id}-${to}`}
                    x1={node.x} y1={node.y} x2={other.x} y2={other.y}
                    stroke={lit ? hueOf(node.archetype) : live ? '#4a3f31' : '#221e19'}
                    strokeWidth={lit ? 0.75 : 0.38}
                    strokeLinecap="round"
                    // A link between disciplines is the hybrid route; dashing it
                    // makes the shape of the web readable at a glance.
                    strokeDasharray={crossing ? '1.4 1.3' : undefined}
                  />
                );
              }),
          )}

          {view.tree.nodes.map((node) => {
            const r = node.kind === 'keystone' ? 3 : node.kind === 'notable' ? 2.3 : 1.4;
            // Reachable draws the route; affordable decides whether it can be
            // clicked. Showing one without the other is what makes a tree legible.
            const open = node.reachable && !busy && view.character.skillPoints > 0;
            const hue = hueOf(node.archetype);
            const lit = hover === node.id;

            return (
              <g
                key={node.id}
                className={open ? 'node open' : 'node'}
                onMouseEnter={() => setHover(node.id)}
                onMouseLeave={() => setHover(null)}
                onClick={open ? () => act({ type: 'allocate', node: node.id }) : undefined}
              >
                {node.taken && (
                  <circle cx={node.x} cy={node.y} r={r * 2.6} fill={`url(#glow-${node.archetype})`} />
                )}

                {/* Keystones are diamonds. They are the decisions, and a
                    decision should not look like a stat bump. */}
                {node.kind === 'keystone' ? (
                  <rect
                    x={node.x - r} y={node.y - r} width={r * 2} height={r * 2}
                    transform={`rotate(45 ${node.x} ${node.y})`}
                    fill={node.taken ? hue : node.reachable ? '#332b21' : '#1b1714'}
                    stroke={node.taken || node.reachable ? hue : '#2b2620'}
                    strokeWidth={lit ? 0.8 : 0.5}
                  />
                ) : (
                  <circle
                    cx={node.x} cy={node.y} r={r}
                    fill={node.taken ? hue : node.reachable ? '#332b21' : '#1b1714'}
                    stroke={node.taken || node.reachable ? hue : '#2b2620'}
                    strokeWidth={lit ? 0.8 : node.reachable && !node.taken ? 0.55 : 0.35}
                  />
                )}

                {/* Notables carry a pip, so the ones that teach read at a glance. */}
                {node.kind === 'notable' && (
                  <circle cx={node.x} cy={node.y} r={0.7} fill={node.taken ? '#14110e' : hue} />
                )}

                {lit && (
                  <circle
                    cx={node.x} cy={node.y} r={r + 1.8}
                    fill="none" stroke={hue} strokeWidth={0.35} opacity={0.9}
                  />
                )}

                {/* A generous invisible target: the nodes are small on purpose. */}
                <circle cx={node.x} cy={node.y} r={r + 1.6} fill="transparent" />
              </g>
            );
          })}
        </svg>

        {shown && <NodeCard node={shown} />}
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
