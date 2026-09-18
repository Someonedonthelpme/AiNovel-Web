'use client';

import { useEffect, useRef, useState } from 'react';
import type { CombatView, GameView, TurnOutcomeView } from '../../../src/server/game.ts';
import type { CombatAction } from '../../../src/play/combat.ts';
import type { SheetAction } from '../../../src/play/sheetaction.ts';
import { SheetPanel } from './Panels.tsx';
import type { SheetTab } from './Panels.tsx';

/** A signed −3..+3 axis, drawn from the centre so direction reads at a glance. */
function AxisBar({ label, value }: { label: string; value: number }) {
  const width = (Math.abs(value) / 3) * 50;
  return (
    <div className="bar-row">
      <span className="muted">{label}</span>
      <span className="bar">
        <i className={value >= 0 ? 'pos' : 'neg'} style={{ width: `${width}%` }} />
      </span>
      <span className="muted" style={{ textAlign: 'right' }}>{value > 0 ? `+${value}` : value}</span>
    </div>
  );
}

function LinearBar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="bar-row">
      <span className="muted">{label}</span>
      <span className="bar">
        <i className="lin" style={{ width: `${(value / max) * 100}%` }} />
      </span>
      <span className="muted" style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}

/**
 * The local map.
 *
 * Places you have not reached show as unnamed shapes rather than being hidden,
 * so the map communicates "there is more that way" without spoiling what.
 */
