import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { GoogleSignInButton } from '../components/GoogleSignInButton.jsx';

// With a client ID, Google signs in on this page and shows our own domain.
// Without one, fall back to the Supabase redirect flow.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function LoginPage() {
  const { signInWithGoogle, signInWithGoogleIdToken, signInWithPassword, signUp } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function onGoogle() {
    setError(null);
    setBusy(true);
    const { error } = await signInWithGoogle();
    // On success the browser navigates to Google, so only errors land here.
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  async function onGoogleCredential(credential, nonce) {
    setError(null);
    setBusy(true);
    const { error } = await signInWithGoogleIdToken(credential, nonce);
    // On success AuthProvider picks up the session; PublicOnlyRoute redirects.
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await signInWithPassword(email, password);
        if (error) throw error;
        // AuthProvider picks up the session; PublicOnlyRoute redirects.
      } else {
        const { data, error } = await signUp(email, password, fullName.trim());
        if (error) throw error;
        if (!data.session) setNotice('Check your email to confirm your account, then sign in.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h1>G-Map</h1>
        <p className="muted">Live location sharing</p>

        {GOOGLE_CLIENT_ID ? (
          <GoogleSignInButton
            clientId={GOOGLE_CLIENT_ID}
            onCredential={onGoogleCredential}
            onError={(err) => setError(err.message)}
          />
        ) : (
          <button className="btn btn-google" onClick={onGoogle} disabled={busy}>
            <GoogleIcon /> Continue with Google
          </button>
        )}

        <div className="divider"><span>or</span></div>

        <form onSubmit={onSubmit} className="stack">
          {mode === 'signup' && (
            <label>
              Name
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
            </label>
          )}
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </label>
          {error && <p className="error">{error}</p>}
          {notice && <p className="notice">{notice}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="muted small">
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <button
            className="link"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError(null);
              setNotice(null);
            }}
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
