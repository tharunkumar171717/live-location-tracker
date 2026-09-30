import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as aesjs from 'aes-js';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in mobile/.env');

// Sessions exceed SecureStore's 2KB value limit, so store them AES-encrypted
// in AsyncStorage and keep only the per-item key in SecureStore (Keystore).
class LargeSecureStore {
  async encrypt(storageKey, value) {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(storageKey, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encrypted);
  }

  async decrypt(storageKey, value) {
    const keyHex = await SecureStore.getItemAsync(storageKey);
    if (!keyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(keyHex), new aesjs.Counter(1));
    return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(value)));
  }

  async getItem(storageKey) {
    const encrypted = await AsyncStorage.getItem(storageKey);
    return encrypted ? this.decrypt(storageKey, encrypted) : null;
  }

  async setItem(storageKey, value) {
    await AsyncStorage.setItem(storageKey, await this.encrypt(storageKey, value));
  }

  async removeItem(storageKey) {
    await AsyncStorage.removeItem(storageKey);
    await SecureStore.deleteItemAsync(storageKey);
  }
}

export const supabase = createClient(url, key, {
  auth: {
    storage: Platform.OS === 'web' ? AsyncStorage : new LargeSecureStore(),
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Only refresh tokens while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
