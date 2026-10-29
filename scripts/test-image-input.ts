// The setup walk's picture box takes a dragged or a pasted picture (28.10). See lib/imageInput.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstImageFile } from '../apps/creator-web/src/lib/imageInput';

let failures = 0;
function ok(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}
const f = (type: string, name = 'x') => ({ type, name }) as unknown as File;
ok('takes the first image', firstImageFile([f('text/plain'), f('image/png', 'a'), f('image/jpeg', 'b')])?.name === 'a');
ok('a PDF or text alone is not a picture', firstImageFile([f('application/pdf'), f('text/plain')]) === undefined);
ok('nothing is nothing', firstImageFile(null) === undefined && firstImageFile([]) === undefined);
const flow = readFileSync(join(process.cwd(), 'apps/creator-web/src/components/SetupFlow.tsx'), 'utf8');
ok('the picture box accepts a drop', /onDrop=\{[^}]*firstImageFile\(e\.dataTransfer\.files\)/.test(flow));
ok('and a paste', /addEventListener\('paste'/.test(flow) && /firstImageFile\(e\.clipboardData\?\.files\)/.test(flow));
console.log(failures === 0 ? '\n✅ image input: ALL PASS' : `\n❌ image input: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
