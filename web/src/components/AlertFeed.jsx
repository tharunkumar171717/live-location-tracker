import { useEffect, useRef, useState } from 'react';
import { colorFor } from './LiveMap.jsx';

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - new Date(ts)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function text(a, names) {
  const who = names[a.userId] || 'Someone';
  return a.kind === 'enter' ? `${who} arrived at ${a.name}` : `${who} left ${a.name}`;
}

// Zone alerts: a list in the sidebar plus a toast on the map for new ones.
export function AlertFeed({ alerts, names }) {
  if (alerts.length === 0) return null;
  return (
    <section className="panel">
      <h3>Alerts</h3>
      <ul className="plain-list alerts">
        {alerts.slice(0, 8).map((a) => (
          <li key={a.id} className="small">
            <span className="alert-dot" style={{ background: colorFor(a.userId) }} />
            <span>{text(a, names)}</span>
            <span className="muted"> · {ago(a.occurredAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AlertToast({ alerts, names }) {
  const [shown, setShown] = useState(null);
  const lastId = useRef(alerts[0]?.id);

  useEffect(() => {
    const newest = alerts[0];
    if (!newest || newest.id === lastId.current) return;
    lastId.current = newest.id;
    // Only toast live events, not history loaded on open.
    if (Date.now() - new Date(newest.occurredAt) > 30_000) return;
    setShown(newest);
    const t = setTimeout(() => setShown(null), 5000);
    return () => clearTimeout(t);
  }, [alerts]);

  if (!shown) return null;
  return (
    <div className={`toast ${shown.kind}`} role="status">
      {shown.kind === 'enter' ? '📍' : '🚶'} {text(shown, names)}
    </div>
  );
}
