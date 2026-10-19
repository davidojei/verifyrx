import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STATE_COPY } from '@verifyrx/decision';
import Btn from '../components/Btn';
import { clearHistory, loadHistory } from '../lib/cache';
import { fmtDateTime } from '../lib/format';
import type { HistoryEntry } from '../lib/types';
import { colors, stateColor } from '../theme';

interface Props {
  onBack: () => void;
  onOpen: (entry: HistoryEntry) => void;
}

export default function HistoryScreen({ onBack, onOpen }: Props) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    void loadHistory().then(setItems);
  }, []);

  function confirmClear() {
    Alert.alert('Clear history?', 'This removes the list of past checks from this phone only.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          void clearHistory().then(() => setItems([]));
        },
      },
    ]);
  }

  const data = items ?? [];

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>History</Text>
      <Text style={styles.sub}>Stored on this phone only.</Text>

      <FlatList
        data={data}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={items ? <Text style={styles.empty}>No checks yet.</Text> : null}
        renderItem={({ item }) => {
          const state = item.outcome.result.state;
          return (
            <Pressable onPress={() => onOpen(item)} style={styles.item} accessibilityRole="button">
              <View style={[styles.chip, { backgroundColor: stateColor[state] }]} />
              <View style={styles.itemBody}>
                <Text style={styles.itemTitle}>{item.outcome.result.product?.name ?? 'Unrecognised code'}</Text>
                <Text style={styles.itemSub}>
                  {STATE_COPY[state].headline} - {fmtDateTime(item.at)}
                  {item.outcome.offline ? ' - offline' : ''}
                </Text>
                <Text style={styles.itemCode} numberOfLines={1}>
                  {item.code}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      <View style={{ paddingBottom: insets.bottom + 14, paddingHorizontal: 18 }}>
        {data.length > 0 && <Btn label="Clear history" variant="secondary" onPress={confirmClear} />}
        <Btn label="Back to scanning" onPress={onBack} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, paddingHorizontal: 18 },
  sub: { fontSize: 14, color: colors.muted, paddingHorizontal: 18, marginBottom: 8 },
  empty: { fontSize: 16, color: colors.muted, padding: 18 },
  item: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: colors.border },
  chip: { width: 8, borderRadius: 4, marginRight: 12 },
  itemBody: { flex: 1 },
  itemTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  itemSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  itemCode: { fontSize: 12, color: colors.muted, marginTop: 2 },
});