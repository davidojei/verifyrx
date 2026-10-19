import type { Reason, ResultState } from '@verifyrx/decision';

export interface ProductInfo {
  name: string;
  manufacturer: string;
  nafdac_reg_no: string;
  active_ingredient: string | null;
  strength: string | null;
}

export interface BatchInfo {
  batch_no: string;
  mfg_date: string | null;
  expiry_date: string;
  status: 'ok' | 'recalled';
}

export interface VerifyResult {
  state: ResultState;
  reasons: Reason[];
  product?: ProductInfo;
  batch?: BatchInfo;
}

export interface BundleRow {
  h: string;
  product_name: string;
  manufacturer: string;
  nafdac_reg_no: string;
  active_ingredient: string | null;
  strength: string | null;
  batch_no: string;
  mfg_date: string | null;
  expiry_date: string;
  batch_status: 'ok' | 'recalled';
  scan_count: number;
  distinct_devices: number;
  distinct_areas: number;
  confirmed_fake_reports: number;
  open_user_reports: number;
}

export interface BundleConfig {
  flag_at_devices: number;
  flag_at_areas: number;
  flag_at_scans: number;
  flag_at_reports: number;
}

export interface Bundle {
  synced_at: string;
  salt: string;
  config?: BundleConfig;
  rows: BundleRow[];
}

export interface Outcome {
  result: VerifyResult;
  offline: boolean;
  noData: boolean;
  syncedAt: string | null;
}

export interface HistoryEntry {
  id: string;
  at: string;
  code: string;
  outcome: Outcome;
}