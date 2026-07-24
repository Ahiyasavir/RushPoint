## Context

This is a **copy-only** change to two dictionary values. play-web has no component test runner, so
it is a UI lane verified by build + i18n. There is no logic and no extractable decision.

## Current state (re-confirmed against the moving tree)

`apps/play-web/src/components/TaskRunner.tsx` selects the eyebrow (anchor on content — TaskRunner is
being edited concurrently, so lines drift):

```
const requiredHere  = stage.requiredTaskCount ?? stage.tasks.length;
const completedHere = stage.tasks.filter((t) => t.status === 'completed').length;
const headerLabel = stage.tasks.length > 1
  ? (requiredHere < stage.tasks.length ? t.task.stopOf({ done: completedHere + 1, total: requiredHere }) : t.task.routedTask)
  : t.task.yourTask;
```

So `t.task.routedTask` is shown **only** for a full multi-task stage (more than one task and no
`requiredTaskCount` reduction). The strings today, in `apps/play-web/src/i18n.ts`:

```
// HE
yourTask:   'המשימה שלכם',
routedTask: 'משימה מנוהלת',
stopOf: ({ done, total }) => `עצור ${done} מתוך ${total}`,
// EN
yourTask:   'Your task',
routedTask: 'Routed task',
stopOf: ({ done, total }) => `Stop ${done} of ${total}`,
```

## The fix

Change the two `routedTask` values to match the friendly `yourTask` register:

```
// HE
routedTask: 'המשימה שלכם',
// EN
routedTask: 'Your task',
```

Rationale for reusing `yourTask` wording (rather than adding a "current task" variant): in a
multi-task stage the player is handed one task at a time, so "your task" reads correctly and keeps
the whole card family on one plain register. The `task.routedTask` **key stays** (only its value
changes), so the `TaskRunner` selection above needs no edit.

## RTL / i18n notes

- HE is the default; both strings are already Hebrew/English respectively and stay so (no leak).
- No em-dash, no new key, no hardcoded component string. `i18n:check:strict` PART A parity holds
  (same keys both languages) and no new PART B (nothing added to a component).

## Test strategy

Copy-only **UI lane**. Verified by `npm run i18n:check:strict` (HE stays HE / EN stays EN, key
parity) and `npm run play:build`. No pure module, no wired test.
