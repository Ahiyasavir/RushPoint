## Context

play-web has **no component test runner** (CLAUDE.md), so this is a UI-lane change verified by
typecheck / build / bundle-budget / i18n plus a manual reveal check. There is no extractable pure
decision here — the change wires an existing action to a second button and adds one aria string.

## Current state (re-confirmed against the moving tree)

`apps/play-web/src/screens/PlayScreen.tsx` — anchor on content, lines drift:

- **The SOS action** is one shared `useAsyncAction` over the `sos()` function:
  ```
  async function sos() {
    if (!(await dialog.confirm(t.play.sosConfirm, { confirmLabel: t.play.sosSend, danger: true }))) return;
    // resolve best-effort coords, THEN send
    await triggerSOS({ ownerUid, gameId, runId, ...(coords ?? {}) });
    feedback('alert'); await dialog.alert(t.play.sosSent);
    // catch → dialog.alert(t.play.sosFailed)
  }
  const sosAction = useAsyncAction(sos);   // in-flight guard: a panicked double tap fires once
  ```
- **The bottom SOS button** (active-race branch, currently near the end of the returned JSX):
  ```
  <Button variant="danger" className="mt-4" loading={sosAction.busy} onClick={() => void sosAction.run()}>SOS</Button>
  ```
  It renders after LiveOps, the photo feed (`state.game.photoFeedEnabled !== false`), chat, and the
  trackables/zones/devices panels — i.e. below the fold on a real phone.
- **The sticky `Header`** (`function Header({ game, score, accent, onLeave, powerUpArmed, timeOnly, startedAt })`)
  renders the game name + live score/clock and a single "leave" button:
  ```
  <button onClick={onLeave} aria-label={t.play.leaveAria}
    className="inline-flex items-center min-h-[44px] px-3 py-2 -me-3 rounded-lg text-xs text-zinc-500">{t.play.leave}</button>
  ```
  `Header` is rendered in both the pre-start branch and the active-race branch (same props today).

## The fix

1. **Pass the SOS action into `Header`.** Add an optional `onSos?: () => void` prop (and, for the
   spinner, `sosBusy?: boolean`) to `Header`. The **active-race** call site passes
   `onSos={() => void sosAction.run()}` and `sosBusy={sosAction.busy}`. The **pre-start** call site
   omits them — that screen is short and already shows SOS above the fold, so the header stays
   unchanged there (no behaviour change to pre-start).

2. **Render a compact header SOS control** only when `onSos` is provided, placed **before** the
   "leave" button inside the header's trailing control group so the two sit together at the inline
   end:
   ```
   {onSos && (
     <button type="button" onClick={onSos} aria-label={t.play.sosAria} disabled={sosBusy}
       className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 rounded-lg
                  text-xs font-bold text-ink-alert border border-ink-alert/40 disabled:opacity-50">
       SOS
     </button>
   )}
   ```
   The visible text is the brand-neutral literal `SOS` (already used un-translated at both existing
   buttons, so no new visible-copy key and no PART B regression); the accessible name comes from
   `t.play.sosAria`.

3. **Keep the bottom button.** Nothing is removed — the header control is a strictly additional
   entry point onto the same `sosAction`. Because both drive one `useAsyncAction`, `sosAction.busy`
   disables/loads both at once and the existing double-tap guard covers taps across the two.

## RTL / i18n notes

- HE is the default language. Spacing uses **logical** classes only (`px-3`, `min-w-[44px]`,
  gap on the parent control group) — no physical `ml-`/`mr-`/`left`/`right`, so the header lays out
  correctly RTL and LTR. The leave button already uses `-me-3`; the SOS control sits inline-before it.
- One new key per dictionary in `apps/play-web/src/i18n.ts` (`play.sosAria`):
  - HE: `sosAria: 'שליחת קריאת מצוקה למארגנים'`
  - EN: `sosAria: 'Send an SOS alert to the organizers'`
  No em-dash in copy. No hardcoded UI string bypasses `t.*` (the `SOS` literal is the same
  intentional brand token already present un-translated; it does not switch language).
- Accessibility: 44px min target (height and width), a real `aria-label`, `type="button"`,
  `disabled` while busy.

## Test strategy

Presentation/wiring only — **UI lane**. No pure module is extracted (design rationale above):
the change adds a prop-driven button and one string. Verified by the build lane:
`npm run typecheck` · `npm run play:build` · `npm run bundle:budget` (no new/eager heavy import) ·
`npm run i18n:check:strict` (dictionary parity + zero new PART B). Manual: on a phone-width active
race, SOS is visible in the header without scrolling and, tapped, opens the same confirm →
`triggerSOS` → "sent" path as the bottom button.

## Non-regression checklist

- Bottom SOS button unchanged (still renders, still `sosAction`).
- `sos()` / `triggerSOS` / confirm dialog / location resolve / success+failure alerts unchanged.
- Pre-start `Header` unchanged (no `onSos` passed there).
- Header still shows game name, score/elapsed clock, power-up chip, and leave.
- No new heavy import; `t.play.sosAria` is the only new key.
