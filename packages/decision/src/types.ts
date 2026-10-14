export type ResultState = 'VERIFIED' | 'SUSPICIOUS' | 'CANT_CONFIRM';

export const ALL_REASONS = [
  'CODE_NOT_FOUND',
  'RECALLED',
  'EXPIRED',
  'REPORTED_FAKE',
  'REPORTED_BY_USERS',
  'MANY_DEVICES',
  'MANY_LOCATIONS',
  'HIGH_SCAN_COUNT',
] as const;
export type Reason = (typeof ALL_REASONS)[number];

export type BatchStatus = 'ok' | 'recalled';

/** Every threshold means: flag when value >= threshold (same rule as the SQL). */
export interface DecisionConfig {
  flagAtDevices: number;
  flagAtAreas: number;
  flagAtScans: number;
  flagAtReports: number;
}

export interface DecisionInput {
  found: boolean;
  batchStatus?: BatchStatus;
  expiryDate?: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD, Nigeria date (see lagosToday)
  scanCount: number; // including the current scan
  distinctDevices: number;
  distinctAreas: number;
  confirmedFakeReports: number;
  openUserReports: number; // distinct users with status 'new' reports
}

export interface Decision {
  state: ResultState;
  reasons: Reason[];
}