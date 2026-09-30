import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#f6f7f9',
  card: '#fff',
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  primary: '#2563eb',
  danger: '#dc2626',
  ok: '#16a34a',
};

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 16 },
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12 },
  h1: { fontSize: 28, fontWeight: '700', color: colors.text },
  h2: { fontSize: 17, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted },
  small: { fontSize: 13 },
  error: { color: colors.danger },
  notice: { color: colors.ok },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, backgroundColor: '#fff' },
  btn: { borderRadius: 8, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', flexDirection: 'row', gap: 8 },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnDanger: { borderColor: colors.danger },
  btnText: { fontSize: 16, fontWeight: '500', color: colors.text },
  btnTextPrimary: { color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
