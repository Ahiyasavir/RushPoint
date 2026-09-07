// The creator-web file-save helper (change: share-ladder-unification).
//
// Four export surfaces each inlined the same six lines and each got them wrong the
// same way: the object URL was revoked on the SAME TICK as `a.click()`, and the
// anchor was never attached to the document. Chrome reads the blob synchronously
// inside click() and survives; Firefox and older WebKit queue the read, find the
// URL revoked, and produce no file, no error and no console warning.
//
// Nothing in the repo could have caught it — not tsc, not eslint, not a build. The
// only "test" was a developer on Chrome watching a file appear. The worst instance
// was Settings' "export my data", a legal obligation that silently did nothing.
//
// A fifth call site (RunConsolePage's photo downloader) had the correct sequence
// all along and it simply never travelled. These assertions make it travel.
import {
  downloadBlob, downloadUrl, downloadText, downloadJson, downloadCsv,
} from '../apps/creator-web/src/lib/downloadFile';

let failures = 0;
function ok(cond: boolean, label: string, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

interface FakeAnchor { href: string; download: string; rel: string; style: Record<string, string>; }

/** A minimal DOM that records the ORDER of every step. */
function installDom() {
  const log: string[] = [];
  let attached = false;
  let lastAnchor: FakeAnchor | null = null;
  const blobText = new Map<string, string>();
  const timers: Array<() => void> = [];

  const anchorFor = (): FakeAnchor & { click(): void; remove(): void } => {
    const a = {
      href: '', download: '', rel: '', style: {} as Record<string, string>,
      click() {
        // The heart of the bug: was the URL still alive, and was the anchor in
        // the document, at the moment the browser was asked to save?
        log.push(attached ? 'click:attached' : 'click:detached');
        if (a.href.startsWith('blob:') && !blobText.has(a.href)) log.push('click:dead-url');
      },
      remove() { attached = false; log.push('remove'); },
    };
    lastAnchor = a;
    return a;
  };

  (globalThis as { document?: unknown }).document = {
    createElement: () => anchorFor(),
    body: { appendChild: () => { attached = true; log.push('append'); } },
  };
  let n = 0;
  (globalThis as { URL?: unknown }).URL = {
    createObjectURL: (b: { __text?: string }) => {
      const u = `blob:fake-${++n}`;
      blobText.set(u, b.__text ?? '');
      log.push('create');
      return u;
    },
    revokeObjectURL: (u: string) => { blobText.delete(u); log.push('revoke'); },
  };
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => { timers.push(fn); return 0; }) as unknown as typeof setTimeout;
  (globalThis as { Blob?: unknown }).Blob = class {
    __text: string;
    type: string;
    constructor(parts: string[], opts?: { type?: string }) { this.__text = parts.join(''); this.type = opts?.type ?? ''; }
  };
  return { log, runTimers: () => timers.splice(0).forEach((f) => f()), anchor: () => lastAnchor, blobText };
}

const origDoc = (globalThis as { document?: unknown }).document;
const origURL = (globalThis as { URL?: unknown }).URL;
const origBlob = (globalThis as { Blob?: unknown }).Blob;
const origTimeout = globalThis.setTimeout;

console.log('\n[downloadFile] the object URL is alive when the browser reads it');
{
  const dom = installDom();
  const saved = downloadBlob(new Blob(['hello']) as unknown as Blob, 'a.txt');
  ok(saved === true, 'reports success when there is a DOM to save into');
  const clickIdx = dom.log.indexOf('click:attached');
  ok(clickIdx >= 0, 'the anchor is IN THE DOCUMENT when it is clicked — a detached anchor’s programmatic click is ignored by some engines');
  ok(!dom.log.includes('click:dead-url'),
    'the object URL is still live at click time');
  ok(!dom.log.slice(0, clickIdx + 1).includes('revoke'),
    'nothing was revoked before or during the click — a same-tick revoke is the silent no-file bug');
  dom.runTimers();
  ok(dom.log.includes('revoke'), 'and it IS revoked afterwards, so nothing leaks');
}

console.log('\n[downloadFile] no DOM ⇒ an honest failure, not a phantom success');
{
  (globalThis as { document?: unknown }).document = undefined;
  ok(downloadBlob(new Blob(['x']) as unknown as Blob, 'a.txt') === false,
    'downloadBlob returns false rather than claiming a file was saved');
  ok(downloadUrl('https://x.test/p.jpg', 'p') === false,
    'downloadUrl does the same — Settings’ GDPR export depends on this to show an error');
}

console.log('\n[downloadFile] CSV carries the UTF-8 BOM');
{
  const dom = installDom();
  downloadCsv('שם,ניקוד\nקבוצה,10', 'r.csv');
  const text = [...dom.blobText.values()][0] ?? [...(dom.blobText as Map<string, string>).values()][0];
  // The blob text is captured at creation, before the deferred revoke clears it.
  ok(typeof text === 'string' && text.charCodeAt(0) === 0xfeff,
    'a CSV starts with U+FEFF — without it Excel decodes the file as the system codepage and every Hebrew team name is mojibake',
    `got charCode ${typeof text === 'string' ? text.charCodeAt(0) : 'n/a'}`);
  ok(typeof text === 'string' && text.includes('שם,ניקוד'), 'and the content follows the BOM intact');
}

console.log('\n[downloadFile] the typed wrappers set a usable filename and MIME');
{
  const dom = installDom();
  downloadJson({ a: 1 }, 'game.json');
  const a = dom.anchor();
  ok(a?.download === 'game.json', 'the download attribute carries the filename');
  ok(a?.rel === 'noreferrer', 'and rel="noreferrer", so a remote target cannot read the opener');
  const text = [...dom.blobText.values()][0];
  ok(text === '{\n  "a": 1\n}', 'downloadJson pretty-prints, matching what the Builder’s export always produced');
}
{
  const dom = installDom();
  downloadText('plain', 'n.txt');
  ok([...dom.blobText.values()][0] === 'plain', 'downloadText writes the text verbatim (no BOM — only CSV needs one)');
}

(globalThis as { document?: unknown }).document = origDoc;
(globalThis as { URL?: unknown }).URL = origURL;
(globalThis as { Blob?: unknown }).Blob = origBlob;
(globalThis as { setTimeout: unknown }).setTimeout = origTimeout;

console.log(failures === 0 ? '\n✅ downloadFile: ALL PASS\n' : `\n❌ downloadFile: ${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
