// Guard for the participant app's top overlay stack (change: play-top-overlay-stack).
//
// Two defects lived here, and both were invisible to every gate the repo had.
//
// (1) OVERLAP. Three `position: fixed` status overlays sat at three hardcoded top
//     offsets — the offline banner at 0, the power-up toast at 0.75rem, the
//     reconnect pill at 2rem — each sized so that IT alone looked right. They are
//     owned by two unrelated React trees (App mounts the banner, PlayScreen the
//     other two), so no component could see the others. Measured, the boxes are
//     ~[0,28], ~[12,48] and ~[32,60]: the banner overlaps the toast and the toast
//     overlaps the pill. Going offline is exactly the event that raises the banner
//     AND fails the poll, so this was reachable in ordinary field play.
//
// (2) TOP INSET. index.html sets `viewport-fit=cover` and the manifest asks for
//     `display: standalone`, so an installed PWA and the Play Store TWA draw the
//     page UNDER the status bar and the notch. Only those fixed overlays folded in
//     `env(safe-area-inset-top)`; every page SHELL ran on flat `pt-6`/`py-6`/`p-6`
//     or nothing at all, putting the header inside the cutout. In a browser tab
//     the inset resolves to 0 and the browser's own chrome hides the mistake,
//     which is why it survived: the bug only exists in the context real players
//     install into, and no screenshot taken on a desktop can show it.
//
// The fix is structural — ONE fixed flex column, ordered by flex `order` — so this
// guard is about keeping it structural. The shell list is DECLARED, not inferred,
// in the same spirit as callableHardening and hotPathReads: a new full-height
// shell must state its intent here rather than quietly inherit a missing inset.
//
//   npx tsx scripts/test-top-overlay-stack.ts
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playWebTsxFiles } from './lib/playA11yScan';
import { TOP_OVERLAY_ORDER, slotFor } from '../apps/play-web/src/lib/topOverlays';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLAY = join(ROOT, 'apps', 'play-web');

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string, detail = ''): void {
  if (cond) { passed++; console.log(`PASS  ${msg}`); }
  else { failed++; console.log(`FAIL  ${msg}${detail ? ' :: ' + detail : ''}`); }
}

// ── The pure ordering contract ────────────────────────────────────────────────
const orderValues = Object.values(TOP_OVERLAY_ORDER);
ok(new Set(orderValues).size === orderValues.length,
  'every top overlay has a distinct flex order', JSON.stringify(TOP_OVERLAY_ORDER));
ok(TOP_OVERLAY_ORDER.offline < TOP_OVERLAY_ORDER.reconnecting,
  'the offline banner outranks the reconnect pill (it explains the pill)');
ok(TOP_OVERLAY_ORDER.reconnecting < TOP_OVERLAY_ORDER.powerUp,
  'a problem outranks a celebration');
ok(slotFor('offline') === 'banner',
  'the persistent offline banner reserves layout space instead of covering the header');
ok(slotFor('reconnecting') === 'toast' && slotFor('powerUp') === 'toast',
  'transient overlays float and never reflow the run');

// ── The CSS the stack rests on ────────────────────────────────────────────────
const css = readFileSync(join(PLAY, 'src', 'index.css'), 'utf8');
for (const cls of ['.rp-top-stack', '.rp-safe-t', '.rp-safe-t-flush']) {
  ok(css.includes(cls), `index.css defines ${cls}`);
}
ok(/\.rp-top-stack\s*\{[^}]*position:\s*fixed/.test(css),
  'the stack is one fixed container, not one per overlay');
ok(/\.rp-top-stack\s*\{[^}]*flex-direction:\s*column/.test(css),
  'the stack lays overlays out in flow, so they cannot overlap by construction');
ok(/\.rp-top-stack\s*\{[^}]*gap:/.test(css),
  'the stack separates overlays with a real gap');
ok(/\.rp-top-stack\s*\{[^}]*pointer-events:\s*none/.test(css),
  'the stack never eats a tap meant for the header underneath it');
