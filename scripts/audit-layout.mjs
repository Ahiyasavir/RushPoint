#!/usr/bin/env node
// Layout audit of the creator's setup walk (2026-10-27), on the LOCAL dev stack (`npm run dev:all`).
// Builds a fresh game through the composer with the seed creator, then at EVERY screen of the walk
// re-lays the page out at six sizes (two phones, a tablet, three desktops) and asks the browser for
// nested scrolls, clipped content and undersized maps (scripts/lib/layoutAudit.mjs). A dev aid, not a
// gate: it needs a running stack and a browser. Writes <out>/report.json and one screenshot per
// screen and size that has a problem.
//
//   node scripts/audit-layout.mjs <outDir> [--sizes=phone,desktop] [--screens=40] [--game=<id>] [--shots=phone]
// --shots saves a screenshot of EVERY screen at those sizes, for a review by eye.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { auditLayoutInPage, AUDIT_VIEWPORTS, judgeLayout } from './lib/layoutAudit.mjs';

const OUT = process.argv[2] || 'layout-audit';
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').split('=')[1] || '';
const SIZES = arg('sizes') ? AUDIT_VIEWPORTS.filter((v) => arg('sizes').split(',').includes(v.name)) : AUDIT_VIEWPORTS;
const MAX_SCREENS = Number(arg('screens')) || 60;
const BASE = 'http://localhost:5180';
fs.mkdirSync(OUT, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// The installed Chrome when PLAYWRIGHT_CHANNEL says so (the Playwright browsers are not always on this machine).
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
const page = await ctx.newPage();
page.setDefaultTimeout(25_000);

await page.goto(`${BASE}/#signin`);
await page.getByPlaceholder('you@example.com').fill('creator@rushpoint.dev');
await page.locator('input[type=password]').fill('test1234');
await page.getByRole('button', { name: /^כניסה/ }).click();
await page.getByRole('button', { name: /משחק חדש/ }).first().waitFor({ timeout: 90_000 });
// Whatever greets a creator (tour, what's new, a restore prompt) is closed first.
await pause(2500);
// Skipped for a given game: one of these answers ("not now") also turned the walk's own opening off.
for (let k = 0; k < (arg('game') ? 0 : 4); k++) {
  const dlg = page.locator('[role=alertdialog], [role=dialog]').first();
  if (!(await dlg.isVisible().catch(() => false))) break;
  const close = dlg.getByRole('button', { name: /הבנתי|דלגו|סגירה|לא עכשיו|ביטול|סגור/ }).first();
  if (await close.isVisible().catch(() => false)) await close.click().catch(() => undefined); else await page.keyboard.press('Escape');
  await pause(500);
}

// The composer, with a high prep level so the walk carries prep cards and places.
await page.getByRole('button', { name: /משחק חדש/ }).first().click();
await page.getByPlaceholder('למשל: מרוץ השבט').fill('בדיקת פריסה');
for (let i = 0; i < 14; i++) {
  const compose = page.getByRole('button', { name: 'הרכיבו לי משחק' });
  if (await compose.isVisible().catch(() => false)) { await compose.click(); break; }
  if (await page.getByText('כמה בא לכם להתכונן מראש?').isVisible().catch(() => false)) {
    await page.locator('[role=dialog] button').filter({ hasText: /^5$/ }).first().click({ timeout: 1500 }).catch(() => undefined);
  }
  if (await page.getByText('איפה זה קורה?').isVisible().catch(() => false)) {
    for (const p of ['פארק', 'מרכז העיר']) await page.getByRole('button', { name: p, exact: true }).click({ timeout: 1500 }).catch(() => undefined);
  }
  if (await page.getByText('מי משחק?').isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /נוער, 14 עד/ }).click({ timeout: 1500 }).catch(() => undefined);
  }
  await page.getByRole('button', { name: 'הבא', exact: true }).last().click().catch(() => undefined);
  await pause(300);
}
const flow = page.locator('[role=dialog][aria-label="מכינים את המשחק"]');
// A dev server reload (HMR while someone edits) can drop the session mid-run: sign in again and
// reopen the walk on the game the composer just made, straight from its address.
async function signIn() {
  await page.getByPlaceholder('you@example.com').fill('creator@rushpoint.dev');
  await page.locator('input[type=password]').fill('test1234');
  await page.getByRole('button', { name: /^כניסה/ }).click();
  await page.getByRole('button', { name: /משחק חדש/ }).first().waitFor({ timeout: 90_000 });
}
async function openWalk(gameId) {
  await page.goto(`${BASE}/build/${gameId}`); await pause(2500);
  if (await page.getByPlaceholder('you@example.com').isVisible().catch(() => false)) { await signIn(); await page.goto(`${BASE}/build/${gameId}`); await pause(2500); }
  await page.evaluate(() => { history.replaceState({ usr: { rpJustCreated: true, rpOpenSetup: true }, key: 'x', idx: 0 }, '', location.pathname); });
  await page.reload(); await pause(4000);
}
const GAME = arg('game');
if (GAME) await openWalk(GAME);
else {
  await flow.waitFor({ timeout: 60_000 }).catch(async () => {
    const id = (page.url().match(/\/build\/([^/?#]+)/) || [])[1];
    if (!id) throw new Error('the composer did not open a game: ' + page.url());
    await openWalk(id);
  });
}
await flow.waitFor({ timeout: 30_000 });
await pause(1500);

const report = [];
let worst = 0;
for (let i = 0; i < MAX_SCREENS; i++) {
  const title = ((await flow.locator('h1,h2,h3').first().textContent().catch(() => '')) || '').trim().slice(0, 50);
  const ask = ((await flow.locator('h3').first().textContent().catch(() => '')) || '').trim().slice(0, 40);
  const screen = { i, title, ask, sizes: {} };
  for (const v of SIZES) {
    await page.setViewportSize({ width: v.width, height: v.height });
    // Long enough for the layout to settle: a shot taken mid-resize shows a phone column in a desktop window.
    await pause(1500);
    const r = await page.evaluate(auditLayoutInPage, { root: '[role=dialog][aria-label="מכינים את המשחק"]' });
    const problems = judgeLayout(r);
    screen.sizes[v.name] = { problems, maps: r.maps, contentWidthShare: r.contentWidthShare };
    const SHOTS = arg('shots').split(',').filter(Boolean);
    if (problems.length || SHOTS.includes(v.name)) {
      worst += problems.length;
      const shot = () => page.screenshot({ path: path.join(OUT, `${String(i).padStart(2, '0')}-${v.name}.png`), timeout: 15000 });
      await shot().catch(() => pause(1500).then(shot)).catch(() => console.log(`   (no screenshot at ${v.name})`));
    }
  }
  report.push(screen);
  const bad = Object.entries(screen.sizes).filter(([, s]) => s.problems.length);
  console.log(`${String(i).padStart(2)} ${title} / ${ask}: ${bad.length ? bad.map(([n, s]) => `${n}[${s.problems.join('; ')}]`).join(' ') : 'clean'}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  if (await flow.getByText(/מה להכין לפני המשחק/).first().isVisible().catch(() => false)) break;
  // Move on: place a pin where a map asks for one, otherwise just press the primary.
  const canvas = flow.locator('.maplibregl-canvas').first();
  if (await canvas.isVisible().catch(() => false)) {
    const box = await canvas.boundingBox();
    if (box) await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await pause(300);
  }
  await flow.locator('footer button').last().click();
  await pause(600);
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
console.log(`\n${worst} problem(s) across ${report.length} screens x ${SIZES.length} sizes. Report: ${path.join(OUT, 'report.json')}`);
process.exit(worst ? 1 : 0);
