import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { publicApi } from '../lib/api.js';
import { LiveMap, colorFor } from '../components/LiveMap.jsx';
import { AlertFeed, AlertToast } from '../components/AlertFeed.jsx';
import { useTrackingSession } from '../tracking/useTrackingSession.js';
import { useSmoothedPositions } from '../tracking/useSmoothedPosition.js';

// View-only page for a share link. No account, no sending, just watching.
export function SharePage() {
  const { token } = useParams();
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const live = useTrackingSession(null, { shareToken: token });

  useEffect(() => {
    publicApi.share(token).then(setView).catch((e) => setLoadError(e.message));
  }, [token, live.zonesVersion]);

  const { seedAlerts } = live;
  useEffect(() => {
    publicApi.shareEvents(token).then(seedAlerts).catch(() => {});
  }, [token, seedAlerts]);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const names = useMemo(
    () => Object.fromEntries((view?.session.members || []).map((m) => [m.user_id, m.full_name])),
    [view],
  );
  const positions = useSmoothedPositions(live.positions);

  const gone = live.status === 'expired' || live.error;
  if (loadError || (gone && !view)) {
    return (
      <div className="center stack">
        <img src="/logo.svg" alt="" width="56" height="56" />
        <p className="error">{loadError || live.error}</p>
        <Link to="/demo">Watch the live demo instead</Link>
      </div>
    );
  }
  if (!view) return <div className="center muted">Loading…</div>;

  const minutesLeft = Math.max(0, Math.round((new Date(view.expiresAt) - now) / 60_000));
  const isDemo = view.session.is_demo;

  return (
    <div className="share-layout">
      <header className="header">
        <Link to="/" className="brand"><img src="/logo.svg" alt="" width="24" height="24" /> G-Map</Link>
        <span className="badge">view-only</span>
      </header>
      <main className="session-layout">
        <aside className="card stack sidebar">
          <h2>
            {view.session.name}
            {isDemo && <span className="badge demo">demo</span>}
          </h2>
          <p className="small status-line">
            <span className={`dot ${live.status}`} /> {gone ? 'link closed' : live.status}
            <span className="muted"> · link expires in {minutesLeft} min</span>
          </p>
          {live.error && <p className="error small">{live.error}</p>}
          {live.ended && <p className="muted small">This session has ended.</p>}
          {isDemo && (
            <p className="hint small">
              These riders are simulated, moving along real Bengaluru roads in real time. Watch for zone
              alerts as they pass the dashed circles.
            </p>
          )}

          <AlertFeed alerts={live.alerts} names={names} />

          <h3>People</h3>
          <ul className="member-list">
            {view.session.members
              // Simulated members without a position (the demo's host) are just noise.
              .filter((m) => !(m.is_bot && !live.positions[m.user_id]))
              .map((m) => {
              const p = live.positions[m.user_id];
              return (
                <li key={m.user_id}>
                  <span className="alert-dot" style={{ background: colorFor(m.user_id) }} /> <strong>{m.full_name}</strong>
                  <div className="muted small">
                    {p
                      ? `updated ${new Date(p.recordedAt).toLocaleTimeString()}${p.speed ? ` · ${Math.round(p.speed * 3.6)} km/h` : ''}`
                      : 'no location yet'}
                  </div>
                </li>
              );
            })}
          </ul>

          {isDemo && (
            <div className="cta">
              <p className="small">Want your own session with these riders, zones and replay?</p>
              <Link className="btn btn-primary" to="/login">Try it free</Link>
            </div>
          )}
        </aside>
        <section className="map-wrap">
          <AlertToast alerts={live.alerts} names={names} />
          <LiveMap positions={positions} names={names} geofences={view.geofences} />
        </section>
      </main>
    </div>
  );
}
