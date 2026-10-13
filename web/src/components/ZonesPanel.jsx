import { useState } from 'react';

const RADII = [100, 150, 250, 500, 1000];

// Zones (geofences): members get an alert when someone enters or leaves one.
// Placing one: press "Add zone", click the map, name it, save.
export function ZonesPanel({ zones, draft, onStartDraft, onDraftChange, onSave, onCancel, onDelete, canDelete, disabled, error }) {
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h3>Zones</h3>
      {zones.length === 0 && !draft && <p className="muted small">Get an alert when someone arrives or leaves.</p>}
      <ul className="plain-list">
        {zones.map((z) => (
          <li key={z.id} className="small">
            <span><span className="zone-dot" /> {z.name} <span className="muted">· {Math.round(z.radius_m)} m</span></span>
            {canDelete(z) && (
              <button className="link-btn small" onClick={() => onDelete(z.id)}>delete</button>
            )}
          </li>
        ))}
      </ul>

      {draft ? (
        <form className="stack-tight" onSubmit={save}>
          {draft.lat == null ? (
            <p className="hint small">Click the map to place the zone.</p>
          ) : (
            <>
              <input
                autoFocus
                placeholder="e.g. Office"
                maxLength={60}
                required
                value={draft.name}
                onChange={(e) => onDraftChange({ name: e.target.value })}
              />
              <div className="row">
                <select
                  value={draft.radiusM}
                  onChange={(e) => onDraftChange({ radiusM: Number(e.target.value) })}
                  aria-label="Radius"
                >
                  {RADII.map((r) => (
                    <option key={r} value={r}>{r} m</option>
                  ))}
                </select>
                <button className="btn btn-small btn-primary" disabled={busy}>Save</button>
              </div>
            </>
          )}
          <button type="button" className="link-btn small" onClick={onCancel}>cancel</button>
        </form>
      ) : (
        !disabled && (
          <button className="btn btn-small" onClick={onStartDraft}>+ Add zone</button>
        )
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
