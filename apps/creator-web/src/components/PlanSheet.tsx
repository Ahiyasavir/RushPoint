// What a creator on the community plan sees (change: community-plan). Ahiya, 2.11: it must not feel
// like a wall. So the launches are a gift that is being used, shown as progress and never as a countdown;
// a launch is celebrated before anything is said about what is left; there is no red and no error word;
// and asking for more is a one tap message to a person, with the message already written.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { launchMoment, planContactUrl, type CreatorPlanView } from '@rushpoint/shared';
import { getMyPlan } from '../services/calls';
import { useT } from './LanguageContext';
import { Icon } from './Icon';
import { useAuth } from './AuthGate';

export type PlanReason = 'launch' | 'out' | 'info' | 'publish' | 'export' | 'import' | 'share';
type BlockedFeature = 'publish' | 'export' | 'import' | 'share';

/** Three marks at most reach a phone row; an account he opened further reads as a number instead. */
const MAX_MARKS = 6;

export function PlanMarks({ plan, launching = false }: { plan: CreatorPlanView; launching?: boolean }) {
  if (plan.runsTotal > MAX_MARKS) return null;
  return (
    <span className="inline-flex items-center gap-1.5" aria-hidden="true">
      {Array.from({ length: plan.runsTotal }, (_, i) => {
        const used = i < plan.runsUsed;
        const now = launching && i === plan.runsUsed;
        return (
          <span key={i} className={`inline-flex items-center justify-center rounded-full w-5 h-5 border-2 ${
            used ? 'bg-rp-fire border-rp-fire text-white' : now ? 'border-rp-fire bg-rp-fire/15 animate-pulse motion-reduce:animate-none' : 'border-[--rp-border] bg-[--surface-0]'
          }`}>
            {used && <Icon name="check" className="w-3 h-3" />}
          </span>
        );
      })}
    </span>
  );
}

function PlanSheet({ plan, reason, gameTitle, onDone }: {
  plan: CreatorPlanView; reason: PlanReason; gameTitle?: string; onDone: (go: boolean) => void;
}) {
  const t = useT();
  const p = t.plan;
  const { user } = useAuth();
  const moment = reason === 'launch' ? launchMoment(plan) : null;
  const ending = reason === 'out' || !!moment?.last;

  const title = moment ? p.launchTitle(moment.launchNumber)
    : reason === 'out' ? p.outTitle(plan.runsUsed)
    : reason === 'info' ? p.infoTitle
    : p.blocked[reason as BlockedFeature].title;
  const body = moment ? p.launchBody(moment.leftAfter, plan.runsTotal)
    : reason === 'out' ? p.outBody
    : reason === 'info' ? p.infoBody(plan.runsLeft, plan.runsTotal)
    : p.blocked[reason as BlockedFeature].body;

  const contactHref = planContactUrl(p.contactMessage({ email: user?.email ?? '', game: gameTitle ?? '' }));

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-[--surface-0] p-6 pb-[calc(env(safe-area-inset-bottom)+24px)] sm:pb-6 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[14px] font-bold text-ink-fire">
            <Icon name="gift" className="w-4 h-4" />{p.eyebrow}
          </span>
          <PlanMarks plan={plan} launching={!!moment} />
        </div>
        <h2 className="mt-4 font-brand text-[28px] font-extrabold leading-tight text-[--ink-1]" dir="auto">{title}</h2>
        <p className="mt-2 text-[17px] leading-relaxed text-[--ink-2]" dir="auto">{body}</p>

        {reason !== 'publish' && reason !== 'export' && reason !== 'import' && reason !== 'share' && (
          <ul className="mt-4 space-y-1.5 text-[15px] text-[--ink-2]">
            {p.includes.map((line) => (
              <li key={line} className="flex items-center gap-2"><Icon name="checkCircle" className="w-4 h-4 shrink-0 text-ink-fire" />{line}</li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex flex-col gap-2">
          {moment && (
            <button type="button" onClick={() => onDone(true)} className="min-h-[52px] rounded-2xl bg-rp-fire px-6 text-[17px] font-bold text-white">
              {p.launchCta}
            </button>
          )}
          <a
            href={contactHref} target="_blank" rel="noreferrer" onClick={() => { if (!moment) onDone(false); }}
            className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-6 text-[16px] font-bold ${
              moment && !ending ? 'text-ink-fire' : moment ? 'border-2 border-rp-fire/50 text-ink-fire' : 'bg-rp-fire text-white'
            }`}
          >
            <Icon name="chat" className="w-5 h-5" />{ending ? p.contactMoreCta : p.contactCta}
          </a>
          <button type="button" onClick={() => onDone(false)} className="min-h-[44px] text-[15px] font-semibold text-[--ink-2]">
            {moment ? p.notYet : p.close}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The plan for one page: what it may do, and the sheet that explains it. Fails open: the server decides. */
export function usePlanGate() {
  const { user } = useAuth();
  const uid = user?.uid;
  const [plan, setPlan] = useState<CreatorPlanView | null>(null);
  const [open, setOpen] = useState<{ reason: PlanReason; gameTitle?: string; resolve: (go: boolean) => void } | null>(null);

  useEffect(() => {
    if (!uid) return;
    let live = true;
    void getMyPlan().then((p) => { if (live) setPlan(p); }).catch(() => undefined);
    return () => { live = false; };
  }, [uid]);

  const ask = useCallback((view: CreatorPlanView, reason: PlanReason, gameTitle?: string) => new Promise<boolean>((resolve) => {
    setPlan(view);
    setOpen({ reason, gameTitle, resolve });
  }), []);

  /** Asked right before a real launch, from a fresh read: another tab may have spent one. */
  const confirmLaunch = useCallback(async (gameTitle: string): Promise<boolean> => {
    const view = await getMyPlan().catch(() => null);
    if (!view || view.plan !== 'community') return true;
    return ask(view, view.runsLeft > 0 ? 'launch' : 'out', gameTitle);
  }, [ask]);

  /** True when this creator's plan holds the feature back; the sheet has then been shown. */
  const blocked = useCallback((feature: BlockedFeature, gameTitle?: string): boolean => {
    if (!plan || plan.canMoveGames) return false;
    void ask(plan, feature, gameTitle);
    return true;
  }, [plan, ask]);

  const showInfo = useCallback(() => { if (plan) void ask(plan, plan.runsLeft > 0 ? 'info' : 'out'); }, [plan, ask]);

  const sheet = useMemo(() => (open && plan
    // On body: the home screen's header animates in, and a transformed ancestor would trap `fixed`.
    ? createPortal(<PlanSheet plan={plan} reason={open.reason} gameTitle={open.gameTitle} onDone={(go) => { open.resolve(go); setOpen(null); }} />, document.body)
    : null), [open, plan]);

  return { plan, confirmLaunch, blocked, showInfo, sheet, isCommunity: plan?.plan === 'community' };
}

/** The line on the home screen: progress, in a corner, never a banner. */
export function PlanChip({ plan, onOpen }: { plan: CreatorPlanView; onOpen: () => void }) {
  const p = useT().plan;
  if (plan.plan !== 'community') return null;
  return (
    <button type="button" onClick={onOpen} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[--rp-border] bg-[--surface-0] px-4 text-[14px] font-semibold text-[--ink-2]">
      <PlanMarks plan={plan} />
      <span dir="auto">{plan.runsLeft > 0 ? p.chipLeft(plan.runsLeft, plan.runsTotal) : p.chipOut}</span>
    </button>
  );
}
