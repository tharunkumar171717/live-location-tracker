import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import { Header } from '../components/Header.jsx';
import { LiveMap } from '../components/LiveMap.jsx';
import { SharePanel } from '../components/SharePanel.jsx';
import { ZonesPanel } from '../components/ZonesPanel.jsx';
import { AlertFeed, AlertToast } from '../components/AlertFeed.jsx';
import { useTrackingSession } from '../tracking/useTrackingSession.js';
import { useGeolocation } from '../tracking/useGeolocation.js';
import { useWakeLock } from '../tracking/useWakeLock.js';
import { bearingDegrees, compassDirection, distanceMeters, formatDistance } from '../lib/geo.js';
import { TRAVEL_MODES, formatDuration } from '../lib/route.js';
import { useRoute } from '../tracking/useRoute.js';
import { useSmoothedPosition } from '../tracking/useSmoothedPosition.js';

export function SessionPage() {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [keepAwake, setKeepAwake] = useState(true);
  // {type:'point', lat, lng} | {type:'member', userId} | null
  const [target, setTarget] = useState(null);
  const [travelMode, setTravelMode] = useState('car');
  const [zones, setZones] = useState([]);
  const [draft, setDraft] = useState(null); // zone being placed
  const [zoneError, setZoneError] = useState(null);

  const live = useTrackingSession(sessionId);
  const ended = live.ended || session?.status === 'ended';
  // GPS runs whenever the session is open so you always see yourself on the
  // map; positions are only sent to the server while sharing.
  const geo = useGeolocation({ enabled: !ended, onPosition: sharing ? live.sendLocation : undefined });
  const wake = useWakeLock(sharing && keepAwake && !ended);

  // Send the fix we already have as soon as sharing starts.
  const { sendLocation } = live;
  useEffect(() => {
    if (sharing && geo.current) sendLocation(geo.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharing, sendLocation]);

  // Your own marker comes straight from the device, not the server round trip.
  const ownFix = geo.current;
  const positions = useMemo(
    () =>
      ownFix
        ? { ...live.positions, [user.id]: { userId: user.id, ...ownFix, recordedAt: ownFix.timestamp } }
        : live.positions,
    [live.positions, ownFix, user.id],
  );

  useEffect(() => {
    api.getSession(sessionId).then(setSession).catch((e) => setLoadError(e.message));
  }, [sessionId]);

  // Zones load on open and whenever any member changes them.
  useEffect(() => {
    api.listGeofences(sessionId).then(setZones).catch(() => {});
  }, [sessionId, live.zonesVersion]);

  const { seedAlerts } = live;
  useEffect(() => {
    api.geofenceEvents(sessionId).then(seedAlerts).catch(() => {});
  }, [sessionId, seedAlerts]);

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
  // Predicted between GPS fixes so distance and markers move continuously.
  const self = useSmoothedPosition(positions[user.id]);
  const memberTarget = useSmoothedPosition(target?.type === 'member' ? positions[target.userId] : null);
  const targetPoint = target?.type === 'member' ? memberTarget : target;
  const mapPositions = useMemo(() => {
    const next = { ...positions };
    if (self) next[user.id] = self;
    if (memberTarget) next[target.userId] = memberTarget;
    return next;
  }, [positions, self, memberTarget, user.id, target]);
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

  // Map clicks place the draft zone while adding one, otherwise set a target.
  const onPick = useCallback(
    (pt) => {
      if (draft) setDraft((d) => ({ ...d, ...pt }));
      else setTarget({ type: 'point', ...pt });
    },
    [draft],
  );

  async function saveZone() {
    setZoneError(null);
    try {
      const zone = await api.createGeofence(sessionId, {
        name: draft.name.trim(),
        lat: draft.lat,
        lng: draft.lng,
        radiusM: draft.radiusM,
      });
      setZones((z) => [...z.filter((x) => x.id !== zone.id), zone]);
      setDraft(null);
    } catch (e) {
      setZoneError(e.message);
    }
  }

  async function deleteZone(id) {
    setZoneError(null);
    try {
      await api.deleteGeofence(sessionId, id);
      setZones((z) => z.filter((x) => x.id !== id));
    } catch (e) {
      setZoneError(e.message);
    }
  }

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
  const expiresIn = session.expires_at ? Math.max(0, Math.round((new Date(session.expires_at) - now) / 60_000)) : null;

  return (
    <>
      <Header />
      <main className="session-layout">
        <aside className="card stack sidebar">
          <Link to="/" className="small">← All sessions</Link>
          <h2>
            {session.name}
            {session.is_demo && <span className="badge demo">demo</span>}
          </h2>
          {session.is_demo && !ended && (
            <p className="hint small">
              Simulated riders are moving around Bengaluru. Try a zone near them, set one as a target,
              or open <Link to={`/sessions/${sessionId}/replay`}>Replay</Link> in a minute.
              {expiresIn != null && ` Ends in ${expiresIn} min.`}
            </p>
          )}
          <p className="small">
            Join code <span className="mono code">{session.join_code}</span>
          </p>
          <p className="small status-line">
            <span className={`dot ${live.status}`} /> {live.status}
            {ended && <span className="badge ended">ended</span>}
            {sharing && !ended && (
              <span className="muted">
                {' '}· {geo.mode === 'idle' ? 'idle, saving battery' : 'moving, live'}
              </span>
            )}
          </p>
          {live.queued > 0 && (
            <p className="hint small">Offline: {live.queued} point{live.queued === 1 ? '' : 's'} saved, will sync on reconnect.</p>
          )}

          {!ended && (
            <>
              <button className={`btn ${sharing ? '' : 'btn-primary'}`} onClick={() => setSharing((s) => !s)}>
                {sharing ? 'Stop sharing my location' : 'Share my location'}
              </button>
              {sharing && wake.supported && (
                <label className="check small">
                  <input type="checkbox" checked={keepAwake} onChange={(e) => setKeepAwake(e.target.checked)} />
                  Keep screen on while sharing{wake.locked ? ' (on)' : ''}
                </label>
              )}
            </>
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
                {self?.accuracy > 20 && (
                  <p className="error small">
                    Weak GPS (±{Math.round(self.accuracy)} m). Small moves won't register; go outdoors and turn on
                    precise location.
                  </p>
                )}
              </>
            )}
          </section>

          <AlertFeed alerts={live.alerts} names={members} />

          <ZonesPanel
            zones={zones}
            draft={draft}
            disabled={ended}
            error={zoneError}
            onStartDraft={() => {
              setZoneError(null);
              setDraft({ name: '', radiusM: 150, lat: null, lng: null });
            }}
            onDraftChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onSave={saveZone}
            onCancel={() => setDraft(null)}
            onDelete={deleteZone}
            canDelete={(z) => isOwner || z.created_by === user.id}
          />

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

          <SharePanel sessionId={sessionId} disabled={ended} />

          <Link className="btn" to={`/sessions/${sessionId}/replay`}>▶ Replay this trip</Link>

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

        <section className={`map-wrap${draft ? ' picking' : ''}`}>
          {/* On phones the sidebar's distance card is scrolled out of view while
              you use the map, so repeat the key numbers on top of the map. */}
          {target && (
            <div className="map-distance">
              <div>
                <strong>
                  {distance != null ? formatDistance(distance) : !self ? 'Waiting for your location…' : 'Waiting…'}
                </strong>
                {nav.progress && <span> · {formatDuration(nav.progress.eta)}</span>}
                <div className="small">
                  to {targetLabel}
                  {distance != null && !nav.progress ? ' · straight line' : ''}
                </div>
              </div>
              <button className="link-btn small" onClick={() => setTarget(null)}>clear</button>
            </div>
          )}
          {draft && draft.lat == null && <div className="map-hint">Click the map to place the zone</div>}
          <AlertToast alerts={live.alerts} names={members} />
          <LiveMap
            positions={mapPositions}
            names={members}
            selfId={user.id}
            target={targetPoint}
            targetIsMember={target?.type === 'member'}
            distance={distance}
            routeCoords={nav.progress?.remainingCoords}
            onPick={onPick}
            geofences={zones}
            draftZone={draft?.lat != null ? draft : null}
          />
        </section>
      </main>
    </>
  );
}
