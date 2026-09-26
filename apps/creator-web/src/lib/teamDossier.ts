// Everything about ONE team, for the Run Console's team page (change: team-dossier-and-search, D1).
//
// Field report 2026-09-25: "In teams and scores I can't click a team and see everything about
// it." The console already streams every team document in full; this turns one of them into a
// plain view-model the component only has to render.
//
// Pure, clock-injected and total. Named fields are copied OUT of the document (the
// galleryTaskDetail.ts pattern), so a field added to the team document tomorrow can never reach
// the organizer's screen by accident, and a malformed value is dropped rather than rendered.

import { isRenderableMedia, normalizePhone, submissionSenderName } from '@rushpoint/shared';

export interface DossierPhone { uid: string; name: string; sending: boolean }
export interface DossierAnswer { answer: string; correct?: boolean }
export interface DossierTask {
  taskId: string;
  title: string;
  status: string;
  earnedScore?: number;
  /** answer-scored-question: which outcome earned the points ('unmatched' = the catch-all). */
  outcome?: { id: string; label: string };
  /** Whole minutes from start to finish, when both are known. */
  minutes?: number;
  answers: DossierAnswer[];
}
export interface DossierStage { title: string; status: string; tasks: DossierTask[] }
export interface DossierMedia {
  taskId: string;
  title: string;
  url: string;
  kind: 'photo' | 'audio' | 'video';
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  senderName: string;
  /** video-upload-speed D7: '' when there is none. */
  posterUrl: string;
  durationSec: number | null;
}
export interface DossierLedgerLine {
  at: string;
  delta: number;
  kind: string;
  reason?: string;
  by?: string;
  taskTitle?: string;
}
export interface TeamDossier {
  id: string;
  name: string;
  score: number;
  rank: number | null;
  status: 'waiting' | 'playing' | 'finished';
  members: string[];
  phones: DossierPhone[];
  current: { taskId: string; title: string; minutes: number | null } | null;
  timeline: DossierStage[];
  media: DossierMedia[];
  ledger: DossierLedgerLine[];
  /** Numbers to call, from the game's phone-type registration fields only. */
  callTargets: { label: string; phone: string }[];
  /** Whether the game asks teams for a phone at all (the page explains how when not). */
  gameAsksForPhone: boolean;
  /** Where the team was last seen (their teamLocations ping), or null when unknown. */
  location: { lat: number; lng: number; minutesAgo: number | null; mapsUrl: string } | null;
}

export interface TeamDossierInput {
  teamDoc: unknown;
  taskTitle: (taskId: string) => string;
  stageTitle: (order: number) => string;
  nowMs: number;
  rank?: number | null;
  /** Turns a stored reason (a preset code like `reasonHelpfulness`, or free text)
   *  into words. Never lets a raw code reach the organizer. */
  reasonLabel?: (reason: string) => string;
  /** The game's registration fields of type 'phone' (quick-dial-and-actions D3). */
  phoneFields?: { id: string; label: string }[];
  /** An outcome's authored text, from the game (answer-scored-question). '' when unknown. */
  outcomeLabel?: (taskId: string, outcomeId: string) => string;
  /** The team's teamLocations document, when the console has it. */
  location?: { lat?: unknown; lng?: unknown; updatedAt?: unknown } | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const ms = (v: unknown): number | undefined => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : undefined;
};
const wholeMinutes = (from?: number, to?: number): number | undefined =>
  from !== undefined && to !== undefined && to >= from ? Math.floor((to - from) / 60000) : undefined;

