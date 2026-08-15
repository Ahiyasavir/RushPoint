// Admin-only platform user activity report (change: admin-user-activity-dashboard,
// extended by admin-engagement-and-outreach).
//
// Not in the primary nav (see creatorNav.ts — same treatment as `/live`); reachable only
// by direct URL. Gates its own content on the signed-in user's `admin` custom claim so a
// non-admin who navigates here never even calls the callable — but the REAL boundary is
// server-side: `listPlatformUsers` re-checks `context.auth.token.admin` itself.
//
// PHONE FIRST. The person who reads this is usually away from a desk, so the small screen
// layout is the primary one: summary tiles stack, and each creator is a CARD. The table is
// the enhancement, shown only from `md` up. A five column table on a 375px screen is a
// horizontal scroll nobody performs.
//
// SCOPE: creators only. Anonymous participants have no email and no link to a creator uid,
// so they are excluded server-side.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../services/firebase';
import { listPlatformUsers, setUserNote } from '../services/calls';
import {
  summarizePlatform, activationStage, engagementParts,
  type AdminUserSummary, type ActivationStage,
} from '@rushpoint/shared';
import { isAdminClaim } from '../lib/adminGate';
import { buildAdminUsersCsv, filterUsers, sortUsers, type AdminUserSort } from '../lib/adminUsersExport';
import { formatTxDate } from '../lib/formatTxDate';
import { EmptyState, Skeleton, Badge, Button, Input, Textarea } from '../components/ui';
import { LoadingState } from '../components/LoadingState';
import { useT } from '../components/LanguageContext';

type GateState = 'checking' | 'denied' | 'allowed';

const STAGE_COLOR: Record<ActivationStage, 'zinc' | 'gold' | 'cyan' | 'green'> = {
  signed_up: 'zinc',
  built_game: 'gold',
  launched_run: 'cyan',
  completed_run: 'green',
};

