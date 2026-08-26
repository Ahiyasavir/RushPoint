// The smart-build questionnaire (change: smart-game-composer).
//
// Renders SteppedWizard over the step data in lib/smartBuildWizard.ts. Every
// decision — which questions exist, in what order, what their defaults are, what
// "complete" means, what the composer payload looks like — lives in that pure
// reducer, so this file is only markup and copy lookup.
//
// Bank tags are rendered through their REGISTRY LABEL for the current language,
// never their id. `needsSetup` on a creator's screen would be the data model
// leaking into the product, and `bankTagLabel` returns '' for an unknown id
// rather than falling back to the id itself, so that leak cannot happen even by
// accident.
import { useMemo, useReducer } from 'react';
import { ChipRow, MultiChipRow, RatingRow } from './ui';
import SteppedWizard, { type WizardStepConfig } from './SteppedWizard';
import { useLanguage, useT } from './LanguageContext';
import { bankTagLabel, type BankTagId } from '../bankTags';
import {
  SMART_BUILD_OCCASIONS,
  SMART_BUILD_WHO,
  SMART_BUILD_DIFFICULTIES,
  SMART_BUILD_PREP_LEVELS,
  SMART_BUILD_DURATIONS,
  SMART_BUILD_GROUP_SIZES,
  SMART_BUILD_PREFERRED_TAGS,
  SMART_BUILD_AREAS,
  SMART_BUILD_QUESTION_ORDER,
  hasLeftSmartBuild,
  initialSmartBuildState,
  isSmartBuildComplete,
  smartBuildAnswers,
  smartBuildReducer,
} from '../lib/smartBuildWizard';
import { previewComposition, type ComposerAnswers } from '../lib/composeGame';
import { TASK_BANK } from '../taskBank';

