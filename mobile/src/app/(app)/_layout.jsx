import { Pressable, Text } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { colors } from '../../ui.js';

export default function AppLayout() {
  const { signOut } = useAuth();
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: 'Sessions',
          headerRight: () => (
            <Pressable onPress={signOut} hitSlop={8}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>Log out</Text>
            </Pressable>
          ),
        }}
      />
      <Stack.Screen name="session/[id]" options={{ title: 'Session' }} />
    </Stack>
  );
}
