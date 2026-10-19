import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Bundle, VerifyResult } from './types';

export type ApiErrorKind = 'rate_limited' | 'invalid_code' | 'auth' | 'network' | 'server';

export class ApiError extends Error {
  kind: ApiErrorKind;
  constructor(kind: ApiErrorKind, message: string) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
  }
}

function toApiError(e: PostgrestError): ApiError {
  if (e.message === 'rate_limited') return new ApiError('rate_limited', e.message);
  if (e.message === 'invalid_code') return new ApiError('invalid_code', e.message);
  if (e.message === 'auth_required') return new ApiError('auth', e.message);
  // Errors raised by the server carry a code; failed network requests do not.
  if (!e.code) return new ApiError('network', e.message);
  return new ApiError('server', e.message);
}

export async function verifyCode(
  code: string,
  coords: { lat: number; lng: number } | null,
): Promise<VerifyResult> {
  const { data, error } = await supabase.rpc('verify_code', {
    p_code: code,
    p_lat: coords ? coords.lat : null,
    p_lng: coords ? coords.lng : null,
  });
  if (error) throw toApiError(error);
  return data as VerifyResult;
}

export async function syncBundle(): Promise<Bundle> {
  const { data, error } = await supabase.rpc('sync_bundle');
  if (error) throw toApiError(error);
  return data as Bundle;
}