import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export const MAX_PHOTOS = 3;
const MAX_WIDTH = 1280;
const QUALITY = 0.6;

export class PhotoPermissionError extends Error {
  constructor() {
    super('camera_permission_denied');
    this.name = 'PhotoPermissionError';
  }
}

/** Shrinks a photo and returns it as a base64 JPEG string (about 150-300 KB). */
async function shrinkToBase64(uri: string): Promise<string> {
  // The module is typed loosely on purpose: SDK 57 has a newer and an older (deprecated) API.
  const M = ImageManipulator as any;
  if (M.ImageManipulator && typeof M.ImageManipulator.manipulate === 'function') {
    const ctx = M.ImageManipulator.manipulate(uri);
    ctx.resize({ width: MAX_WIDTH });
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ format: M.SaveFormat.JPEG, compress: QUALITY, base64: true });
    if (!out.base64) throw new Error('photo_encode_failed');
    return out.base64 as string;
  }
  const out = await M.manipulateAsync(uri, [{ resize: { width: MAX_WIDTH } }], {
    compress: QUALITY,
    format: M.SaveFormat.JPEG,
    base64: true,
  });
  if (!out.base64) throw new Error('photo_encode_failed');
  return out.base64 as string;
}

export async function takePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new PhotoPermissionError();
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
  const asset = res.assets?.[0];
  if (res.canceled || !asset) return null;
  return shrinkToBase64(asset.uri);
}

export async function pickPhoto(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
  const asset = res.assets?.[0];
  if (res.canceled || !asset) return null;
  return shrinkToBase64(asset.uri);
}

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(128);
for (let i = 0; i < CHARS.length; i++) LOOKUP[CHARS.charCodeAt(i)] = i;

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const outLen = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = LOOKUP[clean.charCodeAt(i)] ?? 0;
    const e2 = LOOKUP[clean.charCodeAt(i + 1)] ?? 0;
    const e3 = i + 2 < clean.length ? (LOOKUP[clean.charCodeAt(i + 2)] ?? 0) : 0;
    const e4 = i + 3 < clean.length ? (LOOKUP[clean.charCodeAt(i + 3)] ?? 0) : 0;
    out[o++] = (e1 << 2) | (e2 >> 4);
    if (o < outLen) out[o++] = ((e2 & 15) << 4) | (e3 >> 2);
    if (o < outLen) out[o++] = ((e3 & 3) << 6) | e4;
  }
  return out;
}