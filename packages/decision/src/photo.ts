/**
 * Merges the code-scan result with the photo analysis into one final result.
 *
 * Rules that must never change:
 *  - A photo can never produce VERIFIED. VERIFIED only comes from a VERIFIED code scan with no signs.
 *  - Any sign downgrades (strong -> SUSPICIOUS, weak only -> CAN'T CONFIRM).
 *  - Low confidence, unusable photos and malformed model output are INCONCLUSIVE: they never reassure
 *    and never accuse.
 *  - Text written by a model is screened before anyone sees it.
 *
 * This file has no imports on purpose. It is copied to supabase/functions/_shared/ for the Edge Function:
 * edit it here, then run  node scripts/sync-shared.cjs
 */

export type CombinedState = 'VERIFIED' | 'SUSPICIOUS' | 'CANT_CONFIRM';
export type PhotoState = 'NO_SIGNS' | 'SIGNS_FOUND' | 'INCONCLUSIVE';

// Strong signs are deterministic mismatches found by our own cross-check code.
export const STRONG_SIGN_CODES = [
  'REG_NO_MISMATCH',
  'PACK_EXPIRED',
  'MANDATORY_FIELD_MISSING',
  'BATCH_FORMAT_MISMATCH',
  'PACK_CONTRADICTS_RECORD',
] as const;
// Weak signs are visual observations written by a model.
export const WEAK_SIGN_CODES = ['VISUAL_DIFFERENCE'] as const;
export const SIGN_CODES = [...STRONG_SIGN_CODES, ...WEAK_SIGN_CODES] as const;
export type SignCode = (typeof SIGN_CODES)[number];

export const NOTE_CODES = ['PHOTO_NO_SIGNS_NOT_PROOF', 'PHOTO_INCONCLUSIVE', 'ASK_PHARMACIST'] as const;
export type NoteCode = (typeof NOTE_CODES)[number];

export const SIGN_FIELDS = ['product_name', 'manufacturer', 'nafdac_reg_no', 'batch_no', 'mfg_date', 'expiry_date'] as const;
export const ASPECTS = ['print_quality', 'logo', 'font', 'colour', 'layout', 'spelling', 'seal_or_hologram', 'other'] as const;
export type Aspect = (typeof ASPECTS)[number];

export const PHOTO_MIN_CONFIDENCE = 0.5;
const MAX_SIGNS = 10;
const MAX_DETAIL = 200;
const MIN_DETAIL = 8;

export interface Sign {
  code: SignCode;
  field?: string;
  aspect?: string;
  detail?: string;
}

export interface Combined {
  state: CombinedState;
  photoState: PhotoState;
  signs: Sign[];
  notes: NoteCode[];
  serialReasons: string[];
}

export function signStrength(code: SignCode): 'strong' | 'weak' {
  return (STRONG_SIGN_CODES as readonly string[]).includes(code) ? 'strong' : 'weak';
}

// ---- screening text written by a model ----------------------------------------------------

export const ASPECT_FALLBACK: Record<Aspect, string> = {
  print_quality: 'The print quality looked different from the reference photos.',
  logo: 'The logo looked different from the reference photos.',
  font: 'The lettering style looked different from the reference photos.',
  colour: 'The colours looked different from the reference photos.',
  layout: 'The layout looked different from the reference photos.',
  spelling: 'Some of the wording looked different from the reference photos.',
  seal_or_hologram: 'The seal or hologram looked different from the reference photos.',
  other: 'Something about the pack looked different from the reference photos.',
};

