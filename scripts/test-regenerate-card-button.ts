// Regenerate is one visible press on every mission card (change: composer-v2-phase0).
//
// It used to sit inside the card's "⋯" menu with no feedback and no visible way back. The founder
// wants a prominent button, a nice effect, and something that makes building feel good. No
// component test runner exists in creator-web, so this pins the wiring by source scan; the look
// itself is checked in the browser preview.
//   npx tsx scripts/test-regenerate-card-button.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function ok(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const card = read('apps/creator-web/src/components/TaskCard.tsx');
const canvas = read('apps/creator-web/src/components/TaskCanvas.tsx');
const builder = read('apps/creator-web/src/pages/BuilderPage.tsx');
const toast = read('apps/creator-web/src/components/toast.tsx');
const css = read('apps/creator-web/src/index.css');
const i18n = read('apps/creator-web/src/i18n.ts');

const flat = (s: string) => s.replace(/\s+/g, ' ');

// ── The button ──────────────────────────────────────────────────────────────
// A button's opening tag can hold `=>` inside its handlers, so it is read as the text up to the
// first `>` that closes the tag line, not up to the first `>` of all.
const buttons = flat(card).split('<button').slice(1).map((rest) => rest.slice(0, rest.search(/">|\}>/) + 2));
const visible = buttons.filter((b) => /onClick=\{[^}]*onRegenerate/.test(b) && !/role="menuitem"/.test(b));
ok('the card shows a regenerate button outside the menu', visible.length === 1);
ok('it has an accessible name from the dictionary', visible.some((b) => /aria-label=\{b\.regenerateTask\}/.test(b)));
ok('it is a real tap target (TAP_CLUSTER)', visible.some((b) => /TAP_CLUSTER/.test(b)));
ok('it draws the dice icon', /onRegenerate[\s\S]{0,700}<Icon name="dice"/.test(card));
ok('the menu item stays, for keyboard users who live in the menu', /role="menuitem" onClick=\{onRegenerate\}/.test(flat(card)));

// ── The effect ──────────────────────────────────────────────────────────────
ok('the card takes a regenerate nonce', /regenNonce\?: number/.test(card));
ok('the spin replays on every swap (keyed on the nonce)', /key=\{`regen-\$\{regenNonce\}`\}|rp-regen-spin/.test(card) && /regenNonce/.test(card));
ok('the canvas passes the nonce through', /regenNonce=\{/.test(canvas));
ok('the spin animation exists', /\.rp-regen-spin\s*\{[\s\S]*?animation:/.test(css) && /@keyframes rp-regen-spin/.test(css));
ok('reduced motion turns the spin off', /prefers-reduced-motion: reduce\)\s*\{\s*\.rp-regen-spin\s*\{\s*animation: none/.test(css));

// ── The way back ────────────────────────────────────────────────────────────
ok('a toast with an action stays long enough to read and undo', /ACTION_DISMISS_MS = (\d+)/.test(toast) && Number(/ACTION_DISMISS_MS = (\d+)/.exec(toast)![1]) >= 6000);
ok('a toast can carry an action button', /action\?: \{ label: string; onClick: \(\) => void \}/.test(toast) && /t\.action/.test(toast));
const regen = builder.slice(builder.indexOf('function regenerateTask('), builder.indexOf('function regenerateTask(') + 1400);
ok('the card swap toasts with an undo that runs the Builder history', /toast\.info\([\s\S]*?action: \{ label: b\.regenerateUndo, onClick: undo \}/.test(regen));
ok('the swap bumps the nonce for that card', /setRegenNonce/.test(regen));
ok('both dictionaries name the toast and its undo',
  (i18n.match(/regenerateDone:/g) ?? []).length === 2 && (i18n.match(/regenerateUndo:/g) ?? []).length === 2);

console.log(failures === 0 ? '\n✅ regenerate card button: ALL PASS' : `\n❌ regenerate card button: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
