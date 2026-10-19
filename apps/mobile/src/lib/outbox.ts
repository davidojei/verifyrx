import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, verifyCode } from './api';
import { base64ToBytes } from './photos';
import { ensureSession, supabase } from './supabase';

const REPORTS_KEY = 'vrx:outbox:reports:v1';
const SCANS_KEY = 'vrx:outbox:scans:v1';
const MAX_QUEUED_REPORTS = 10;
const MAX_QUEUED_SCANS = 50;
const MAX_FAILURES = 5;
const BUCKET = 'report-photos';

export interface ReportDraft {
  id: string;
  code_value: string | null;
  product_name_text: string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  photos: string[]; // base64 JPEGs
}

interface QueuedReport {
  id: string;
  code_value: string | null;
  product_name_text: string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  photoCount: number;
  created_at: string;
  failures?: number;
}

interface QueuedScan {
  code: string;
  lat: number | null;
  lng: number | null;
  at: string;
}

export type FlushIssue = null | 'rate_limited' | 'network' | 'other';
export interface FlushResult {
  issue: FlushIssue;
}
export interface SubmitResult {
  status: 'sent' | 'queued';
  issue: FlushIssue;
}

const photoKey = (id: string, i: number) => `vrx:photo:${id}:${i}`;

async function loadList<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

async function saveList<T>(key: string, list: T[]): Promise<void> {
  if (list.length === 0) await AsyncStorage.removeItem(key);
  else await AsyncStorage.setItem(key, JSON.stringify(list));
}

export async function pendingCounts(): Promise<{ reports: number; scans: number }> {
  const [r, s] = await Promise.all([loadList<QueuedReport>(REPORTS_KEY), loadList<QueuedScan>(SCANS_KEY)]);
  return { reports: r.length, scans: s.length };
}

export async function enqueueScan(code: string, coords: { lat: number; lng: number } | null): Promise<void> {
  const list = await loadList<QueuedScan>(SCANS_KEY);
  if (list.length >= MAX_QUEUED_SCANS) return;
  list.push({ code, lat: coords ? coords.lat : null, lng: coords ? coords.lng : null, at: new Date().toISOString() });
  await saveList(SCANS_KEY, list);
}

export async function submitReport(draft: ReportDraft): Promise<SubmitResult> {
  const list = await loadList<QueuedReport>(REPORTS_KEY);
  if (list.length >= MAX_QUEUED_REPORTS) throw new Error('queue_full');

  // 1. Save everything on the phone first, so nothing is lost if the send fails.
  for (let i = 0; i < draft.photos.length; i++) {
    await AsyncStorage.setItem(photoKey(draft.id, i), draft.photos[i] as string);
  }
  list.push({
    id: draft.id,
    code_value: draft.code_value,
    product_name_text: draft.product_name_text,
    notes: draft.notes,
    lat: draft.lat,
    lng: draft.lng,
    photoCount: draft.photos.length,
    created_at: new Date().toISOString(),
  });
  await saveList(REPORTS_KEY, list);

  // 2. Try to send right away.
  const flush = await flushOutbox();
  const stillQueued = (await loadList<QueuedReport>(REPORTS_KEY)).some((r) => r.id === draft.id);
  return { status: stillQueued ? 'queued' : 'sent', issue: stillQueued ? flush.issue : null };
}

let running: Promise<FlushResult> | null = null;

/** Sends whatever is waiting. Safe to call often; only one run happens at a time. */
export function flushOutbox(): Promise<FlushResult> {
  if (!running) {
    running = doFlush().finally(() => {
      running = null;
    });
  }
  return running;
}

function storageAlreadyExists(error: unknown): boolean {
  const e = error as { statusCode?: string | number; status?: number; message?: string };
  return String(e.statusCode) === '409' || e.status === 409 || /already exists/i.test(e.message ?? '');
}

function looksLikeNetwork(message: string): boolean {
  return /network|fetch|timeout|failed to connect|offline/i.test(message);
}

async function doFlush(): Promise<FlushResult> {
  const scans = await loadList<QueuedScan>(SCANS_KEY);
  const reports = await loadList<QueuedReport>(REPORTS_KEY);
  if (scans.length === 0 && reports.length === 0) return { issue: null };
  if (!(await ensureSession())) return { issue: 'network' };

  // ---- queued scans: replay them so the server counts them ----
  let remainingScans = [...scans];
  for (const s of scans) {
    try {
      await verifyCode(s.code, s.lat !== null && s.lng !== null ? { lat: s.lat, lng: s.lng } : null);
      remainingScans = remainingScans.filter((x) => x !== s);
      await saveList(SCANS_KEY, remainingScans);
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'invalid_code') {
        remainingScans = remainingScans.filter((x) => x !== s); // can never succeed: drop it
        await saveList(SCANS_KEY, remainingScans);
        continue;
      }
      const issue: FlushIssue = e instanceof ApiError && e.kind === 'rate_limited' ? 'rate_limited' : 'network';
      return { issue };
    }
  }

  // ---- queued reports ----
  const sessionRes = await supabase.auth.getSession();
  const uid = sessionRes.data.session?.user.id;
  if (!uid) return { issue: 'network' };

  let remaining = [...reports];
  for (const r of reports) {
    const paths: string[] = [];
    let failure: FlushIssue = null;
    let permanent = false;

    for (let i = 0; i < r.photoCount && !failure; i++) {
      const b64 = await AsyncStorage.getItem(photoKey(r.id, i));
      if (!b64) continue; // photo no longer on the phone; send the rest
      const path = `${uid}/${r.id}-${i + 1}.jpg`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, base64ToBytes(b64), { contentType: 'image/jpeg', upsert: false });
      if (error && !storageAlreadyExists(error)) {
        failure = looksLikeNetwork(error.message) ? 'network' : 'other';
      } else {
        paths.push(path);
      }
    }

    if (!failure) {
      const { error } = await supabase.from('reports').insert({
        id: r.id,
        code_value: r.code_value,
        product_name_text: r.product_name_text,
        photo_url: paths.length > 0 ? paths.join(',') : null,
        notes: r.notes,
        lat: r.lat,
        lng: r.lng,
      });
      if (error && error.code !== '23505') {
        // 23505 = already inserted on an earlier try, which counts as success.
        if (error.message === 'rate_limited') failure = 'rate_limited';
        else if (!error.code) failure = 'network';
        else if (['23514', '22001', '22P02', '42501'].includes(error.code)) {
          permanent = true; // this report can never be accepted, so do not block the queue
          failure = 'other';
        } else failure = 'other';
      }
    }

    if (!failure || permanent) {
      const keys = Array.from({ length: r.photoCount }, (_, i) => photoKey(r.id, i));
      await AsyncStorage.multiRemove(keys);
      remaining = remaining.filter((x) => x.id !== r.id);
      await saveList(REPORTS_KEY, remaining);
      if (permanent) console.warn('REPORT DROPPED (rejected by server)', r.id);
      continue;
    }

    if (failure === 'other') {
      const failures = (r.failures ?? 0) + 1;
      if (failures >= MAX_FAILURES) {
        const keys = Array.from({ length: r.photoCount }, (_, i) => photoKey(r.id, i));
        await AsyncStorage.multiRemove(keys);
        remaining = remaining.filter((x) => x.id !== r.id);
        console.warn('REPORT DROPPED after repeated failures', r.id);
      } else {
        remaining = remaining.map((x) => (x.id === r.id ? { ...x, failures } : x));
      }
      await saveList(REPORTS_KEY, remaining);
    }
    return { issue: failure };
  }

  return { issue: null };
}