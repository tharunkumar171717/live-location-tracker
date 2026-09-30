import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import { Header } from '../components/Header.jsx';
import { LiveMap } from '../components/LiveMap.jsx';
import { useTrackingSession } from '../tracking/useTrackingSession.js';
import { useGeolocation } from '../tracking/useGeolocation.js';

export function SessionPage() {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sharing, setSharing] = useState(false);

  const live = useTrackingSession(sessionId);
  const ended = live.ended || session?.status === 'ended';
  const geo = useGeolocation({ enabled: sharing && !ended, onPosition: live.sendLocation });

  useEffect(() => {
    api.getSession(sessionId).then(setSession).catch((e) => setLoadError(e.message));
  }, [sessionId]);

  // A new member may have joined since we loaded the roster. Refetch once
  // per unknown user (they may also have left, so don't loop).
  const requested = useRef(new Set());
  useEffect(() => {
    if (!session) return;
    const known = new Set(session.members.map((m) => m.user_id));
    const unknown = Object.keys(live.positions).filter((id) => !known.has(id) && !requested.current.has(id));
    if (unknown.length === 0) return;
    unknown.forEach((id) => requested.current.add(id));
    api.getSession(sessionId).then(setSession).catch(() => {});
  }, [live.positions, session, sessionId]);

  const members = useMemo(
    () =>
      Object.fromEntries(
        (session?.members || []).map((m) => [m.user_id, m.full_name || m.email || 'Member']),
      ),
    [session],
  );

  if (loadError) {
    return (
      <>
        <Header />
        <main className="container stack">
          <p className="error">{loadError}</p>
          <Link to="/">Back</Link>
        </main>
      </>
    );
  }
  if (!session) return <><Header /><div className="center muted">Loading…</div></>;

  const isOwner = session.role === 'owner';

  return (
    <>
      <Header />
      <main className="session-layout">
        <aside className="card stack sidebar">
          <Link to="/" className="small">← All sessions</Link>
          <h2>{session.name}</h2>
          <p className="small">
            Join code <span className="mono code">{session.join_code}</span>
          </p>
          <p className="small">
            <span className={`dot ${live.status}`} /> {live.status}
            {ended && <span className="badge ended">ended</span>}
          </p>

          {!ended && (
            <button className={`btn ${sharing ? '' : 'btn-primary'}`} onClick={() => setSharing((s) => !s)}>
              {sharing ? 'Stop sharing my location' : 'Share my location'}
            </button>
          )}
          {geo.error && <p className="error small">{geo.error}</p>}
          {live.error && <p className="error small">{live.error}</p>}

          <h3>Members</h3>
          <ul className="member-list">
            {session.members.map((m) => {
              const p = live.positions[m.user_id];
              return (
                <li key={m.user_id}>
                  <strong>{m.user_id === user.id ? 'You' : members[m.user_id]}</strong>
                  {m.role === 'owner' && <span className="badge">owner</span>}
                  <div className="muted small">
                    {p ? `updated ${new Date(p.recordedAt).toLocaleTimeString()}` : 'no location yet'}
                  </div>
                </li>
              );
            })}
          </ul>

          {!ended && isOwner && (
            <button
              className="btn btn-danger"
              onClick={async () => {
                if (!confirm('End this session for everyone?')) return;
                setSession(await api.endSession(sessionId).then((s) => ({ ...session, ...s })));
                setSharing(false);
              }}
            >
              End session
            </button>
          )}
          {!isOwner && (
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await api.leaveSession(sessionId);
                navigate('/');
              }}
            >
              Leave session
            </button>
          )}
        </aside>

        <section className="map-wrap">
          <LiveMap positions={live.positions} names={members} selfId={user.id} />
        </section>
      </main>
    </>
  );
}
