// inbox.mjs — on-demand USER task injection.
//
// The user drops a task into autopilot/inbox/ at ANY time (even while the loop runs):
//   • a file:  autopilot/inbox/whatever.md   (first heading/line = title, rest = details)
//   • or CLI:  node autopilot/supervisor.mjs add "make the leaderboard pulse on overtake"
//
// At the start of every cycle the supervisor calls ingestInbox(): each new file becomes a
// high-priority task (userRequested:true → ranked ABOVE everything by score.mjs, and the selector
// is told to pick user tasks first), then the file is moved to inbox/processed/ so it is ingested
// exactly once. User tasks are never auto-dropped: a failed one is re-queued or blocked WITH a
// visible reason, never silently lost.
import { readdir, readFile, rename, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const TASK_EXTS = new Set(['.md', '.txt', '.task']);

// Parse one inbox file's raw text into { title, body }.
function parseTask(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let title = '';
  let firstIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (!s) continue;
    title = s.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim();
    firstIdx = i;
    break;
  }
  const body = firstIdx >= 0 ? lines.slice(firstIdx + 1).join('\n').trim() : '';
  return { title: title.slice(0, 300), body };
}

// Optional "key: value" front-matter the user can put at the top of a task file to steer it:
//   goal: ui | gameplay | admin | reliability | ...
//   risk: 1..5   effort: 1..5
function extractHints(body) {
  const hints = {};
  const re = /^\s*(goal|risk|effort)\s*:\s*(.+?)\s*$/gim;
  let m;
  while ((m = re.exec(body))) {
    const k = m[1].toLowerCase();
    hints[k] = k === 'goal' ? m[2].toLowerCase().trim() : Math.max(1, Math.min(5, Number(m[2]) || 3));
  }
  return hints;
}

export function ensureInbox(inboxDir) {
  return mkdir(path.join(inboxDir, 'processed'), { recursive: true });
}

// Append a task to the inbox from the CLI (`supervisor.mjs add "..."`). Returns the file path.
export async function addInboxTask(inboxDir, text, stampMs) {
  await ensureInbox(inboxDir);
  const safe = (text || '').trim();
  if (!safe) throw new Error('empty task text');
  // Deterministic-ish unique name from caller-supplied timestamp (Date.* is avoided elsewhere,
  // but the CLI is a one-shot human action so a real timestamp here is fine).
  const stamp = stampMs || Date.now();
  const slug = safe.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';
  const file = path.join(inboxDir, `${stamp}-${slug}.md`);
  await writeFile(file, safe.endsWith('\n') ? safe : safe + '\n', 'utf8');
  return file;
}

// Read every un-processed inbox file, turn it into a high-priority user task, and move the file to
// processed/. Returns the array of new task objects (already shaped for the backlog). Pure of Date.*
// for resume-safety: the caller passes the current cycle; ids use a per-state sequence.
export async function ingestInbox(inboxDir, state, cycle) {
  await ensureInbox(inboxDir);
  let entries;
  try { entries = await readdir(inboxDir, { withFileTypes: true }); }
  catch { return []; }

  const files = entries
    .filter((e) => e.isFile() && TASK_EXTS.has(path.extname(e.name).toLowerCase()) && e.name.toLowerCase() !== 'readme.md')
    .map((e) => e.name)
    .sort(); // stable order = insertion order (timestamp-prefixed names sort chronologically)

  const created = [];
  for (const name of files) {
    const full = path.join(inboxDir, name);
    let raw = '';
    try { raw = await readFile(full, 'utf8'); } catch { continue; }
    const { title, body } = parseTask(raw);
    if (!title) { // empty/garbage file — archive it so we don't re-scan forever
      await rename(full, path.join(inboxDir, 'processed', name)).catch(() => {});
      continue;
    }
    const hints = extractHints(body);
    state.userTaskSeq = (state.userTaskSeq || 0) + 1;
    created.push({
      id: `U-${state.userTaskSeq}`,
      goal: hints.goal || 'user',
      title,
      dims: { userImpact: 5, adminImpact: 3, reliability: 3, productRisk: 3, cleanupValue: 0 },
      risk: hints.risk ?? 3,
      effort: hints.effort ?? 3,
      deps: [],
      source: 'user',
      userRequested: true,
      status: 'backlog',
      createdCycle: cycle,
      sourceFile: name,
      notes: body || '(no extra detail supplied)'
    });
    await rename(full, path.join(inboxDir, 'processed', name)).catch(() => {});
  }
  return created;
}
