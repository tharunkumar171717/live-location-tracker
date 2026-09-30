import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthProvider.jsx';
import { Button } from '../components/Button.jsx';
import { colors, ui } from '../ui.js';

export default function Login() {
  const { signInWithGoogle, signInWithPassword, signUp } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function run(which, fn) {
    setError(null);
    setNotice(null);
    setBusy(which);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const submit = () =>
    run('form', async () => {
      if (mode === 'signin') return signInWithPassword(email.trim(), password);
      const { needsConfirmation } = await signUp(email.trim(), password, fullName.trim());
      if (needsConfirmation) setNotice('Check your email to confirm your account, then sign in.');
    });

  return (
    <SafeAreaView style={ui.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[ui.content, { flexGrow: 1, justifyContent: 'center' }]} keyboardShouldPersistTaps="handled">
          <View style={ui.card}>
            <Text style={ui.h1}>G-Map</Text>
            <Text style={ui.muted}>Live location sharing</Text>

            <Button title="Continue with Google" onPress={() => run('google', signInWithGoogle)} busy={busy === 'google'} disabled={!!busy} />

            <View style={[ui.row, { marginVertical: 4 }]}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              <Text style={[ui.muted, ui.small]}>or</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            </View>

            {mode === 'signup' && (
              <TextInput style={ui.input} placeholder="Name" value={fullName} onChangeText={setFullName} autoComplete="name" />
            )}
            <TextInput
              style={ui.input}
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
            />
            <TextInput
              style={ui.input}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              onSubmitEditing={submit}
            />
            {error && <Text style={ui.error}>{error}</Text>}
            {notice && <Text style={ui.notice}>{notice}</Text>}
            <Button
              title={mode === 'signin' ? 'Sign in' : 'Create account'}
              variant="primary"
              onPress={submit}
              busy={busy === 'form'}
              disabled={!!busy || !email || password.length < 6}
            />

            <Pressable
              onPress={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError(null);
                setNotice(null);
              }}
            >
              <Text style={[ui.small, { color: colors.primary, textAlign: 'center' }]}>
                {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
