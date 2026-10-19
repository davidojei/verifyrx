import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Bundle, BundleConfig, BundleRow, HistoryEntry, Outcome } from './types';

const BUNDLE_KEY = 'vrx:bundle:v1';
const HISTORY_KEY = 'vrx:history:v1';
const SHARE_AREA_KEY = 'vrx:share-area:v1';
const MAX_HISTORY = 200;

export interface StoredBundle {
  synced_at: string;
  salt: string;
  config?: BundleConfig;
  rows: Record<string, BundleRow>;
}

let memo: StoredBundle | null | undefined;

export async function saveBundle(b: Bundle): Promise<void> {
  const rows: Record<string, BundleRow> = {};
  for (const r of b.rows) rows[r.h] = r;
  const stored: StoredBundle = { synced_at: b.synced_at, salt: b.salt, config: b.config, rows };
  await AsyncStorage.setItem(BUNDLE_KEY, JSON.stringify(stored));
  memo = stored;
}

export async function loadBundle(): Promise<StoredBundle | null> {
  if (memo !== undefined) return memo;
  try {
    const raw = await AsyncStorage.getItem(BUNDLE_KEY);
    memo = raw ? (JSON.parse(raw) as StoredBundle) : null;
  } catch {
    memo = null;
  }
  return memo;
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export async function addHistory(code: string, outcome: Outcome): Promise<void> {
  const list = await loadHistory();
  const entry: HistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    code: code.slice(0, 256),
    outcome,
  };
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...list].slice(0, MAX_HISTORY)));
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(HISTORY_KEY);
}

export async function getShareArea(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SHARE_AREA_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setShareArea(on: boolean): Promise<void> {
  if (on) await AsyncStorage.setItem(SHARE_AREA_KEY, '1');
  else await AsyncStorage.removeItem(SHARE_AREA_KEY);
}