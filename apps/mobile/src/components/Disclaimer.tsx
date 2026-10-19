import { StyleSheet, Text } from 'react-native';
import { DISCLAIMER } from '@verifyrx/decision';
import { colors } from '../theme';

export default function Disclaimer() {
  return <Text style={styles.text}>{DISCLAIMER}</Text>;
}

const styles = StyleSheet.create({
  text: { fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 14 },
});