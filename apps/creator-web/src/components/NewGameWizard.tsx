// The guided new-game wizard (change: guided-new-game-wizard).
//
// Replaces the template-card picker as the "+ New game" entry point. Two screens,
// both designed at 390px FIRST: this repo has a documented habit of shipping
// creator-web UI desktop-first and patching it for phones afterwards (the Quick
// Setup step bar and the mission-editor sheet both did exactly that), and the
// creator console is used on a phone more than anywhere else.
//
// Every decision lives in lib/newGameWizard.ts and lib/describeNewGame.ts — this
// file only renders them. In particular it does NOT decide which template a game
// type maps to: that comes from `templateGenre`, declared by an admin per
// template, so renaming or reordering a template can never silently change what
// the wizard builds.
import { useMemo, useReducer, useState } from 'react';
import { Button, ChipRow, Input } from './ui';
import SmartBuildWizard from './SmartBuildWizard';
import { useT } from './LanguageContext';
import {
  AGE_BANDS, DURATION_BANDS, GROUP_SIZE_BANDS, ADULT_AGE,
  GUARDIAN_CONSENT_AGE_THRESHOLD,
} from '@rushpoint/shared';
import {
  initialWizardState, wizardReducer, buildCreationPlan, availableGameTypes,
  templateForGameType, type CreationPlan, type GameTypeId, type WizardTemplateOption,
  type WizardPath,
} from '../lib/newGameWizard';
import { blendGameDescription, derivedGameTags, type NewGameDescriptionCopy } from '../lib/describeNewGame';
import type { ComposerAnswers } from '../lib/composeGame';

/** What the wizard needs to know about each available template. */
export interface WizardTemplate extends WizardTemplateOption {
  templateEmoji?: string;
  title: string;
  description?: string;
  stageCount: number;
  taskCount: number;
  id: string;
  ownerUid: string;
}

/** What the Dashboard is asked to create. */
export interface WizardSubmission {
  plan: CreationPlan;
  /** Present only on the guided path: the resolved template plus composed copy. */
  template?: WizardTemplate;
  description?: string;
  tags?: string[];
}

