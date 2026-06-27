# Proposal — Global UI standard: remove dashes/hyphens from user-facing copy

## Why

User-facing copy across both apps uses em-dashes (`—`) and spaced hyphens (` - `) as sentence
separators (e.g. landing/wallet i18n strings, `"Demo mode — sign up to save"`, seed descriptions).
The product wants a clean, consistent typographic standard: no decorative dashes or hyphens in any
UI text or menu. This is both a one-time copy sweep and a permanent standard so the regression
doesn't creep back in.

## What Changes

> Observable behavior. Visible copy no longer contains `—` or ` - ` separators; sentences use
> commas, periods, or line breaks instead. Wording is otherwise unchanged.

- A documented UI text standard in `INSTRUCTIONS.md`: no `—`/`–`/` - ` separators in user-facing
  strings.
- A sweep of both apps' translation maps and visible JSX text literals to rewrite dash separators.
- A pure-logic test that scans the translation maps and fails on any dash separator, locking the
  standard in as a permanent copy lint.

## Capabilities

### New Capabilities
- `ui-text-no-dashes`: a documented + test-enforced standard that user-facing strings contain no
  em-dash/en-dash or spaced-hyphen separators.

## Surfaces touched

- **creator-web:** `src/i18n.ts` (HE + EN copy).
- **play-web:** `src/i18n.ts` (created by the `play-web-i18n-hebrew` change).
- **docs:** `INSTRUCTIONS.md` (the standard).
- **Tests:** `scripts/test-no-dashes.ts` (pure: scan both apps' maps).
- **No callable change**, no data-model change.

## Non-goals

- No change to code comments, file paths, CLI flags, CSS, or class names (hyphens there are valid).
- No change to user-authored content stored in Firestore (only app-shipped copy).
- No automated codemod of arbitrary JSX (the test guards the translation maps; JSX literals are
  swept manually and should migrate into i18n over time).