function LocalMap({ view, onTravel, busy }: { view: GameView; onTravel: (id: string) => void; busy: boolean }) {
  const byId = new Map(view.map.nodes.map((n) => [n.id, n]));

  return (
    <svg viewBox="-6 -6 112 112" style={{ width: '100%', height: 'auto' }} role="img" aria-label="local map">
      {view.map.edges.map((edge) => {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (!a || !b) return null;
        return (
          <line
            key={`${edge.from}-${edge.to}`}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="#302a23" strokeWidth={0.8}
          />
        );
      })}

      {view.map.nodes.map((node) => {
        const fill = node.current ? '#d9a441' : node.known ? '#221e19' : '#181512';
        const stroke = node.current ? '#d9a441' : node.reachable ? '#7a5f27' : '#302a23';
        return (
          <g
            key={node.id}
            onClick={() => node.reachable && !busy && onTravel(node.id)}
            style={{ cursor: node.reachable && !busy ? 'pointer' : 'default' }}
          >
            <circle cx={node.x} cy={node.y} r={node.current ? 3.6 : 2.8} fill={fill} stroke={stroke} strokeWidth={0.9} />
            <text
              x={node.x} y={node.y - 5}
              textAnchor="middle"
              fontSize={3.4}
              fill={node.current ? '#eae2d6' : node.known ? '#9c8f7d' : '#5c5349'}
            >
              {node.name.length > 18 ? `${node.name.slice(0, 17)}…` : node.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The tactical board.
 *
 * Squares matter here in a way they do not anywhere else in the game, so this is
 * the one place drawn as a grid rather than a node graph.
 */
/**
 * The tactical board.
 *
 * Movement is made by clicking the ground rather than by picking from a list:
 * an open board offers close to a hundred legal steps, which is unreadable as
 * chips and was previously truncated — hiding `end turn` and stranding the
 * player. Attacks and ending the turn stay as chips, since those are choices
 * rather than places.
 */
function CombatBoard({
  combat,
  onMove,
  busy,
}: {
  combat: CombatView;
  onMove: (to: { x: number; y: number }) => void;
  busy: boolean;
}) {
  const cell = 100 / Math.max(combat.grid.width, combat.grid.height);
  const walls = new Set(combat.grid.walls);

  // Where the engine says this character may step, keyed for a cheap lookup.
  const reachable = new Map<string, { x: number; y: number }>();
  if (combat.yourTurn && !combat.over) {
    for (const option of combat.options) {
      if (option.action.kind === 'move') reachable.set(`${option.action.to.x},${option.action.to.y}`, option.action.to);
    }
  }

  return (
    <svg viewBox="0 0 100 100" style={{ width: '100%', height: 'auto', background: '#100e0c', borderRadius: 8 }}>
      {Array.from({ length: combat.grid.height }, (_, y) =>
        Array.from({ length: combat.grid.width }, (_, x) => {
          const key = `${x},${y}`;
          const step = reachable.get(key);
          return (
            <rect
              key={key}
              x={x * cell} y={y * cell} width={cell} height={cell}
              fill={walls.has(key) ? '#2b2620' : step ? 'rgba(217,164,65,0.12)' : 'transparent'}
              stroke="#1e1a16" strokeWidth={0.25}
              style={step && !busy ? { cursor: 'pointer' } : undefined}
              onClick={step && !busy ? () => onMove(step) : undefined}
            >
              {step && <title>move to {key}</title>}
            </rect>
          );
        }),
      )}

      {combat.fighters.filter((f) => !f.dead).map((f) => {
        const cx = f.x * cell + cell / 2;
        const cy = f.y * cell + cell / 2;
        const mine = f.side === 'party';
        return (
          <g key={f.id}>
            <circle
              cx={cx} cy={cy} r={cell * 0.34}
              fill={mine ? '#d9a441' : '#7a3b2c'}
              stroke={f.dying ? '#c96442' : '#12100e'} strokeWidth={0.6}
            />
            <rect x={cx - cell * 0.4} y={cy + cell * 0.4} width={cell * 0.8} height={cell * 0.1} fill="#2b2620" />
            <rect
              x={cx - cell * 0.4} y={cy + cell * 0.4}
              width={cell * 0.8 * (f.hp / Math.max(1, f.maxHp))} height={cell * 0.1}
              fill={mine ? '#7fa76a' : '#c96442'}
            />
          </g>
        );
      })}
    </svg>
  );
}

export default function Game({ initial }: { initial: GameView }) {
  const [view, setView] = useState(initial);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // How the last fight ended, shown until the next thing you do.
  const [closing, setClosing] = useState<string[]>([]);
  const [lastShifts, setLastShifts] = useState<string[]>([]);
  // One panel now, opened at whichever tab you clicked from.
  const [panel, setPanel] = useState<null | SheetTab>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [view.transcript.length, busy]);

  async function send(text: string) {
    const said = text.trim();
    if (!said || busy) return;
    setBusy(true);
    setNotice(null);
    setClosing([]);
    setInput('');

    // Movement and looking are narration; anything else is talking to someone.
    const mode = /^(go|walk|move|look|search|เดิน|ไป|มอง|ค้น)/i.test(said) ? 'exploration' : 'conversation';

    try {
      const response = await fetch(`/api/sessions/${view.id}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: said, mode }),
      });
      const data: TurnOutcomeView & { error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'the turn failed');
      setView(data.view);
      setLastShifts(data.shifts);
      if (data.rejected.length) setNotice(data.rejected.join(' · '));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function act(action: CombatAction) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/sessions/${view.id}/combat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'that did not work');
      if (data.error) setNotice(data.error);
      setClosing(data.finished ? data.closing ?? [] : []);
      setView(data.view);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * A panel action.
   *
   * Goes to the server and comes back as a whole view: the sheet is a fold of
   * the log, so the browser must never patch its own copy.
   */
  async function actOnSheet(action: SheetAction) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/sessions/${view.id}/sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'that did not work');
      if (data.error) setNotice(data.error);
      else if (data.note) setNotice(data.note);
      setView(data.view);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function ascend(to?: string) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setClosing([]);
    try {
      const response = await fetch(`/api/sessions/${view.id}/climb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A way out that is not the stair, when one was clicked.
        body: JSON.stringify(to ? { to } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'the climb failed');
      if (data.error) setNotice(data.error);
      else setNotice(`You reach ${data.arrived}.`);
      setView(data.view);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const c = view.character;

  return (
    <main className="shell">
      <div className="game">
        {/* ---------------------------------------------------- the sheet */}
        <div className="col">
          <section
            className="panel opens"
            onClick={() => setPanel('status')}
            title="Inventory, experience and unspent points"
          >
            <p className="label">
              Character
              {c.abilityPoints > 0 && <span className="points"> · {c.abilityPoints} point{c.abilityPoints > 1 ? 's' : ''}</span>}
            </p>
            <h3 style={{ margin: '0 0 0.1rem' }}>{c.name}</h3>
            <p className="muted" style={{ margin: '0 0 0.9rem', fontSize: '0.85rem' }}>
              {c.background} · level {c.level}
            </p>

            <div className="stats">
              <div className="stat"><b>{c.hp}/{c.maxHp}</b><span>hp</span></div>
              <div className="stat"><b>{c.ac}</b><span>ac</span></div>
              <div className="stat"><b>{view.region.danger}</b><span>danger</span></div>
            </div>

            <div className="stats" style={{ marginTop: '0.5rem' }}>
              {Object.entries(c.abilities).map(([key, value]) => (
                <div className="stat" key={key}><b>{value}</b><span>{key}</span></div>
              ))}
            </div>

            {c.traits.length > 0 && (
              <div style={{ marginTop: '0.8rem' }}>
                {c.traits.map((t) => <span className="tag" key={t}>{t}</span>)}
              </div>
            )}
          </section>

          <section className="panel">
            <p className="label">Disposition</p>
            {Object.entries(c.personality).map(([axis, value]) => (
              <AxisBar key={axis} label={axis} value={value as number} />
            ))}
            <p className="label" style={{ margin: '1rem 0 0.6rem' }}>Needs</p>
            {Object.entries(c.needs).map(([need, value]) => (
              <LinearBar key={need} label={need} value={value as number} max={10} />
            ))}
          </section>

          {(
            <section className="panel opens" onClick={() => setPanel('skill')} title="Tree, traits and signets">
              <p className="label">
                Skills
                {c.skillPoints > 0 && <span className="points"> · {c.skillPoints} to spend</span>}
              </p>
              {c.skills.map((s) => (
                <div key={s.name} style={{ marginBottom: '0.6rem' }}>
                  <strong style={{ fontSize: '0.9rem' }}>{s.name}</strong>{' '}
                  {s.cost > 0 && <span className="tag">{s.cost} {s.pool}</span>}
                  <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>{s.effect}</p>
                </div>
              ))}
            </section>
          )}
        </div>

        {/* ------------------------------------------------- the scene */}
        <div className="col">
          <section className="panel">
            <p className="label">Floor {view.region.floor} · turn {view.turn}</p>
            <h2 className="scene-title">{view.place.name}</h2>
            <p className="scene-sub">{view.region.name} — {view.region.biome}</p>
            {view.place.description && (
              <p className="muted" style={{ marginBottom: 0 }}>{view.place.description}</p>
            )}
          </section>

          <section className="panel">
            <div className="transcript">
              {view.transcript.length === 0 && (
                <p className="muted">Nothing has happened yet. Say something, or look around.</p>
              )}
              {view.transcript.map((entry, i) => (
                <div key={i}>
                  <p className="said">{entry.input}</p>
                  <p className="prose">{entry.prose}</p>
                  {entry.roll && (
                    <p className="roll">
                      {entry.roll.ability} {entry.roll.dice[0]}+{entry.roll.dice[1]}
                      {entry.roll.modifier >= 0 ? '+' : ''}{entry.roll.modifier} = {entry.roll.total}{' '}
                      <span className={`tier-${entry.roll.tier}`}>{entry.roll.tier.toUpperCase()}</span>
                    </p>
                  )}
                  {i === view.transcript.length - 1 && lastShifts.map((s) => (
                    <p className="shift" key={s}>Something has changed — she {s}.</p>
                  ))}
                </div>
              ))}
              {busy && <p className="muted"><span className="spinner">▚</span> thinking…</p>}
              <div ref={bottom} />
            </div>

            {!view.combat && closing.length > 0 && (
              <div style={{ margin: '0.9rem 0' }}>
                <p className="label" style={{ marginBottom: '0.5rem' }}>How the fight ended</p>
                {closing.map((line, i) => (
                  <p className="shift" key={i} style={{ margin: '0.2rem 0' }}>{line}</p>
                ))}
              </div>
            )}

            {view.combat && (
              <div style={{ margin: '0.9rem 0' }}>
                <p className="label" style={{ marginBottom: '0.5rem' }}>
                  A fight · round {view.combat.round}
                  {view.combat.over && ` · ${view.combat.victor === 'party' ? 'you won' : 'you lost'}`}
                </p>
                <CombatBoard combat={view.combat} onMove={(to) => act({ kind: 'move', to })} busy={busy} />

                <div style={{ marginTop: '0.6rem' }}>
                  {view.combat.fighters.filter((f) => !f.dead).map((f) => (
                    <span className="tag" key={f.id} style={{ color: f.side === 'party' ? 'var(--amber)' : 'var(--danger)' }}>
                      {f.name} {f.hp}/{f.maxHp}{f.dying ? ' · down' : ''}
                    </span>
                  ))}
                </div>

                {view.combat.log.length > 0 && (
                  <div style={{ marginTop: '0.6rem' }}>
                    {view.combat.log.map((line, i) => (
                      <p className="shift" key={i} style={{ margin: '0.2rem 0' }}>{line}</p>
                    ))}
                  </div>
                )}

                {!view.combat.over && view.combat.yourTurn && (
                  <p className="muted" style={{ fontSize: '0.8rem', margin: '0.5rem 0 0' }}>
                    Click the lit ground to move.
                  </p>
                )}

                {!view.combat.over && (
                  <div className="chips" style={{ marginTop: '0.7rem' }}>
                    {view.combat.yourTurn ? (
                      // Moves live on the board; everything else is a chip, and the
                      // list is never truncated — `end turn` has to stay reachable.
                      view.combat.options
                        .filter((o) => o.action.kind !== 'move')
                        .map((o, i) => (
                          // A word carries what is typed in the box below (6b stage 8).
                          <button
                            className="chip"
                            key={i}
                            onClick={() => {
                              if (o.action.kind === 'parley') {
                                void act({ ...o.action, say: input });
                                setInput('');
                              } else void act(o.action);
                            }}
                            disabled={busy}
                          >
                            {o.label}
                          </button>
                        ))
                    ) : (
                      <span className="muted">waiting…</span>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="composer">
              <input
                value={input}
                placeholder={
                  view.combat
                    ? (view.language === 'th' ? 'จะพูดอะไร แล้วเลือกคนที่จะคุยด้วย…' : 'What you say — then pick who to talk to')
                    : (view.language === 'th' ? 'จะทำอะไร…' : 'What do you do?')
                }
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !view.combat && send(input)}
                // Mid-fight the box is what you SAY, sent by a "talk to" chip.
                disabled={busy || Boolean(view.ended) || Boolean(view.combat && (view.combat.over || !view.combat.yourTurn))}
              />
              <button onClick={() => send(input)} disabled={busy || !input.trim() || Boolean(view.combat) || Boolean(view.ended)}>
                Do it
              </button>
            </div>

            {notice && <p className="muted" style={{ fontSize: '0.8rem' }}>{notice}</p>}

            {view.ended && (
              <p style={{ color: 'var(--danger)' }}>This run is over — {view.ended}.</p>
            )}

            <div className="chips" style={{ marginTop: '0.9rem' }}>
              {!view.combat && !view.ended && view.suggestions.slice(0, 8).map((s) => (
                <button className="chip" key={s} onClick={() => send(s)} disabled={busy}>{s}</button>
              ))}
              {view.canClimb && !view.combat && !view.ended && (
                <button className="chip" onClick={() => ascend()} disabled={busy} style={{ borderColor: 'var(--amber-dim)' }}>
                  ↑ Climb to floor {view.region.floor + 1}
                </button>
              )}
              {/* Ways out that are not stairs: a road, a breach, a gate. */}
              {!view.combat && !view.ended && view.ways.filter((w) => w.here).map((w) => (
                <button
                  key={w.to}
                  className="chip"
                  onClick={() => ascend(w.to)}
                  disabled={busy}
                  style={{ borderColor: 'var(--amber-dim)' }}
                >
                  → Take the way out
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* --------------------------------------------- map and people */}
        <div className="col">
          <section className="panel">
            <p className="label">This floor</p>
            <LocalMap view={view} onTravel={(id) => {
              const node = view.map.nodes.find((n) => n.id === id);
              send(view.language === 'th' ? `ไปที่ ${node?.name}` : `go to ${node?.name}`);
            }} busy={busy} />
            <p className="dim" style={{ fontSize: '0.75rem', marginBottom: 0 }}>
              Click a lit place to walk there. Deepest floor reached: {view.deepestFloor}.
            </p>
          </section>

          <section className="panel">
            <p className="label">Here with you</p>
            {view.people.length === 0 && <p className="muted">Nobody.</p>}
            {view.people.map((p) => (
              <div className="person" key={p.id}>
                <h4>{p.name}</h4>
                <p>{p.oneLine}</p>
                <div>
                  <span className="tag">trust {p.trust > 0 ? `+${p.trust}` : p.trust}</span>
                  {p.disposition.map((d) => <span className="tag" key={d}>{d}</span>)}
                  {p.condition.map((d) => <span className="tag" key={d} style={{ color: 'var(--danger)' }}>{d}</span>)}
                </div>
              </div>
            ))}
          </section>

          <section className="panel">
            <p className="label">Session</p>
            <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
              {view.factCount} facts established · <a href="/">all sessions</a>
            </p>
          </section>
        </div>
      </div>
      {panel && (
        <SheetPanel view={view} act={actOnSheet} busy={busy} start={panel} onClose={() => setPanel(null)} />
      )}
    </main>
  );
}
