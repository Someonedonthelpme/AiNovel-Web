'use client';

import { useEffect, useState } from 'react';

type Summary = {
  id: string;
  characterName: string;
  premise: string;
  turns: number;
  language: 'th' | 'en';
  updatedAt: string;
};

export default function Home() {
  const [sessions, setSessions] = useState<Summary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  /**
   * Delete a run.
   *
   * The list is refetched rather than patched locally: the server is the one
   * that knows what survived, and guessing here is how a UI ends up showing
   * something that is not there.
   */
  async function remove(id: string) {
    setDeleting(id);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${id}/delete`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'could not delete');
      const refreshed = await fetch('/api/sessions').then((r) => r.json());
      setSessions(Array.isArray(refreshed) ? refreshed : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  }

  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((data) => setSessions(Array.isArray(data) ? data : []))
      .catch(() => setSessions([]));
  }, []);

  async function begin(language: 'th' | 'en') {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'generation failed');
      window.location.href = `/play/${data.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  }

  return (
    <main className="shell">
      <h1 style={{ margin: '0 0 0.2rem', fontSize: '1.6rem' }}>The Tower</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Climb it. Talk your way up. Everything here is generated as you go.
      </p>

      <div className="panel" style={{ marginTop: '1.5rem' }}>
        <p className="label">Begin</p>
        {creating ? (
          <p className="muted">
            <span className="spinner">▚</span> Building a world and a character. This takes a minute — the
            model is writing a town, its people and their voices from scratch.
          </p>
        ) : (
          <div className="chips">
            <a className="primary" href="/new">Make a character</a>
            <button className="chip" onClick={() => begin('en')}>Quick start (English)</button>
            <button className="chip" onClick={() => begin('th')}>เริ่มเร็ว (ไทย)</button>
          </div>
        )}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>

      <p className="label" style={{ marginTop: '2rem' }}>Continue</p>
      {sessions === null && <p className="muted"><span className="spinner">▚</span> loading…</p>}
      {sessions?.length === 0 && <p className="muted">No sessions yet.</p>}

      <div className="sessions">
        {sessions?.map((s) => (
          <div key={s.id} className="session">
            <a href={`/play/${s.id}`} className="session-body">
              <strong>{s.characterName || 'unnamed'}</strong>
              <span className="muted"> · {s.turns} turns · {s.language}</span>
              <br />
              <span className="dim" style={{ fontSize: '0.85rem' }}>{s.premise.slice(0, 120)}</span>
            </a>
            <span className="muted" style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
              {new Date(s.updatedAt).toLocaleString()}
            </span>
            {/* Two clicks, because a run is hours of play and there is no undo. */}
            {confirming === s.id ? (
              <span className="chips">
                <button className="mini danger" disabled={deleting === s.id} onClick={() => remove(s.id)}>
                  {deleting === s.id ? 'deleting…' : 'really delete'}
                </button>
                <button className="mini" onClick={() => setConfirming(null)}>keep</button>
              </span>
            ) : (
              <button className="mini" onClick={() => setConfirming(s.id)}>delete</button>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
