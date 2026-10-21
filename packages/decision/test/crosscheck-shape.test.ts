import { describe, it, expect } from 'vitest';
import { SIGN_CODES, STRONG_SIGN_CODES, combine } from '../src/photo';

// What crosscheck_pack returns (see supabase/migrations/20261020000005_pack_check.sql).
const rpc = (over: Record<string, unknown> = {}) => ({
  analysis_id: '00000000-0000-0000-0000-000000000001',
  usable: true,
  confidence: 0.9,
  signs: [],
  checked: ['registration', 'expiry'],
  product: { name: 'Demo', manufacturer: 'Maker' },
  tips: null,
  ...over,
});

// Every sign code the SQL function can produce.
const SQL_CODES = [
  'MANDATORY_FIELD_MISSING',
  'PACK_EXPIRED',
  'REG_NO_MISMATCH',
  'BATCH_FORMAT_MISMATCH',
  'PACK_CONTRADICTS_RECORD',
];
const FIELDS = ['nafdac_reg_no', 'batch_no', 'expiry_date', 'mfg_date'];

const V = { state: 'VERIFIED', reasons: [] };

describe('database check output feeds the combiner', () => {
  it('the database only produces codes the combiner knows, and all of them are strong', () => {
    for (const c of SQL_CODES) {
      expect((SIGN_CODES as readonly string[]).includes(c)).toBe(true);
      expect((STRONG_SIGN_CODES as readonly string[]).includes(c)).toBe(true);
    }
  });

  it('every sign and field the database can produce survives the combiner and makes a verified code suspicious', () => {
    for (const code of SQL_CODES) {
      for (const field of FIELDS) {
        const r = combine(V, rpc({ signs: [{ code, field }] }));
        expect(r.state).toBe('SUSPICIOUS');
        expect(r.signs).toEqual([{ code, field }]);
      }
    }
  });

  it('no signs on a verified code keeps it verified, with a "not proof" note', () => {
    const r = combine(V, rpc());
    expect(r.state).toBe('VERIFIED');
    expect(r.notes).toEqual(['PHOTO_NO_SIGNS_NOT_PROOF']);
  });

  it('no signs without a code is never verified', () => {
    const r = combine(null, rpc());
    expect(r.state).toBe('CANT_CONFIRM');
    expect(r.notes).toContain('ASK_PHARMACIST');
  });

  it('not usable (no reference data) is inconclusive, never "nothing unusual"', () => {
    const r = combine(null, rpc({ usable: false, product: null }));
    expect(r.photoState).toBe('INCONCLUSIVE');
    expect(r.state).toBe('CANT_CONFIRM');
    expect(combine(V, rpc({ usable: false })).state).toBe('VERIFIED');
  });
});