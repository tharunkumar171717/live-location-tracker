import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const TTL_LABELS = { 15: '15 min', 60: '1 hour', 240: '4 hours', 480: '8 hours', 1440: '24 hours' };

function remaining(expiresAt) {
  const min = Math.max(0, Math.round((new Date(expiresAt) - Date.now()) / 60_000));
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m left` : `${min} min left`;
}

// View-only links: anyone with the link can watch until it expires, no account needed.
export function SharePanel({ sessionId, disabled }) {
  const [links, setLinks] = useState([]);
  const [ttl, setTtl] = useState(60);
  const [fresh, setFresh] = useState(null); // {id, url} shown once
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    api.listShares(sessionId).then((r) => setLinks(r.links)).catch((e) => setError(e.message));
  }, [sessionId]);
  useEffect(refresh, [refresh]);

  async function create() {
    setError(null);
    setCopied(false);
    try {
      const link = await api.createShare(sessionId, ttl);
      setFresh({ id: link.id, url: `${window.location.origin}/share/${link.token}` });
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function copy() {
    try {
      if (navigator.share && /Mobi/.test(navigator.userAgent)) {
        await navigator.share({ title: 'Watch my live location', url: fresh.url });
      } else {
        await navigator.clipboard.writeText(fresh.url);
        setCopied(true);
      }
    } catch {
      // user cancelled the share sheet
    }
  }

  async function revoke(id) {
    await api.revokeShare(sessionId, id).catch((e) => setError(e.message));
    if (fresh?.id === id) setFresh(null);
    refresh();
  }

  return (
    <section className="panel">
      <h3>Share view-only link</h3>
      {!disabled && (
        <div className="row">
          <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))} aria-label="Link expires after">
            {Object.entries(TTL_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
          <button className="btn btn-small" onClick={create}>Create link</button>
        </div>
      )}
      {fresh && (
        <div className="share-fresh">
          <input readOnly value={fresh.url} onFocus={(e) => e.target.select()} aria-label="Share link" />
          <button className="btn btn-small btn-primary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      )}
      {links.length > 0 && (
        <ul className="plain-list">
          {links.map((l) => (
            <li key={l.id} className="small">
              <span className="muted">by {l.created_by_name || 'member'} · {remaining(l.expires_at)}</span>
              <button className="link-btn small" onClick={() => revoke(l.id)}>revoke</button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
