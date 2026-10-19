import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../theme';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

export default function Btn({ label, onPress, variant = 'primary', disabled = false }: Props) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        primary ? styles.primary : styles.secondary,
        (pressed || disabled) && styles.dim,
      ]}
    >
      <Text style={[styles.label, primary ? styles.labelPrimary : styles.labelSecondary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 10 },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.primary },
  dim: { opacity: 0.55 },
  label: { fontSize: 17, fontWeight: '600' },
  labelPrimary: { color: '#FFFFFF' },
  labelSecondary: { color: colors.primary },
});