export default function SmartBuildWizard({ busy, onLeave, onFinish }: {
  busy?: boolean;
  /** The creator backed out through the first question. */
  onLeave: () => void;
  onFinish: (answers: ComposerAnswers) => void;
}) {
  const t = useT();
  const { lang } = useLanguage();
  const w = t.dashboard.wizard;
  const [state, dispatch] = useReducer(smartBuildReducer, undefined, initialSmartBuildState);

  const a = state.answers;

  // What we are about to build, from the answers so far. Recomputed as they
  // change and shown on the LAST screen only: earlier it would be noise (the
  // number moves with every tap), and on the last screen it is the one fact
  // that makes the final tap an informed decision instead of an act of faith.
  const preview = useMemo(() => previewComposition(TASK_BANK, smartBuildAnswers(state)), [state]);

  const tagLabel = (id: BankTagId): string => bankTagLabel(id, lang === 'en' ? 'en' : 'he');

  // Keyed on the level itself, so a sixth level added to PREP_SCALE shows up as
  // a missing label rather than as a silently wrong one.
  const prepLabel = (level: number): string => w.prepLevels[String(level)] ?? '';
  const prepHint = (level: number): string => w.prepLevelHints[String(level)] ?? '';

  const difficultyLabel = (id: string): string =>
    id === 'easy' ? w.difficultyEasy
      : id === 'hard' ? w.difficultyHard
        : w.difficultyBalanced;

  // One entry per SMART_BUILD_QUESTION_ORDER id, in the same order — the shell
  // indexes into this array with the reducer's index, so the two must not drift.
  const steps: WizardStepConfig[] = [
    {
      id: 'occasion',
      title: w.occasionTitle,
      subtitle: w.occasionSub,
      render: () => (
        <div className="flex flex-col gap-2">
          <ChipRow
            label={w.occasionLabel}
            options={SMART_BUILD_OCCASIONS}
            value={a.occasion}
            onChange={(v) => dispatch({ type: 'setAnswer', key: 'occasion', value: v })}
            render={(v) => w.occasionOptions[v] ?? ''}
          />
          <p className="text-[11px] text-[--ink-3]">{w.occasionHint}</p>
        </div>
      ),
    },
    {
      id: 'who',
      title: w.whoTitle,
      subtitle: w.whoSub,
      render: () => (
        <ChipRow
          label={w.whoLabel}
          options={SMART_BUILD_WHO.map((o) => o.id)}
          value={a.who}
          onChange={(v) => dispatch({ type: 'setAnswer', key: 'who', value: v })}
          render={(v) => w.whoOptions[v] ?? ''}
        />
      ),
    },
    {
      id: 'areas',
      title: w.areasTitle,
      subtitle: w.areasSub,
      render: () => (
        // Just the places now. Whether missions get PINNED to real spots used to
        // be a second question here — it is a preparation level, and it is asked
        // as one (see the prep step below).
        <MultiChipRow
          label={w.areasLabel}
          options={SMART_BUILD_AREAS}
          values={a.areas}
          onToggle={(area) => dispatch({ type: 'toggleArea', area })}
          render={(v) => tagLabel(v)}
          hint={w.areasHint}
        />
      ),
    },
    {
      id: 'people',
      title: w.smartPeopleTitle,
      subtitle: w.smartPeopleSub,
      render: () => (
        <ChipRow
          label={w.peopleLabel}
          options={SMART_BUILD_GROUP_SIZES.map((b) => b.people)}
          value={a.people}
          onChange={(v) => dispatch({ type: 'setAnswer', key: 'people', value: v })}
          render={(v) => (v >= (SMART_BUILD_GROUP_SIZES[SMART_BUILD_GROUP_SIZES.length - 1]?.people ?? 40)
            ? w.peoplePlus(v) : w.peopleUpTo(v))}
        />
      ),
    },
    {
      id: 'duration',
      title: w.smartDurationTitle,
      subtitle: w.smartDurationSub,
      render: () => (
        <ChipRow
          label={w.durationLabel}
          options={SMART_BUILD_DURATIONS}
          value={a.minutes}
          onChange={(v) => dispatch({ type: 'setAnswer', key: 'minutes', value: v })}
          render={(v) => w.minutesShort(v)}
        />
      ),
    },
    {
      id: 'difficulty',
      title: w.difficultyTitle,
      subtitle: w.difficultySub,
      render: () => (
        <ChipRow
          label={w.difficultyLabel}
          options={SMART_BUILD_DIFFICULTIES}
          value={a.difficultyPreference}
          onChange={(v) => dispatch({ type: 'setAnswer', key: 'difficultyPreference', value: v })}
          render={(v) => difficultyLabel(v)}
        />
      ),
    },
    {
      id: 'prep',
      title: w.prepTitle,
      subtitle: w.prepSub,
      render: () => (
        <RatingRow
          label={w.prepLabel}
          options={SMART_BUILD_PREP_LEVELS}
          value={a.prepEffort}
          onChange={(v) => dispatch({ type: 'setAnswer', key: 'prepEffort', value: v })}
          render={(v) => prepLabel(v)}
          hint={prepHint(a.prepEffort)}
        />
      ),
    },
    {
      id: 'preferred',
      title: w.preferredTitle,
      subtitle: w.preferredSub,
      render: () => (
        <MultiChipRow
          label={w.preferredLabel}
          options={SMART_BUILD_PREFERRED_TAGS}
          values={a.preferredTags}
          onToggle={(tag) => dispatch({ type: 'togglePreferred', tag })}
          render={(v) => tagLabel(v)}
          hint={w.preferredHint}
        />
      ),
    },
  ];

  // Sits below the last question's chips, above the CTA.
  const previewLine = preview.possible
    ? w.previewCount(preview.missionCount)
    : w.previewNone;

  function handleNext() {
    const next = smartBuildReducer(state, { type: 'next' });
    // The reducer is the single source of "are we done" — asking it, rather than
    // comparing indexes here, is what keeps that rule in one place.
    if (isSmartBuildComplete(next)) { onFinish(smartBuildAnswers(next)); return; }
    dispatch({ type: 'next' });
  }

  function handleBack() {
    const next = smartBuildReducer(state, { type: 'back' });
    // Back past the first question means "I picked the wrong card" — hand control
    // to the host wizard rather than trapping the creator on question one.
    if (hasLeftSmartBuild(next)) { onLeave(); return; }
    dispatch({ type: 'back' });
  }

  return (
    <SteppedWizard
      steps={steps}
      index={Math.min(state.index, SMART_BUILD_QUESTION_ORDER.length - 1)}
      onBack={handleBack}
      onNext={handleNext}
      busy={busy}
      finalNote={previewLine}
      labels={{
        back: w.back,
        next: w.next,
        finish: w.smartFinish,
        progress: (step, total) => w.smartProgress(step, total),
      }}
    />
  );
}
