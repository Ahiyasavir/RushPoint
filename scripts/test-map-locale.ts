// Every map speaks the app's language (found playing at 375px, 2026-10-03).
//
// The mission editor's map showed "Use two fingers to move the map" in the middle
// of a Hebrew screen. MapLibre ships English defaults for every word it draws
// itself: the two-finger hint, the zoom buttons' labels, the attribution toggle,
// the map's own accessible name. None of it goes through `t.*`, so the i18n gate
// cannot see it, and on a phone the two-finger hint is the first thing a creator
// reads on the map.
//
// The fix is MapLibre's `locale` option, filled from our dictionaries through one
// helper per app (`lib/mapLocale.ts`, duplicated on purpose like `mapRtl.ts`:
// packages/shared holds no map engine). This gate requires every
// `new maplibregl.Map(` in both apps to pass it, and the helper to cover every key
// the controls we use display.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapLocale as creatorMapLocale, MAP_LOCALE_KEYS as CREATOR_KEYS } from '../apps/creator-web/src/lib/mapLocale';
import { mapLocale as playMapLocale, MAP_LOCALE_KEYS as PLAY_KEYS } from '../apps/play-web/src/lib/mapLocale';
import { translations as CREATOR } from '../apps/creator-web/src/i18n';
import { translations as PLAY } from '../apps/play-web/src/i18n';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`); }
};

function tsx(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) tsx(p, out);
    else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

console.log('\nmaps speak the app language');

// The words the controls we use actually draw. A key here that MapLibre stops
// using is harmless; a key MapLibre draws that is missing here shows English.
const REQUIRED = [
  'Map.Title',
  'NavigationControl.ZoomIn', 'NavigationControl.ZoomOut', 'NavigationControl.ResetBearing',
  'AttributionControl.ToggleAttribution', 'AttributionControl.MapFeedback',
  'CooperativeGesturesHandler.MobileHelpText', 'CooperativeGesturesHandler.WindowsHelpText',
  'CooperativeGesturesHandler.MacHelpText',
  'Popup.Close',
  'GeolocateControl.FindMyLocation', 'GeolocateControl.LocationNotAvailable',
];
for (const [app, keys] of [['creator', CREATOR_KEYS], ['play', PLAY_KEYS]] as const) {
  const missing = REQUIRED.filter((k) => !keys.includes(k));
  check(`${app}: the locale covers every key the controls draw`, missing.length === 0, missing);
}

for (const [app, fn, dict] of [['creator', creatorMapLocale, CREATOR], ['play', playMapLocale, PLAY]] as const) {
  for (const lang of ['he', 'en'] as const) {
    const loc = fn((dict[lang] as unknown as { mapUi: never }).mapUi);
    const empty = REQUIRED.filter((k) => typeof loc[k] !== 'string' || loc[k].trim() === '');
    check(`${app} ${lang}: every key has text`, empty.length === 0, empty);
  }
  const he = fn((dict.he as unknown as { mapUi: never }).mapUi);
  check(`${app}: the Hebrew two-finger hint is Hebrew`, /[֐-׿]/.test(he['CooperativeGesturesHandler.MobileHelpText'] ?? ''));
}

const sites: string[] = [];
const missingLocale: string[] = [];
for (const app of ['apps/creator-web/src', 'apps/play-web/src']) {
  for (const f of tsx(path.join(ROOT, app))) {
    const src = readFileSync(f, 'utf8');
    let i = src.indexOf('new maplibregl.Map(');
    while (i >= 0) {
      const rel = path.relative(ROOT, f);
      sites.push(rel);
      const window = src.slice(i, i + 1500);
      const close = window.indexOf('});');
      const block = close > 0 ? window.slice(0, close) : window;
      if (!/\blocale:\s*mapLocale\(/.test(block)) missingLocale.push(rel);
      i = src.indexOf('new maplibregl.Map(', i + 1);
    }
  }
}
check(`the scan found the maps (${sites.length})`, sites.length >= 7, sites);
check('every map passes locale: mapLocale(...)', missingLocale.length === 0, missingLocale);

console.log(failures === 0 ? '\n✅ map locale: ALL PASS' : `\n❌ map locale: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
