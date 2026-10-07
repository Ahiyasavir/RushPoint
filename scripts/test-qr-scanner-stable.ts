// Issue 51 (7.10 simulation): "the code scanner keeps turning off and on". The camera effect in
// QrScanner depended on `onDecode`, and TaskRunner passes a NEW arrow every render, so every team
// state refresh (a poll every few seconds) stopped the stream and opened it again. The camera must
// open once per mount: the effect has no dependencies and reads the latest callback through a ref.
//   npx tsx scripts/test-qr-scanner-stable.ts
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../apps/play-web/src/components/QrScanner.tsx', import.meta.url), 'utf8');

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// The effect that calls getUserMedia, up to its dependency list.
const start = src.indexOf('getUserMedia');
const effectStart = src.lastIndexOf('useEffect(', start);
const depsMatch = /\n {2}\}, \[([^\]]*)\]\);/.exec(src.slice(start));
check('the camera effect exists', start > 0 && effectStart > 0);
check('the camera effect has an EMPTY dependency list (opens once per mount)',
  !!depsMatch && depsMatch[1].trim() === '', depsMatch ? `deps=[${depsMatch[1]}]` : 'no deps found');
check('the latest onDecode is read through a ref', /onDecodeRef\.current\s*=\s*onDecode/.test(src)
  && /onDecodeRef\.current\(/.test(src));
check('no direct onDecode( call inside the decode loop', !/[^.\w]onDecode\(code\)/.test(src));

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}  (test-qr-scanner-stable)`);
process.exit(failures === 0 ? 0 : 1);
