// Survey tasks (change: survey-tasks) — pure validation shared by the
// submitTaskAnswer grader (server) and Builder/Wizard authoring. A survey has NO
// right answer; validateSurveyResponse only enforces SHAPE. Dependency-free,
// mirrors ordering.ts / gating.ts siblings.

export const SURVEY_RESPONSE_MAX_LEN = 500;
export const SURVEY_CHOICES_MIN = 2;
export const SURVEY_CHOICES_MAX = 8;

/**
 * Validate a submitted survey response. Returns the canonical (trimmed) response
 * string, or null when invalid. Rejects empty / whitespace-only / non-string /
 * over-500-chars (measured AFTER trim). When `choices` is a non-empty array the
 * trimmed response must EXACTLY equal one of the choices (keeps the per-choice
 * aggregation clean — the UI only ever sends button values; a hand-crafted
 * payload gets a loud invalid-argument, not a bucket of garbage). Free-text
 * (absent / empty choices): any non-empty trimmed string ≤ 500 chars.
 */
export function validateSurveyResponse(
  response: unknown,
  choices?: string[],
): string | null {
  if (typeof response !== 'string') return null;
  const trimmed = response.trim();
  if (trimmed.length === 0 || trimmed.length > SURVEY_RESPONSE_MAX_LEN) return null;
  if (Array.isArray(choices) && choices.length > 0) {
    return choices.includes(trimmed) ? trimmed : null;
  }
  return trimmed;
}

/**
 * Validate authored surveyChoices. Returns an error string, or null when valid.
 * Absent / non-array ⇒ null (a free-text survey). Errors: too few / too many
 * choices, or a non-string / empty choice.
 */
export function validateSurveyChoices(choices: unknown): string | null {
  if (!Array.isArray(choices)) return null;
  if (choices.length < SURVEY_CHOICES_MIN) {
    return `A choice survey needs at least ${SURVEY_CHOICES_MIN} options`;
  }
  if (choices.length > SURVEY_CHOICES_MAX) {
    return `A choice survey allows at most ${SURVEY_CHOICES_MAX} options`;
  }
  for (const choice of choices) {
    if (typeof choice !== 'string' || choice.trim() === '') {
      return 'Every survey option needs text';
    }
  }
  return null;
}
