import * as Location from 'expo-location';
import { getShareArea, setShareArea } from './cache';

function round2(n: number): number {
  return Math.round(n * 100) / 100; // about 1 km
}

/** Approximate position, only if the user switched area sharing on. Never waits for a GPS fix. */
export async function approxCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    if (!(await getShareArea())) return null;
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const pos = await Location.getLastKnownPositionAsync();
    if (!pos) return null;
    return { lat: round2(pos.coords.latitude), lng: round2(pos.coords.longitude) };
  } catch {
    return null;
  }
}

export async function enableAreaSharing(): Promise<boolean> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    const ok = status === 'granted';
    await setShareArea(ok);
    return ok;
  } catch {
    return false;
  }
}