import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';

// gmap://auth/callback in a dev build; exp://.../--/auth/callback in Expo Go.
// Both must be listed in Supabase -> Auth -> URL Configuration -> Redirect URLs.
export const redirectTo = Linking.createURL('auth/callback');

// The OAuth redirect can reach us twice on Android (as the browser result and
// as a deep link to /auth/callback). Codes are single-use, so exchange once.
const exchanged = new Set();
export async function completeOAuthFromUrl(url) {
  const { queryParams } = Linking.parse(url);
  if (queryParams?.error_description) throw new Error(String(queryParams.error_description));
  const code = queryParams?.code;
  if (!code || exchanged.has(code)) return;
  exchanged.add(code);
  const { error } = await supabase.auth.exchangeCodeForSession(String(code));
  if (error) throw error;
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setLoading(false);
      if (event === 'SIGNED_OUT') setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) return;
    const t = setTimeout(() => {
      api.upsertProfile().then(setProfile).catch((err) => console.warn('profile upsert failed', err.message));
    }, 0);
    return () => clearTimeout(t);
  }, [userId]);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      async signInWithGoogle() {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error) throw error;
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type === 'success') await completeOAuthFromUrl(result.url);
      },
      async signInWithPassword(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signUp(email, password, fullName) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: fullName ? { full_name: fullName } : undefined,
            emailRedirectTo: redirectTo,
          },
        });
        if (error) throw error;
        return { needsConfirmation: !data.session };
      },
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
