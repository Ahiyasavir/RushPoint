import * as Location from 'expo-location';
import type { DeviceCoords } from './useDeviceLocation';

/**
 * One-shot GPS fix for geofenced station-code submissions (NATIVE).
 *
 * Web uses the sibling `oneShotLocation.web.ts` (browser Geolocation API) so the
 * `expo-location` polyfill is never installed in the web bundle — same deliberate
 * split as `useDeviceLocation`. Returns null on permission denial / unavailability
 * so the caller can submit without GPS (the server only enforces geofenced stations).
 */
export async function getOneShotLocation(): Promise<DeviceCoords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}
