import { describe, it, expect } from 'vitest';
import {
  NOTE_COPY,
  PHOTO_DISCLAIMER,
  SIGNS_HEADING,
  SIGN_COPY,
} from '../src/copy';
import { NOTE_CODES, SIGN_CODES } from '../src/photo';

const BANNED = [/\bsafe\b/i, /100\s*%/, /guarantee/i, /definitely/i, /\bfake\b/i, /counterfeit/i];

describe('photo wording', () => {
  const all = [SIGNS_HEADING, PHOTO_DISCLAIMER, ...Object.values(SIGN_COPY), ...Object.values(NOTE_COPY)];

  it('has wording for every sign and every note', () => {
    expect(Object.keys(SIGN_COPY).sort()).toEqual([...SIGN_CODES].sort());
    expect(Object.keys(NOTE_COPY).sort()).toEqual([...NOTE_CODES].sort());
  });

  it('never says a medicine is fake, safe or certain', () => {
    for (const text of all) for (const re of BANNED) expect(text).not.toMatch(re);
  });

  it('says it is a signs-we-noticed screening aid', () => {
    expect(SIGNS_HEADING).toBe('Signs we noticed');
    expect(PHOTO_DISCLAIMER).toMatch(/screening aid/i);
  });

  it('a clean photo is never presented as proof', () => {
    expect(NOTE_COPY.PHOTO_NO_SIGNS_NOT_PROOF).toMatch(/cannot confirm/i);
  });
});