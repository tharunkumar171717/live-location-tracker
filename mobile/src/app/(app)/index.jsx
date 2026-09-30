import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api } from '../../lib/api.js';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { Button } from '../../components/Button.jsx';
import { colors, ui } from '../../ui.js';

export default function Sessions() {
  const { user, profile } = useAuth();
  const [sessions, setSessions] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setSessions(await api.listSessions());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function go(which, fn) {
    setError(null);
    setBusy(which);
    try {
      const session = await fn();
      setName('');
      setCode('');
      router.push(`/session/${session.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const header = (
    <View style={{ gap: 16, marginBottom: 8 }}>
      <Text style={ui.muted}>Signed in as {profile?.full_name || user?.email}</Text>
      <View style={ui.card}>
        <Text style={ui.h2}>Start a session</Text>
        <TextInput style={ui.input} placeholder="e.g. Weekend trip" value={name} onChangeText={setName} maxLength={100} />
        <Button
          title="Create"
          variant="primary"
          busy={busy === 'create'}
          disabled={!!busy || !name.trim()}
          onPress={() => go('create', () => api.createSession(name.trim()))}
        />
      </View>
      <View style={ui.card}>
        <Text style={ui.h2}>Join with a code</Text>
        <TextInput
          style={[ui.input, { letterSpacing: 2, fontFamily: 'monospace' }]}
          placeholder="ABC123"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={12}
        />
        <Button
          title="Join"
          busy={busy === 'join'}
          disabled={!!busy || code.trim().length < 4}
          onPress={() => go('join', () => api.joinSession(code.trim()))}
        />
      </View>
      {error && <Text style={ui.error}>{error}</Text>}
      <Text style={ui.h2}>Your sessions</Text>
      {sessions?.length === 0 && <Text style={ui.muted}>No sessions yet.</Text>}
    </View>
  );

  return (
    <FlatList
      style={ui.screen}
      contentContainerStyle={ui.content}
      data={sessions || []}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={header}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      renderItem={({ item: s }) => (
        <Pressable style={[ui.card, { gap: 4 }]} onPress={() => router.push(`/session/${s.id}`)}>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <Text style={ui.h2}>{s.name}</Text>
            <Text style={[ui.small, { color: s.status === 'active' ? colors.ok : colors.muted }]}>{s.status}</Text>
          </View>
          <Text style={[ui.muted, ui.small]}>
            {s.member_count} member{s.member_count === 1 ? '' : 's'} · {s.role}
          </Text>
        </Pressable>
      )}
    />
  );
}
