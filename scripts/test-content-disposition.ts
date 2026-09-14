// Pure-logic tests — the download disposition header (change: media-serving-correctness).
//
// Two reasons this is its own tested function rather than a template literal at
// the call site.
//
// 1. It is the whole fix for "the download button opens a fullscreen player".
//    Per the HTML spec the `download` attribute on an <a> is IGNORED cross-origin
//    without Content-Disposition, and media is served from api.rush-point.com
//    while the console runs on creator.rush-point.com. The client code in
//    apps/creator-web/src/lib/downloadFile.ts was already correct and was defeated
//    purely by the missing header.
// 2. The filename is attacker-influenced. A participant controls the upload
//    filename within the IDOR-guarded prefix, and a CR or LF reaching a response
//    header is header injection. So the sanitizer is the security boundary and
//    gets swept, not spot-checked.
//
// NOTE ON HOW THE HOSTILE INPUTS ARE BUILT: every dangerous character is produced
// with `ch(code)` rather than written as a source escape. CLAUDE.md records a real
// defect where a tool's string escaping turned an intended `\b` into a literal
// BACKSPACE that rendered as nothing and matched nothing, so a check examined
// nothing and passed. Building the bytes from their code points removes that whole
// class of mistake and keeps this file clean for scripts/test-source-control-chars.ts.
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { contentDispositionAttachment, FALLBACK_DOWNLOAD_NAME } = require_('../functions/mediaServing.js');

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}

/** A single character by code point — see the note above. */
const ch = (code: number): string => String.fromCharCode(code);
const CR = ch(13);
const LF = ch(10);
const TAB = ch(9);
const NUL = ch(0);
const ESC = ch(27);
const DEL = ch(127);
const BACKSPACE = ch(8);
const QUOTE = ch(34);
const BACKSLASH = ch(92);

/** The characters that must never survive into an emitted header value. */
const FORBIDDEN = [CR, LF, QUOTE, BACKSLASH, NUL, ESC, DEL, TAB, BACKSPACE];

console.log('\nmedia-serving — contentDispositionAttachment');

// ── 1. It says "attachment", which is the entire point ────────────────────────
{
  const v = contentDispositionAttachment('clip.webm');
  ok(`a normal name yields an attachment disposition :: ${JSON.stringify(v)}`,
    typeof v === 'string' && v.startsWith('attachment'));
  ok('a normal name survives recognisably', typeof v === 'string' && v.includes('clip.webm'));
  ok('the filename is quoted', typeof v === 'string' && /^attachment; filename="[^"]*"$/.test(v));
}

// ── 2. Header injection — the security boundary ───────────────────────────────
{
  const hostile = [
    `a${CR}${LF}X-Injected: yes.webm`,
    `a${LF}Set-Cookie: x=1.webm`,
    `a${CR}b.webm`,
    `a${QUOTE}b.webm`,
    `a${NUL}b.webm`,
    `a${ESC}b.webm`,
    `a${DEL}b.webm`,
    `a${BACKSLASH}b.webm`,
    `a${TAB}b.webm`,
    `a${BACKSPACE}b.webm`,
    `${QUOTE}; X-Injected: yes; x="`,
  ];
  for (const name of hostile) {
    let v: unknown;
    let threw = false;
    try { v = contentDispositionAttachment(name); } catch { threw = true; }
    const s = String(v);
    // The whole value must be exactly ONE attachment line whose quoted filename
    // carries nothing that could terminate the quoting or start a new header.
    const m = /^attachment; filename="([^"]*)"$/.exec(s);
    const inner = m ? m[1] : null;
    const clean = !threw && inner !== null && !FORBIDDEN.some((c) => inner.includes(c));
    ok(`${JSON.stringify(name)} emits no control character, quote or backslash`, clean, s);
    ok(`${JSON.stringify(name)} emits exactly one line`,
      !s.includes(CR) && !s.includes(LF), s);
  }
}

// ── 3. A name that sanitizes away still yields a usable header ────────────────
{
  const empties = ['', '   ', `${CR}${LF}`, `${QUOTE}${QUOTE}${QUOTE}`, `${NUL}${NUL}`,
    '../../etc/passwd', '/', '.', '..'];
  for (const name of empties) {
    const s = String(contentDispositionAttachment(name));
    ok(`${JSON.stringify(name)} falls back to the safe constant :: ${s}`,
      s.includes(FALLBACK_DOWNLOAD_NAME));
  }
  ok('the fallback constant is a non-empty string with no path separator',
    typeof FALLBACK_DOWNLOAD_NAME === 'string' && FALLBACK_DOWNLOAD_NAME.length > 0
    && !FALLBACK_DOWNLOAD_NAME.includes('/') && !FALLBACK_DOWNLOAD_NAME.includes(BACKSLASH),
    String(FALLBACK_DOWNLOAD_NAME));
}

// ── 4. Only the basename is offered — never a path ────────────────────────────
{
  const s = String(contentDispositionAttachment('runs/abc/teams/xyz/clip.webm'));
  ok(`a path yields only its basename :: ${s}`, s.includes('clip.webm') && !s.includes('runs/'));
  const w = String(contentDispositionAttachment(`C:${BACKSLASH}tmp${BACKSLASH}clip.webm`));
  ok(`a windows path yields only its basename :: ${w}`, w.includes('clip.webm') && !w.includes('tmp'));
}

// ── 5. Totality ───────────────────────────────────────────────────────────────
{
  for (const bad of [null, undefined, 42, {}, [], true]) {
    let threw = false;
    let v: unknown;
    try { v = contentDispositionAttachment(bad as unknown as string); } catch { threw = true; }
    ok(`${JSON.stringify(bad)} does not throw and yields a header`,
      !threw && typeof v === 'string' && (v as string).startsWith('attachment'), String(v));
  }
  const long = `${'a'.repeat(5000)}.webm`;
  const s = String(contentDispositionAttachment(long));
  ok(`a 5000 character name is bounded :: ${s.length} chars`, s.length < 400);
  ok('a bounded long name is still one line', !s.includes(CR) && !s.includes(LF));
}

console.log('');
if (failures > 0) {
  console.error(`✗ content-disposition: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ content-disposition: all assertions passed');
