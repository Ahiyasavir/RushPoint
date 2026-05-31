// Tiny .env loader (no dependency): loads scripts/.env then repo-root .env so you
// can keep RUSHPOINT_SHEETS_ID / RUSHPOINT_SHEETS_WEBHOOK in a file. Existing
// process env always wins. Import this before reading any RUSHPOINT_* var.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const file of [path.join(here, '..', '.env'), path.join(here, '..', '..', '.env')]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}