export default function NewGameWizard({ templates, busy, onSubmit, recentBankKeys }: {
  templates: readonly WizardTemplate[];
  busy?: boolean;
  onSubmit: (submission: WizardSubmission) => void;
  /** Passed straight through to the smart build — see its own prop note. */
  recentBankKeys?: string[];
}) {
  const t = useT();
  const d = t.dashboard;
  const w = d.wizard;
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialWizardState);
  // The path step SELECTS and then confirms (change: builder-mobile-simplification),
  // so the choice needs somewhere to live between the two taps. It starts on the
  // recommended path: the step can then never present a disabled Next, and a
  // creator who simply taps through gets the option we actually recommend.
  const [pathChoice, setPathChoice] = useState<WizardPath>('smart_build');
  const [nameTouched, setNameTouched] = useState(false);

  // Only the types an admin actually tagged a template for. A type nothing can
  // build is not offered — offering it would silently create the wrong game.
  const offered = useMemo(() => availableGameTypes(templates), [templates]);
  const chosenType = (offered.includes(state.answers.type) ? state.answers.type : offered[0]) as GameTypeId | undefined;
  const resolved = useMemo(
    () => (chosenType ? templateForGameType(templates, chosenType) : null),
    [templates, chosenType],
  );
  const template = resolved
    ? templates.find((x) => x.groupKey === resolved.groupKey)
    : undefined;

  /** A band's human label, in words. Never its id — ids carry hyphens, and the
   *  copy standard forbids showing one. */
  const ageBandLabel = (bandId: string): string => {
    const band = AGE_BANDS.find((b) => b.id === bandId);
    if (!band) return '';
    return band.to === undefined ? w.agePlus(band.from) : w.ageRange(band.from, band.to);
  };

  const copy: NewGameDescriptionCopy = ({
    lead: ({ people, minutes, ageLabel }) => w.descriptionLead(people, minutes, ageLabel),
    ageLabel: (bandId) => ageBandLabel(bandId),
    ageTag: (bandId) => w.ageTag(ageBandLabel(bandId)),
    durationTag: (minutes) => w.durationTag(minutes),
  });

  /**
   * Create whatever the given action makes creatable, or advance if it does not.
   *
   * The reducer is the single source of "is anything creatable yet" — choosing
   * the guided path only advances to the questions, while choosing scratch (or
   * pressing the final CTA) lands on `done` and yields a plan. Asking the reducer
   * rather than tracking it here is what keeps "nothing is created until the end"
   * true in one place instead of two.
   */
  function advanceOrCreate(action: Parameters<typeof wizardReducer>[1]) {
    const next = wizardReducer(state, action);
    const plan = buildCreationPlan(next, d.untitledGame);
    if (!plan) { dispatch(action); return; }
    // Both of these carry everything the Dashboard needs on their own; only the
    // template arm needs a resolved template and composed copy alongside it.
    if (plan.kind === 'blank' || plan.kind === 'smart_build') { onSubmit({ plan }); return; }
    onSubmit({
      plan,
      template,
      description: blendGameDescription(template?.description, plan.answers, copy),
      tags: derivedGameTags(plan.answers, copy),
    });
  }

  const ageBand = AGE_BANDS.find((b) => b.id === state.answers.age);
  const showConsentNotice = (ageBand?.from ?? ADULT_AGE) < GUARDIAN_CONSENT_AGE_THRESHOLD;

  // ── Screen 1: name, then the fork ──────────────────────────────────────────
  // Narrower than the fork/questionnaire screens and centred: a single input
  // floating in the same width the icon-grid steps need read as unfinished
  // empty space, not a deliberate first screen (real creator feedback on the
  // shipped panel — change: smart-build-delight follow-up).
  // The three ways in, as data: one shape, one render, so a card can never drift
  // from its siblings the way the two accented ones did before.
  const PATH_CARDS: readonly { path: WizardPath; icon: string; title: string; body: string; recommended?: boolean }[] = [
    { path: 'smart_build', icon: '🧠', title: w.smartTitle, body: w.smartBody, recommended: true },
    { path: 'guided', icon: '📖', title: w.guidedTitle, body: w.guidedBody },
    { path: 'scratch', icon: '📄', title: w.scratchTitle, body: w.scratchBody },
  ];

  // ── The NAME step ─────────────────────────────────────────────────────────
  // Split from the path step (change: builder-mobile-simplification). The two
  // used to share one branch, which meant the PATH screen still rendered the name
  // heading, the name sub-line and the name input above its own question: the
  // biggest thing on the screen asked "what shall we call the game?" while the
  // 13px line under it asked how to start, and the actual answer was three cards
  // with no primary button under them — only a 12px text link. Every other screen
  // in this flow trains the eye to find an orange button at the bottom, so the one
  // screen without one read as stuck.
  if (state.step === 'name') {
    return (
      <div className="flex flex-col gap-3 mx-auto w-full max-w-sm">
        <div className="text-center">
          <div className="text-3xl leading-none mb-1.5" aria-hidden="true">🎲</div>
          <h3 className="font-brand font-bold text-[--ink-1] text-lg">{w.nameTitle}</h3>
          <p className="text-[--ink-3] text-[13px] mt-0.5">{w.nameSub}</p>
        </div>
        <Input
          value={state.name}
          autoFocus
          dir="auto"
          placeholder={w.namePlaceholder}
          onChange={(e) => { dispatch({ type: 'setName', name: e.target.value }); setNameTouched(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter') dispatch({ type: 'next' }); }}
        />
        {/* A blank name never blocks — it resolves to the untitled fallback. */}
        <Button onClick={() => dispatch({ type: 'next' })} className="w-full min-h-[44px]">
          {w.next}
        </Button>
        {/* Only shown once the creator has typed something, so an untouched field
            never looks like an error. */}
        {nameTouched && !state.name.trim() && (
          <p className="text-[13px] text-[--ink-3]">{d.untitledGame}</p>
        )}
      </div>
    );
  }

  // ── The PATH step ─────────────────────────────────────────────────────────
  // Its own question as the heading, the name reduced to a one-line reminder that
  // is also the way back to editing it, and — the point of the split — a real
  // footer with the same חזרה / הבא pair every other step has. The cards SELECT
  // rather than commit, so choosing and confirming are two separate acts here
  // exactly as they are in the questionnaire that follows.
  if (state.step === 'path') {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="font-brand font-bold text-[--ink-1] text-lg">{w.pathTitle}</h3>
        </div>
        <button
          type="button"
          onClick={() => dispatch({ type: 'back' })}
          aria-label={w.nameTitle}
          className="self-start max-w-full flex items-center gap-1.5 rounded-lg border border-[--rp-border] bg-[--surface-2]/60 px-2.5 py-1 text-[13px] text-[--ink-2] hover:text-[--ink-1] hover:bg-[--surface-2] transition-colors"
        >
          <span className="truncate" dir="auto">{state.name.trim() || d.untitledGame}</span>
          <span aria-hidden className="shrink-0 text-[--ink-3]">✎</span>
        </button>
        {/* NOTHING here is truncated, on purpose (change:
            smart-build-wizard-no-scroll). The titles used to `truncate` and the
            bodies to `line-clamp-1`, to keep three stacked cards short enough not
            to scroll on a phone. It worked on the phone and read badly everywhere
            else: at three columns the widest card is ~200px, so the recommended
            card rendered as "שנרכיב לכם מ…" with its body cut mid-word — the
            creator was being asked to choose between three options they could not
            finish reading. The height is bought back from the COPY instead
            (i18n `smartBody` / `guidedBody` are two clauses, not three), which
            shortens the cards in every layout rather than hiding text in one.
            `items-start` so a title that does wrap still aligns with its icon;
            `break-words` so a long single word cannot overflow the card.

            ONE emphasised card, not two: of three genuinely different options the
            compose and story cards used to share the same orange treatment, so two
            read as a matched pair and the blank one as the odd one out — the
            opposite of the real hierarchy.

            Selection is `aria-pressed` plus a border WIDTH change and a tick,
            never colour alone — the rule ChoiceCardRow follows. The recommended
            card keeps a softer accent while unselected so the recommendation
            survives selection moving elsewhere, and the tick is what says which
            one is chosen, so the two signals never read as the same thing. */}
        <div className="grid gap-2 sm:grid-cols-3">
          {PATH_CARDS.map(({ path, icon, title, body, recommended }) => {
            const on = pathChoice === path;
            return (
              <button
                key={path}
                type="button"
                disabled={busy}
                aria-pressed={on}
                onClick={() => setPathChoice(path)}
                className={`relative text-start rounded-xl border-2 p-2.5 transition-colors disabled:opacity-40 ${
                  on ? 'border-rp-fire bg-rp-fire/10'
                    : recommended ? 'border-rp-fire/60 bg-rp-fire/5 hover:bg-rp-fire/10'
                    : 'border-[--rp-border] bg-[--surface-1] hover:border-rp-fire/50 hover:bg-[--surface-2]'}`}
              >
                <div className="flex items-start gap-1.5">
                  <span className="text-lg leading-none shrink-0">{icon}</span>
                  <span className="font-brand font-semibold text-[--ink-1] text-sm break-words">{title}</span>
                  {recommended && !on && (
                    <span className="ms-auto shrink-0 rounded-full bg-rp-fire/15 text-ink-fire text-[12px] font-medium px-1.5 py-0.5">
                      {w.smartRecommended}
                    </span>
                  )}
                  {on && (
                    <span aria-hidden className="ms-auto shrink-0 grid h-5 w-5 place-items-center rounded-full bg-rp-fire text-white text-[12px] leading-none">✓</span>
                  )}
                </div>
                <div className="text-[13px] text-[--ink-3] mt-1 leading-snug break-words">{body}</div>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
            <Button variant="ghost" onClick={() => dispatch({ type: 'back' })} className="min-h-[44px]">
              {w.back}
            </Button>
            <Button
              onClick={() => advanceOrCreate({ type: 'choosePath', path: pathChoice })}
              loading={busy}
              className="flex-1 min-h-[44px]"
            >
            {w.next}
          </Button>
        </div>
      </div>
    );
  }

  // ── The smart-build questionnaire ─────────────────────────────────────────
  // Its own state machine, so nothing here knows what it asks; this file only
  // decides what happens when it finishes or is backed out of.
  if (state.step === 'smartBuildDetails') {
    return (
      <SmartBuildWizard
        busy={busy}
        recentBankKeys={recentBankKeys}
        onLeave={() => dispatch({ type: 'back' })}
        onFinish={(answers: ComposerAnswers, seed: number) => {
          // Record the answers AND the seed, THEN finish — `buildCreationPlan`
          // reads them off the state, so finishing first would compose from the
          // defaults. The seed rides along so the game composed at the call site
          // is the one the live shape panel predicted.
          const withAnswers = wizardReducer(state, { type: 'setComposerAnswers', answers, seed });
          const done = wizardReducer(withAnswers, { type: 'next' });
          const plan = buildCreationPlan(done, d.untitledGame);
          if (plan) onSubmit({ plan });
        }}
      />
    );
  }

  // The guided path was chosen but no template can answer it — say so plainly
  // instead of rendering a question with no possible answer.
  if (state.step === 'details' && offered.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[--ink-2]">{w.noGenreTemplates}</p>
        <Button variant="ghost" onClick={() => dispatch({ type: 'back' })}>{w.back}</Button>
      </div>
    );
  }

  // ── Screen 2: the four questions, one scroll, then the CTA ─────────────────
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-brand font-bold text-[--ink-1] text-lg">{w.detailsTitle}</h3>
        <p className="text-[--ink-3] text-[13px] mt-0.5">{w.detailsSub}</p>
      </div>

      {offered.length > 1 && (
        <ChipRow label={w.typeLabel} options={offered} value={chosenType as GameTypeId}
          onChange={(v) => dispatch({ type: 'setAnswer', key: 'type', value: v })}
          render={(v) => (v === 'story' ? w.typeStory : w.typeMissions)} />
      )}

      <ChipRow label={w.peopleLabel} options={GROUP_SIZE_BANDS.map((b) => b.people)}
        value={state.answers.people}
        onChange={(v) => dispatch({ type: 'setAnswer', key: 'people', value: v })}
        render={(v) => (v >= (GROUP_SIZE_BANDS[GROUP_SIZE_BANDS.length - 1]?.people ?? 40)
          ? w.peoplePlus(v) : w.peopleUpTo(v))} />

      <ChipRow label={w.durationLabel} options={DURATION_BANDS}
        value={state.answers.duration}
        onChange={(v) => dispatch({ type: 'setAnswer', key: 'duration', value: v })}
        render={(v) => w.minutesShort(v)} />

      <ChipRow label={w.ageLabel} options={AGE_BANDS.map((b) => b.id)}
        value={state.answers.age}
        onChange={(v) => dispatch({ type: 'setAnswer', key: 'age', value: v })}
        render={(v) => ageBandLabel(v)} />

      {showConsentNotice && (
        <p className="text-[13px] text-[--ink-2] bg-[--surface-2] rounded-lg px-3 py-2 leading-relaxed">
          {w.consentNotice}
        </p>
      )}

      {/* What we will build. Only what the projection actually carries — counts,
          not a play-time estimate, because the client genuinely cannot compute one
          (listGameTemplates sends counts, never stages). The honest estimate comes
          back in the creation RESPONSE. */}
      {template && (
        <div className="rounded-xl border border-[--rp-border] bg-[--surface-1] p-3">
          <div className="text-[13px] text-[--ink-3]">{w.previewTitle}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xl leading-none">{template.templateEmoji || '🧩'}</span>
            <span className="font-brand font-semibold text-[--ink-1] text-sm min-w-0 truncate" dir="auto">
              {template.title}
            </span>
          </div>
          <div className="text-[13px] text-[--ink-3] mt-1">
            {w.previewMeta(template.stageCount, template.taskCount)}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => dispatch({ type: 'back' })} className="min-h-[44px]">
          {w.back}
        </Button>
        <Button onClick={() => advanceOrCreate({ type: 'next' })} loading={busy} className="flex-1 min-h-[44px]">
          {w.create}
        </Button>
      </div>
    </div>
  );
}
