#!/usr/bin/env node
// The deploy checklist PDF (Ahiya, 2026-10-05): one designed PDF per production deploy, always in
// the same template: computer checks, phone checks, special checks, then what changed.
//
//   npm run checks:pdf -- docs/deploy-checks/2026-10-05.md            → same path, .pdf
//   npm run checks:pdf -- docs/deploy-checks/2026-10-05.md out.pdf
//
// The source format and the template live in scripts/lib/deployChecks.mjs. Printed by the
// Chromium that Playwright already installs for the e2e UI suite, so Hebrew right to left and the
// page footer render exactly as in a browser.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { renderHtml, frontMatter } from './lib/deployChecks.mjs';

const [src, outArg] = process.argv.slice(2);
if (!src) {
  console.error('usage: npm run checks:pdf -- docs/deploy-checks/<date>.md [out.pdf]');
  process.exit(1);
}
const out = outArg ?? src.replace(/\.md$/i, '.pdf');
const md = readFileSync(src, 'utf8');
const html = renderHtml(md);
const { meta } = frontMatter(md);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({
    path: out,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="font-family:Segoe UI,Arial;font-size:8px;color:#78716c;width:100%;padding:0 14mm;display:flex;justify-content:space-between;direction:rtl">
      <span>RushPoint · ${String(meta.title ?? 'בדיקות אחרי דיפלויי').replace(/</g, '')}</span>
      <span>עמוד <span class="pageNumber"></span> מתוך <span class="totalPages"></span></span></div>`,
    margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
  });
} finally {
  await browser.close();
}
console.log(`✓ ${path.resolve(out)}`);
