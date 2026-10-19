import { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  GENERIC_ERROR_NOTE,
  REPORT_NEEDS_DETAIL_NOTE,
  REPORT_PRIVACY_NOTE,
  REPORT_QUEUED_NOTE,
  REPORT_QUEUE_FULL_NOTE,
  REPORT_RATE_LIMITED_NOTE,
  REPORT_SENT_NOTE,
} from '@verifyrx/decision';
import Btn from '../components/Btn';
import Disclaimer from '../components/Disclaimer';
import { submitReport, type SubmitResult } from '../lib/outbox';
import { MAX_PHOTOS, PhotoPermissionError, pickPhoto, takePhoto } from '../lib/photos';
import { colors } from '../theme';

interface Props {
  initialCode: string | null;
  onDone: () => void;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function currentApprox(): Promise<{ lat: number; lng: number } | null> {
  try {
    const last = await Location.getLastKnownPositionAsync();
    if (last) return { lat: round2(last.coords.latitude), lng: round2(last.coords.longitude) };
    const cur = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    if (!cur) return null;
    return { lat: round2(cur.coords.latitude), lng: round2(cur.coords.longitude) };
  } catch {
    return null;
  }
}

export default function ReportScreen({ initialCode, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState(initialCode ?? '');
  const [product, setProduct] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [useLocation, setUseLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SubmitResult | null>(null);

  async function addPhoto(source: 'camera' | 'gallery') {
    if (photos.length >= MAX_PHOTOS || busy) return;
    setError(null);
    setBusy(true);
    try {
      const b64 = source === 'camera' ? await takePhoto() : await pickPhoto();
      if (b64) setPhotos((p) => [...p, b64]);
    } catch (e) {
      if (e instanceof PhotoPermissionError) {
        Alert.alert('Camera permission needed', 'Allow camera access in your phone settings, or choose a photo from the gallery instead.');
      } else {
        setError(GENERIC_ERROR_NOTE);
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleLocation(next: boolean) {
    if (!next) {
      setUseLocation(false);
      return;
    }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setUseLocation(status === 'granted');
      if (status !== 'granted') {
        Alert.alert('Location permission needed', 'Allow location access in your phone settings to include your approximate area.');
      }
    } catch {
      setUseLocation(false);
    }
  }

  async function onSubmit() {
    if (busy) return;
    setError(null);
    const c = code.trim();
    const p = product.trim();
    const n = notes.trim();
    if (!c && !p && photos.length === 0) {
      setError(REPORT_NEEDS_DETAIL_NOTE);
      return;
    }
    setBusy(true);
    try {
      const coords = useLocation ? await currentApprox() : null;
      const res = await submitReport({
        id: Crypto.randomUUID(),
        code_value: c || null,
        product_name_text: p || null,
        notes: n || null,
        lat: coords ? coords.lat : null,
        lng: coords ? coords.lng : null,
        photos,
      });
      setDone(res);
    } catch (e) {
      setError(e instanceof Error && e.message === 'queue_full' ? REPORT_QUEUE_FULL_NOTE : GENERIC_ERROR_NOTE);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const text =
      done.status === 'sent'
        ? REPORT_SENT_NOTE
        : done.issue === 'rate_limited'
          ? REPORT_RATE_LIMITED_NOTE
          : REPORT_QUEUED_NOTE;
    return (
      <View style={[styles.root, { padding: 18, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 18 }]}>
        <Text style={styles.title}>{done.status === 'sent' ? 'Report sent' : 'Report saved'}</Text>
        <Text style={styles.p}>{text}</Text>
        <Btn label="Done" onPress={onDone} />
        <Disclaimer />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 18, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }}
      >
        <Text style={styles.title}>Report a problem</Text>
        <Text style={styles.p}>Tell us about a medicine that looks wrong. Fill in whatever you can.</Text>

        <Text style={styles.label}>Code on the pack (optional)</Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          maxLength={256}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Barcode or QR code text"
          placeholderTextColor="#6B7280"
        />

        <Text style={styles.label}>Product name (optional)</Text>
        <TextInput
          style={styles.input}
          value={product}
          onChangeText={setProduct}
          maxLength={200}
          placeholder="What is written on the pack"
          placeholderTextColor="#6B7280"
        />

        <Text style={styles.label}>What looked wrong? (optional)</Text>
        <TextInput
          style={[styles.input, styles.notes]}
          value={notes}
          onChangeText={setNotes}
          maxLength={2000}
          multiline
          textAlignVertical="top"
          placeholder="For example: spelling mistakes, faded print, broken seal, where you bought it"
          placeholderTextColor="#6B7280"
        />
        <Text style={styles.count}>{notes.length}/2000</Text>

        <Text style={styles.label}>
          Photos of the packaging ({photos.length}/{MAX_PHOTOS})
        </Text>
        <View style={styles.thumbs}>
          {photos.map((b64, i) => (
            <View key={i} style={styles.thumbWrap}>
              <Image source={{ uri: `data:image/jpeg;base64,${b64}` }} style={styles.thumb} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${i + 1}`}
                onPress={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                style={styles.remove}
              >
                <Text style={styles.removeText}>X</Text>
              </Pressable>
            </View>
          ))}
        </View>
        {photos.length < MAX_PHOTOS && (
          <View>
            <Btn label="Take a photo" variant="secondary" onPress={() => void addPhoto('camera')} disabled={busy} />
            <Btn label="Choose from gallery" variant="secondary" onPress={() => void addPhoto('gallery')} disabled={busy} />
          </View>
        )}
        <Text style={styles.small}>{REPORT_PRIVACY_NOTE}</Text>

        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.switchTitle}>Include my approximate area</Text>
            <Text style={styles.small}>Rounded to about 1 km. Off by default.</Text>
          </View>
          <Switch value={useLocation} onValueChange={(v) => void toggleLocation(v)} />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Btn label={busy ? 'Please wait...' : 'Send report'} onPress={() => void onSubmit()} disabled={busy} />
        <Btn label="Cancel" variant="secondary" onPress={onDone} disabled={busy} />
        <Disclaimer />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  p: { fontSize: 16, color: colors.text, lineHeight: 23, marginTop: 8 },
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 18 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.text, marginTop: 8 },
  notes: { minHeight: 110 },
  count: { fontSize: 12, color: colors.muted, textAlign: 'right', marginTop: 4 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  thumbWrap: { width: 96, height: 96 },
  thumb: { width: 96, height: 96, borderRadius: 10, backgroundColor: colors.card },
  remove: { position: 'absolute', top: -6, right: -6, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: '#FFFFFF', fontWeight: '700' },
  small: { fontSize: 13, color: colors.muted, lineHeight: 18, marginTop: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 18 },
  switchTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  error: { fontSize: 15, color: colors.danger, marginTop: 14 },
});