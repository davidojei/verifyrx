import type { ResultState } from '@verifyrx/decision';

export const colors = {
  bg: '#FFFFFF',
  text: '#111827',
  muted: '#4B5563',
  border: '#D1D5DB',
  card: '#F3F4F6',
  primary: '#0B5FFF',
  danger: '#B3261E',
};

export const stateColor: Record<ResultState, string> = {
  VERIFIED: '#1B7F3B',
  SUSPICIOUS: '#B3261E',
  CANT_CONFIRM: '#9A5B00',
};

// Symbols as well as colour, so the state never depends on colour alone.
export const stateSymbol: Record<ResultState, string> = {
  VERIFIED: '\u2713',
  SUSPICIOUS: '!',
  CANT_CONFIRM: '?',
};