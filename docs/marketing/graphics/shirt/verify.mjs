import { createRequire } from 'node:module'; import path from 'node:path';
const [repo, dir] = process.argv.slice(2); const req = createRequire(path.join(repo, 'package.json'));
const sharp = req('sharp'); const jsQR = req('jsqr');
for (const color of ['black', 'white']) for (const file of [`shirt-${color}-back-print.png`, `shirt-${color}-back-preview.png`]) for (const width of [1600, 900, 600, 400, 300, 200]) {
  const bg = color === 'black' ? '#121212' : '#FAFAF8';
  const { data, info } = await sharp(path.join(dir, file)).flatten({ background: bg }).resize({ width }).blur(width>500?2:0.6).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const plain = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: 'dontInvert' });
  const both = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: 'attemptBoth' });
  console.log(file.padEnd(32), String(width).padStart(5), 'normal:', plain?.data ?? 'NO', ' with-invert:', both?.data ?? 'NO');
}
