// What one creator notification says and where it leads (change: creator-engagement-loop). Pure, so the
// bell renders and the unit lane checks the same thing. A kind we do not know yet, or an item missing
// what its sentence needs, is dropped rather than drawn as a broken line: an empty list is honest, a
// line reading "undefined passed 5 participants" is not.
import type { CreatorNotification, EventCountdown } from '@rushpoint/shared';
import type { IconName } from '../components/Icon';

export interface NotificationCopy {
  firstJoin: (p: { game: string; team: string }) => string;
  players: (p: { game: string; n: number }) => string;
  finished: (p: { game: string; teams: number }) => string;
  likedGame: (p: { title: string; n: number }) => string;
  likedTask: (p: { title: string; n: number }) => string;
  copied: (p: { title: string; n: number }) => string;
  rated: (p: { n: number }) => string;
  eventSoon: (p: { game: string; when: EventCountdown }) => string;
}

export interface NotificationView { id: string; text: string; href: string | null; icon: IconName; createdAt: string }

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function notificationView(n: CreatorNotification, copy: NotificationCopy): NotificationView | null {
  if (!n || typeof n.id !== 'string' || !Number.isFinite(Date.parse(n.createdAt))) return null;
  const p = n.params ?? {};
  const run = n.gameId && n.runId ? `/run/${n.gameId}/${n.runId}` : null;
  const report = n.gameId && n.runId ? `/report/${n.gameId}/${n.runId}` : null;
  // The end of a run opens on its moments, full screen: the peak, not a table.
  const moments = run ? `${run}?moments=1` : null;
  const base = { id: n.id, createdAt: n.createdAt };
  switch (n.kind) {
    case 'firstJoin':
      return str(p.game) ? { ...base, text: copy.firstJoin({ game: str(p.game), team: str(p.team) }), href: run, icon: 'users' } : null;
    case 'players':
      return str(p.game) && num(p.n) > 0 ? { ...base, text: copy.players({ game: str(p.game), n: num(p.n) }), href: run, icon: 'trophy' } : null;
    case 'finished':
      return str(p.game) ? { ...base, text: copy.finished({ game: str(p.game), teams: num(p.teams, 1) }), href: moments, icon: 'camera' } : null;
    case 'liked': {
      if (!str(p.title)) return null;
      const args = { title: str(p.title), n: num(n.count, 1) };
      return { ...base, text: p.item === 'task' ? copy.likedTask(args) : copy.likedGame(args), href: '/gallery', icon: 'heart' };
    }
    case 'copied':
      return str(p.title) ? { ...base, text: copy.copied({ title: str(p.title), n: num(n.count, 1) }), href: '/gallery', icon: 'star' } : null;
    case 'rated':
      return { ...base, text: copy.rated({ n: num(n.count, 1) }), href: report, icon: 'thumbsUp' };
    case 'eventSoon': {
      const when = p.when === 'd3' || p.when === 'd1' || p.when === 'd0' ? p.when : null;
      return str(p.game) && when ? { ...base, text: copy.eventSoon({ game: str(p.game), when }), href: n.gameId ? `/build/${n.gameId}` : null, icon: 'flame' } : null;
    }
    default:
      return null;
  }
}
