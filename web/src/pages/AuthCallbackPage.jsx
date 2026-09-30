import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';

// Google (via Supabase) redirects here with ?code=...; supabase-js exchanges
// it for a session on load. We just wait for the session, then move on.
export function AuthCallbackPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [error] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    return params.get('error_description') || hash.get('error_description');
  });
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (session) navigate('/', { replace: true });
  }, [session, navigate]);

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 10_000);
    return () => clearTimeout(t);
  }, []);

  if (error || timedOut) {
    return (
      <div className="center stack">
        <p className="error">{error || 'Sign-in did not complete.'}</p>
        <Link to="/login">Back to sign in</Link>
      </div>
    );
  }
  return <div className="center muted">Signing you in…</div>;
}
