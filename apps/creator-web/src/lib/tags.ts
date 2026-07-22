// Pure parser for the Builder's game-tags input (change: tags-input-separators).
//
// The tags field is comma-separated, but the input must let the creator type a
// space and a comma freely (so "chutz, park, night" can actually be entered).
// The visible input therefore keeps the RAW string the user typed; Game.tags is
// derived from it via this helper: split on comma, trim each, drop empties and
// duplicates. DOM-free so it can be unit-tested in the pure-logic lane.

const MAX_TAGS = 20;
const MAX_TAG_LEN = 40;

export function parseTagsInput(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const tag = part.trim().slice(0, MAX_TAG_LEN);
    if (!tag) continue;
    if (out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
