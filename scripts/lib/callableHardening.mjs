// Pure static analysis of the Cloud Function callable surface
// (change: callable-hardening-consistency).
//
// Every function here is a total function of TEXT — no I/O except the one explicit
// `collectSources` file walk — so the guard's decision logic can be proven against
// synthetic fixtures in scripts/test-callable-hardening.ts, independently of what
// functions/src currently happens to contain. That separation is the whole point:
// an analyzer whose regex quietly stops matching reports green forever, and the
// only defence is testing the analyzer itself in both directions.
//
// Regexes rather than a TypeScript AST: the scripts/ lane has no TS-compiler
// dependency, and the declaration being parsed is ONE house-standard idiom used
// ~94 times identically. See design.md D1/D4 for the trade-off and its bounds.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** The module that legitimately defines the wrapper, so it may name raw onCall. */
export const WRAPPER_MODULE = 'obs/log.ts';

/**
 * Anti-vacuity floor (design D9). Well below today's count so ordinary additions
 * and deletions never trip it, high enough that a scan which has stopped matching
 * cannot pass over an almost-empty set.
 */
export const CALLABLE_FLOOR = 60;

/**
 * Callables deliberately reachable WITHOUT authentication. Declared, never
 * inferred (design D3): the value of this table is that a callable which loses its
 * auth assertion by accident fails the guard instead of being waved through as
 * "probably intentional". Adding a name here is a decision someone made on
 * purpose, and the reason string is where they justify it.
 */
export const PUBLIC_CALLABLES = {
  checkChallengeAnswer:
    'Unauthenticated acquisition surface: the "challenge a friend" teaser is answered by '
    + 'signed-out viewers. Published games only (resolved through publicGames), returns ONLY '
    + '{ correct }, and the answer key never leaves the server.',
  submitContactMessage:
    'The marketing site\'s contact form. The sender is by definition someone who does not have '
    + 'an account yet, so requiring one would mean nobody can ask a question before signing up. '
    + 'What authentication would normally carry is carried instead by field validation, a size '
    + 'bound, and a rate limit keyed on the CONNECTION rather than on anything the caller sends. '
    + 'It returns only { ok }, never a document id, and the collection it writes is closed to '
    + 'clients in both directions.',
  getSharedGame:
    'A share link for an unpublished game (change: game-share-link). The recipient is by '
    + 'definition someone the creator wants to show a game to, which is very often somebody '
    + 'who has no account yet — requiring one would defeat the point of sending a link. What '
    + 'authentication would normally carry is carried by a 128-bit unguessable token that IS '
    + 'the address of the link document, a rate limit keyed on the CONNECTION rather than on '
    + 'anything the caller sends, and a projection that copies fields out by name so no server '
    + 'secret can reach the response by default. It returns a read-only view and never the '
    + 'owner uid; taking a COPY is a different callable and does require an account.',
};

/**
 * Callables whose action is privileged or destructive enough that "who did this,
 * and when" must be answerable AFTER the fact — i.e. they must write a durable
 * auditLogs record. See functions/src/obs/audit.ts for why a console line is not
 * enough (it ages out; auditLogs does not).
 *
 * Declared, not inferred, for the reason in design D3: no heuristic would catch
 * the NEXT callable that belongs here. A reviewer adding one does, and this list
 * is short enough to read while reviewing.
 *
 * Deliberately ABSENT, with reasons:
 *   • deleteMyAccount        — a durable, admin-readable record of a user
 *                              exercising erasure works against the request.
 *   • reviewStationSubmission— already persists reviewedBy/reviewedAt/reviewNote
 *                              on the submission itself, so the question is
 *                              already answerable; a second record is cost with
 *                              no new fact.
 *   • updateLocation & co.   — high-frequency participant pings; one audit row per
 *                              call would be a cost bug, not accountability.
 */
