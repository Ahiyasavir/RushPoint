// Narrative chapters (change: narrative-chapters) — pure helpers for story beats.
import type { StoryBeat } from './types';

/** The body text for a beat in the given language (Hebrew falls back to `body`). */
export function localizedBeatBody(beat: StoryBeat | undefined, lang: 'he' | 'en'): string {
  if (!beat) return '';
  if (lang === 'he') return (beat.bodyHe ?? beat.body ?? '').trim();
  return (beat.body ?? '').trim();
}

/** True when a beat carries anything worth rendering (title, body, or image). */
export function beatHasContent(beat: StoryBeat | undefined): boolean {
  if (!beat) return false;
  return Boolean((beat.title ?? '').trim() || (beat.body ?? '').trim() ||
    (beat.bodyHe ?? '').trim() || (beat.imageUrl ?? '').trim());
}

/**
 * Which beat to show for a stage given the team's record status. Intro shows while
 * the stage is active; outro shows once it's completed. Returns null when there's
 * nothing to show. Pure — the play UI decides dismissal locally.
 */
export function resolveStageNarrative(
  stage: { narrative?: { intro?: StoryBeat; outro?: StoryBeat } } | undefined,
  stageStatus: 'locked' | 'active' | 'completed' | 'skipped' | undefined,
): { kind: 'intro' | 'outro'; beat: StoryBeat } | null {
  const n = stage?.narrative;
  if (!n) return null;
  if (stageStatus === 'active' && beatHasContent(n.intro)) return { kind: 'intro', beat: n.intro! };
  if (stageStatus === 'completed' && beatHasContent(n.outro)) return { kind: 'outro', beat: n.outro! };
  return null;
}
