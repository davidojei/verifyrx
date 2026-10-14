import { describe, it, expect } from 'vitest';
import * as copy from '../src/copy';

const BANNED = [/\bsafe\b/i, /100\s*%/, /guarantee/i, /definitely/i];

describe('app notices', () => {
  const notices = [
    copy.OFFLINE_NOTE,
    copy.NO_OFFLINE_DATA_NOTE,
    copy.RATE_LIMITED_NOTE,
    copy.GENERIC_ERROR_NOTE,
    copy.UNREADABLE_CODE_NOTE,
  ];
  it('never claims a medicine is safe or certain', () => {
    for (const text of notices) for (const re of BANNED) expect(text).not.toMatch(re);
  });
  it('offline notice says the data may be out of date', () => {
    expect(copy.OFFLINE_NOTE).toMatch(/out of date/);
  });
});