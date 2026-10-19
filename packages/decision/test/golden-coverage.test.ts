import { describe, it, expect } from 'vitest';
import golden from '../golden/cases.json';
import { ALL_REASONS } from '../src/types';

describe('golden cases', () => {
  it('cover every reason at least once, so the SQL parity test checks them all', () => {
    const seen = new Set<string>(golden.cases.flatMap((c) => c.expected.reasons));
    for (const r of ALL_REASONS) expect(seen.has(r)).toBe(true);
  });
});