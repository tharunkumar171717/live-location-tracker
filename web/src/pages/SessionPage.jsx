import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import { Header } from '../components/Header.jsx';
import { LiveMap } from '../components/LiveMap.jsx';
import { useTrackingSession } from '../tracking/useTrackingSession.js';
import { useGeolocation } from '../tracking/useGeolocation.js';
import { bearingDegrees, compassDirection, distanceMeters, formatDistance } from '../lib/geo.js';
import { TRAVEL_MODES, formatDuration } from '../lib/route.js';
import { useRoute } from '../tracking/useRoute.js';

export function SessionPage() {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sharing, setSharing] = useState(false);
  // {type:'point', lat, lng} | {type:'member', userId} | null
  const [target, setTarget] = useState(null);
  const [travelMode, setTravelMode] = useState('car');

  const live = useTrackingSession(sessionId);
  const ended = live.ended || session?.status === 'ended';
  // GPS runs whenever the session is open so you always see yourself on the
  // map; positions are only sent to the server while sharing.
  const geo = useGeolocation({ enabled: !ended, onPosition: sharing ? live.sendLocation : undefined });

  // Send the fix we already have as soon as sharing starts.
  const { sendLocation } = live;
  useEffect(() => {
    if (sharing && geo.current) sendLocation(geo.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharing, sendLocation]);

  // Your own marker comes straight from the device, not the server round trip.
  const positions = useMemo(
    () =>
      geo.current
        ? { ...live.positions, [user.id]: { userId: user.id, ...geo.current, recordedAt: geo.current.timestamp } }
        : live.positions,
    [live.positions, geo.current, user.id],
  );

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

  // A member target follows that member as their location updates.
  const self = positions[user.id];
  const targetPoint = target?.type === 'member' ? positions[target.userId] : target;
  const straight = self && targetPoint ? distanceMeters(self, targetPoint) : null;
  const nav = useRoute(self, targetPoint, travelMode);
  // Road distance when we have a route, straight line otherwise.
  const distance = nav.progress ? nav.progress.remaining : straight;

  // Re-render every second so "GPS updated Ns ago" stays current.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const gpsAge = self?.recordedAt ? Math.max(0, Math.round((now - new Date(self.recordedAt)) / 1000)) : null;

  const targetLabel = target?.type === 'member' ? members[target.userId] || 'Member' : 'Map point';

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

          <section className="target-card">
            <h3>Distance</h3>
            {!target ? (
              <p className="muted small">Click the map, or pick a member below, to set a target.</p>
            ) : (
              <>
                <p className="small">
                  To <strong>{targetLabel}</strong>{' '}
                  <button className="link-btn small" onClick={() => setTarget(null)}>clear</button>
                </p>
                <div className="mode-tabs" role="tablist">
                  {Object.entries(TRAVEL_MODES).map(([key, m]) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={travelMode === key}
                      className={travelMode === key ? 'active' : ''}
                      onClick={() => setTravelMode(key)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {!self || !targetPoint ? (
                  <p className="muted small">
                    {!self ? 'Waiting for your location…' : 'Waiting for their location…'}
                  </p>
                ) : nav.progress ? (
                  <>
                    <p className="distance">
                      {formatDistance(nav.progress.remaining)}
                      <span className="distance-sub"> · {formatDuration(nav.progress.eta)}</span>
                    </p>
                    <p className="muted small">
                      by road{nav.rerouting ? ' · rerouting…' : ''} · {formatDistance(straight)} straight line{' '}
                      {compassDirection(bearingDegrees(self, targetPoint))}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="distance">
                      {formatDistance(straight)}
                      <span className="muted small"> {compassDirection(bearingDegrees(self, targetPoint))}</span>
                    </p>
                    <p className={`small ${nav.error ? 'error' : 'muted'}`}>
                      straight line · {nav.error || (nav.loading ? 'finding road route…' : 'no road route')}
                    </p>
                  </>
                )}
                {self && (
                  <p className="muted small">
                    GPS {gpsAge != null ? `updated ${gpsAge}s ago` : 'waiting'}
                    {self.accuracy > 0 ? ` · ±${Math.round(self.accuracy)} m` : ''}
                  </p>
                )}
              </>
            )}
          </section>

          <h3>Members</h3>
          <ul className="member-list">
            {session.members.map((m) => {
              const p = positions[m.user_id];
              return (
                <li key={m.user_id}>
                  <strong>{m.user_id === user.id ? 'You' : members[m.user_id]}</strong>
                  {m.role === 'owner' && <span className="badge">owner</span>}
                  {m.user_id !== user.id && (
                    <button
                      className="link-btn small"
                      onClick={() => setTarget({ type: 'member', userId: m.user_id })}
                    >
                      {target?.userId === m.user_id ? 'target' : 'set as target'}
                    </button>
                  )}
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
          <LiveMap
            positions={positions}
            names={members}
            selfId={user.id}
            target={targetPoint}
            targetIsMember={target?.type === 'member'}
            distance={distance}
            routeCoords={nav.progress?.remainingCoords}
            onPickTarget={(pt) => setTarget({ type: 'point', ...pt })}
          />
        </section>
      </main>
    </>
  );
}
