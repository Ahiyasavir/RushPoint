// ─── Mode-aware registration helpers (change: solo-mode-registration) ─────────
//
// In solo/individual play the "team" and the "player" are the same entity, so the
// join form must collect ONE name, not both a team name and a player name. These
// pure helpers resolve the right fields + display name so the logic is unit-tested
// without rendering. Team mode is returned unchanged.

import type { GameMode, RegistrationField } from './types';

/** The canonical name fields: the member-level player name and the team name. */
export function isNameField(f: RegistrationField): boolean {
  return f.id === 'name' || f.id === 'teamName';
}

/**
 * Resolve which registration fields to show for a given mode.
 *  - team        → fields unchanged.
 *  - individual  → drop team-level name fields and collapse to exactly ONE name
 *                  field (a member-level 'name'); non-name custom fields are kept.
 *                  If the only name field present is a team name (e.g. a solo game
 *                  configured with a team-level "your name"), it is normalized into
 *                  the single member-level name field so the form never shows zero
 *                  name inputs.
 */
export function resolveRegistrationFields(
  mode: GameMode,
  fields: RegistrationField[],
): RegistrationField[] {
  if (mode === 'team') return fields;

  const nameFields = fields.filter(isNameField);
  const nonName = fields.filter((f) => !isNameField(f));

  // Prefer an existing member-level name field; otherwise normalize the first
  // name field (e.g. a team-level name) into a member-level 'name'.
  const preferred =
    nameFields.find((f) => f.level === 'member' && f.id === 'name') ?? nameFields[0];

  if (!preferred) return nonName; // no name field at all (unusual) — leave as-is

  const single: RegistrationField = {
    ...preferred,
    id: 'name',
    level: 'member',
  };

  return [single, ...nonName];
}

/**
 * Validate required registration fields client-side (change: prelaunch-critical-fixes,
 * M5). Returns the set of field ids that are required but empty, so JoinScreen can
 * highlight exactly which fields to fill before calling joinRun. A required checkbox
 * must be the literal string 'true'; other fields must be non-blank.
 */
export function validateRequiredFields(
  fields: RegistrationField[],
  values: Record<string, string>,
): Set<string> {
  const errors = new Set<string>();
  for (const f of fields) {
    if (!f.required) continue;
    const v = values[f.id] ?? '';
    if (f.type === 'checkbox') {
      if (v !== 'true') errors.add(f.id);
    } else if (!v.trim()) {
      errors.add(f.id);
    }
  }
  return errors;
}

/** Resolve the display name to submit to joinRun, given the mode. */
export function resolveDisplayName(
  mode: GameMode,
  values: Record<string, string>,
  memberNames: string[],
): string {
  const firstMember = memberNames.map((m) => (m ?? '').trim()).find(Boolean);
  if (mode === 'individual') {
    return firstMember || (values.name ?? '').trim() || 'Player';
  }
  return (values.teamName ?? '').trim() || firstMember || 'Team';
}
