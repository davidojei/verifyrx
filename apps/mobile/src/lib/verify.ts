import * as Crypto from 'expo-crypto';
import { decide, DEFAULT_CONFIG, lagosToday, type DecisionConfig } from '@verifyrx/decision';
import { ApiError, syncBundle, verifyCode } from './api';
import { loadBundle, saveBundle } from './cache';
import { enqueueScan } from './outbox';
import { approxCoords } from './location';
import { ensureSession } from './supabase';
import type { BundleConfig, Outcome, VerifyResult } from './types';

const ONLINE_TIMEOUT_MS = 6000;
const MAX_CODE_LENGTH = 256;

const UNKNOWN: VerifyResult = { state: 'CANT_CONFIRM', reasons: ['CODE_NOT_FOUND'] };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ApiError('network', 'timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Thresholds saved with the offline data; built-in defaults if they are missing or unusable.
function offlineConfig(c: BundleConfig | undefined): DecisionConfig {
  const pick = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 1 ? v : fallback;
  return {
    flagAtDevices: pick(c?.flag_at_devices, DEFAULT_CONFIG.flagAtDevices),
    flagAtAreas: pick(c?.flag_at_areas, DEFAULT_CONFIG.flagAtAreas),
    flagAtScans: pick(c?.flag_at_scans, DEFAULT_CONFIG.flagAtScans),
    flagAtReports: pick(c?.flag_at_reports, DEFAULT_CONFIG.flagAtReports),
  };
}

async function offlineVerify(code: string): Promise<Outcome> {
  const bundle = await loadBundle();
  if (!bundle) return { result: UNKNOWN, offline: true, noData: true, syncedAt: null };

  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${bundle.salt}:${code}`);
  const row = bundle.rows[hash];
  if (!row) return { result: UNKNOWN, offline: true, noData: false, syncedAt: bundle.synced_at };

  try {
    const d = decide({
      found: true,
      batchStatus: row.batch_status,
      expiryDate: row.expiry_date,
      today: lagosToday(),
      scanCount: row.scan_count,
      distinctDevices: row.distinct_devices,
      distinctAreas: row.distinct_areas,
      confirmedFakeReports: row.confirmed_fake_reports,
      openUserReports: row.open_user_reports,
    }, offlineConfig(bundle.config));
    return {
      result: {
        state: d.state,
        reasons: d.reasons,
        product: {
          name: row.product_name,
          manufacturer: row.manufacturer,
          nafdac_reg_no: row.nafdac_reg_no,
          active_ingredient: row.active_ingredient,
          strength: row.strength,
        },
        batch: {
          batch_no: row.batch_no,
          mfg_date: row.mfg_date,
          expiry_date: row.expiry_date,
          status: row.batch_status,
        },
      },
      offline: true,
      noData: false,
      syncedAt: bundle.synced_at,
    };
  } catch {
    // Bad saved data must never become VERIFIED.
    return { result: UNKNOWN, offline: true, noData: false, syncedAt: bundle.synced_at };
  }
}

export async function verify(rawCode: string): Promise<Outcome> {
  const code = rawCode.trim();
  if (code.length === 0) throw new ApiError('invalid_code', 'empty');
  // Anything this long is not one of our codes (for example a web link in a QR code).
  if (code.length > MAX_CODE_LENGTH) {
    return { result: UNKNOWN, offline: false, noData: false, syncedAt: null };
  }

  const coords = await approxCoords();
  try {
    const result = await withTimeout(
      (async () => {
        if (!(await ensureSession())) throw new ApiError('network', 'no session');
        return verifyCode(code, coords);
      })(),
      ONLINE_TIMEOUT_MS,
    );
    return { result, offline: false, noData: false, syncedAt: null };
  } catch (e) {
    if (e instanceof ApiError && (e.kind === 'rate_limited' || e.kind === 'invalid_code')) throw e;
    try {
      await enqueueScan(code, coords);
    } catch {
      // The outbox is a convenience; never block the result.
    }
    return offlineVerify(code);
  }
}

/** Downloads the offline data. Returns the sync time, or null if it could not. */
export async function syncNow(): Promise<string | null> {
  try {
    if (!(await ensureSession())) return null;
    const bundle = await syncBundle();
    await saveBundle(bundle);
    return bundle.synced_at;
  } catch (e) {
    console.warn('SYNC FAILED', e);
    return null;
  }
}
