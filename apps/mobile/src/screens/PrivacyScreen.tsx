import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Btn from '../components/Btn';
import Disclaimer from '../components/Disclaimer';
import { getShareArea, setShareArea } from '../lib/cache';
import { enableAreaSharing } from '../lib/location';
import { colors } from '../theme';

export default function PrivacyScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [share, setShare] = useState(false);

  useEffect(() => {
    void getShareArea().then(setShare);
  }, []);

  async function toggle(next: boolean) {
    if (next) {
      const ok = await enableAreaSharing();
      setShare(ok);
      if (!ok) {
        Alert.alert('Location permission needed', 'Allow location access in your phone settings to share your approximate area.');
      }
    } else {
      await setShareArea(false);
      setShare(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 18, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }}>
      <Text style={styles.title}>Privacy</Text>
      <Text style={styles.p}>VerifyRx collects as little as possible. You do not need an account.</Text>

      <Text style={styles.h}>What we collect</Text>
      <Text style={styles.p}>{'\u2022 '}No name, phone number or email address.</Text>
      <Text style={styles.p}>
        {'\u2022 '}A random anonymous ID, created on your phone the first time you scan. It helps us notice when one code is scanned on many phones. It is not linked to who you are.
      </Text>
      <Text style={styles.p}>{'\u2022 '}The codes you check, the result, and the time.</Text>
      <Text style={styles.p}>{'\u2022 '}Your approximate area (rounded to about 1 km), only if you switch it on below.</Text>
      <Text style={styles.p}>{'\u2022 '}If you send a report: the photos and notes you choose to include.</Text>

      <Text style={styles.h}>What stays on your phone</Text>
      <Text style={styles.p}>Your scan history. You can clear it any time from the History screen.</Text>

      <View style={styles.switchRow}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.switchTitle}>Share my approximate area with scans</Text>
          <Text style={styles.switchSub}>Off by default. Helps spot copied codes that show up in several places.</Text>
        </View>
        <Switch value={share} onValueChange={(v) => void toggle(v)} />
      </View>

      <Disclaimer />
      <Btn label="Back" onPress={onBack} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  h: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 20 },
  p: { fontSize: 16, color: colors.text, lineHeight: 23, marginTop: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 22 },
  switchTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  switchSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
});