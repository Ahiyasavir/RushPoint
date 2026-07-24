## Context

creator-web has ESLint but no component test runner; this is a **UI lane** restyle of the wizard
footer. The controlling condition already exists in the component (`step < lastStep`), so no new pure
decision is introduced — the change is which `Button` variant each control carries in each branch.

## Current state (re-confirmed)

`apps/creator-web/src/components/TaskWizard.tsx`, footer:

```
<div className="ms-auto flex items-center gap-2">
  {step < lastStep && (
    <Button variant="ghost" disabled={!canGoNext(stepKey, task)} onClick={() => setStep((s) => (s + 1) as WizardStep)}>{b.next} →</Button>
  )}
  <Button onClick={finish}>{b.done}</Button>
</div>
```

- On non-final steps (`step < lastStep`): "Next →" is `variant="ghost"` (secondary) and "Done" is the
  default primary — so the primary weight is on Done even though the step-appropriate action is Next.
- On the final step: only "Done" (default primary) renders. That is already correct.

`b.next` / `b.done` exist in both dictionaries (`builder.next` / `builder.done`). `Button`'s default
(no `variant`) is the weighted primary; `variant="ghost"` is the secondary style.

## The fix

Swap the variants by step, keeping both controls and their handlers:

- **Non-final step (`step < lastStep`):** render "Next →" as the **primary** (default variant, keep
  `disabled={!canGoNext(stepKey, task)}`), and render "Done" as **`variant="ghost"`** (secondary).
- **Final step:** "Next →" is not rendered (unchanged); "Done" is the **primary** (default variant).

Concretely, "Done" takes `variant={step < lastStep ? 'ghost' : undefined}` (or the equivalent
conditional), and "Next →" drops `variant="ghost"` so it becomes primary. Everything else in the
footer row — the `ms-auto` wrapper, Back, the Delete-task link, gap/spacing — is untouched.

"Done" remains present and **never disabled** in either branch, preserving the "finish a valid task
from any step" guarantee; only its visual weight changes on non-final steps.

## RTL / i18n notes

- HE is default; the footer already uses logical layout (`ms-auto`, `gap-2`). No physical-direction
  class is added. The `→` glyph is decorative (kept as today) and follows the existing label; it is
  not new copy.
- **No i18n change.** `builder.next` / `builder.done` reused; no new key, no hardcoded string, no
  em-dash.
- Run `npm run i18n:check:strict` — no dictionary change, so PART A parity and PART B are unchanged.

## Test strategy

Presentational **UI lane** — no extractable pure decision is added (the `step < lastStep` boolean
already exists and is unchanged; wrapping it in a helper would add indirection without new logic to
test, so it is intentionally left inline). Verify via `npm run typecheck` · `npm run lint` ·
`npm run creator:build` · `npm run i18n:check:strict`. Manual: on steps 1-2 "Next →" is the primary
and "Done" is the ghost/secondary; on the last step "Done" is the primary; "Done" is clickable on
every step (reveals blockers / closes) exactly as before.

## Non-regression checklist

- "Done" reachable and never disabled on every step; `finish` handler unchanged.
- "Next →" keeps `canGoNext` enablement and advance behaviour.
- Back / Delete task / step chips / step bodies unchanged.
- No i18n key added; parity + PART B unchanged.
