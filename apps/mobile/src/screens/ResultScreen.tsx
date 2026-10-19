import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NO_OFFLINE_DATA_NOTE, OFFLINE_NOTE, REASON_COPY, STATE_COPY } from '@verifyrx/decision';
import Btn from '../components/Btn';
import Disclaimer from '../components/Disclaimer';
import { fmtDate } from '../lib/format';
import type { Outcome } from '../lib/types';
import { colors, stateColor, stateSymbol } from '../theme';

interface Props {
  outcome: Outcome;
  code: string;
  backLabel: string;
  onBack: () => void;
  onReport: () => void;
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function ResultScreen({ outcome, code, backLabel, onBack, onReport }: Props) {
  const insets = useSafeAreaInsets();
  const { result, offline, noData, syncedAt } = outcome;
  const copy = STATE_COPY[result.state];
  const { product, batch } = result;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
      <View style={[styles.hero, { backgroundColor: stateColor[result.state], paddingTop: insets.top + 28 }]}>
        <Text style={styles.symbol}>{stateSymbol[result.state]}</Text>
        <Text style={styles.headline}>{copy.headline}</Text>
      </View>

      <View style={styles.body}>
        {offline && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              {noData ? NO_OFFLINE_DATA_NOTE : OFFLINE_NOTE}
              {!noData && syncedAt ? ` Saved data from ${fmtDate(syncedAt)}.` : ''}
            </Text>
          </View>
        )}

        <Text style={styles.p}>{copy.explanation}</Text>

        {result.state === 'SUSPICIOUS' && result.reasons.length > 0 && (
          <View>
            <Text style={styles.h}>Why</Text>
            {result.reasons.map((r) => (
              <Text key={r} style={styles.p}>
                {'\u2022 '}
                {REASON_COPY[r]}
              </Text>
            ))}
          </View>
        )}

        {product && batch && (
          <View style={styles.card}>
            <Row label="Product" value={product.name} />
            <Row label="Manufacturer" value={product.manufacturer} />
            <Row label="NAFDAC reg. no." value={product.nafdac_reg_no} />
            <Row label="Active ingredient" value={product.active_ingredient} />
            <Row label="Strength" value={product.strength} />
            <Row label="Batch" value={batch.batch_no} />
            <Row label="Made" value={batch.mfg_date} />
            <Row label="Expires" value={batch.expiry_date} />
          </View>
        )}

        <Text style={styles.h}>What to do next</Text>
        <Text style={styles.p}>{copy.advice}</Text>

        <Text style={styles.code}>Code: {code}</Text>

        <Btn label={backLabel} onPress={onBack} />
        <Btn label="Report a problem with this medicine" variant="secondary" onPress={onReport} />
        <Disclaimer />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hero: { alignItems: 'center', paddingBottom: 28, paddingHorizontal: 20 },
  symbol: { fontSize: 64, color: '#FFFFFF', fontWeight: '700' },
  headline: { fontSize: 28, color: '#FFFFFF', fontWeight: '700', textAlign: 'center', marginTop: 4 },
  body: { padding: 18 },
  banner: { backgroundColor: '#FFF4D6', borderRadius: 10, padding: 12, marginBottom: 12 },
  bannerText: { fontSize: 14, color: '#5A4300', lineHeight: 20 },
  p: { fontSize: 16, color: colors.text, lineHeight: 23, marginTop: 6 },
  h: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 18 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 18 },
  row: { flexDirection: 'row', paddingVertical: 4 },
  rowLabel: { width: 130, fontSize: 14, color: colors.muted },
  rowValue: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '600' },
  code: { fontSize: 12, color: colors.muted, marginTop: 16 },
});