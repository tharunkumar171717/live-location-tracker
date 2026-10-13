import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, publicApi } from '../lib/api.js';

// /demo: no sign-in. Gets a short-lived view link to the public demo session
// and opens it.
export function PublicDemoPage() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in dev
    started.current = true;
    publicApi
      .demoLink()
      .then(({ token }) => navigate(`/share/${token}`, { replace: true }))
      .catch((e) => setError(e.message));
  }, [navigate]);

  return (
    <div className="center stack">
      <img src="/logo.svg" alt="" width="56" height="56" />
      {error ? (
        <>
          <p className="error">{error}</p>
          <Link to="/login">Back</Link>
        </>
      ) : (
        <p className="muted">Starting the live demo…</p>
      )}
    </div>
  );
}

// /start-demo (signed in, incl. guests): creates a private demo session with
// simulated riders, then opens it.
export function StartDemoPage() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .startDemo()
      .then((s) => navigate(`/sessions/${s.id}`, { replace: true }))
      .catch((e) => setError(e.message));
  }, [navigate]);

  return (
    <div className="center stack">
      {error ? (
        <>
          <p className="error">{error}</p>
          <Link to="/">Back</Link>
        </>
      ) : (
        <p className="muted">Setting up your demo session…</p>
      )}
    </div>
  );
}
