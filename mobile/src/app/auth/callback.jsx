import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { Redirect } from 'expo-router';
import { completeOAuthFromUrl, useAuth } from '../../auth/AuthProvider.jsx';

// Deep-link target for gmap://auth/callback?code=... (OAuth and email confirmation).
export default function AuthCallback() {
  const url = Linking.useLinkingURL();
  const { session } = useAuth();
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!url) return;
    completeOAuthFromUrl(url)
      .catch((e) => setError(e.message))
      .finally(() => setDone(true));
  }, [url]);

  if (session) return <Redirect href="/" />;
  if (error || (done && !session)) return <Redirect href="/login" />;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <ActivityIndicator />
      <Text>Signing you in…</Text>
    </View>
  );
}
