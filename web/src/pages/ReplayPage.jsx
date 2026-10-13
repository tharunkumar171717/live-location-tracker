import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Header } from '../components/Header.jsx';
import { LiveMap, colorFor } from '../components/LiveMap.jsx';
import { formatClock, formatSpan, positionAt, trailUntil } from '../lib/replay.js';

const SPEEDS = [1, 10, 30, 60, 120];

// Scrub through a session's history: everyone's trail and position at time t.
export function ReplayPage() {
  const { sessionId } = useParams();
  const [data, setData] = useState(null);
  const [session, setSession] = useState(null);
  const [zones, setZones] = useState([]);
  const [error, setError] = useState(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);

  useEffect(() => {
    Promise.all([api.replay(sessionId), api.getSession(sessionId), api.listGeofences(sessionId)])
      .then(([replay, s, z]) => {
        setData(replay);
        setSession(s);
        setZones(z);
        setT(replay.startedAt ?? 0);
      })
      .catch((e) => setError(e.message));
  }, [sessionId]);

  // Advance the clock in real time x speed while playing.
  const last = useRef(null);
  useEffect(() => {
    if (!playing || !data) return;
    let raf;
    const step = (now) => {
      const dt = last.current == null ? 0 : now - last.current;
      last.current = now;
      setT((prev) => {
        const next = prev + dt * speed;
        if (next >= data.endedAt) {
          setPlaying(false);
          return data.endedAt;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [playing, speed, data]);

  const names = useMemo(
    () => Object.fromEntries((session?.members || []).map((m) => [m.user_id, m.full_name || m.email || 'Member'])),
    [session],
  );

  const { positions, trails } = useMemo(() => {
    const positions = {};
    const trails = {};
    for (const [userId, track] of Object.entries(data?.tracks || {})) {
      const p = positionAt(track, t);
      if (p) positions[userId] = { userId, lat: p.lat, lng: p.lng, stale: p.stale };
      trails[userId] = trailUntil(track, t);
    }
    return { positions, trails };
  }, [data, t]);

  // Fit the whole trip, not just where people are at the start.
  const fitPoints = useMemo(() => {
    const pts = [];
    for (const track of Object.values(data?.tracks || {})) {
      const step = Math.max(1, Math.floor(track.length / 50));
      for (let i = 0; i < track.length; i += step) pts.push({ lat: track[i][1], lng: track[i][2] });
    }
    return pts;
  }, [data]);

  if (error) {
    return (
      <>
        <Header />
        <main className="container stack">
          <p className="error">{error}</p>
          <Link to={`/sessions/${sessionId}`}>Back</Link>
        </main>
      </>
    );
  }
  if (!data || !session) return <><Header /><div className="center muted">Loading…</div></>;

  const empty = data.points === 0;
  const duration = (data.endedAt ?? 0) - (data.startedAt ?? 0);

  return (
    <>
      <Header />
      <main className="session-layout">
        <aside className="card stack sidebar">
          <Link to={`/sessions/${sessionId}`} className="small">← Back to live view</Link>
          <h2>Replay · {session.name}</h2>
          {empty ? (
            <p className="muted small">No locations recorded yet. Share your location, then come back.</p>
          ) : (
            <>
              <p className="muted small">
                {formatClock(data.startedAt)} – {formatClock(data.endedAt)} · {formatSpan(duration)} ·{' '}
                {data.points.toLocaleString()} points
                {data.thinnedBy > 1 && ` (every ${data.thinnedBy}th shown)`}
              </p>
              <p className="replay-clock">{formatClock(t)}</p>
              <input
                type="range"
                className="scrubber"
                min={data.startedAt}
                max={data.endedAt}
                step={1000}
                value={t}
                onChange={(e) => setT(Number(e.target.value))}
                aria-label="Replay time"
              />
              <div className="row">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    if (t >= data.endedAt) setT(data.startedAt);
                    setPlaying((p) => !p);
                  }}
                >
                  {playing ? '❚❚ Pause' : '▶ Play'}
                </button>
                <div className="mode-tabs" role="tablist" aria-label="Playback speed">
                  {SPEEDS.map((s) => (
                    <button key={s} role="tab" aria-selected={speed === s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)}>
                      {s}×
                    </button>
                  ))}
                </div>
              </div>
              <h3>People</h3>
              <ul className="member-list">
                {Object.keys(data.tracks).map((id) => (
                  <li key={id}>
                    <span className="alert-dot" style={{ background: colorFor(id) }} /> <strong>{names[id] || 'Member'}</strong>
                    <div className="muted small">
                      {positions[id] ? (positions[id].stale ? 'paused' : 'moving') : 'not started yet'}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
        <section className="map-wrap">
          <LiveMap positions={positions} names={names} trails={trails} geofences={zones} fitPoints={fitPoints} />
        </section>
      </main>
    </>
  );
}
