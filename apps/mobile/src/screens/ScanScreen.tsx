import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GENERIC_ERROR_NOTE, RATE_LIMITED_NOTE, UNREADABLE_CODE_NOTE } from '@verifyrx/decision';
import { ApiError } from '../lib/api';
import { addHistory } from '../lib/cache';
import { fmtDate } from '../lib/format';
import type { Outcome } from '../lib/types';
import { verify } from '../lib/verify';
import Btn from '../components/Btn';
import Disclaimer from '../components/Disclaimer';
import { colors } from '../theme';

interface Props {
  syncedAt: string | null;
  pending: number;
  onOutcome: (outcome: Outcome, code: string) => void;
  onHistory: () => void;
  onPrivacy: () => void;
  onReport: () => void;
}

function TopBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.topBtn}>
      <Text style={styles.topBtnText}>{label}</Text>
    </Pressable>
  );
}

export default function ScanScreen({ syncedAt, pending, onOutcome, onHistory, onPrivacy, onReport }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function check(raw: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const code = raw.trim();
      const outcome = await verify(code);
      try {
        await addHistory(code, outcome);
      } catch {
        // History is a convenience; never block the result because of it.
      }
      if (mounted.current) onOutcome(outcome, code);
    } catch (e) {
      if (mounted.current) {
        if (e instanceof ApiError && e.kind === 'rate_limited') setMessage(RATE_LIMITED_NOTE);
        else if (e instanceof ApiError && e.kind === 'invalid_code') setMessage(UNREADABLE_CODE_NOTE);
        else setMessage(GENERIC_ERROR_NOTE);
      }
    } finally {
      if (mounted.current) setBusy(false);
      setTimeout(() => {
        lock.current = false;
      }, 1200);
    }
  }

  const cameraOn = !!permission?.granted && !manual;

  return (
    <View style={styles.root}>
      {cameraOn && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'code128', 'qr', 'datamatrix'] }}
          onBarcodeScanned={
            busy
              ? undefined
              : (r) => {
                  void check(r.data);
                }
          }
        />
      )}

      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <TopBtn label="History" onPress={onHistory} />
        {cameraOn && <TopBtn label={torch ? 'Torch off' : 'Torch'} onPress={() => setTorch((t) => !t)} />}
        <TopBtn label="Report" onPress={onReport} />
        <TopBtn label="Privacy" onPress={onPrivacy} />
      </View>

      {cameraOn && <View pointerEvents="none" style={styles.frame} />}

      <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
        {busy && (
          <View style={styles.statusRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.status}>Checking...</Text>
          </View>
        )}
        {!busy && message && <Text style={styles.error}>{message}</Text>}
        {!busy && !message && cameraOn && <Text style={styles.status}>Point the camera at the barcode or QR code.</Text>}

        {!permission && <ActivityIndicator color={colors.primary} />}

        {permission && !permission.granted && !manual && (
          <View>
            <Text style={styles.p}>VerifyRx needs the camera to scan the code on the pack. You can also type the code instead.</Text>
            <Btn label="Allow camera" onPress={() => void requestPermission()} />
          </View>
        )}

        {(manual || (permission && !permission.granted)) && (
          <View>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="Type the code"
              placeholderTextColor="#6B7280"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => void check(text)}
              returnKeyType="search"
            />
            <Btn label="Check code" onPress={() => void check(text)} disabled={busy || text.trim().length === 0} />
          </View>
        )}

        {permission?.granted && (
          <Btn
            label={manual ? 'Use camera instead' : 'Type code instead'}
            variant="secondary"
            onPress={() => setManual((m) => !m)}
          />
        )}
        {permission && !permission.granted && !manual && (
          <Btn label="Type code instead" variant="secondary" onPress={() => setManual(true)} />
        )}

        <Text style={styles.sync}>
          {syncedAt ? `Offline data updated ${fmtDate(syncedAt)}` : 'Offline data: not downloaded yet'}
        </Text>
        {pending > 0 && (
          <Text style={styles.pending}>
            {pending} {pending === 1 ? 'item is' : 'items are'} waiting to send when you are online
          </Text>
        )}
        <Disclaimer />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0F14' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, zIndex: 2 },
  topBtn: { backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 11, paddingVertical: 10, borderRadius: 20 },
  topBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  frame: { position: 'absolute', top: '22%', alignSelf: 'center', width: 240, height: 240, borderWidth: 3, borderColor: '#FFFFFF', borderRadius: 16 },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  status: { fontSize: 15, color: colors.muted },
  error: { fontSize: 15, color: colors.danger },
  p: { fontSize: 15, color: colors.text, lineHeight: 21 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, color: colors.text, marginTop: 10 },
  sync: { fontSize: 12, color: colors.muted, marginTop: 12 },
  pending: { fontSize: 12, color: colors.primary, marginTop: 4, fontWeight: '600' },
});