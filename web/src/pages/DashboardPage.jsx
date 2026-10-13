import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Header } from '../components/Header.jsx';

export function DashboardPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listSessions().then(setSessions).catch((e) => setError(e.message));
  }, []);

  async function run(fn) {
    setError(null);
    setBusy(true);
    try {
      const session = await fn();
      navigate(`/sessions/${session.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <main className="container stack">
        <div className="grid-2">
          <form
            className="card stack"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api.createSession(name.trim()));
            }}
          >
            <h2>Start a session</h2>
            <input placeholder="e.g. Weekend trip" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
            <button className="btn btn-primary" disabled={busy}>Create</button>
          </form>
          <form
            className="card stack"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api.joinSession(code.trim()));
            }}
          >
            <h2>Join with a code</h2>
            <input
              placeholder="ABC123"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              maxLength={12}
              className="mono"
            />
            <button className="btn" disabled={busy}>Join</button>
          </form>
        </div>

        {error && <p className="error">{error}</p>}

        <section className="card">
          <h2>Your sessions</h2>
          {sessions === null ? (
            <p className="muted">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="muted">No sessions yet.</p>
          ) : (
            <ul className="session-list">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link to={`/sessions/${s.id}`}>{s.name}</Link>
                  <span className={`badge ${s.status}`}>{s.status}</span>
                  <span className="muted small">
                    {s.member_count} member{s.member_count === 1 ? '' : 's'} · {s.role}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
