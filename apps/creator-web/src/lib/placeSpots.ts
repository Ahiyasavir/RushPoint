// Places asked once, named, and pinned for the creator (change: place-setup-named-spots).
//
// Ahiya, 3.11, on a composed two-place game: every mission opened with the same "לכו לפארק.", even
// when the whole stage was in the park; every pinned mission had its own map screen; and the line could
// only say "the park", never which one. So:
//   • the line belongs to the STAGE, said once where the place changes, in four rotating forms;
//   • the walk asks once per place ("Where is the park?"), any number of spots, each with a name;
//   • a stage takes one spot of its kind, and its missions are pinned around it.
// A stage with two sets (a big game, see placeTrack) cannot name one place, so there each mission keeps
// its own line, rotating too. Pure and total; the composer and the walk both go through here, so what
// a game says at compose time and after setup cannot disagree.

import type { Game, PlaceSpot, Stage, Task, TemplateWizardStep } from '@rushpoint/shared';

export interface PlaceForms { to: string; bare: string }
export interface PlaceWords {
  lang: 'he' | 'en';
  forms: Record<string, PlaceForms>;
  /** The line forms, given "to <place>" and "<place>"; index 0 is the first line a game says. */
  phrases: readonly ((p: { to: string; bare: string }) => string)[];
}

const HEBREW_LETTER = /^[א-ת]/;

/** "to <place>": a kind as the language writes it, or a spot name with its prefix. */
export function placeTo(words: PlaceWords, kind: string, name?: string): string {
  const n = (name ?? '').trim();
  if (n === '') return words.forms[kind]?.to ?? '';
  if (words.lang === 'en') return `to ${n}`;
  if (!HEBREW_LETTER.test(n)) return `אל ${n}`;
  // Hebrew writes ל + ה as ל: "לסניף", never "להסניף".
  return `ל${n.length > 1 && n.startsWith('ה') ? n.slice(1) : n}`;
}

function placeBare(words: PlaceWords, kind: string, name?: string): string {
  const n = (name ?? '').trim();
  return n !== '' ? n : words.forms[kind]?.bare ?? '';
}

/** One go-to line. '' when the kind is unknown to these words. */
export function goLine(words: PlaceWords, kind: string, name: string | undefined, variant: number): string {
  const to = placeTo(words, kind, name);
  if (to === '' || words.phrases.length === 0) return '';
  const phrase = words.phrases[((variant % words.phrases.length) + words.phrases.length) % words.phrases.length];
  return phrase({ to, bare: placeBare(words, kind, name) });
}

/** Every line this module could have written for these kinds and names, in every language given. */
function knownLines(wordsList: readonly PlaceWords[], kinds: Iterable<string>, names: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const words of wordsList) {
    for (const kind of kinds) {
      for (const name of ['', ...names]) {
        for (let v = 0; v < words.phrases.length; v++) {
          const line = goLine(words, kind, name, v);
          if (line) out.add(line);
        }
      }
    }
  }
  return out;
}

function isPlaceWords(w: unknown): w is PlaceWords {
  const v = w as Partial<PlaceWords> | null;
  return !!v && typeof v === 'object' && !!v.forms && typeof v.forms === 'object' && Array.isArray(v.phrases) && v.phrases.length > 0;
}

/** The kind of every place in this game's words, plus anything the tasks carry. */
function allKinds(game: Game, wordsList: readonly PlaceWords[]): Set<string> {
  const kinds = new Set<string>();
  for (const w of wordsList) for (const k of Object.keys(w.forms)) kinds.add(k);
  for (const s of game.stages ?? []) for (const t of s.tasks ?? []) if (t?.placeTrack) kinds.add(t.placeTrack);
  return kinds;
}

function stripLine(text: string, known: Set<string>): string {
  for (const line of known) {
    if (text === line) return '';
    if (text.startsWith(`${line} `)) return text.slice(line.length + 1);
  }
  return text;
}

const sortedStages = (game: Game): Stage[] =>
  (game.stages ?? []).filter(Boolean).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/** The kinds a stage is played in, in task order. */
function stageKinds(stage: Stage): string[] {
  const kinds: string[] = [];
  for (const t of stage.tasks ?? []) if (t?.placeTrack && !kinds.includes(t.placeTrack)) kinds.push(t.placeTrack);
  return kinds;
}

/**
 * Which spot each (stage, kind) occurrence takes: the k-th occurrence of a kind, in game order, takes
 * that kind's spot k mod n. Undefined when the kind has no spot.
 */
