'use client';

import { useEffect, useRef, useState } from 'react';
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

function StatusTab({ view, act, busy }: { view: GameView; act: Act; busy: boolean }) {
  const c = view.character;
  const [open, setOpen] = useState(false);

  return (
    <div className="sheet-split">
      {/* The portrait. A 2D picture or a 3D model belongs here; until the body
          field lands there is a frame and the words the character was given. */}
      <aside className="sheet-aside portrait">
        <div className="portrait-frame">
          <span className="muted">no likeness yet</span>
        </div>
        <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.8rem' }}>
          {c.background} · level {c.level}
        </p>
        <div className="tags">{c.traits.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
      </aside>

      <div className="sheet-main">
      <div className="tabs">
        {c.className && <span className="tag" style={{ color: 'var(--amber)' }}>{c.className}</span>}
        {c.subclassName && <span className="tag">{c.subclassName}</span>}
        <span className="tag">{c.xp} / {c.xpToNext} xp</span>
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

      {/* The expandable strip the mock-up puts under the stats: everything
          currently acting on you, without crowding the numbers above it. */}
      <button className="mini" style={{ marginTop: '1rem' }} onClick={() => setOpen(!open)}>
        {open ? 'hide' : 'expand'} full status
      </button>
      {open && (
        <div className="status-strip">
          <p className="label">Condition</p>
          {c.conditions.length === 0
            ? <p className="muted">Nothing is acting on you.</p>
            : <div className="tags">{c.conditions.map((x) => <span className="tag" key={x}>{x}</span>)}</div>}
          <p className="label" style={{ marginTop: '0.8rem' }}>Needs</p>
          <div className="tags">
            {Object.entries(c.needs).map(([need, value]) => (
              <span className="tag" key={need}>{need} {value as number}/10</span>
            ))}
          </div>
          <p className="label" style={{ marginTop: '0.8rem' }}>Disposition</p>
          <div className="tags">
            {Object.entries(c.personality).map(([axis, value]) => (
              <span className="tag" key={axis}>{axis} {(value as number) > 0 ? '+' : ''}{value as number}</span>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inventory: the paper-doll, and what is in the pack                          */
/* -------------------------------------------------------------------------- */

type BoardShape = NonNullable<GameView['inventory']['stacks'][number]['board']>;
type Placed = GameView['inventory']['stacks'][number]['placed'];

/**
 * What a bag looks like inside.
 *
 * A board is NOT a rectangle — a frame with a notch has cells missing — so this
 * draws the grid it actually has rather than a w×h block, and a square that is
 * not there is simply not drawn.
 */
function Board({ board, placed }: { board: BoardShape; placed: Placed }) {
  const real = new Set(board.cells.map(([x, y]) => `${x},${y}`));
  const filled = new Map<string, string>();
  for (const item of placed) for (const [x, y] of item.cells) filled.set(`${x},${y}`, item.name);

  const squares = [];
  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const key = `${x},${y}`;
      const name = filled.get(key);
      squares.push(
        <span
          key={key}
          className={!real.has(key) ? 'cell gone' : name ? 'cell full' : 'cell'}
          title={name ?? undefined}
        />,
      );
    }
  }

  return (
    <div className="board" style={{ gridTemplateColumns: `repeat(${board.w}, 12px)` }}>
      {squares}
    </div>
  );
}

/**
 * A bag with room for this, if there is one.
 *
 * The panel offers a move only when it would be allowed — a "stow" button that
 * always answers "it will not fit" is worse than no button. Nothing here
 * decides whether it fits; `putIn` does, and this asks the same question.
 */
function bagFor(view: GameView, itemId: string): string | null {
  const bag = view.inventory.stacks.find((i) => (
    i.id !== itemId && i.space !== null && i.space > 0 && !i.inside
  ));
  return bag?.id ?? null;
}

function InventoryTab({ view, act, busy }: { view: GameView; act: Act; busy: boolean }) {
  const c = view.character;

  return (
    <div className="sheet-split">
      {/*
        The paper-doll: every place this world lets you wear something, EMPTY
        ONES INCLUDED. An empty slot is the useful half — it is what tells a
        player they have nothing on their head.
      */}
      <aside className="sheet-aside">
        <p className="label">Equipment</p>
        {view.inventory.slots.map((slot) => (
          <div className={slot.itemId ? 'doll-slot' : 'doll-slot empty'} key={slot.id}>
            <span className="muted">{slot.name}</span>
            {slot.itemId ? (
              <>
                <strong>{slot.itemName}</strong>
                {slot.condition < 1 && (
                  <span className="tag" style={{ color: slot.condition < 0.25 ? 'var(--danger)' : 'var(--amber)' }}>
                    {Math.round(slot.condition * 100)}%
                  </span>
                )}
                <button
                  className="mini"
                  disabled={busy}
                  onClick={() => act({ type: 'unequip', slot: slot.id as Slot })}
                >
                  remove
                </button>
              </>
            ) : (
              <span className="muted">—</span>
            )}
          </div>
        ))}
      </aside>

      <div className="sheet-main">
      <p className="label">
        Carrying{' '}
        <span
          className="muted"
          style={{ fontWeight: 400, color: c.carried > c.capacity ? 'var(--bad)' : undefined }}
          title="over capacity costs you movement"
        >
          — {c.carried}/{c.capacity} load
        </span>
      </p>
      <div className="row purse">
        <div><strong>coin</strong> <span className="muted">what you have on you</span></div>
        <div className="coin">{c.coin}</div>
      </div>
      {view.inventory.stacks.length === 0 && <p className="muted">Nothing else but what you stand in.</p>}
      {view.inventory.stacks.map((item) => (
        // Indented when it is inside a bag, so the pack reads as a tree rather
        // than as one long list that happens to contain a bag.
        <div className="row" key={item.id} style={item.inside ? { paddingLeft: '1.2rem' } : undefined}>
          <div>
            <strong>{item.name}</strong>
            {item.count > 1 && <span className="muted"> ×{item.count}</span>}{' '}
            <span className="tag">{item.kind}</span>
            {item.equipped && <span className="tag" style={{ color: 'var(--amber)' }}>worn</span>}
            {item.read && <span className="tag" style={{ color: 'var(--muted)' }}>read</span>}
            {item.capacity !== null && (
              <span className="tag" title="what is still free inside it">
                {item.capacity - (item.space ?? 0)}/{item.capacity}
              </span>
            )}
            {item.condition < 1 && (
              <span className="tag" style={{ color: item.condition < 0.25 ? 'var(--danger)' : 'var(--amber)' }}>
                {Math.round(item.condition * 100)}%
              </span>
            )}
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>{item.description}</p>
            {item.board && <Board board={item.board} placed={item.placed} />}
            {item.parts.length > 0 && (
              <div className="parts">
                {item.parts.map((part) => (
                  <span className="tag" key={part.id} title={part.fused ? 'made as one piece' : undefined}>
                    {part.name}
                    {part.condition < 1 && ` ${Math.round(part.condition * 100)}%`}
                    {/* Fused pieces show, and offer nothing — the boundary is a
                        fact about the object, not a refusal to discover. */}
                    {!part.fused && (
                      <button
                        className="mini"
                        disabled={busy}
                        onClick={() => act({ type: 'strip', item: item.id, part: part.id })}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            {item.inside && (
              <button className="mini" disabled={busy} onClick={() => act({ type: 'takeOut', item: item.id })}>
                take out
              </button>
            )}
            {/* Stowing needs somewhere to stow it, so the button only exists
                once there is a bag with room — offering a move that would
                always be refused is worse than not offering it. */}
            {!item.inside && !item.equipped && bagFor(view, item.id) && (
              <button
                className="mini"
                disabled={busy}
                onClick={() => act({ type: 'stow', item: item.id, container: bagFor(view, item.id)! })}
              >
                stow
              </button>
            )}
            {item.usable && (
              <button className="mini" disabled={busy} onClick={() => act({ type: 'use', item: item.id })}>use</button>
            )}
            {item.hasLore && !item.read && (
              <button className="mini" disabled={busy} onClick={() => act({ type: 'read', item: item.id })}>read</button>
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
      </div>
    </div>
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

/** The SVG is drawn in a -4..104 box; this puts a point back on the wrapper in %. */
const VIEW_MIN = -4;
const VIEW_SPAN = 108;
const asPercent = (n: number): number => ((n - VIEW_MIN) / VIEW_SPAN) * 100;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

/** A drag has to travel this far before it stops counting as a click. */
const DRAG_SLOP = 1.2;

type TreeNode = GameView['tree']['nodes'][number];
type Offsets = Record<string, { dx: number; dy: number }>;
type Camera = { x: number; y: number; zoom: number };

const START_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/**
 * Where a node actually sits, once the player has had their way with it.
 *
 * Generated position, plus any drag they applied, put through the camera.
 */
const placed = (node: TreeNode, offsets: Offsets, camera: Camera) => {
  const off = offsets[node.id] ?? { dx: 0, dy: 0 };
  return { x: node.x + off.dx, y: node.y + off.dy };
};

/**
 * What a node is, floating beside it.
 *
 * Positioned in wrapper percentages rather than SVG units, so it has to be put
 * through the same camera the graph is — otherwise the card drifts away from
 * its node the moment anything is panned or zoomed.
 */
function NodeCard({ node, offsets, camera }: { node: TreeNode; offsets: Offsets; camera: Camera }) {
  const hue = hueOf(node.stat);
  const at = placed(node, offsets, camera);
  const left = asPercent(at.x * camera.zoom + camera.x);
  const top = asPercent(at.y * camera.zoom + camera.y);

  // Flip across the node when it would otherwise run off the edge.
  const flipX = left > 62;
  const flipY = top > 66;

  return (
    <div
      className="node-card"
      style={{
        left: `${Math.max(0, Math.min(100, left))}%`,
        top: `${Math.max(0, Math.min(100, top))}%`,
        borderLeftColor: hue,
        transform: `translate(${flipX ? 'calc(-100% - 1.1rem)' : '1.1rem'}, ${flipY ? '-100%' : '0'})`,
      }}
    >
      <div className="node-card-head">
        <strong style={{ color: hue }}>{node.name}</strong>
        <span className="node-kind">{node.kind}</span>
      </div>
      <p className="node-discipline">{DISCIPLINE[node.stat]?.label ?? node.stat}</p>
      <p className="node-grant">{node.description}</p>
      {node.teaches && <p className="teaches">teaches {node.teaches}</p>}
      {/* Why this branch exists at all. The old islands never said. */}
      {node.grafted && <p className="node-from">grown from {node.grafted.name}</p>}
      {node.freeStanding && !node.taken && (
        <p className="node-entry">free-standing — needs nothing held</p>
      )}
      {node.requiresAll.length > 0 && !node.taken && (
        <p className="node-entry">opens only when {node.requiresAll.length} parts of your tree meet</p>
      )}
      {node.taken && <p className="node-state held">held</p>}
      {!node.taken && node.reachable && <p className="node-state open">one point away</p>}
    </div>
  );
}

/**
 * The passive tree, with a camera over it.
 *
 * A sixty-node web in a fixed frame is a picture of a tree rather than
 * something you can work with, so this one pans, zooms and lets nodes be
 * dragged out of the way.
 *
 * Dragging a node changes only where it is DRAWN. Positions are generated from
 * the seed and the graph is what matters — what connects to what — so a layout
 * the player has rearranged is a viewing preference, not game state. It lives
 * in localStorage beside the session id rather than in the event log, which is
 * reserved for things that actually happened.
 */
function SkillTree({ view, act, busy }: { view: GameView; act: Act; busy: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const [camera, setCamera] = useState<Camera>(START_CAMERA);
  const [offsets, setOffsets] = useState<Offsets>({});
  const frame = useRef<HTMLDivElement>(null);

  // What is being dragged, and whether it has moved far enough to stop being a
  // click. Held in a ref: this changes on every pointermove and re-rendering
  // sixty nodes for each one would crawl.
  const drag = useRef<{ kind: 'pan' | 'node'; id?: string; x: number; y: number; moved: boolean } | null>(null);

  const storageKey = `tree-layout:${view.id}`;
  /**
   * Nothing is written until the saved layout has been read back in.
   *
   * STATE rather than a ref, and that distinction is the whole bug it fixes.
   * Both effects run on mount in declaration order, so with a ref the save
   * fired on the same pass as the load — before React had re-rendered with the
   * restored values — and wrote the DEFAULT camera straight over the saved one.
   * A state flag forces a re-render in between, so the save sees what was
   * loaded.
   */
  const [loaded, setLoaded] = useState(false);

  // Restore whatever arrangement they left it in. Wrapped because a browser
  // with site data blocked throws on access rather than returning null.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { camera?: Camera; offsets?: Offsets };
      if (parsed.camera) setCamera(parsed.camera);
      if (parsed.offsets) setOffsets(parsed.offsets);
    } catch {
      // A missing or unreadable layout is not worth telling anyone about.
    } finally {
      setLoaded(true);
    }
  }, [storageKey]);

  /**
   * Save whatever they have arranged.
   *
   * Driven by an effect rather than called from the pointer handlers, because
   * a handler closes over the state as it was when the handler was created —
   * saving from `pointerup` wrote the offsets from BEFORE the drag, so a
   * rearranged tree came back in its old shape.
   */
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ camera, offsets }));
    } catch {
      // Not being able to save a layout should never break the panel.
    }
  }, [loaded, storageKey, camera, offsets]);

  /** Screen pixels to SVG units, which is what every position here is in. */
  const toSvg = (dx: number, dy: number) => {
    const rect = frame.current?.getBoundingClientRect();
    const scale = rect && rect.width > 0 ? VIEW_SPAN / rect.width : 1;
    return { x: dx * scale, y: dy * scale };
  };

  /**
   * Keep receiving moves once the pointer leaves the element it started on.
   *
   * Guarded because `setPointerCapture` THROWS for a pointer id the browser
   * does not consider active. An uncaught throw here would abort the handler
   * before the drag was ever recorded, and the graph would simply refuse to
   * move — capture is a convenience, not a precondition.
   */
  const capture = (element: Element, pointerId: number, take: boolean) => {
    try {
      if (take) element.setPointerCapture?.(pointerId);
      else element.releasePointerCapture?.(pointerId);
    } catch {
      // Without capture a drag still works; it just ends early if the pointer
      // leaves the frame, which `onPointerLeave` already handles.
    }
  };

  function onPointerDown(event: React.PointerEvent, id?: string) {
    if (busy) return;
    capture(event.currentTarget as Element, event.pointerId, true);
    drag.current = { kind: id ? 'node' : 'pan', id, x: event.clientX, y: event.clientY, moved: false };
  }

  function onPointerMove(event: React.PointerEvent) {
    const current = drag.current;
    if (!current) return;

    const moved = toSvg(event.clientX - current.x, event.clientY - current.y);
    if (Math.abs(moved.x) + Math.abs(moved.y) > DRAG_SLOP) current.moved = true;
    if (!current.moved) return;

    current.x = event.clientX;
    current.y = event.clientY;

    if (current.kind === 'pan') {
      setCamera((c) => ({ ...c, x: c.x + moved.x, y: c.y + moved.y }));
      return;
    }

    // A node drag is in graph units, so it has to be divided back out of the
    // zoom — otherwise the node runs away from the cursor when zoomed in.
    const id = current.id!;
    setOffsets((o) => {
      const previous = o[id] ?? { dx: 0, dy: 0 };
      return { ...o, [id]: { dx: previous.dx + moved.x / camera.zoom, dy: previous.dy + moved.y / camera.zoom } };
    });
  }

  function onPointerUp(event: React.PointerEvent, node?: TreeNode) {
    const current = drag.current;
    drag.current = null;
    capture(event.currentTarget as Element, event.pointerId, false);

    if (!current) return;
    if (current.moved) return;

    // It never moved, so it was a click.
    if (node && node.reachable && !busy && view.character.skillPoints > 0) {
      act({ type: 'allocate', node: node.id });
    }
  }

  /** Zoom about the middle of the frame, so the tree does not slide away. */
  function zoomBy(factor: number) {
    setCamera((c) => {
      const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.zoom * factor));
      const middle = VIEW_SPAN / 2 + VIEW_MIN;
      return {
        zoom,
        x: middle - ((middle - c.x) / c.zoom) * zoom,
        y: middle - ((middle - c.y) / c.zoom) * zoom,
      };
    });
  }

  function onWheel(event: React.WheelEvent) {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }

  function reset() {
    setCamera(START_CAMERA);
    setOffsets({});
  }

  const byId = new Map(view.tree.nodes.map((n) => [n.id, n]));
  const shown = hover ? byId.get(hover) : null;
  const spent = view.tree.nodes.filter((n) => n.taken && n.id !== 'start').length;
  // Ordered so the character's own discipline stays first.
  const shownDisciplines = [
    ...view.tree.paths.filter((id) => view.tree.nodes.some((n) => n.stat === id)),
    ...[...new Set(view.tree.nodes.map((n) => n.stat))].filter((id) => !view.tree.paths.includes(id)),
  ];
  const rearranged = Object.keys(offsets).length > 0 || camera.zoom !== 1 || camera.x !== 0 || camera.y !== 0;

  return (
    // A flex column of its own, so the frame inside it has somewhere to grow.
    // As a plain div this wrapper sized to its content and the tree stayed a
    // postage stamp however tall the panel got.
    <div className="tree-tab">
      <div className="legend">
        {/*
          Built from what is actually DRAWN, not from the discipline list.
          A revealed island can belong to a discipline the tree does not
          otherwise hold — an Eldritch Knight has magic nodes on an otherwise
          magic-less tree — and those want naming. Reading the visible nodes
          also means a hidden island cannot leak its discipline into the key.
        */}
        {shownDisciplines.map((id) => (
          <span className="legend-item" key={id} style={{ opacity: view.tree.home === id ? 1 : 0.6 }}>
            <i style={{ background: hueOf(id) }} />
            {DISCIPLINE[id]?.label ?? id}{view.tree.home === id ? ' · yours' : ''}
          </span>
        ))}
      </div>

      <div className="tree-bar">
        <span className="muted">
          A point can only go somewhere touching what you already hold. {spent} spent.
          {view.character.skillPoints > 0 && (
            <span className="points"> {view.character.skillPoints} to spend.</span>
          )}
        </span>
        <span className="chips">
          <button className="mini" onClick={() => zoomBy(1 / 1.25)} disabled={camera.zoom <= ZOOM_MIN}>−</button>
          <span className="zoom-read">{Math.round(camera.zoom * 100)}%</span>
          <button className="mini" onClick={() => zoomBy(1.25)} disabled={camera.zoom >= ZOOM_MAX}>+</button>
          <button className="mini" onClick={reset} disabled={!rearranged}>reset</button>
        </span>
      </div>

      <div className="tree-frame">
        {/*
          The stage is exactly the size of the drawing, and the card is
          positioned inside it. Anchoring the card to the FRAME instead would
          put it adrift the moment the frame is wider than the square viewBox.
        */}
        <div className="tree-stage" ref={frame}>
        <svg
          viewBox="-4 -4 108 108"
          className={drag.current ? 'tree-svg dragging' : 'tree-svg'}
          onPointerDown={(e) => onPointerDown(e)}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => onPointerUp(e)}
          onPointerLeave={(e) => onPointerUp(e)}
          onWheel={onWheel}
        >
          <defs>
            {/* A held node glows in its own colour; one gradient per discipline. */}
            {view.tree.paths.map((id) => (
              <radialGradient id={`glow-${id}`} key={id}>
                <stop offset="0%" stopColor={hueOf(id)} stopOpacity={0.5} />
                <stop offset="100%" stopColor={hueOf(id)} stopOpacity={0} />
              </radialGradient>
            ))}
          </defs>

          <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
            {view.tree.nodes.map((node) =>
              node.connections
                // Each edge once: both ends list it, so only draw the lower id.
                .filter((to) => to > node.id)
                .map((to) => {
                  const other = byId.get(to);
                  if (!other) return null;
                  const a = placed(node, offsets, camera);
                  const b = placed(other, offsets, camera);
                  const lit = node.taken && other.taken;
                  const live = node.taken !== other.taken && (node.reachable || other.reachable);
                  const crossing =
                    node.stat !== other.stat && node.id !== 'start' && other.id !== 'start';
                  return (
                    <line
                      key={`${node.id}-${to}`}
                      x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke={lit ? hueOf(node.stat) : live ? '#4a3f31' : '#221e19'}
                      strokeWidth={lit ? 0.75 : 0.38}
                      strokeLinecap="round"
                      // A link between disciplines is the hybrid route; dashing
                      // it makes the shape of the web readable at a glance.
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
              const hue = hueOf(node.stat);
              const lit = hover === node.id;
              const at = placed(node, offsets, camera);

              return (
                <g
                  key={node.id}
                  className={open ? 'node open' : 'node'}
                  onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, node.id); }}
                  onPointerMove={onPointerMove}
                  onPointerUp={(e) => { e.stopPropagation(); onPointerUp(e, node); }}
                  onMouseEnter={() => setHover(node.id)}
                  onMouseLeave={() => setHover(null)}
                >
                  {node.taken && (
                    <circle cx={at.x} cy={at.y} r={r * 2.6} fill={`url(#glow-${node.stat})`} />
                  )}

                  {/* Keystones are diamonds. They are the decisions, and a
                      decision should not look like a stat bump. */}
                  {node.kind === 'keystone' ? (
                    <rect
                      x={at.x - r} y={at.y - r} width={r * 2} height={r * 2}
                      transform={`rotate(45 ${at.x} ${at.y})`}
                      fill={node.taken ? hue : node.reachable ? '#332b21' : '#1b1714'}
                      stroke={node.taken || node.reachable ? hue : '#2b2620'}
                      strokeWidth={lit ? 0.8 : 0.5}
                    />
                  ) : (
                    <circle
                      cx={at.x} cy={at.y} r={r}
                      fill={node.taken ? hue : node.reachable ? '#332b21' : '#1b1714'}
                      stroke={node.taken || node.reachable ? hue : '#2b2620'}
                      strokeWidth={lit ? 0.8 : node.reachable && !node.taken ? 0.55 : 0.35}
                    />
                  )}

                  {/* A free-standing root is ringed square: you did not walk here. */}
                  {node.freeStanding && (
                    <rect
                      x={at.x - r - 1.3} y={at.y - r - 1.3} width={(r + 1.3) * 2} height={(r + 1.3) * 2}
                      fill="none" stroke={hue} strokeWidth={0.3} opacity={0.6} rx={0.6}
                    />
                  )}

                  {/* Notables carry a pip, so the ones that teach read at a glance. */}
                  {node.kind === 'notable' && (
                    <circle cx={at.x} cy={at.y} r={0.7} fill={node.taken ? '#14110e' : hue} />
                  )}

                  {lit && (
                    <circle
                      cx={at.x} cy={at.y} r={r + 1.8}
                      fill="none" stroke={hue} strokeWidth={0.35} opacity={0.9}
                    />
                  )}

                  {/* A generous invisible target: the nodes are small on purpose. */}
                  <circle cx={at.x} cy={at.y} r={r + 1.6} fill="transparent" />
                </g>
              );
            })}
          </g>
        </svg>

        {shown && <NodeCard node={shown} offsets={offsets} camera={camera} />}

        <p className="tree-hint muted">drag to move · wheel to zoom · drag a node to rearrange</p>
        </div>
      </div>
    </div>
  );
}

/** Progress is shown per condition, because they do not average into anything. */
function TraitList({ view }: { view: GameView }) {
  return (
    <div className="panel-scroll">
      {view.traits.map((trait) => (
        <div className="row" key={trait.id}>
          <div>
            <strong style={{ color: trait.held ? 'var(--amber)' : undefined }}>{trait.name}</strong>{' '}
            {trait.held && <span className="tag" style={{ color: 'var(--good)' }}>earned</span>}
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>{trait.description}</p>
            {trait.note && (
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--amber)' }}>{trait.note}</p>
            )}
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

function SignetList({ view, act, busy }: { view: GameView; act: Act; busy: boolean }) {
  if (view.signets.length === 0) {
    return (
      <p className="muted">
        Nothing yet. Signets are not listed — they are found, and some give no warning at all.
      </p>
    );
  }

  return (
    <div className="panel-scroll">
      {view.signets.map((s) => (
        <div className="row" key={s.id}>
          <div>
            <strong style={{ color: s.held ? 'var(--amber)' : undefined }}>{s.name}</strong>{' '}
            {s.held && <span className="tag" style={{ color: 'var(--good)' }}>held</span>}
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>{s.description}</p>
          </div>
          {s.available && !s.held && (
            <button className="take" disabled={busy} onClick={() => act({ type: 'claimSignet', id: s.id })}>
              claim
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The sheet: one modal, six tabs                                              */
/* -------------------------------------------------------------------------- */

export const SHEET_TABS = ['status', 'inventory', 'skill', 'trait', 'signet', 'quest'] as const;
export type SheetTab = (typeof SHEET_TABS)[number];

/**
 * One panel for everything about the character.
 *
 * This replaced two separate modals — a character sheet and a tree/traits/
 * signets one — which meant the same person was described in two places and
 * neither held the whole of them. Six tabs, a persistent left column, and one
 * way in.
 */
export function SheetPanel({ view, act, busy, onClose, start = 'status' }: {
  view: GameView; act: Act; busy: boolean; onClose: () => void; start?: SheetTab;
}) {
  const [tab, setTab] = useState<SheetTab>(start);
  const c = view.character;

  const badge = (t: SheetTab) =>
    t === 'skill' && c.skillPoints > 0 ? ` (${c.skillPoints})` : '';

  return (
    <Modal title={c.name} onClose={onClose}>
      <div className="tabs sheet-tabs">
        {SHEET_TABS.map((t) => (
          <button key={t} className={tab === t ? 'tab on' : 'tab'} onClick={() => setTab(t)}>
            {t}{badge(t)}
          </button>
        ))}
      </div>

      {/* The one choice that reshapes the tree rather than filling it in. */}
      {tab === 'skill' && c.subclassChoices.length > 0 && (
        <div className="subclass-prompt">
          <p>
            <strong>Level {c.level}.</strong> Choose a path. It grants a skill outright and opens a way
            into a part of the tree your class cannot otherwise reach — and it cannot be changed.
          </p>
          {c.subclassChoices.map((sub) => (
            <div className="row" key={sub.id}>
              <div>
                <strong>{sub.name}</strong>
                <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>{sub.description}</p>
                <span className="subclass-opens">opens {DISCIPLINE[sub.opens]?.label ?? sub.opens}</span>
              </div>
              <button className="mini" disabled={busy} onClick={() => act({ type: 'chooseSubclass', id: sub.id })}>
                take it
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'status' && <StatusTab view={view} act={act} busy={busy} />}
      {tab === 'inventory' && <InventoryTab view={view} act={act} busy={busy} />}
      {tab === 'skill' && <SkillTree view={view} act={act} busy={busy} />}
      {tab === 'trait' && <TraitList view={view} />}
      {tab === 'signet' && <SignetList view={view} act={act} busy={busy} />}
      {tab === 'quest' && (
        <p className="muted">
          Nothing is asked of you yet. Tasks will appear here when the tower, or somebody in it,
          wants something.
        </p>
      )}
    </Modal>
  );
}
