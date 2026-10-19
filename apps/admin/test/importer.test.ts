import { describe, it, expect } from 'vitest';
import { COLUMNS, isValidDate, validateRows } from '../lib/importer';

const H: string[] = [...COLUMNS];
const base: Record<string, string> = {
  nafdac_reg_no: 'DEMO-1',
  product_name: 'Demo',
  manufacturer: 'Maker',
  active_ingredient: 'X',
  strength: '5 mg',
  batch_no: 'B1',
  mfg_date: '2026-01-01',
  expiry_date: '2028-01-01',
  code_value: 'C1',
};
const make = (over: Record<string, string> = {}) => ({ ...base, ...over });
const blank = () => Object.fromEntries(COLUMNS.map((c) => [c, ''])) as Record<string, string>;

describe('validateRows', () => {
  it('accepts valid rows', () => {
    const r = validateRows([make(), make({ code_value: 'C2' })], H);
    expect(r.issues).toEqual([]);
    expect(r.rows).toHaveLength(2);
  });

  it('reports a missing required column', () => {
    const r = validateRows([make()], H.filter((c) => c !== 'manufacturer'));
    expect(r.rows).toEqual([]);
    expect(r.issues).toMatchObject([{ line: 1, field: 'manufacturer' }]);
  });

  it('reports empty required fields with the right line number', () => {
    const r = validateRows([make(), make({ manufacturer: '', code_value: 'C2' })], H);
    expect(r.issues).toEqual([{ line: 3, field: 'manufacturer', message: 'manufacturer is required' }]);
  });

  it('checks real dates', () => {
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2027-02-29')).toBe(false);
    expect(isValidDate('30/06/2028')).toBe(false);
    expect(isValidDate('2028-13-01')).toBe(false);
    expect(isValidDate('')).toBe(false);
  });

  it('rejects an expiry date in the wrong format', () => {
    const r = validateRows([make({ expiry_date: '30/06/2028' })], H);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ line: 2, field: 'expiry_date' });
  });

  it('rejects a manufacture date after the expiry date', () => {
    const r = validateRows([make({ mfg_date: '2029-01-01' })], H);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ line: 2, field: 'mfg_date' });
  });

  it('flags a duplicate code on the later row only', () => {
    const r = validateRows([make(), make()], H);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ line: 3, field: 'code_value' });
  });

  it('flags a product that changes under the same NAFDAC number', () => {
    const r = validateRows([make(), make({ product_name: 'Other', code_value: 'C2' })], H);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ line: 3, field: 'product_name' });
  });

  it('flags a batch whose expiry date changes', () => {
    const r = validateRows([make(), make({ expiry_date: '2029-01-01', code_value: 'C2' })], H);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ line: 3, field: 'expiry_date' });
  });

  it('rejects an over-long code', () => {
    const r = validateRows([make({ code_value: 'x'.repeat(257) })], H);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ line: 2, field: 'code_value' });
  });

  it('rejects quotes and backslashes in codes', () => {
    const r = validateRows([make({ code_value: 'a"b' })], H);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ field: 'code_value' });
  });

  it('skips blank rows but keeps line numbers true to the file', () => {
    const r = validateRows([make(), blank(), make({ code_value: 'C2' })], H);
    expect(r.issues).toEqual([]);
    expect(r.rows.map((x) => x.line)).toEqual([2, 4]);
  });
});