export function buildTeamDossier(input: TeamDossierInput): TeamDossier | null {
  const t = input.teamDoc;
  if (!isObj(t) || typeof t.id !== 'string' || !t.id) return null;
  const title = (id: string) => {
    try { return input.taskTitle(id) || id; } catch { return id; }
  };

  const status: TeamDossier['status'] = t.status === 'finished' ? 'finished' : t.launched === true ? 'playing' : 'waiting';
  const controller = str(t.controllerUid) ?? t.id;

  const members = Array.isArray(t.memberNames) ? t.memberNames.filter((m): m is string => typeof m === 'string' && !!m.trim()) : [];
  const phones: DossierPhone[] = (Array.isArray(t.devices) ? t.devices : [])
    .filter((d): d is Obj => isObj(d) && typeof d.uid === 'string')
    .map((d) => ({ uid: d.uid as string, name: str(d.name) ?? '', sending: d.uid === controller }));

  const timeline: DossierStage[] = [];
  const stages = Array.isArray(t.stages) ? t.stages.filter(isObj) : [];
  for (const s of stages) {
    const order = num(s.order);
    const tasks: DossierTask[] = (Array.isArray(s.tasks) ? s.tasks : [])
      .filter((r): r is Obj => isObj(r) && typeof r.taskId === 'string')
      .map((r) => {
        const answers: DossierAnswer[] = (Array.isArray(r.answerLog) ? r.answerLog : [])
          .filter((a): a is Obj => isObj(a) && typeof a.answer === 'string')
          .map((a) => (typeof a.correct === 'boolean' ? { answer: a.answer as string, correct: a.correct } : { answer: a.answer as string }));
        const out: DossierTask = { taskId: r.taskId as string, title: title(r.taskId as string), status: str(r.status) ?? 'unassigned', answers };
        const earned = num(r.earnedScore);
        if (earned !== undefined) out.earnedScore = earned;
        const oid = str(r.outcomeId);
        if (oid) {
          let label = '';
          if (oid !== 'unmatched') { try { label = input.outcomeLabel?.(r.taskId as string, oid) ?? ''; } catch { label = ''; } }
          out.outcome = { id: oid, label };
        }
        const m = wholeMinutes(ms(r.startedAt), ms(r.completedAt));
        if (m !== undefined) out.minutes = m;
        return out;
      });
    if (order === undefined && tasks.length === 0) continue; // nothing readable in it
    timeline.push({ title: order !== undefined ? input.stageTitle(order) : '', status: str(s.status) ?? '', tasks });
  }

  let current: TeamDossier['current'] = null;
  const activeId = str(t.activeTaskId);
  if (status === 'playing' && activeId) {
    let started: number | undefined;
    for (const s of stages) {
      for (const r of Array.isArray(s.tasks) ? s.tasks : []) {
        if (isObj(r) && r.taskId === activeId) started = ms(r.startedAt);
      }
    }
    const minutes = wholeMinutes(started, input.nowMs);
    current = { taskId: activeId, title: title(activeId), minutes: minutes ?? null };
  }

  const media: DossierMedia[] = [];
  if (isObj(t.taskSubmissions)) {
    for (const [taskId, sub] of Object.entries(t.taskSubmissions)) {
      if (!isObj(sub)) continue;
      const url = str(sub.photoUrl) ?? '';
      if (!isRenderableMedia(url)) continue;
      const kind = sub.mediaKind === 'audio' ? 'audio' : sub.mediaKind === 'video' ? 'video' : 'photo';
      const st = sub.status === 'approved' || sub.status === 'rejected' ? sub.status : 'pending';
      media.push({
        taskId, title: title(taskId), url, kind, status: st,
        submittedAt: str(sub.submittedAt) ?? '',
        senderName: submissionSenderName({ displayName: str(t.displayName) }, sub as never),
        posterUrl: kind === 'video' && isRenderableMedia(str(sub.posterUrl) ?? '') ? (str(sub.posterUrl) as string) : '',
        durationSec: typeof sub.mediaDurationSec === 'number' && Number.isFinite(sub.mediaDurationSec) && sub.mediaDurationSec > 0 ? sub.mediaDurationSec : null,
      });
    }
    media.sort((a, b) => (ms(b.submittedAt) ?? 0) - (ms(a.submittedAt) ?? 0));
  }

  const ledger: DossierLedgerLine[] = (Array.isArray(t.scoreLedger) ? t.scoreLedger : [])
    .filter((l): l is Obj => isObj(l) && num(l.delta) !== undefined && typeof l.kind === 'string')
    .map((l) => {
      const line: DossierLedgerLine = { at: str(l.at) ?? '', delta: num(l.delta)!, kind: l.kind as string };
      const reason = str(l.reason);
      if (reason) {
        let label = reason;
        try { label = input.reasonLabel?.(reason) || reason; } catch { /* keep the stored text */ }
        line.reason = label;
      }
      if (str(l.by)) line.by = str(l.by);
      if (str(l.taskId)) line.taskTitle = title(l.taskId as string);
      return line;
    })
    .reverse();

  // Only fields the GAME declared as phone fields: a number typed into a name field
  // is not an invitation to call it.
  const callTargets: { label: string; phone: string }[] = [];
  const reg = isObj(t.registrationData) ? t.registrationData : {};
  for (const f of input.phoneFields ?? []) {
    const v = reg[f.id];
    const values = Array.isArray(v) ? v : [v];
    for (const x of values) {
      if (typeof x === 'string' && normalizePhone(x)) callTargets.push({ label: f.label, phone: x.trim() });
    }
  }

  // Last known place. A 0,0 placeholder or an out-of-range value is "unknown", never a pin in the
  // sea: the organizer would drive to it.
  let location: TeamDossier['location'] = null;
  const loc = input.location;
  if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number'
    && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)
    && Math.abs(loc.lat) <= 90 && Math.abs(loc.lng) <= 180 && !(loc.lat === 0 && loc.lng === 0)) {
    const at = typeof loc.updatedAt === 'string' ? Date.parse(loc.updatedAt) : NaN;
    location = {
      lat: loc.lat,
      lng: loc.lng,
      minutesAgo: Number.isFinite(at) ? Math.max(0, Math.round((input.nowMs - at) / 60_000)) : null,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`,
    };
  }

  return {
    id: t.id,
    name: str(t.displayName) ?? t.id,
    score: num(t.score) ?? 0,
    rank: typeof input.rank === 'number' && Number.isFinite(input.rank) ? input.rank : null,
    status,
    members,
    phones,
    current,
    timeline,
    media,
    location,
    ledger,
    callTargets,
    gameAsksForPhone: (input.phoneFields ?? []).length > 0,
  };
}
