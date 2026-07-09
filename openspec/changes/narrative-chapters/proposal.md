## Why

RushPoint games are a flat list of stages with only a title for framing. The clearest
structural gap versus narrative experiences (Hunt A Killer, story-driven city hunts) is
the absence of *story*: an intro that sets the scene when a chapter opens and an outro
"beat" that pays it off on completion. This turns a checklist of tasks into a story with
chapters — the single highest-leverage way to make a game feel authored, with no new
game-state machine.

## What Changes

- Each **Stage** may carry an optional **`narrative`**: an intro beat (shown as a full
  card when the stage becomes active) and/or an outro beat (shown when the stage
  completes), each with a title, bilingual body, and optional image.
- The play-web renders a **StoryInterstitial** card for the active stage's intro (and, on
  completion, its outro), dismissable; the stage is framed as **"Chapter N: <title>"**.
- The Builder stage editor gains a collapsible **"Story"** section to author intro/outro
  text (EN/HE) + an optional image (reusing the existing media-upload path).
- Narrative beats are **not secret** — the active stage's narrative is echoed by
  `getMyTeamState`; they are never copied into `publicTasks`.

## Capabilities

### New Capabilities
- `narrative-chapters`: optional per-stage intro/outro story beats (`StoryBeat`),
  chapter framing in play, the Builder authoring section, and the play-web interstitial.

## Non-goals

- No branching plot / choose-your-path engine (stages stay linear).
- No per-task narrative (stage-level only, to keep authoring simple).
- No server-persisted "seen" state — interstitial dismissal is client-local (the beat is
  cosmetic; it must never gate progression or block viewer devices).

## Surfaces touched
- **shared types:** `StoryBeat` interface + `Stage.narrative?: { intro?: StoryBeat; outro?: StoryBeat }`.
- **functions:** `getMyTeamState` echoes the active stage's `narrative` (passthrough, not
  secret); no new callable. `narrative.*.imageUrl` validated as a Storage URL server-side.
- **creator-web:** Builder stage editor "Story" section + i18n.
- **play-web:** `StoryInterstitial` component + `PlayScreen` chapter framing + i18n.
- **Tests:** a tiny pure `resolveStageNarrative` helper test (which beat to show) +
  `getMyTeamState` echo assertion in e2e. No index/rules change.
