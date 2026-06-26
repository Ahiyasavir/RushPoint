// Pure-logic tests for GPS error UX (change: prelaunch-critical-fixes, C1/C2).
// withLocation must surface GPS denial/absence via an onDenied callback instead of
// silently calling cb(0, 0). Extracted to apps/play-web/src/utils/withLocation.ts so it
// imports with no React. No emulator.
//   npx tsx scripts/test-gps-error-ux.ts
import { withLocation } from '../apps/play-web/src/utils/withLocation';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// Mock helpers for navigator.geolocation.
type GeoMock = { success?: { latitude: number; longitude: number }; error?: boolean };
function setNavigator(value: unknown): void {
  // Node 24 ships a read-only `navigator` global, so a plain assignment is
  // ignored — define the property so the mock actually takes effect.
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}
function installGeo(mock: GeoMock | null): void {
  if (mock === null) {
    setNavigator({ geolocation: undefined });
    return;
  }
  setNavigator({
    geolocation: {
      getCurrentPosition(ok: (p: { coords: { latitude: number; longitude: number } }) => void, err: () => void) {
        if (mock.error) { err(); return; }
        if (mock.success) ok({ coords: mock.success });
      },
    },
  });
}

// 1. GPS denied → onDenied called once, cb not called.
{
  installGeo({ error: true });
  let cbCalls = 0, deniedCalls = 0;
  withLocation(() => { cbCalls++; }, () => { deniedCalls++; });
  check('GPS denied → onDenied called once', deniedCalls === 1, `denied=${deniedCalls}`);
  check('GPS denied → cb NOT called', cbCalls === 0, `cb=${cbCalls}`);
}

// 2. geolocation absent → onDenied called once, cb not called.
{
  installGeo(null);
  let cbCalls = 0, deniedCalls = 0;
  withLocation(() => { cbCalls++; }, () => { deniedCalls++; });
  check('geolocation absent → onDenied called once', deniedCalls === 1, `denied=${deniedCalls}`);
  check('geolocation absent → cb NOT called', cbCalls === 0, `cb=${cbCalls}`);
}

// 3. GPS success → cb called with coords, onDenied not called.
{
  installGeo({ success: { latitude: 32.08, longitude: 34.78 } });
  let got: [number, number] | null = null, deniedCalls = 0;
  withLocation((lat, lng) => { got = [lat, lng]; }, () => { deniedCalls++; });
  check('GPS success → cb called with coords', got?.[0] === 32.08 && got?.[1] === 34.78, JSON.stringify(got));
  check('GPS success → onDenied NOT called', deniedCalls === 0, `denied=${deniedCalls}`);
}

// 4. No onDenied provided + GPS error → no crash, cb not called.
{
  installGeo({ error: true });
  let cbCalls = 0, threw = false;
  try { withLocation(() => { cbCalls++; }); } catch { threw = true; }
  check('no onDenied + error → does not throw', !threw);
  check('no onDenied + error → cb NOT called', cbCalls === 0, `cb=${cbCalls}`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}  (test-gps-error-ux)`);
process.exit(failures === 0 ? 0 : 1);
