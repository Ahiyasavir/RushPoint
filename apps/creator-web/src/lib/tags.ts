// Builder tags input parser (changes: tags-input-separators → game-task-tags).
//
// The tags field is comma-separated, but the input must let the creator type a
// space and a comma freely (so "chutz, park, night" can actually be entered).
// The visible input therefore keeps the RAW string the user typed; Game.tags /
// Task.tags are derived from it via this helper.
//
// The rules themselves now live in @rushpoint/shared (`normalizeTags`) so the
// SERVER applies exactly the same ones — a parser only creator-web could reach is
// precisely why `updateGame` had no tag guard at all. This wrapper is kept so
// BuilderPage's import and scripts/test-tags-input.ts stay unchanged.
import { normalizeTags } from '@rushpoint/shared';

export { MAX_TAGS, MAX_TAG_LEN } from '@rushpoint/shared';

export function parseTagsInput(raw: string): string[] {
  return normalizeTags(raw);
}
