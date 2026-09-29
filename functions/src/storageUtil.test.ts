// change: run-media-disk-retention. The retention prune promised by the Privacy Policy ("uploaded
// photos auto-deleted 90 days after run completion") only ever called the Firebase Storage bucket.
// Production has no bucket: every photo, audio clip and video sits on the VPS disk, so the bucket
// call threw, the run was stamped pruned, and the media stayed forever. These tests run with no
// bucket configured, which is exactly the VPS.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-uploads-'));
let deleteRunUploads: (runId: string) => Promise<{ bucket: boolean; disk: boolean }>;

function put(rel: string): string {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'x');
  return full;
}

beforeAll(async () => {
  // UPLOAD_DIR is read when the module loads, as on the VPS.
  process.env.UPLOAD_DIR = root;
  ({ deleteRunUploads } = await import('./storageUtil'));
  // This hook is a COLD import of firebase-functions + firebase-admin, not a wait on anything that
  // can race. Under the parallel verify load it measured past vitest's 10 s hook default, which
  // failed the file with "hook timed out" while every assertion was fine. The bound is for a hang.
}, 60_000);

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

describe('deleteRunUploads', () => {
  it('removes the run folder on disk even though no bucket exists', async () => {
    const mine = put('runs/r1/teams/t1/task-1.jpg');
    const clip = put('runs/r1/teams/t2/task-2.webm');
    const r = await deleteRunUploads('r1');
    expect(fs.existsSync(mine)).toBe(false);
    expect(fs.existsSync(clip)).toBe(false);
    expect(r.disk).toBe(true);
    expect(r.bucket).toBe(false);
  });

  it('never touches another run', async () => {
    const other = put('runs/r2/teams/t1/task-1.jpg');
    put('runs/r3/teams/t1/task-1.jpg');
    await deleteRunUploads('r3');
    expect(fs.existsSync(other)).toBe(true);
  });

  it('a blank run id deletes nothing (it would widen to every run)', async () => {
    const other = put('runs/r4/teams/t1/task-1.jpg');
    const r = await deleteRunUploads('');
    expect(fs.existsSync(other)).toBe(true);
    expect(r.disk).toBe(false);
  });
});

describe('pruneRunPII source guard', () => {
  it('purges run media through deleteRunUploads, never a bare bucket call', () => {
    const src = fs.readFileSync(path.join(__dirname, 'maintenance', 'index.ts'), 'utf8');
    expect(src).toMatch(/deleteRunUploads\(/);
    expect(src).not.toMatch(/deleteFiles\(\s*\{\s*prefix:\s*runPhotoPrefix/);
  });
});
