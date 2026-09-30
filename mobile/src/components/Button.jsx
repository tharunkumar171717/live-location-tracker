import { ActivityIndicator, Pressable, Text } from 'react-native';
import { colors, ui } from '../ui.js';

export function Button({ title, onPress, variant, disabled, busy, children }) {
  const primary = variant === 'primary';
  const danger = variant === 'danger';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        ui.btn,
        primary && ui.btnPrimary,
        danger && ui.btnDanger,
        (pressed || disabled) && { opacity: 0.7 },
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? '#fff' : colors.text} /> : children}
      <Text style={[ui.btnText, primary && ui.btnTextPrimary, danger && { color: colors.danger }]}>{title}</Text>
    </Pressable>
  );
}
