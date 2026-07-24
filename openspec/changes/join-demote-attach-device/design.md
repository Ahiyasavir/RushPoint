## Context

play-web has no component test runner (CLAUDE.md), so this is a **UI-lane** presentation change:
reorder/reweight two already-built branches of the team-mode registration step and demote one to a
link. No new callable, no new state, no logic on the submit paths.

## Current state (re-confirmed against the moving tree)

`apps/play-web/src/screens/JoinScreen.tsx` — anchor on content:

- A full-width segmented control renders only in team mode and sets `joinMode`:
  ```
  {!isSolo && (
    <div className="flex rounded-xl bg-app-card border border-glass-border p-1 mb-4 ...">
      {([['create', t.devices.joinModeCreate], ['attach', t.devices.joinModeAttach]] as const).map(([m, label]) => (
        <button ... onClick={() => { setJoinMode(m); setErr(''); }}
          className={`flex-1 rounded-lg min-h-[44px] ... ${joinMode === m ? 'bg-white ...' : 'text-zinc-500'}`}>
          {label}
        </button>
      ))}
    </div>
  )}
  ```
- The step then branches:
  ```
  {!isSolo && joinMode === 'attach' ? (
     /* attach form: attachExplain + team-code Input + member-name Input + attachAction/attachCta */
  ) : (
     /* create form: teamFields, team-name card, member list, submitAction/joinCta */
  )}
  ```
- Existing copy (`apps/play-web/src/i18n.ts`, `devices`):
  ```
  joinModeCreate: 'קבוצה חדשה'                    / 'New team'
  joinModeAttach: 'הקבוצה שלי כבר במשחק'          / 'My team is already in'
  attachExplain / teamCodePlaceholder / memberNamePlaceholder / attaching / attachCta
  ```

## The fix

1. **Delete the segmented control block.** `joinMode` state stays; only the equal-weight toggle UI
   is removed.

2. **Default to create.** `joinMode` initializes to `'create'` (already the default), so the step
   opens on the create form with no forced decision. The branch `joinMode === 'attach' ? … : …`
   stays exactly as-is — create is the else path and now the on-open path.

3. **Demoted attach link under the primary Join button** (inside the create branch, after the
   `submitAction`/`joinCta` Button):
   ```
   <button type="button" onClick={() => { setJoinMode('attach'); setErr(''); }}
     className="mx-auto mt-4 block min-h-[44px] px-2 text-sm font-semibold text-ink-fire underline-offset-2">
     {t.devices.joinModeAttach}
   </button>
   ```
   Reuses the existing `joinModeAttach` sentence ("My team is already in" / "הקבוצה שלי כבר במשחק"),
   so no new copy is required. (If the design prefers a fuller prompt, add ONE new key
   `devices.joinModeAttachPrompt` in both languages; not required.)

4. **Back-to-create link on the attach form** (inside the attach branch, near its Button):
   ```
   <button type="button" onClick={() => { setJoinMode('create'); setErr(''); }}
     className="mx-auto mt-4 block min-h-[44px] px-2 text-sm font-semibold text-ink-fire underline-offset-2">
     {t.devices.joinModeCreate}
   </button>
   ```
   Keeps the attach path fully reversible.

Both links clear `err` on switch, mirroring the removed toggle's `setErr('')`.

## RTL / i18n notes

- HE is default. Layout uses **logical** classes only (`mx-auto`, `mt-4`, `px-2`) — no physical
  direction classes, so RTL and LTR both lay out correctly.
- No hardcoded UI strings: both link labels route through existing `t.devices.*` keys. If a
  dedicated prompt key is added, it must be HE + EN with no em-dash; otherwise no i18n change at all
  (both dictionaries already carry the reused keys, so parity holds).
- Targets are min 44px; links are real `<button type="button">` with visible text (accessible name
  from the text), so no icon-only-button a11y finding.

## Test strategy

Presentation-only **UI lane**; no pure decision is extracted (the branch already exists — only its
weighting/entry changes). Verified by `npm run typecheck` · `npm run play:build` ·
`npm run bundle:budget` · `npm run i18n:check:strict`. Manual: team-mode Join opens on the create
form; the attach link reveals the device-code form and back returns to create; both submit paths
still work.

## Non-regression checklist

- Attach form (explain + code + name inputs + `attachAction`/`attachCta`) renders unchanged when
  reached via the link.
- Create form (team-name card, members, registration fields, `submitAction`/`joinCta`) unchanged.
- Solo mode unchanged (never showed the toggle; shows neither link).
- `joinMode` state + both callables untouched; only the entry UI changed.