export default function AdminUsersPage() {
  const t = useT();
  const ta = t.adminUsers;
  const nav = useNavigate();

  const [gate, setGate] = useState<GateState>('checking');
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<AdminUserSort>('lastActive');
  // The tick only earns its place if it can filter: its whole purpose is answering
  // "who have I still not written to".
  const [outreach, setOutreach] = useState<'all' | 'emailed' | 'notEmailed'>('all');

  async function load() {
    setFailed(false);
    try {
      const res = await listPlatformUsers({ limit: 300 });
      setUsers(res.users);
      setTruncated(res.truncated);
    } catch (e) {
      console.error('[adminUsers] listPlatformUsers failed:', e);
      setUsers((prev) => prev ?? []);
      setFailed(true);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function checkGate() {
      const user = auth.currentUser;
      if (!user) { if (!cancelled) setGate('denied'); return; }
      try {
        const token = await user.getIdTokenResult();
        if (cancelled) return;
        if (isAdminClaim(token.claims)) { setGate('allowed'); void load(); } else setGate('denied');
      } catch {
        if (!cancelled) setGate('denied');
      }
    }
    void checkGate();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Patch one row in place after a note save, so the list does not flicker or lose the
   *  current search and sort just because a note was written. */
  function applyNote(uid: string, patch: Partial<AdminUserSummary>) {
    setUsers((prev) => (prev ?? []).map((u) => (u.uid === uid ? { ...u, ...patch } : u)));
  }

  const summary = useMemo(() => summarizePlatform(users ?? []), [users]);
  const visible = useMemo(() => {
    const byOutreach = (users ?? []).filter((u) =>
      outreach === 'all' ? true : outreach === 'emailed' ? u.emailed : !u.emailed);
    return sortUsers(filterUsers(byOutreach, query), sort);
  }, [users, query, sort, outreach]);

  const duration = (ms: number) => {
    const { hours, minutes } = engagementParts(ms);
    return hours > 0 ? ta.durationHm(hours, minutes) : ta.durationM(minutes);
  };

  function downloadCsv() {
    const blob = new Blob([buildAdminUsersCsv(visible)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rushpoint-users.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  /** All visible emails, for one tap "mail everyone". BCC, never To: a To list would
   *  disclose every creator's address to every recipient. */
  const bulkMailHref = useMemo(() => {
    const emails = visible.map((u) => u.email).filter((e): e is string => !!e);
    if (emails.length === 0) return null;
    return `mailto:?bcc=${encodeURIComponent(emails.join(','))}`;
  }, [visible]);

  if (gate === 'checking') {
    return (
      <div className="animate-fade-up space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  if (gate === 'denied') return <EmptyState icon="🔒" title={ta.deniedTitle} body={ta.deniedBody} />;
  if (!users) {
    return (
      <div className="animate-fade-up space-y-4">
        <LoadingState messages={ta.loading} className="!py-6" />
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    );
  }

  const tiles: { label: string; value: string }[] = [
    { label: ta.tileCreators, value: String(summary.totalCreators) },
    { label: ta.tileActivation, value: `${summary.activationRate}%` },
    { label: ta.tileGames, value: String(summary.totalGames) },
    { label: ta.tileRuns, value: String(summary.totalRuns) },
    { label: ta.tilePlayers, value: String(summary.totalParticipants) },
    { label: ta.tileTime, value: duration(summary.totalEngagementMs) },
  ];

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[--ink-1]">{ta.title}</h1>
        <p className="text-sm text-[--ink-3]">{ta.subtitle}</p>
      </div>

      <button
        onClick={() => nav('/admin/templates')}
        className="text-xs font-medium text-[--ink-3] hover:text-[--ink-1] underline underline-offset-2"
      >
        {ta.toTemplatesLink}
      </button>

      {/* Summary tiles: 2 across on a phone, 6 across on a desktop. */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border border-[--rp-border] bg-[--surface-2] p-3">
            <div className="text-lg font-semibold text-[--ink-1]">{tile.value}</div>
            <div className="text-[11px] text-[--ink-3] leading-tight">{tile.label}</div>
          </div>
        ))}
      </div>

      {/* The funnel, which is the actionable part: where creators stop. */}
      <div className="rounded-xl border border-[--rp-border] p-3">
        <div className="text-xs uppercase text-[--ink-3] mb-2">{ta.funnelTitle}</div>
        <div className="flex flex-wrap gap-2 text-sm">
          {(Object.keys(summary.funnel) as ActivationStage[]).map((stage) => (
            <span key={stage} className="flex items-center gap-1.5">
              <Badge color={STAGE_COLOR[stage]}>{summary.funnel[stage]}</Badge>
              <span className="text-[--ink-3]">{ta.stage[stage]}</span>
            </span>
          ))}
        </div>
        {summary.funnel.built_game > 0 && (
          <p className="text-xs text-[--ink-3] mt-2">{ta.funnelHint(summary.funnel.built_game)}</p>
        )}
      </div>

      {/* Controls: stack on a phone, inline from sm up. */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={ta.searchPlaceholder}
          aria-label={ta.searchPlaceholder}
          className="sm:max-w-xs"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as AdminUserSort)}
          aria-label={ta.sortLabel}
          className="h-10 rounded-xl border border-[--rp-border] bg-[--surface-2] px-3 text-sm text-[--ink-1]"
        >
          <option value="lastActive">{ta.sortLastActive}</option>
          <option value="engagement">{ta.sortEngagement}</option>
          <option value="games">{ta.sortGames}</option>
          <option value="runs">{ta.sortRuns}</option>
          <option value="players">{ta.sortPlayers}</option>
        </select>
        <select
          value={outreach}
          onChange={(e) => setOutreach(e.target.value as 'all' | 'emailed' | 'notEmailed')}
          aria-label={ta.outreachLabel}
          className="h-10 rounded-xl border border-[--rp-border] bg-[--surface-2] px-3 text-sm text-[--ink-1]"
        >
          <option value="all">{ta.outreachAll}</option>
          <option value="notEmailed">{ta.outreachNotEmailed}</option>
          <option value="emailed">{ta.outreachEmailed}</option>
        </select>
        <div className="flex gap-2 sm:ms-auto">
          <Button onClick={() => void load()}>{ta.refreshBtn}</Button>
          <Button onClick={downloadCsv}>{ta.exportBtn}</Button>
          {bulkMailHref && <a href={bulkMailHref} className="inline-flex items-center h-10 px-4 rounded-xl border border-[--rp-border] text-sm font-medium text-[--ink-1] hover:bg-[--surface-2]">{ta.mailAllBtn}</a>}
        </div>
      </div>

      {failed && <p className="text-sm text-rp-alert" role="alert">{ta.loadFailed}</p>}
      {truncated && <p className="text-sm text-[--ink-3]">{ta.truncatedNotice(users.length)}</p>}
      <p className="text-xs text-[--ink-3]">{ta.engagementNote}</p>

      {visible.length === 0 ? (
        <EmptyState icon="👤" title={query ? ta.noMatches : ta.noUsers} />
      ) : (
        <>
          {/* ── PHONE: one card per creator ── */}
          <ul className="md:hidden space-y-2">
            {visible.map((u) => {
              const stage = activationStage(u);
              const open = !!expanded[u.uid];
              return (
                <li key={u.uid} className="rounded-xl border border-[--rp-border] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-[--ink-1] truncate" dir="auto">{u.displayName || ta.unnamed}</div>
                      {u.email && <div className="text-xs text-[--ink-3] truncate" dir="auto">{u.email}</div>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge color={STAGE_COLOR[stage]}>{ta.stage[stage]}</Badge>
                      {/* So an annotated creator is identifiable without opening each card. */}
                      {u.note && <span className="text-[11px] text-[--ink-3]" title={u.note}>📝 {ta.hasNote}</span>}
                      {u.emailed && <span className="text-[11px] text-[--ink-3]">✉️ {ta.emailedShort}</span>}
                    </div>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[--ink-3]">
                    <div className="flex justify-between"><dt>{ta.colGames}</dt><dd className="text-[--ink-1]">{u.gamesCreatedCount}</dd></div>
                    <div className="flex justify-between"><dt>{ta.colRuns}</dt><dd className="text-[--ink-1]">{u.runsLaunchedCount}</dd></div>
                    <div className="flex justify-between"><dt>{ta.colPlayers}</dt><dd className="text-[--ink-1]">{u.participantsReached}</dd></div>
                    <div className="flex justify-between"><dt>{ta.colTime}</dt><dd className="text-[--ink-1]">{duration(u.engagementMs)}</dd></div>
                    <div className="flex justify-between col-span-2"><dt>{ta.colLastActive}</dt><dd className="text-[--ink-1]">{u.lastActiveAt ? formatTxDate(u.lastActiveAt) : ta.never}</dd></div>
                  </dl>
                  <div className="mt-2 flex gap-2">
                    {u.email && (
                      <a href={`mailto:${u.email}`} className="text-xs px-2 py-1 rounded-lg border border-[--rp-border] text-[--ink-1]">
                        {ta.emailBtn}
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpanded((p) => ({ ...p, [u.uid]: !p[u.uid] }))}
                      className="text-xs px-2 py-1 rounded-lg border border-[--rp-border] text-[--ink-1]"
                    >
                      {open ? ta.hideDetail : ta.showDetail}
                    </button>
                  </div>
                  {open && <Detail user={u} ta={ta} onNoteSaved={applyNote} />}
                </li>
              );
            })}
          </ul>

          {/* ── DESKTOP: the table ── */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="text-[--ink-3] text-xs uppercase">
                  <th className="text-start p-2">{ta.colUser}</th>
                  <th className="text-start p-2">{ta.colStage}</th>
                  <th className="text-start p-2">{ta.colLastActive}</th>
                  <th className="text-start p-2">{ta.colTime}</th>
                  <th className="text-start p-2">{ta.colGames}</th>
                  <th className="text-start p-2">{ta.colRuns}</th>
                  <th className="text-start p-2">{ta.colPlayers}</th>
                  <th className="text-start p-2">{ta.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => {
                  const stage = activationStage(u);
                  return (
                    <tr key={u.uid} className="border-t border-[--rp-border] align-top">
                      <td className="p-2">
                        <div className="font-medium text-[--ink-1]" dir="auto">{u.displayName || ta.unnamed}</div>
                        <div className="text-[--ink-3] text-xs" dir="auto">{u.email || u.uid}</div>
                      </td>
                      <td className="p-2"><Badge color={STAGE_COLOR[stage]}>{ta.stage[stage]}</Badge></td>
                      <td className="p-2">{u.lastActiveAt ? formatTxDate(u.lastActiveAt) : ta.never}</td>
                      <td className="p-2">{duration(u.engagementMs)}</td>
                      <td className="p-2">
                        <button
                          type="button"
                          className="underline decoration-dotted"
                          onClick={() => setExpanded((p) => ({ ...p, [u.uid]: !p[u.uid] }))}
                        >
                          {u.gamesCreatedCount}
                        </button>
                      </td>
                      <td className="p-2">{u.runsLaunchedCount}</td>
                      <td className="p-2">{u.participantsReached}</td>
                      <td className="p-2">
                        {u.email
                          ? <a href={`mailto:${u.email}`} className="underline">{ta.emailBtn}</a>
                          : <span className="text-[--ink-3]">{ta.noEmail}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.filter((u) => expanded[u.uid]).map((u) => (
              <div key={`${u.uid}-d`} className="border-t border-[--rp-border] p-3">
                <div className="text-xs uppercase text-[--ink-3] mb-1" dir="auto">{u.displayName || u.email || u.uid}</div>
                <Detail user={u} ta={ta} onNoteSaved={applyNote} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The private operator note for one creator. Saves explicitly rather than on every
 *  keystroke: a note is written on a phone, often on a bad connection, and a per keystroke
 *  write would be both expensive and lossy. Local state is the draft; the row is patched
 *  only once the server confirms. */
function NoteEditor({ user, ta, onSaved }: {
  user: AdminUserSummary;
  ta: ReturnType<typeof useT>['adminUsers'];
  onSaved: (uid: string, patch: Partial<AdminUserSummary>) => void;
}) {
  const [draft, setDraft] = useState(user.note ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [ticking, setTicking] = useState(false);
  const dirty = draft.trim() !== (user.note ?? '').trim();

  async function save() {
    setState('saving');
    try {
      // `emailed` omitted: saving the text must never disturb the tick.
      const res = await setUserNote({ uid: user.uid, note: draft });
      onSaved(user.uid, { note: res.note, noteUpdatedAt: res.noteUpdatedAt });
      setState('saved');
    } catch (e) {
      console.error('[adminUsers] setUserNote failed:', e);
      // Never silently drop what was typed: keep the draft and say it did not save.
      setState('failed');
    }
  }

  /** The tick saves IMMEDIATELY on toggle, unlike the note text. A checkbox that needed a
   *  separate save press would be ticked and lost constantly. The current draft text is
   *  sent along so an unsaved note is not clobbered by the tick's own write. */
  async function toggleEmailed(next: boolean) {
    setTicking(true);
    try {
      const res = await setUserNote({ uid: user.uid, note: draft, emailed: next });
      onSaved(user.uid, {
        note: res.note, noteUpdatedAt: res.noteUpdatedAt,
        emailed: res.emailed, emailedAt: res.emailedAt,
      });
    } catch (e) {
      console.error('[adminUsers] setUserNote(emailed) failed:', e);
      setState('failed');
    } finally {
      setTicking(false);
    }
  }

  return (
    <div className="mt-3">
      {/* Manual, never inferred: nothing here can see an email leave a personal mailbox. */}
      <label className="flex items-center gap-2 mb-2 text-sm text-[--ink-1] cursor-pointer">
        <input
          type="checkbox"
          checked={user.emailed}
          disabled={ticking}
          onChange={(e) => void toggleEmailed(e.target.checked)}
          className="w-5 h-5 rounded accent-rp-fire"
        />
        <span>{ta.emailedLabel}</span>
        {user.emailed && user.emailedAt && (
          <span className="text-xs text-[--ink-3]">{ta.emailedOn(formatTxDate(user.emailedAt))}</span>
        )}
      </label>
      <label className="text-xs uppercase text-[--ink-3] block mb-1" htmlFor={`note-${user.uid}`}>
        {ta.noteLabel}
      </label>
      <Textarea
        id={`note-${user.uid}`}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setState('idle'); }}
        placeholder={ta.notePlaceholder}
        rows={3}
        dir="auto"
      />
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        <Button onClick={() => void save()} disabled={!dirty || state === 'saving'}>
          {state === 'saving' ? ta.noteSaving : ta.noteSave}
        </Button>
        {state === 'saved' && <span className="text-xs text-[--ink-3]">{ta.noteSaved}</span>}
        {state === 'failed' && <span className="text-xs text-rp-alert" role="alert">{ta.noteFailed}</span>}
        {user.noteUpdatedAt && state !== 'failed' && (
          <span className="text-xs text-[--ink-3]">{ta.noteUpdated(formatTxDate(user.noteUpdatedAt))}</span>
        )}
      </div>
    </div>
  );
}

/** The per creator drill down: which games, which runs, and the private note. Shared by
 *  both layouts so the phone and the desktop can never drift apart. */
function Detail({ user, ta, onNoteSaved }: {
  user: AdminUserSummary;
  ta: ReturnType<typeof useT>['adminUsers'];
  onNoteSaved: (uid: string, patch: Partial<AdminUserSummary>) => void;
}) {
  return (
    <>
    <NoteEditor user={user} ta={ta} onSaved={onNoteSaved} />
    <div className="mt-2 grid gap-3 sm:grid-cols-2">
      <div>
        <div className="text-xs uppercase text-[--ink-3] mb-1">{ta.colGames}</div>
        {user.games.length === 0 ? (
          <p className="text-sm text-[--ink-3]">{ta.noGames}</p>
        ) : (
          <ul className="space-y-1">
            {user.games.map((g) => (
              <li key={g.id} className="text-sm flex items-center gap-2">
                <span dir="auto">{g.title}</span>
                {g.deleted && <Badge color="red">{ta.deletedTag}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="text-xs uppercase text-[--ink-3] mb-1">{ta.colRuns}</div>
        {user.runs.length === 0 ? (
          <p className="text-sm text-[--ink-3]">{ta.noRuns}</p>
        ) : (
          <ul className="space-y-1">
            {user.runs.map((r) => (
              <li key={r.id} className="text-sm" dir="auto">
                {r.gameTitle}, {r.status} ({r.participantCount})
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
    </>
  );
}
