// Admin-only platform user activity report (change: admin-user-activity-dashboard).
//
// Not in the primary nav (see creatorNav.ts — same treatment as `/live`); reachable
// only by direct URL (bookmark this). Gates its own content on the signed-in user's
// `admin` custom claim so a non-admin who navigates here never even calls the
// callable — but the REAL boundary is server-side: `listPlatformUsers` re-checks
// `context.auth.token.admin` itself, so a forged/stale client claim can never
// produce real data (design.md §D6).
//
// SCOPE: this table is creators only — real Firebase Auth accounts with a
// `users/{uid}` doc. Anonymous participants have no email and no link to any
// creator uid, so they are excluded server-side, not filtered here.
import { Fragment, useEffect, useState } from 'react';
import { auth } from '../services/firebase';
import { listPlatformUsers } from '../services/calls';
import type { AdminUserSummary } from '@rushpoint/shared';
import { isAdminClaim } from '../lib/adminGate';
import { formatTxDate } from '../lib/formatTxDate';
import { EmptyState, Skeleton, Badge, Button } from '../components/ui';
import { LoadingState } from '../components/LoadingState';
import { useT } from '../components/LanguageContext';

type GateState = 'checking' | 'denied' | 'allowed';

export default function AdminUsersPage() {
  const t = useT();
  const ta = t.adminUsers;

  const [gate, setGate] = useState<GateState>('checking');
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState(false);

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
        if (isAdminClaim(token.claims)) {
          setGate('allowed');
          void load();
        } else {
          setGate('denied');
        }
      } catch {
        if (!cancelled) setGate('denied');
      }
    }
    void checkGate();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (gate === 'checking') {
    return (
      <div className="animate-fade-up space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  if (gate === 'denied') {
    return <EmptyState icon="🔒" title={ta.deniedTitle} body={ta.deniedBody} />;
  }

  if (!users) {
    return (
      <div className="animate-fade-up space-y-4">
        <LoadingState messages={ta.loading} className="!py-6" />
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[--ink-1]">{ta.title}</h1>
          <p className="text-sm text-[--ink-3]">{ta.subtitle}</p>
        </div>
        <Button onClick={() => void load()}>{ta.refreshBtn}</Button>
      </div>

      {failed && (
        <p className="text-sm text-[--danger,#e05252]" role="alert">{ta.loadFailed}</p>
      )}

      {truncated && (
        <p className="text-sm text-[--ink-3]">{ta.truncatedNotice(users.length)}</p>
      )}

      {users.length === 0 ? (
        <EmptyState icon="👤" title={ta.noUsers} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="text-[--ink-3] text-xs uppercase">
                <th className="text-start p-2">{ta.colUser}</th>
                <th className="text-start p-2">{ta.colSignedUp}</th>
                <th className="text-start p-2">{ta.colLastActive}</th>
                <th className="text-start p-2">{ta.colGames}</th>
                <th className="text-start p-2">{ta.colRuns}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isOpen = !!expanded[u.uid];
                return (
                  <Fragment key={u.uid}>
                    <tr className="border-t border-[--border,rgba(255,255,255,0.08)]">
                      <td className="p-2 align-top">
                        <div className="font-medium text-[--ink-1]">{u.displayName || ta.unnamed}</div>
                        <div className="text-[--ink-3] text-xs" dir="auto">{u.email || u.uid}</div>
                      </td>
                      <td className="p-2 align-top">{u.createdAt ? formatTxDate(u.createdAt) : ta.never}</td>
                      <td className="p-2 align-top">{u.lastActiveAt ? formatTxDate(u.lastActiveAt) : ta.never}</td>
                      <td className="p-2 align-top">
                        <button
                          type="button"
                          className="underline decoration-dotted"
                          onClick={() => setExpanded((prev) => ({ ...prev, [u.uid]: !prev[u.uid] }))}
                        >
                          {ta.gamesCount(u.gamesCreatedCount)}
                        </button>
                      </td>
                      <td className="p-2 align-top">{ta.runsCount(u.runsLaunchedCount)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-[--panel-2,rgba(255,255,255,0.03)]">
                        <td colSpan={5} className="p-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <div className="text-xs uppercase text-[--ink-3] mb-1">{ta.colGames}</div>
                              {u.games.length === 0 ? (
                                <p className="text-sm text-[--ink-3]">{ta.noGames}</p>
                              ) : (
                                <ul className="space-y-1">
                                  {u.games.map((g) => (
                                    <li key={g.id} className="text-sm flex items-center gap-2">
                                      <span dir="auto">{g.title}</span>
                                      {g.deleted && <Badge>{ta.deletedTag}</Badge>}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div>
                              <div className="text-xs uppercase text-[--ink-3] mb-1">{ta.colRuns}</div>
                              {u.runs.length === 0 ? (
                                <p className="text-sm text-[--ink-3]">{ta.noRuns}</p>
                              ) : (
                                <ul className="space-y-1">
                                  {u.runs.map((r) => (
                                    <li key={r.id} className="text-sm" dir="auto">
                                      {r.gameTitle}, {r.status} ({r.participantCount})
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