for (const cls of ['rp-safe-t', 'rp-safe-t-flush']) {
  ok(new RegExp(`\\.${cls}\\s*\\{[^}]*env\\(safe-area-inset-top`).test(css),
    `.${cls} folds in the top safe-area inset`);
  ok(new RegExp(`\\.${cls}\\s*\\{[^}]*var\\(--rp-top-stack-h`).test(css),
    `.${cls} also reserves room for a pushing banner`);
}

// ── No component may re-invent a fixed top overlay ────────────────────────────
// The three hardcoded offsets are gone; nothing may reintroduce the pattern.
const files = playWebTsxFiles(PLAY);
ok(files.length > 0, 'found play-web components to scan');
const HOST = join('src', 'components', 'TopOverlays.tsx');
const strays: string[] = [];
for (const file of files) {
  const rel = relative(PLAY, file);
  if (rel === HOST) continue; // the stack itself
  const src = readFileSync(file, 'utf8');
  src.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (!/className=/.test(line)) return;
    if (!/\bfixed\b/.test(line)) return;
    // A pinned-to-the-top layer. `inset-0` is a full-screen modal scrim, which is
    // a different thing and stays allowed.
    if (/\binset-0\b/.test(line)) return;
    if (/rp-safe-top|\btop-\d|\btop-\[/.test(line)) strays.push(`${rel}:${i + 1}`);
  });
}
ok(strays.length === 0,
  'no component pins its own overlay to a hardcoded top offset (use TopOverlay)',
  strays.join(', '));
ok(!css.includes('.rp-safe-top-'),
  'the three per-overlay top offsets are gone from index.css');

// ── Every full-height shell states its top-inset intent ───────────────────────
// Declared, never inferred: a shell that fills the viewport draws under the notch
// in standalone, so it either folds the inset in or says here why it need not.
const SHELLS: Record<string, { file: string; needsInset: boolean; why: string }> = {
  'Screen (the shared participant shell)': {
    file: 'src/components/ui.tsx', needsInset: true,
    why: 'wraps the header of every in-run screen',
  },
  JoinScreen: {
    file: 'src/screens/JoinScreen.tsx', needsInset: true,
    why: 'the first screen every player sees, and it brings its own shell',
  },
  StaffConsole: {
    file: 'src/screens/StaffConsole.tsx', needsInset: true,
    why: 'staff hold this open for the whole run',
  },
  LegalScreen: {
    file: 'src/screens/LegalScreen.tsx', needsInset: true,
    why: 'reachable directly at /terms and /privacy, so it is its own page',
  },
  CeremonyScreen: {
    file: 'src/screens/CeremonyScreen.tsx', needsInset: true,
    why: 'a full-bleed results screen with content at the top edge',
  },
  TvLeaderboard: {
    file: 'src/screens/TvLeaderboard.tsx', needsInset: false,
    why: 'shown on a television or a laptop in a browser tab, never installed on a phone',
  },
  ErrorBoundary: {
    file: 'src/components/ErrorBoundary.tsx', needsInset: false,
    why: 'a single vertically-centred card; nothing sits at the top edge to be clipped',
  },
  'App route loaders': {
    file: 'src/App.tsx', needsInset: false,
    why: 'vertically-centred spinners with no top-edge content',
  },
};
for (const [name, { file, needsInset, why }] of Object.entries(SHELLS)) {
  const src = readFileSync(join(PLAY, file), 'utf8');
  ok(src.includes('min-h-screen'),
    `${name} is still a full-height shell (stale entry otherwise)`, file);
  const has = /\brp-safe-t\b|\brp-safe-t-flush\b/.test(src);
  ok(has === needsInset,
    needsInset
      ? `${name} folds in the top safe-area inset (${why})`
      : `${name} declares it needs no top inset (${why})`,
    file);
}

console.log(`\n${failed === 0 ? 'ALL TOP OVERLAY STACK TESTS PASSED' : 'TOP OVERLAY STACK TESTS FAILED'} (${passed} passed, ${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
