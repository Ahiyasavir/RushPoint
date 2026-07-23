// Human readable console labels (change: run-console-progressive-disclosure).
//
// The console showed raw machine identifiers to humans: an alert row printed a
// truncated Firestore document id as "team 8f2c1a09", and the photo review queue
// printed the raw taskId where the task's name belongs. A host cannot act on
// either. These resolvers prefer the human name and fall back to a SHORTENED id
// routed through a translated "unknown" format, so a fallback can never be
// mistaken for a name.
//
// Pure: no React, no Firebase, no i18n (the fallback format is passed in).

/** The 8 character truncation the console has always used. */
export function shortId(id: string): string {
  return typeof id === 'string' ? id.slice(0, 8) : '';
}

export type NamedTeam = { id: string; displayName?: string | null };

/** A team's display name, or a marked short id when it cannot be resolved. */
export function resolveTeamLabel(
  teamId: string,
  teams: readonly NamedTeam[],
  fallbackFmt: (shortId: string) => string,
): string {
  const name = teams.find((team) => team.id === teamId)?.displayName;
  if (typeof name === 'string' && name.trim() !== '') return name;
  return fallbackFmt(shortId(teamId));
}

/**
 * A stored enumeration value's human label, or a MARKED fallback.
 *
 * The console kept re-inventing `LABELS[v] ?? v` (the alert type, the analytics
 * task type, the feedback issue), and every one of them printed the raw stored
 * value to a human the moment a new enum member shipped, in whatever language
 * the database happened to be written in (change: run-console-clarity). This
 * NEVER returns the raw input: an unmapped value comes back through the
 * translated fallback, so a fallback can never be mistaken for a name.
 *
 * `Object.prototype` keys ('toString', 'constructor') and blank labels are not
 * names either, so a stored value cannot borrow one.
 */
export function resolveEnumLabel(
  value: unknown,
  labels: Readonly<Record<string, string>>,
  fallbackFmt: (raw: string) => string,
): string {
  const raw = typeof value === 'string' ? value : '';
  const label = raw !== '' && Object.prototype.hasOwnProperty.call(labels ?? {}, raw)
    ? labels[raw]
    : undefined;
  if (typeof label === 'string' && label.trim() !== '') return label;
  return fallbackFmt(raw);
}

/** A task's title, or a marked short id when it cannot be resolved. */
export function resolveTaskLabel(
  taskId: string,
  titlesById: ReadonlyMap<string, string>,
  fallbackFmt: (shortId: string) => string,
): string {
  const title = titlesById.get(taskId);
  if (typeof title === 'string' && title.trim() !== '') return title;
  return fallbackFmt(shortId(taskId));
}
