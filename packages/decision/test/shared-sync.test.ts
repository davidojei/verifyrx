import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), 'utf8').replace(/\r\n/g, '\n');

describe('Edge Function copy', () => {
  it('is identical to packages/decision/src/photo.ts (run: node scripts/sync-shared.cjs)', () => {
    const canonical = read('../src/photo.ts');
    const shared = read('../../../supabase/functions/_shared/photo.ts');
    expect(shared.endsWith(canonical)).toBe(true);
  });
});