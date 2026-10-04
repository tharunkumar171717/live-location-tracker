import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setLoading(false);
      if (event === 'SIGNED_OUT') setProfile(null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Create/update the profile once per signed-in user (email or Google).
  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) return;
    // Defer out of the auth callback; supabase-js warns against awaiting
    // other Supabase calls inside onAuthStateChange.
    const t = setTimeout(() => {
      api.upsertProfile().then(setProfile).catch((err) => console.error('profile upsert failed', err));
    }, 0);
    return () => clearTimeout(t);
  }, [userId]);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      signInWithGoogle: () =>
        supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        }),
      signInWithGoogleIdToken: (token, nonce) =>
        supabase.auth.signInWithIdToken({ provider: 'google', token, nonce }),
      signInWithPassword: (email, password) => supabase.auth.signInWithPassword({ email, password }),
      signUp: (email, password, fullName) =>
        supabase.auth.signUp({
          email,
          password,
          options: {
            data: fullName ? { full_name: fullName } : undefined,
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        }),
      signOut: () => supabase.auth.signOut(),
    }),
    [session, profile, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
