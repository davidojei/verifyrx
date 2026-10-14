import type { Decision, DecisionConfig, DecisionInput, Reason } from './types';

export class InvalidDecisionInput extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDecisionInput';
  }
}

/** Same defaults as the app_config rows in the database. */
export const DEFAULT_CONFIG: DecisionConfig = {
  flagAtDevices: 3,
  flagAtAreas: 2,
  flagAtScans: 6,
  flagAtReports: 3,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function assertCount(name: string, v: unknown): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new InvalidDecisionInput(`${name} must be a number >= 0`);
  }
}

function assertThreshold(name: string, v: unknown): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) {
    throw new InvalidDecisionInput(`config.${name} must be a number >= 1`);
  }
}

/** Nigeria is UTC+1 all year (no daylight saving), so no Intl needed. */
export function lagosToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Pure decision function. Reason order matches the SQL function.
 * unknown code            -> CANT_CONFIRM
 * known code, any flag    -> SUSPICIOUS (every reason listed)
 * known code, no flags    -> VERIFIED
 * Bad data on a known code throws: it must never become VERIFIED.
 */
export function decide(input: DecisionInput, config: DecisionConfig = DEFAULT_CONFIG): Decision {
  assertThreshold('flagAtDevices', config.flagAtDevices);
  assertThreshold('flagAtAreas', config.flagAtAreas);
  assertThreshold('flagAtScans', config.flagAtScans);
  assertThreshold('flagAtReports', config.flagAtReports);

  if (!input.found) {
    return { state: 'CANT_CONFIRM', reasons: ['CODE_NOT_FOUND'] };
  }

  if (input.batchStatus !== 'ok' && input.batchStatus !== 'recalled') {
    throw new InvalidDecisionInput('batchStatus must be "ok" or "recalled"');
  }
  if (!isValidDate(input.expiryDate)) {
    throw new InvalidDecisionInput('expiryDate must be a valid YYYY-MM-DD date');
  }
  if (!isValidDate(input.today)) {
    throw new InvalidDecisionInput('today must be a valid YYYY-MM-DD date');
  }
  assertCount('scanCount', input.scanCount);
  assertCount('distinctDevices', input.distinctDevices);
  assertCount('distinctAreas', input.distinctAreas);
  assertCount('confirmedFakeReports', input.confirmedFakeReports);
  assertCount('openUserReports', input.openUserReports);

  const reasons: Reason[] = [];
  if (input.batchStatus === 'recalled') reasons.push('RECALLED');
  if (input.expiryDate < input.today) reasons.push('EXPIRED'); // YYYY-MM-DD sorts correctly as text
  if (input.confirmedFakeReports > 0) reasons.push('REPORTED_FAKE');
  if (input.openUserReports >= config.flagAtReports) reasons.push('REPORTED_BY_USERS');
  if (input.distinctDevices >= config.flagAtDevices) reasons.push('MANY_DEVICES');
  if (input.distinctAreas >= config.flagAtAreas) reasons.push('MANY_LOCATIONS');
  if (input.scanCount >= config.flagAtScans) reasons.push('HIGH_SCAN_COUNT');

  return { state: reasons.length > 0 ? 'SUSPICIOUS' : 'VERIFIED', reasons };
}