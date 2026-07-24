# Design: play-pending-states-speak

## Confirmed code references (verified by grep, not read end-to-end)

### P1 — bare spinner on the initial load
- `apps/play-web/src/screens/PlayScreen.tsx:331-351` — `if (!state) { return (<Screen>… }`. The
  non-error branch is line **348**:
  `<div className="w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />`.
  The `err ? (…retry+leave…) : (spinner)` structure is unchanged — only the `:` (no-error) arm is
  replaced.
- `Working` is **not yet imported** in `PlayScreen.tsx` (grep found no import) — the fix adds
  `import { Working } from '../components/Working';`.

### The `Working` component (verified signature)
`apps/play-web/src/components/Working.tsx`:
```
interface WorkingProps {
  messages: string[];         // 2-4 pre-translated branded lines (caller passes t.* values)
  intervalMs?: number;        // rotation cadence, default 1800
  progress?: number;          // 0..1; when given the bar is determinate
  className?: string;
  children?: ReactNode;
}
export function Working({ messages, intervalMs = 1800, progress, className, children }) { … }
```
It is pure/presentational, imports no dictionary, is RTL-agnostic, and already handles
`prefers-reduced-motion` (static first message, no sweep). Existing call site for reference:
`TaskRunner.tsx:456` — `<Working messages={[t.task.workingChecking, t.task.workingLocating, t.task.workingPrepping]}>`.

### P2 — silent quick-submit handlers (verified)
`apps/play-web/src/components/TaskRunner.tsx`:
- Shared busy state: `const [busy, setBusy] = useState(false)` (line 77); `begin()`→`setBusy(true)`
  (89-93), `end()`→`setBusy(false)` (95-97). Derived: `const frozen = busy || readOnly` (line 299);
  `const answerFrozen = frozen || cooldownLeft > 0` (line 303).
- `field()` (505-525) → `submitCheckIn` (499): `clearMsg()` only, no `showProgress`.
- `verify(code)` (568-579): `clearMsg()` only, no `showProgress`.
- `answer(text)` (662-675) and the quiz/numeric/survey callers: `clearMsg()` only, no `showProgress`.
  (The `checkArrival` path at 545-566 and `submitOrdered`/`submitStep` already `showProgress`; the
  photo/audio paths `showProgress(t.task.uploadingPhoto|uploadingAudio)`.)
- The submit **buttons** that currently pass no `loading`:
  - field check-in: line **869** `<Button disabled={frozen} onClick={field} …>`
  - station code: line **1079** `<Button disabled={busy || !code} onClick={() => onSubmit(code)} …>{t.task.verify}</Button>` (inside `CodeEntry`, `busy={frozen}` at 875)
  - quiz text: line **1122** `<Button disabled={busy || !val.trim()} onClick={() => onSubmit(val.trim())} …>`
  - survey: line **1153**; numeric: line **1205**
- The shared `Button` supports `loading`: `apps/play-web/src/components/ui.tsx:7-9` —
  `ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary'|'ghost'|'danger'; loading?: boolean }`.
  Existing usage pattern: `JoinScreen.tsx:275` `loading={lookupAction.busy}`;
  `PostGameSurvey.tsx:207` `loading={sendAction.busy}`.

## Approach

### P1
Replace line 348's bare ring with:
```
<Working messages={[t.play.loadingGame, t.play.syncingProgress, t.play.almostReady]} />
```
No wrapper/logic change; the surrounding centering `<div>` and the `err` branch stay. Reduced motion
is already handled inside `Working`. This is a pure swap of one presentational element.

### P2
Two layers, both reusing what exists (no new logic):
1. **Primary (required):** pass `loading={busy}` to each fast-submit button so it shows the in-flight
   indicator the upload buttons already get. Note `busy` (not `frozen`) is the loading signal —
   `frozen` also folds in `readOnly`, and a read-only viewer device is not "loading". The `disabled`
   guards stay exactly as they are (they already fold in `busy`). For `CodeEntry`/`QuizEntry`/
   `NumericEntry`/`SurveyEntry`, thread the existing `busy` prop through to the button's `loading`.
2. **Secondary (optional, same change):** add a brief branded `showProgress(t.task.checking)` at the
   top of `verify`, `submitCheckIn` (the `field` path) and `answer`, mirroring how the photo path
   sets `showProgress(t.task.uploadingPhoto)` before its await. The success/error `showProgress`/
   `showError`/`applyAnswerCost` calls already overwrite it on completion.

### ⚠️ Sequencing note (same-file, different region)
Another agent is concurrently editing `TaskRunner.tsx`'s **NAV-LINK area** (the Google/Waze
handoff links). P2 touches only the **submit handlers** (`field`/`submitCheckIn`, `verify`,
`answer`) and the entry sub-components' submit buttons — a different region of the same file. To
avoid a merge clash, the P2 implement step MUST land **after** the in-flight nav-link edit is in.
P1 is in a different file (`PlayScreen.tsx`) and has no such constraint — it can land first/anytime.

## i18n

play-web is Hebrew-default with EN parity; every new key needs HE+EN, natural in each language, no
em-dash, routed through `t.*`. `npm run i18n:check:strict` must stay clean.

### P1 — new keys under the `play` block (3 rotation lines)
| key | HE | EN |
|---|---|---|
| `play.loadingGame` | `טוענים את המשחק…` | `Loading your game…` |
| `play.syncingProgress` | `מסנכרנים את ההתקדמות…` | `Syncing your progress…` |
| `play.almostReady` | `כמעט מוכן…` | `Almost ready…` |

(Reusing `task.workingChecking/Locating/Prepping` was considered but rejected: those read "checking
your answer / locating your next mission" — wrong voice for the pre-team initial load.)

### P2 — one new key under the `task` block, only if the optional `showProgress` layer is included
| key | HE | EN |
|---|---|---|
| `task.checking` | `בודקים…` | `Checking…` |

The **required** P2 layer (`loading={busy}` on the buttons) adds **zero** copy. If we ship only the
button-loading layer, no new key is needed for P2 at all. Ship `task.checking` only if the optional
`showProgress` layer is implemented.

## Reduced motion
Handled entirely inside `Working` (verified: static first message + no sweep under
`prefers-reduced-motion: reduce`). The `Button` `loading` indicator is a small spinner already used
across play-web; no new motion is introduced by P2.

## Test strategy
Presentation-only — play-web has **no component test runner**, so this is verified via the UI/preview
lane, plus:
- `scripts/test-play-web-i18n-dictionary.ts` + `npm run i18n:check:strict` cover the new HE/EN keys
  (parity, real-language, no em-dash, routed through `t.*`).
- `scripts/lib/playA11yScan.ts` (`npm test`) already guards against physical-direction Tailwind and
  nameless icon buttons in the touched `.tsx`.
- **No new pure helper is introduced** — the change is exclusively reuse of the existing `Working`
  component and `Button` `loading` prop, so no new `scripts/test-*.ts` is warranted. (If, contrary to
  plan, any pure decision helper is added during implementation, it MUST get an auto-discovered
  `scripts/test-*.ts` per the config's TDD rule.)
- Manual check: throttle the network, tap Join → the first screen shows rotating branded lines +
  advancing bar; on a task, tap a quick-submit → the button shows a loading indicator during the
  round-trip.
