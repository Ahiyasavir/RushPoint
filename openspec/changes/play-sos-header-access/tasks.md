# Tasks — play-sos-header-access

UI lane (play-web has no component test runner). One component + one i18n key per language.

## Implement

- [ ] 1. **i18n key** — add `sosAria` to `play` in both dictionaries of
      `apps/play-web/src/i18n.ts` (HE `'שליחת קריאת מצוקה למארגנים'`, EN
      `'Send an SOS alert to the organizers'`). No em-dash. (design.md §RTL/i18n)

- [ ] 2. **Header prop** — add optional `onSos?: () => void` and `sosBusy?: boolean` to the
      `Header` component in `apps/play-web/src/screens/PlayScreen.tsx`. (design.md §The fix step 1)

- [ ] 3. **Header SOS control** — render a compact danger button (visible literal `SOS`,
      `aria-label={t.play.sosAria}`, `type="button"`, `min-h-[44px] min-w-[44px]`, logical spacing,
      `disabled={sosBusy}`) inline-before the existing leave button, only when `onSos` is provided.
      (design.md §The fix step 2)

- [ ] 4. **Wire the active-race call site** — pass `onSos={() => void sosAction.run()}` and
      `sosBusy={sosAction.busy}` to the active-race `<Header ... />`. Leave the pre-start call site
      without those props. Do NOT remove the existing bottom SOS button. (design.md §The fix steps 1 & 3)

## Verify (build lane — this agent)

- [ ] 5. `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      i18n:check:strict) — green. Especially i18n:check:strict (parity + zero new PART B) and
      bundle:budget (no eager heavy import).
- [ ] 6. `npx openspec validate play-sos-header-access --strict` — passes.

## Manual (parent / owner — UNVERIFIED here)

- [ ] 7. On a phone-width active race, SOS is reachable in the header without scrolling; tapping it
      opens the same confirm → `triggerSOS` → "SOS sent" path as the bottom button, and a double tap
      across the two entry points still fires once.