export const PRIVILEGED_CALLABLES = {
  deleteGame: 'Removes a creator\'s game from every surface and revokes its join codes.',
  restoreGame: 'Reverses a deletion and reinstates join codes — the counterpart of deleteGame.',
  purgeGameNow: 'Irreversible destruction of a game and everything beneath it.',
  adjustTeamScore: 'Staff override of a participant team\'s score during a live run.',
  skipTaskForTeam:
    'Staff override that removes a scoring opportunity from ONE identified team during a live '
    + 'run, and can lower that team\'s stage requirement. "Who skipped this, for whom, and why" '
    + 'must stay answerable after the event, exactly like adjustTeamScore.',
  clearTeamOutOfBounds: 'Staff override that releases a team from a safety-zone block.',
  setTeamHold:
    'Staff override that stops ONE identified team from advancing at all and pauses its race '
    + 'clock. Both directions change that team\'s standing (held time is excluded from scoring), '
    + 'so "who parked this team, when, and why" must stay answerable after the event.',
  forceAssignTask:
    'Staff override that sends ONE identified team to a SPECIFIC mission, displacing whatever it '
    + 'was on. The override variant additionally bypasses an unlock / scheduled-release / expiry '
    + 'gate the game\'s designer authored, so the trail is the only way an organizer can later '
    + 'tell a routine redirect from a deliberately broken sequencing rule.',
  pruneRunNow:
    'Irreversibly destroys one run\'s participant data — six subcollections, uploaded '
    + 'Storage objects, guardian-consent PII. Nothing is recoverable.',
  pruneExpiredRunDataNow:
    'Runs the same irreversible destruction across up to a hundred runs in one call.',
  purgeDeletedGamesNow:
    'Destroys every game past its trash window, and accepts a grace-period override that '
    + 'lets an operator purge the whole trash immediately.',
  backfillPublicTaskCoordinatesNow:
    'Bulk-rewrites documents in the world-readable publicTasks collection.',
  createGameShareLink:
    'Mints a credential that lets anybody holding it read an UNPUBLISHED game in full. That is '
    + 'a disclosure of private content, and the only way to answer "who opened this game up, '
    + 'when, and with which permissions" after the fact is a durable record — the link document '
    + 'itself is deletable by the same owner.',
  revokeGameShareLink:
    'The counterpart of createGameShareLink: it withdraws read access somebody may be relying '
    + 'on. Both ends of a disclosure decision belong in the same trail, or the trail only ever '
    + 'shows access being granted.',
  listContactMessages:
    'Reads a list of names, email addresses and free text belonging to people who are NOT users '
    + 'of the platform and never agreed to anything beyond "I am sending you a question". They '
    + 'cannot see this collection, cannot correct it and cannot ask who opened it, so the only '
    + 'accountability available is a record on our side of who read it and when.',
};

// ── Markers ──────────────────────────────────────────────────────────────────

