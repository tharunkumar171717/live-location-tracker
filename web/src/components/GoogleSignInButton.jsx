// Google Identity Services button. Google hands the ID token straight to this
// page, so the account chooser shows our own origin instead of the Supabase
// project domain that the OAuth redirect flow exposes.
import { useEffect, useRef } from 'react';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
let gsiPromise;

function loadGsi() {
  gsiPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => {
      gsiPromise = null;
      reject(new Error('Could not load Google sign-in'));
    };
    document.head.appendChild(script);
  });
  return gsiPromise;
}

// Supabase gets the raw nonce; Google gets its SHA-256 hash and embeds it in
// the ID token, so a replayed token can't be used for another sign-in.
async function makeNonce() {
  const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hashed = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { raw, hashed };
}

export function GoogleSignInButton({ clientId, onCredential, onError }) {
  const ref = useRef(null);
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };

  useEffect(() => {
    let cancelled = false;

    Promise.all([loadGsi(), makeNonce()])
      .then(([google, nonce]) => {
        if (cancelled || !ref.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          nonce: nonce.hashed,
          callback: ({ credential }) => handlers.current.onCredential(credential, nonce.raw),
        });
        google.accounts.id.renderButton(ref.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          width: Math.min(400, ref.current.offsetWidth || 400),
        });
      })
      .catch((err) => !cancelled && handlers.current.onError(err));

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return <div ref={ref} className="google-button" />;
}
