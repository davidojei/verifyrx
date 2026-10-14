import { describe, it, expect } from 'vitest';
import golden from '../golden/cases.json';
import { decide, DEFAULT_CONFIG, InvalidDecisionInput, lagosToday } from '../src/decide';
import { STATE_COPY, REASON_COPY, DISCLAIMER } from '../src/copy';
import { ALL_REASONS } from '../src/types';
import type { DecisionConfig, DecisionInput, Reason } from '../src/types';

const base = golden.base as DecisionInput;
const cfg = golden.config as DecisionConfig;

describe('golden cases', () => {
  it.each(golden.cases)('$name', (c) => {
    const input = { ...base, ...c.override } as DecisionInput;
    const result = decide(input, cfg);
    expect(result.state).toBe(c.expected.state);
    expect(result.reasons).toEqual(c.expected.reasons as Reason[]);
  });
});

describe('defaults', () => {
  it('DEFAULT_CONFIG matches the golden config (and the database)', () => {
    expect(DEFAULT_CONFIG).toEqual(cfg);
  });
});

describe('fails closed on bad data', () => {
  it('throws when a known code has no batch status', () => {
    expect(() => decide({ ...base, batchStatus: undefined }, cfg)).toThrow(InvalidDecisionInput);
  });
  it('throws on a missing or malformed expiry date', () => {
    expect(() => decide({ ...base, expiryDate: undefined }, cfg)).toThrow(InvalidDecisionInput);
    expect(() => decide({ ...base, expiryDate: '30/06/2028' }, cfg)).toThrow(InvalidDecisionInput);
    expect(() => decide({ ...base, expiryDate: '2028-02-31' }, cfg)).toThrow(InvalidDecisionInput);
  });
  it('throws on negative or non-finite counts', () => {
    expect(() => decide({ ...base, scanCount: -1 }, cfg)).toThrow(InvalidDecisionInput);
    expect(() => decide({ ...base, distinctDevices: NaN }, cfg)).toThrow(InvalidDecisionInput);
    expect(() => decide({ ...base, distinctAreas: Infinity }, cfg)).toThrow(InvalidDecisionInput);
  });
  it('throws on a nonsensical config (a threshold of 0 would flag everything)', () => {
    expect(() => decide(base, { ...cfg, flagAtScans: 0 })).toThrow(InvalidDecisionInput);
    expect(() => decide(base, { ...cfg, flagAtDevices: NaN })).toThrow(InvalidDecisionInput);
  });
});

describe('invariants', () => {
  it('VERIFIED if and only if there are no reasons; CANT_CONFIRM only for unknown codes', () => {
    for (const scanCount of [0, 5, 6])
      for (const distinctDevices of [1, 2, 3])
        for (const distinctAreas of [1, 2])
          for (const confirmedFakeReports of [0, 1])
            for (const openUserReports of [0, 2, 3])
              for (const batchStatus of ['ok', 'recalled'] as const)
                for (const expiryDate of ['2026-10-13', '2026-10-14']) {
                  const r = decide(
                    { ...base, scanCount, distinctDevices, distinctAreas, confirmedFakeReports, openUserReports, batchStatus, expiryDate },
                    cfg,
                  );
                  expect(r.state === 'VERIFIED').toBe(r.reasons.length === 0);
                  expect(r.state).not.toBe('CANT_CONFIRM');
                }
  });

  it('more activity never removes a warning', () => {
    const axes = ['scanCount', 'distinctDevices', 'distinctAreas', 'openUserReports', 'confirmedFakeReports'] as const;
    for (const axis of axes) {
      for (let v = 0; v <= 12; v++) {
        const lower = decide({ ...base, [axis]: v } as DecisionInput, cfg).reasons;
        const higher = decide({ ...base, [axis]: v + 1 } as DecisionInput, cfg).reasons;
        for (const reason of lower) expect(higher).toContain(reason);
      }
    }
  });
});

describe('lagosToday', () => {
  it('uses the Nigeria date (UTC+1)', () => {
    expect(lagosToday(new Date('2026-10-14T12:00:00Z'))).toBe('2026-10-14');
    expect(lagosToday(new Date('2026-10-14T23:30:00Z'))).toBe('2026-10-15');
    expect(lagosToday(new Date('2026-10-14T22:59:00Z'))).toBe('2026-10-14');
  });
});

describe('user-facing copy', () => {
  const BANNED = [/\bsafe\b/i, /100\s*%/, /guarantee/i, /definitely/i];
  const allText = [
    DISCLAIMER,
    ...Object.values(REASON_COPY),
    ...Object.values(STATE_COPY).flatMap((s) => [s.headline, s.explanation, s.advice]),
  ];

  it('never claims a medicine is safe or certain', () => {
    for (const text of allText) for (const re of BANNED) expect(text).not.toMatch(re);
  });
  it('has wording for every reason', () => {
    expect(Object.keys(REASON_COPY).sort()).toEqual([...ALL_REASONS].sort());
    for (const text of Object.values(REASON_COPY)) expect(text.length).toBeGreaterThan(10);
  });
  it('disclaimer says it is a screening aid', () => {
    expect(DISCLAIMER).toMatch(/screening aid/i);
  });
});