function spotPlan(stages: readonly Stage[], spots: readonly PlaceSpot[]): Map<string, PlaceSpot> {
  const plan = new Map<string, PlaceSpot>();
  const seen = new Map<string, number>();
  for (const st of stages) {
    for (const kind of stageKinds(st)) {
      const of = spots.filter((s) => s.kind === kind);
      const k = seen.get(kind) ?? 0;
      seen.set(kind, k + 1);
      if (of.length > 0) plan.set(`${st.id}|${kind}`, of[k % of.length]);
    }
  }
  return plan;
}

/**
 * Rewrites every go-to line the game owns. A one-place stage opens with the line only where its place
 * (kind, or spot when spots exist) differs from the stage before, and only when the game has more than
 * one place at all. A two-set stage puts a line on each mission instead. A creator's own stage opening
 * is never touched: an opening is ours only when it is empty or is exactly a line we generate.
 */
export function applyPlaceLines(
  game: Game,
  wordsList: readonly PlaceWords[],
  spots: readonly PlaceSpot[],
  /** Names the game used before, so a renamed spot's old line is still recognised as ours. */
  formerNames: readonly string[] = [],
): Game {
  // Total: a copy that hands back anything but real words leaves the text alone, never throws.
  wordsList = (Array.isArray(wordsList) ? wordsList : []).filter(isPlaceWords);
  const words = wordsList[0];
  if (!words) return game;
  const stages = sortedStages(game);
  const plan = spotPlan(stages, spots);
  const names = [...spots.map((s) => s.name), ...formerNames, ...(game.placeSpots ?? []).map((s) => s.name)].filter((n) => typeof n === 'string' && n.trim() !== '');
  const known = knownLines(wordsList, allKinds(game, wordsList), names);
  const keyOf = (st: Stage, kind: string) => {
    const spot = plan.get(`${st.id}|${kind}`);
    return spot ? `${kind}#${spot.id}` : kind;
  };
  const places = new Set<string>();
  for (const st of stages) for (const kind of stageKinds(st)) places.add(keyOf(st, kind));
  const many = places.size > 1;

  let lineNo = 0;
  let prev: string | null = null;
  const nextStages = new Map<string, Stage>();
  for (const st of stages) {
    const kinds = stageKinds(st);
    const intro = st.narrative?.intro;
    const body = (intro?.body ?? '').trim();
    const introOurs = !intro || (!intro.title && !intro.imageUrl && !intro.bodyHe && (body === '' || known.has(body)));
    const tasks = (st.tasks ?? []).map((t) => {
      const plain = stripLine(String(t?.description ?? ''), known);
      return plain === (t?.description ?? '') ? t : { ...t, description: plain };
    });
    let introBody = '';
    if (kinds.length === 1) {
      const key = keyOf(st, kinds[0]);
      if (many && key !== prev) introBody = goLine(words, kinds[0], plan.get(`${st.id}|${kinds[0]}`)?.name, lineNo++);
      prev = key;
    } else if (kinds.length > 1) {
      // Each set rotates on its own: a team reads one set.
      const perKind = new Map<string, number>();
      for (let i = 0; i < tasks.length; i++) {
        const kind = tasks[i]?.placeTrack;
        if (!kind) continue;
        const v = perKind.get(kind) ?? 0;
        perKind.set(kind, v + 1);
        const line = goLine(words, kind, plan.get(`${st.id}|${kind}`)?.name, v);
        if (line) tasks[i] = { ...tasks[i], description: `${line} ${tasks[i].description ?? ''}`.trim() };
      }
      prev = 'tracks';
    } else {
      prev = null;
    }
    let narrative = st.narrative;
    if (introOurs) {
      const rest = { ...(st.narrative ?? {}) };
      delete rest.intro;
      narrative = introBody !== '' ? { ...rest, intro: { body: introBody } } : (rest.outro ? rest : undefined);
    }
    const next: Stage = { ...st, tasks };
    if (narrative) next.narrative = narrative; else delete next.narrative;
    nextStages.set(st.id, next);
  }
  return { ...game, stages: (game.stages ?? []).map((s) => nextStages.get(s?.id) ?? s) };
}

/**
 * A coordinates step the places screen owns: the map screen of any mission played at a place. Once the
 * creator has said where the park is, its missions go there without asking again (Ahiya, 3.11: "if I
 * already entered where the park is, skip these, the goal is to take tasks off the person"). The one
 * exception is a mission that also asks for a picture of its spot: the pin must be where that picture
 * was taken, which only the creator knows.
 */