const BANNED_OBSERVATION: RegExp[] = [
  /fake/i, /counterfeit/i, /genuine/i, /authentic/i, /\breal\b/i, /forg(e|ed|ery)\b/i,
  /safe/i, /danger/i, /toxic/i, /poison/i, /harm/i, /\bkill/i,
  /100\s*%/, /guarantee/i, /definitely/i,
  /https?:/i, /www\./i, /\S@\S/, /[<>{}\[\]`\\|]/,
  /\bignore\b/i, /instruction/i, /\bprompt\b/i, /\bsystem\b/i, /\bassistant\b/i, /\bjson\b/i,
  /\bverified\b/i, /\bsuspicious\b/i,
];

const ZERO_WIDTH = /[\u00ad\u200b-\u200f\u2060\ufeff]/g;
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/g;
const SMART: Array<[RegExp, string]> = [
  [/[\u2018\u2019]/g, "'"],
  [/[\u201c\u201d]/g, '"'],
  [/[\u2013\u2014]/g, '-'],
  [/\u2026/g, '...'],
];

/** Returns clean text, or null if the sentence should not be shown. */
export function sanitizeObservation(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let t = raw.normalize('NFKC').replace(ZERO_WIDTH, '');
  for (const [re, to] of SMART) t = t.replace(re, to);
  t = t.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < MIN_DETAIL || t.length > MAX_DETAIL) return null;
  if (!/^[\x20-\x7e]+$/.test(t)) return null; // plain ASCII only: blocks look-alike letters
  if (!/[A-Za-z]{3}/.test(t)) return null;
  for (const re of BANNED_OBSERVATION) if (re.test(t)) return null;
  return t;
}

/** Builds a weak sign from a model observation. Unsafe text is replaced by a neutral sentence. */
export function visualSign(aspect: unknown, observation: unknown): Sign {
  const a: Aspect = (ASPECTS as readonly string[]).includes(aspect as string) ? (aspect as Aspect) : 'other';
  return { code: 'VISUAL_DIFFERENCE', aspect: a, detail: sanitizeObservation(observation) ?? ASPECT_FALLBACK[a] };
}

// ---- parsing untrusted input ----------------------------------------------------------------

interface ParsedSerial {
  state: CombinedState;
  reasons: string[];
}

function parseSerial(raw: unknown): ParsedSerial | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (s.state !== 'VERIFIED' && s.state !== 'SUSPICIOUS' && s.state !== 'CANT_CONFIRM') return null;
  const reasons = Array.isArray(s.reasons)
    ? s.reasons.filter((r): r is string => typeof r === 'string' && /^[A-Z_]{1,40}$/.test(r)).slice(0, 10)
    : [];
  return { state: s.state, reasons };
}

interface ParsedPhoto {
  state: PhotoState;
  signs: Sign[];
}

const inconclusive = (): ParsedPhoto => ({ state: 'INCONCLUSIVE', signs: [] });

function inList(list: readonly string[], v: unknown): v is string {
  return typeof v === 'string' && list.includes(v);
}

function parsePhoto(raw: unknown, minConfidence: number): ParsedPhoto {
  if (typeof raw !== 'object' || raw === null) return inconclusive();
  const p = raw as Record<string, unknown>;
  if (p.usable !== true) return inconclusive();
  const c = p.confidence;
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1 || c < minConfidence) return inconclusive();
  if (!Array.isArray(p.signs)) return inconclusive();

  const out: Sign[] = [];
  const seen = new Set<string>();
  for (const item of p.signs.slice(0, 50)) {
    if (typeof item !== 'object' || item === null) return inconclusive();
    const s = item as Record<string, unknown>;
    // A sign we do not recognise could be anything, so the whole photo result becomes inconclusive.
    if (!inList(SIGN_CODES, s.code)) return inconclusive();
    const code = s.code as SignCode;
    let sign: Sign;
    if (code === 'VISUAL_DIFFERENCE') {
      sign = visualSign(s.aspect, s.detail);
    } else {
      sign = inList(SIGN_FIELDS, s.field) ? { code, field: s.field } : { code };
    }
    const key = `${sign.code}|${sign.field ?? ''}|${sign.detail ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sign);
  }

  const strong = out.filter((x) => signStrength(x.code) === 'strong');
  const weak = out.filter((x) => signStrength(x.code) === 'weak');
  const signs = [...strong, ...weak].slice(0, MAX_SIGNS);
  return { state: signs.length > 0 ? 'SIGNS_FOUND' : 'NO_SIGNS', signs };
}

// ---- the combiner ---------------------------------------------------------------------------

export function combine(serial: unknown, photo: unknown, opts?: { minConfidence?: number }): Combined {
  const m = opts?.minConfidence;
  const min = typeof m === 'number' && Number.isFinite(m) && m >= 0 && m <= 1 ? m : PHOTO_MIN_CONFIDENCE;
  const s = parseSerial(serial);
  const p = parsePhoto(photo, min);
  const serialState = s ? s.state : null;

  let state: CombinedState;
  if (p.state === 'SIGNS_FOUND') {
    const anyStrong = p.signs.some((x) => signStrength(x.code) === 'strong');
    state = serialState === 'SUSPICIOUS' || anyStrong ? 'SUSPICIOUS' : 'CANT_CONFIRM';
  } else if (serialState === 'VERIFIED') {
    state = 'VERIFIED'; // the only way to VERIFIED: a verified code scan and no signs
  } else if (serialState === 'SUSPICIOUS') {
    state = 'SUSPICIOUS';
  } else {
    state = 'CANT_CONFIRM';
  }

  const notes: NoteCode[] = [];
  if (p.state === 'NO_SIGNS') notes.push('PHOTO_NO_SIGNS_NOT_PROOF');
  if (p.state === 'INCONCLUSIVE') notes.push('PHOTO_INCONCLUSIVE');
  if (state !== 'VERIFIED') notes.push('ASK_PHARMACIST');

  return { state, photoState: p.state, signs: p.signs, notes, serialReasons: s ? s.reasons : [] };
}

/** Used when the photo feature is switched off: the code-scan result passes through unchanged. */
export function combineDisabled(serial: unknown): Combined {
  const s = parseSerial(serial);
  return {
    state: s ? s.state : 'CANT_CONFIRM',
    photoState: 'INCONCLUSIVE',
    signs: [],
    notes: [],
    serialReasons: s ? s.reasons : [],
  };
}