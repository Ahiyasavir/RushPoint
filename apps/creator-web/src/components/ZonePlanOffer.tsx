// "Your missions are spread over a few areas: arrange the game by area?" (change: composer-v2-zones).
//
// Shown in the Builder once the creator's pins fall into two or more areas that the current stages
// mix. One press regroups the game one stage per area, in walking order (lib/zonePlan.ts); the
// Builder's history makes it undoable like any edit. Never shown when the plan would change nothing,
// and never for a game with authored unlock gates or exclusive groups (the planner refuses those).
import { useMemo } from 'react';
import type { Game } from '@rushpoint/shared';
import { useT } from './LanguageContext';
import { Icon } from './Icon';
import { TAP_TEXT } from '../lib/interaction';
import { planZoneStages, type ZonePlan, type ZonePlanCopy } from '../lib/zonePlan';
import { uuid } from '../taskShorthands';

export function useZonePlanCopy(): ZonePlanCopy {
  const b = useT().builder;
  return useMemo(() => ({
    stageTitle: b.zoneStageTitle,
    arrivalTitle: b.zoneArrivalTitle,
    arrivalDescription: b.zoneArrivalDescription,
  }), [b]);
}

export default function ZonePlanOffer({ game, onApply, onDismiss }: {
  game: Pick<Game, 'stages' | 'wizardSteps'>;
  onApply: (plan: ZonePlan) => void;
  onDismiss: () => void;
}) {
  const b = useT().builder;
  const copy = useZonePlanCopy();
  // Ids are minted only when the creator applies, so a render never burns ids; the preview counts
  // come from the same planner with deterministic ids.
  const preview = useMemo(() => planZoneStages(game, copy), [game, copy]);
  if (!preview || preview.movedCount === 0) return null;

  return (
    <div className="shrink-0 mx-1 rounded-xl border border-rp-fire/40 bg-[--surface-1] px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2"
      data-tour="zone-plan-offer">
      <div className="flex items-start gap-2 flex-1 min-w-0">
        <Icon name="map" className="w-5 h-5 shrink-0 text-ink-fire mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[--ink-1]">{b.zonePlanTitle(preview.zoneCount)}</p>
          <p className="text-xs text-[--ink-2] leading-snug">{b.zonePlanBody(preview.arrivalCount)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button type="button" onClick={onDismiss}
          className={`${TAP_TEXT} px-3 rounded-lg text-sm text-[--ink-2] hover:bg-[--surface-2] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60`}>
          {b.zonePlanDismiss}
        </button>
        <button type="button"
          onClick={() => {
            const plan = planZoneStages(game, copy, () => uuid());
            if (plan) onApply(plan);
          }}
          className={`${TAP_TEXT} px-4 rounded-lg text-sm font-semibold bg-rp-fire text-white hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60`}>
          {b.zonePlanApply}
        </button>
      </div>
    </div>
  );
}