export function ownsCoordinateStep(
  step: TemplateWizardStep,
  task: Task | null | undefined,
  allSteps: readonly TemplateWizardStep[] = [],
): boolean {
  if (step.targetFieldPath !== 'coordinates' || !task?.placeTrack) return false;
  if (step.id.endsWith('-placed-coordinates')) return true;
  return !allSteps.some((s) => s.taskId === step.taskId && s.targetFieldPath === 'media');
}

function taskById(game: Game, taskId: string): Task | null {
  for (const s of game.stages ?? []) for (const t of s.tasks ?? []) if (t?.id === taskId) return t;
  return null;
}

/** The kinds whose missions the walk pins itself, in the order the game reaches them. */
export function pinnedKinds(game: Game, steps: readonly TemplateWizardStep[] | null | undefined): string[] {
  const owned = new Set((steps ?? []).filter((s) => ownsCoordinateStep(s, taskById(game, s.taskId), steps ?? [])).map((s) => s.taskId));
  const out: string[] = [];
  for (const st of sortedStages(game)) {
    for (const t of st.tasks ?? []) {
      if (owned.has(t.id) && t.placeTrack && !out.includes(t.placeTrack)) out.push(t.placeTrack);
    }
  }
  return out;
}

/**
 * The kinds the walk asks about, in the order the game reaches them: every kind it pins, and, when the
 * game moves between places, every place a stage sends the teams to, even one with nothing to pin
 * (Ahiya, 3.11: a game that says "go to the branch" never asked which branch). Home is never asked
 * for unless something is pinned there: nobody needs to be told where their own home is.
 */
export function placedKinds(game: Game, steps: readonly TemplateWizardStep[] | null | undefined): string[] {
  const pinned = new Set(pinnedKinds(game, steps));
  const stages = sortedStages(game);
  const all: string[] = [];
  for (const st of stages) for (const k of stageKinds(st)) if (!all.includes(k)) all.push(k);
  const moves = all.length > 1;
  return all.filter((k) => pinned.has(k) || (moves && k !== 'home'));
}

/** A spot the creator has really put on the map. */
export function spotPlaced(s: PlaceSpot): boolean {
  return Number.isFinite(s.lat) && Number.isFinite(s.lng) && !(s.lat === 0 && s.lng === 0);
}

/** The kinds whose missions the walk has already pinned (a placed spot exists). */
export function coveredKinds(game: Game): Set<string> {
  return new Set((game.placeSpots ?? []).filter(spotPlaced).map((s) => s.kind));
}

const RING_M = 12;
/** The i-th of n missions at one spot: on the spot when alone, else on a 12 m ring around it. */
export function ringPoint(center: { lat: number; lng: number }, i: number, n: number): { lat: number; lng: number } {
  if (n <= 1) return { lat: center.lat, lng: center.lng };
  const a = (2 * Math.PI * i) / n;
  const dLat = (RING_M * Math.cos(a)) / 111320;
  const dLng = (RING_M * Math.sin(a)) / (111320 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)));
  return { lat: center.lat + dLat, lng: center.lng + dLng };
}

/**
 * The game with these spots: stored on it, every mission the walk owns pinned at its stage's spot,
 * and every line rewritten with the names. Missions the walk does not own keep their pins.
 */
export function applySpots(
  game: Game,
  steps: readonly TemplateWizardStep[] | null | undefined,
  spots: readonly PlaceSpot[],
  wordsList: readonly PlaceWords[],
): Game {
  const placed = spots.filter(spotPlaced);
  const owned = new Set((steps ?? []).filter((s) => ownsCoordinateStep(s, taskById(game, s.taskId), steps ?? [])).map((s) => s.taskId));
  const stages = sortedStages(game);
  const plan = spotPlan(stages, placed);
  const pinned = new Map<string, Stage>();
  for (const st of stages) {
    const tasks = [...(st.tasks ?? [])];
    for (const kind of stageKinds(st)) {
      const spot = plan.get(`${st.id}|${kind}`);
      if (!spot) continue;
      const idx = tasks.map((t, i) => (owned.has(t.id) && t.placeTrack === kind ? i : -1)).filter((i) => i >= 0);
      idx.forEach((ti, k) => { tasks[ti] = { ...tasks[ti], coordinates: ringPoint(spot, k, idx.length) }; });
    }
    pinned.set(st.id, { ...st, tasks });
  }
  const withPins: Game = { ...game, placeSpots: spots.map((s) => ({ ...s })), stages: (game.stages ?? []).map((s) => pinned.get(s?.id) ?? s) };
  return applyPlaceLines(withPins, wordsList, placed, (game.placeSpots ?? []).map((s) => s.name));
}
