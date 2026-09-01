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
            <button onClick={() => begin('th')}>เริ่มเกมใหม่ (ไทย)</button>
            <button onClick={() => begin('en')}>New game (English)</button>
          </div>
        )}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>

      <p className="label" style={{ marginTop: '2rem' }}>Continue</p>
      {sessions === null && <p className="muted"><span className="spinner">▚</span> loading…</p>}
      {sessions?.length === 0 && <p className="muted">No sessions yet.</p>}

      <div className="sessions">
        {sessions?.map((s) => (
          <a key={s.id} href={`/play/${s.id}`} className="session">
            <span>
              <strong>{s.characterName || 'unnamed'}</strong>
              <span className="muted"> · {s.turns} turns · {s.language}</span>
              <br />
              <span className="dim" style={{ fontSize: '0.85rem' }}>{s.premise.slice(0, 120)}</span>
            </span>
            <span className="muted" style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
              {new Date(s.updatedAt).toLocaleString()}
            </span>
          </a>
        ))}
      </div>
    </main>
  );
}
