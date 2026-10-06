// Pure-logic tests for orientation while playing and filming (change: capture-rotation).
//
// Field report 2026-09-27: "it doesn't let me rotate the screen in the middle of filming". The app
// was locked to portrait in BOTH manifests; the TWA bakes that into AndroidManifest.xml and the
// Screen Orientation API's unlock() only returns to that default, so no code could free it. The
// manifests now say "any"; the game asks for portrait where it can, and releases it while filming.
import { existsSync, readFileSync } from 'node:fs';
import { orientationIntent } from '../apps/play-web/src/lib/orientation';

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}\n      got  ${a}\n      want ${e}`);
}

console.log('\n— what the app asks for —');
eq('playing, camera closed ⇒ portrait', orientationIntent({ screen: 'game', cameraOpen: false }), 'portrait');
eq('playing, camera open ⇒ free (turn the phone to film)', orientationIntent({ screen: 'game', cameraOpen: true }), 'free');
eq('any other screen ⇒ free', orientationIntent({ screen: 'other', cameraOpen: false }), 'free');
eq('junk ⇒ free (never lock by accident)', orientationIntent(null as never), 'free');

console.log('\n— the manifests no longer lock the app —');
const web = JSON.parse(readFileSync('apps/play-web/public/manifest.webmanifest', 'utf8')) as { orientation?: string };
eq('the web manifest allows any orientation', web.orientation, 'any');
const twa = JSON.parse(readFileSync('twa-manifest.json', 'utf8')) as { orientation?: string };
eq('the Play Store (TWA) manifest allows any orientation', twa.orientation, 'any');
// Issue 21 (2026-10-06): twa-manifest.json said "any" since 2026-09-29, but the Android build reads
// app/build.gradle, which still said 'portrait', so the installed app stayed locked while filming.
// The gradle file is what ships: it must agree with the manifest, version included. `app/` is
// gitignored (the generated Android project lives only on the machine that builds the AAB), so the
// check runs where it exists and SAYS when it was skipped.
if (existsSync('app/build.gradle')) {
  const gradle = readFileSync('app/build.gradle', 'utf8');
  eq('the Android build (app/build.gradle) allows any orientation', /orientation:\s*'([^']+)'/.exec(gradle)?.[1], 'any');
  const twaVersion = JSON.parse(readFileSync('twa-manifest.json', 'utf8')) as { appVersionCode?: number };
  eq('the Android build carries the manifest version code', Number(/versionCode\s+(\d+)/.exec(gradle)?.[1]), twaVersion.appVersionCode);
} else {
  console.log('  - skipped: no app/build.gradle in this checkout (the Android project is not in git)');
}

console.log('');
if (failures > 0) {
  console.error(`✗ orientation-intent: ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('✓ orientation-intent: all assertions passed\n');