const AUTH_MARKERS = /\b(requireAuth|assertAdmin|assertStaffOrOwner|assertOwner|assertRunStaff|assertController)\s*\(/;
// The older inline idiom, still used verbatim in ~20 call sites; equivalent to
// requireAuth and must count as conformant, not as a gap to be churned.
const INLINE_AUTH = /if\s*\(\s*!\s*context\.auth\s*\)[\s\S]{0,200}?['"]unauthenticated['"]/;
const AUDIT_MARKERS = /\b(auditBestEffort|writeAuditLog)\s*\(/;

/** True when a source line is inside a comment (line comment or block-comment body). */
function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** 1-based line number of `index` within `text`. */
function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** The whole source line containing `index`. */
function lineTextAt(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  let end = text.indexOf('\n', index);
  if (end === -1) end = text.length;
  return text.slice(start, end);
}

// ── Declaration parsing ──────────────────────────────────────────────────────

// `\s*` spans newlines, so a declaration wrapped across lines (the real
// backfillPublicTaskCoordinatesNow is formatted that way) parses identically.
const DECL = /export const (\w+) = loggedCallable\(\s*'(\w+)'/g;

/**
 * Every callable declaration in one file, each with its body sliced at the NEXT
 * declaration (never at end-of-file — otherwise the first callable would inherit
 * every later callable's markers and the guard would pass on anything).
 *
 * @returns {{ name: string, line: number, body: string }[]}
 */
export function parseCallables(text) {
  const hits = [];
  DECL.lastIndex = 0;
  let m;
  while ((m = DECL.exec(text))) {
    // A commented-out or documented declaration is not a call site.
    if (isCommentLine(lineTextAt(text, m.index))) continue;
    hits.push({ name: m[2], index: m.index, line: lineOf(text, m.index) });
  }
  return hits.map((h, i) => ({
    name: h.name,
    line: h.line,
    body: text.slice(h.index, i + 1 < hits.length ? hits[i + 1].index : text.length),
  }));
}

// ── One level of same-file delegation (design D4) ────────────────────────────

/**
 * Body of a function/const declared at the top level of `fileText`, sliced until
 * the next top-level declaration. Bounded and deliberately shallow — the failure
 * mode of a cleverer call-graph regex is a false NEGATIVE (it "resolves" a marker
 * that is not really on the path and reports green), which is the expensive
 * direction.
 */
function localDeclarationBody(fileText, name) {
  const decl = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[(<]|^(?:export\\s+)?const\\s+${name}\\s*[=:]`,
    'm',
  );
  const m = decl.exec(fileText);
  if (!m) return null;
  const rest = fileText.slice(m.index + m[0].length);
  const next = /\n(?:export\s+)?(?:async\s+)?(?:function|const|class|interface|type)\s/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** Names of top-level functions this body calls, optionally requiring `context` be passed. */
function delegatesCalled(body, requireContextArg) {
  const out = new Set();
  for (const m of body.matchAll(/\b([a-z][A-Za-z0-9_]*)\s*\(([^)]*)\)/g)) {
    if (requireContextArg && !/\bcontext\b/.test(m[2])) continue;
    out.add(m[1]);
  }
  return out;
}

/**
 * Does this callable reject an unauthenticated caller? Direct marker, the inline
 * idiom, or exactly one level of same-file delegation with `context` handed over
 * (the real pickUpTrackable / dropTrackable → transferTrackable shape).
 */
export function hasAuthAssertion(body, fileText) {
  if (AUTH_MARKERS.test(body) || INLINE_AUTH.test(body)) return true;
  for (const name of delegatesCalled(body, true)) {
    const helper = localDeclarationBody(fileText, name);
    if (helper && (AUTH_MARKERS.test(helper) || INLINE_AUTH.test(helper))) return true;
  }
  return false;
}

/**
 * Does this callable leave a durable audit record? Direct marker, or one level of
 * same-file delegation (the real purgeGameNow → purgeGameTree shape, where the
 * record is written by the helper that does the destruction).
 */
export function hasAuditWrite(body, fileText) {
  if (AUDIT_MARKERS.test(body)) return true;
  for (const name of delegatesCalled(body, false)) {
    const helper = localDeclarationBody(fileText, name);
    if (helper && AUDIT_MARKERS.test(helper)) return true;
  }
  return false;
}

// ── Wrapper bypass ───────────────────────────────────────────────────────────

/** 1-based line numbers where a module constructs a callable WITHOUT the wrapper. */
export function findDirectOnCall(text) {
  const lines = [];
  for (const m of text.matchAll(/functions\.https\.onCall\s*\(/g)) {
    if (isCommentLine(lineTextAt(text, m.index))) continue;
    lines.push(lineOf(text, m.index));
  }
  return lines;
}

// ── Entry-point reachability ─────────────────────────────────────────────────

/**
 * How functions/src/index.ts re-exports `spec` (e.g. './runs/index'):
 *   { kind: 'star' }                — `export * from` — every name is covered
 *   { kind: 'names', names: Set }   — explicit list — only these names deploy
 *   null                            — not re-exported at all
 */
export function resolveReexport(indexText, spec) {
  const q = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`export\\s*\\*\\s*from\\s*['"]${q}['"]`).test(indexText)) return { kind: 'star' };
  // `[^}]*` (not `[\s\S]*?`): index.ts holds SEVERAL adjacent `export { … } from`
  // blocks, and a dot-all lazy match happily spans from an earlier block's opening
  // brace to THIS block's closing one. The captured text then contains the
  // intervening `} from '…';\nexport {`, so the first name of every later block is
  // glued to it and silently dropped — which reported launchRun and getWallet as
  // undeployed. Refusing to cross a closing brace confines the match to one block.
  const named = new RegExp(`export\\s*\\{([^}]*)\\}\\s*from\\s*['"]${q}['"]`, 'g');
  const names = new Set();
  let found = false;
  let m;
  while ((m = named.exec(indexText))) {
    found = true;
    for (const raw of m[1].split(',')) {
      // Strip comments and `as` aliases; the deployed name is what index.ts exports.
      const cleaned = raw.replace(/\/\/[^\n]*/g, '').trim();
      if (!cleaned) continue;
      const parts = cleaned.split(/\s+as\s+/);
      const local = parts[0].trim();
      if (/^\w+$/.test(local)) names.add(local);
    }
  }
  return found ? { kind: 'names', names } : null;
}

/** 'runs/index.ts' -> './runs/index' (the specifier index.ts would import by). */
export function moduleSpecifierFor(rel) {
  return `./${rel.replace(/\.ts$/, '')}`;
}

// ── The one file walk ────────────────────────────────────────────────────────

/**
 * Every non-test source file under `srcDir`, as { rel, text }. `__planned__` holds
 * test.todo blueprints for unbuilt work and `__property__`/`testutil` are test
 * support — none are real call sites, and the existing rateLimitCoverage guard
 * excludes them for the same reason.
 */
export function collectSources(srcDir, base = srcDir, out = []) {
  for (const entry of readdirSync(srcDir)) {
    const full = path.join(srcDir, entry);
    if (statSync(full).isDirectory()) {
      if (['node_modules', '__planned__', '__property__', 'testutil'].includes(entry)) continue;
      collectSources(full, base, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push({ rel: path.relative(base, full).split(path.sep).join('/'), text: readFileSync(full, 'utf8') });
    }
  }
  return out;
}
