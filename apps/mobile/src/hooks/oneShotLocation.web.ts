import type { DeviceCoords } from './useDeviceLocation';

/**
 * One-shot GPS fix for geofenced station-code submissions (WEB).
 *
 * Uses the browser Geolocation API directly; we intentionally do NOT import
 * `expo-location` here (its web polyfill crashes on unmount — see
 * `useDeviceLocation.web.ts`). Returns null on permission denial / unavailability
 * so the caller can submit without GPS (the server only enforces geofenced stations).
 */
export async function getOneShotLocation(): Promise<DeviceCoords | null> {
  const geo = (globalThis as unknown as { navigator?: { geolocation?: Geolocation } })
    .navigator?.geolocation;
  if (!geo?.getCurrentPosition) return null;
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 10_000, timeout: 15_000 },
    );
  });
}
