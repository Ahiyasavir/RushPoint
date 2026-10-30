// The full-screen setup flow, as data (change: setup-flow-full-screen).
//
// Ahiya, 22.10, on the Quick Setup card a composed game opened with: the title was a generic line
// chosen by FIELD TYPE, the mission's own instruction sat behind "פרטים" (Hebrew and English glued
// into one paragraph), and the text players will read was behind the same fold, so a creator placed
// a pin without knowing what happens there. "You can't hide something important because it is long."
//
// So the flow walks MISSIONS, not fields, and nothing a creator needs is folded:
//   • one screen per mission, in route order, game-level steps first;
//   • each screen carries the mission as players will see it, in full;
//   • each step becomes an item: PREP (something to do in the world before the game, e.g. build a
//     stone tower at the spot) or FILL (a field to fill here), with its own instruction as its words;
//   • the before-the-game list gathers every PREP item, so it is said at the step AND at the end.
//
// The component (components/SetupFlow.tsx) only draws this. Pure, total, no React:
// scripts/test-setup-flow.ts, which also pins the prep/fill verdict for every setup prompt in the bank.

import {
  isWizardStepConfigured, resolveWizardTarget, readWizardFieldValue,
  type Game, type Task, type TemplateWizardStep,
} from '@rushpoint/shared';
import { isPlacedCoord } from './mapAnchor';
import { quickSetupFocusPlan, type QuickSetupCopyKey, type TaskEditorTab, type TaskOptInGroup } from './quickSetup';

export type SetupLang = 'he' | 'en';

const HEBREW = /[֐-׿]/;
const LATIN = /[A-Za-z]/;

/**
 * Seeded prompts are bilingual by convention ("Hebrew\n\nEnglish"). Keep the paragraphs written in
 * the interface's language. A paragraph with Hebrew letters is Hebrew; one with Latin letters and no
 * Hebrew is English; anything else (numbers, a URL) stays with both. When nothing matches the
 * language asked for, the whole text is returned rather than nothing.
 */
export function pickLanguage(text: unknown, lang: SetupLang): string {
  if (typeof text !== 'string') return '';
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== '');
  if (paras.length === 0) return '';
  const mine = paras.filter((p) => {
    const he = HEBREW.test(p);
    if (lang === 'he') return he || !LATIN.test(p);
    return !he;
  });
  const out = mine.length > 0 ? mine : paras;
  return out.join('\n\n');
}

/**
 * Words that mean "do this in the world, before the game": build, stick up, hide, arrange with
 * someone, go there and count, photograph on site. Declared, not learned: the test runs every setup
 * prompt in the bank through this and pins the verdict, so a new prompt that reads as preparation
 * and is not caught (or the reverse) fails loudly instead of quietly folding into an ordinary field.
 */
export const PREP_MARKERS: readonly string[] = [
  'לפני המשחק', 'מראש', 'בעצמכם', 'בשטח',
  'תבנו', 'תדביקו', 'תחביאו', 'תתאמו', 'תסגרו', 'תכינו', 'הכנתם', 'תשימו בקופסה', 'בגיר',
  'תלפפו', 'תעטפו', 'תנפחו', 'תקשרו', 'תסדרו', 'תבקשו מ', 'תציירו ביד', 'תנו לשחקן',
  'תעמדו בנקודה', 'תצלמו מקרוב', 'תשלמו', 'במקום קבוע',
];

/**
 * Judged on the HEBREW paragraph of a seeded prompt (every bank prompt has one), so whether a step is
 * preparation never depends on the interface language. A prompt with no Hebrew is judged as written.
 */
export function isPrepInstruction(text: unknown): boolean {
  if (typeof text !== 'string' || text.trim() === '') return false;
  const he = pickLanguage(text, 'he');
  return PREP_MARKERS.some((m) => he.includes(m));
}

export interface SetupItem {
  stepId: string;
  /** The step's target field, relative to its mission or game (e.g. `coordinates`). */
  fieldPath: string;
  /** The guided editor anchor that isolates this field (lib/quickSetup's table). */
  anchor: string | null;
  /** Which tab and collapsed group of the mission editor hold the field (null for a game field). */
  wizardStep: TaskEditorTab | null;
  optInGroup: TaskOptInGroup | null;
  /** The flow's own short line for this field, used only when the step has no instruction. */
  copyKey: QuickSetupCopyKey;
  kind: 'prep' | 'fill';
  /** The step's instruction in the interface language, '' when it has none. Never folded. */
  instruction: string;
  required: boolean;
  /** False while the field still needs something from the creator. */
  configured: boolean;
}

export interface SetupScreen {
  key: string;
  scope: 'game' | 'task';
  stageId: string;
  taskId: string;
  /** The mission's (or game's) title as players will see it. */
  title: string;
  /** The text players will read, in full. '' for the game screen. */
  playerText: string;
  taskType: Task['type'] | null;
  items: SetupItem[];
  /** Every REQUIRED item is configured (a PREP item with nothing to fill counts as configured). */
  done: boolean;
}

function taskOf(game: Game, stageId: string, taskId: string): Task | null {
  const stage = (game.stages ?? []).find((s) => s?.id === stageId);
  return (stage?.tasks ?? []).find((t) => t?.id === taskId) ?? null;
}

/**
 * The screens, one per mission, in the order the steps already come in (quickSetupSteps orders
 * them by route), game-level steps gathered onto one screen first. A step that resolves to nothing
 * is dropped (the mission it named is gone); a stage-level step joins the game screen, so it is
 * still asked rather than lost.
 */
export function buildSetupScreens(
  game: Game | null | undefined,
  steps: readonly TemplateWizardStep[] | null | undefined,
  lang: SetupLang,
): SetupScreen[] {
  if (!game || !Array.isArray(steps)) return [];
  const screens: SetupScreen[] = [];
  const byKey = new Map<string, SetupScreen>();
  const gameScreen = (): SetupScreen => {
    let s = byKey.get('game');
    if (!s) {
      s = { key: 'game', scope: 'game', stageId: '', taskId: '', title: String(game.title ?? ''), playerText: '', taskType: null, items: [], done: true };
      byKey.set('game', s);
      screens.unshift(s);
    }
    return s;
  };
  for (const step of steps) {
    const target = resolveWizardTarget(game, step);
    if (!target) continue;
    const plan = quickSetupFocusPlan(target);
    const instruction = pickLanguage(step.instructionPrompt, lang);
    const configured = isWizardStepConfigured(game, step);
    const item: SetupItem = {
      stepId: step.id,
      fieldPath: target.fieldPath,
      anchor: plan.anchor,
      wizardStep: plan.wizardStep,
      optInGroup: plan.optInGroup,
      copyKey: plan.copy,
      kind: isPrepInstruction(step.instructionPrompt) ? 'prep' : 'fill',
      instruction,
      required: step.isRequired === true,
      configured,
    };
    let screen: SetupScreen;
    if (target.scope === 'task') {
      const key = `task:${target.stageId}:${target.taskId}`;
      const existing = byKey.get(key);
      if (existing) screen = existing;
      else {
        const task = taskOf(game, target.stageId, target.taskId);
        screen = {
          key, scope: 'task', stageId: target.stageId, taskId: target.taskId,
          title: String(task?.title ?? ''),
          playerText: pickLanguage(task?.description, lang),
          taskType: task?.type ?? null,
          items: [], done: true,
        };
        byKey.set(key, screen);
        screens.push(screen);
      }
    } else {
      screen = gameScreen();
    }
    screen.items.push(item);
  }
  for (const s of screens) {
    // Within a mission: where it is first (you need the place to think about the rest), then the
    // preparation, then the remaining fields, each group in the order the steps came.
    s.items = [
      ...s.items.filter((i) => i.fieldPath === 'coordinates'),
      ...s.items.filter((i) => i.fieldPath !== 'coordinates' && i.kind === 'prep'),
      ...s.items.filter((i) => i.fieldPath !== 'coordinates' && i.kind !== 'prep'),
    ];
    s.done = s.items.every((i) => !i.required || i.configured);
  }
  return screens;
}

export interface BeforeGameEntry { stepId: string; taskId: string; title: string; text: string }

/**
 * A preparation as it reads on the before-the-game sheet. The same instruction is shown in the walk,
 * beside the box it talks about, so it says "תכתבו כאן את המילה" or "תסמנו כאן את הקיר". On the sheet,
 * which the organizer saves or sends to whoever prepares the field, there is no "here" to type into
 * (found 29.10), so the in-app part is dropped and only the work in the field is kept. Hebrew only:
 * the walk shows the interface language, and the English prompts never say "here" this way.
 */
const IN_APP_SENTENCE = /^\s*ו?(?:(?:תכתבו|תסמנו|תרשמו)\s+(?:כאן|פה)(?=[\s.,]|$)|תחליפו את הסוגריים)/;
const IN_APP_CLAUSE = /,\s*ו(?:תכתבו|תסמנו|תרשמו)\s+(?:כאן|פה)(?=[\s.,]|$)[^.]*/g;
export function prepSheetText(instruction: string): string {
  if (typeof instruction !== 'string') return '';
  const sentences = instruction.replace(IN_APP_CLAUSE, '').split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((x) => !IN_APP_SENTENCE.test(x));
  return (kept.length > 0 ? kept : sentences).join(' ').trim();
}

/**
 * Does a station code need a sign at the mission's point? Only when nothing in its setup says how the
 * code reaches the teams. Every bank code mission has its own way: a contact person or a stall hands
 * it over, a note sits inside what the key opens, chalk marks a hidden spot, or a second place holds
 * it. For those a sign at the point gives the answer away at the start (found 29.10 on "תיבת המת").
 */
const CODE_DELIVERY = /תתאמו|כתבתם|תשימו|פתק|מדבקה|גיר|נותן|במקום השני/;
export function codeNeedsSign(instruction: string): boolean {
  return !CODE_DELIVERY.test(typeof instruction === 'string' ? instruction : '');
}

/** Every preparation the game asks for, in route order, for the finish screen. */
export function beforeGameList(screens: readonly SetupScreen[]): BeforeGameEntry[] {
  const out: BeforeGameEntry[] = [];
  for (const s of screens) {
    for (const i of s.items) {
      if (i.kind !== 'prep' || i.instruction === '') continue;
      const text = prepSheetText(i.instruction);
      if (text === '') continue;
      // One mission, one entry: two preparations of the same mission read as the mission twice.
      const last = out[out.length - 1];
      if (last && last.taskId === s.taskId && s.taskId !== '') last.text = `${last.text} ${text}`;
      else out.push({ stepId: i.stepId, taskId: s.taskId, title: s.title, text });
    }
  }
  return out;
}

/** Where the flow should open: the first screen with a required item still open, else the first. */
export function firstOpenScreen(screens: readonly SetupScreen[]): number {
  const i = screens.findIndex((s) => !s.done);
  return i >= 0 ? i : 0;
}

/** How many required items are still open across the flow (the finish screen's "what is left"). */
export function openRequiredCount(screens: readonly SetupScreen[]): number {
  return screens.reduce((n, s) => n + s.items.filter((i) => i.required && !i.configured).length, 0);
}

/** The value a game-level field holds now, for the game screen's own inputs. */
export function gameFieldValue(game: Game | null | undefined, fieldPath: string): string {
  if (!game) return '';
  const v = readWizardFieldValue(game, { id: '', stageId: '', taskId: '', targetFieldPath: fieldPath, instructionPrompt: '', isRequired: false });
  return typeof v === 'string' ? v : '';
}

/**
 * A copy of the game with one game-level text field set. Nested paths (`instructions.bodyHe`) build
 * the object they live in. Returns the game unchanged for a path it cannot write.
 */
export function withGameField<G extends Game>(game: G, fieldPath: string, value: string): G {
  const parts = fieldPath.split('.').filter((p) => p !== '');
  if (parts.length === 0 || parts.length > 2) return game;
  if (parts.length === 1) return { ...game, [parts[0]]: value };
  const [head, leaf] = parts;
  const inner = (game as Record<string, unknown>)[head];
  const base = inner && typeof inner === 'object' && !Array.isArray(inner) ? inner as Record<string, unknown> : {};
  return { ...game, [head]: { ...base, [leaf]: value } };
}

// ─── The walk itself (Ahiya, 22.10): one small thing per screen ──────────────────────────────────
//
// "Take him step by step through every mission, the whole screen dedicated to it": first the game's
// plan, then each item of each mission on its own screen (the mission's text shown above it, so the
// creator always knows what the teams will do there), then the finish with the route and the prep
// list. A beat is one screen of that walk.

export type SetupBeat =
  | { kind: 'plan' }
  | { kind: 'item'; screen: number; item: number; firstOfMission: boolean }
  | { kind: 'finish' }
  // The prep list on its own screen after the route: Ahiya wants nothing scrolled on a phone, and the
  // route map plus a long list plus the share buttons do not fit one phone screen.
  | { kind: 'prep' };

export function buildSetupBeats(screens: readonly SetupScreen[]): SetupBeat[] {
  const beats: SetupBeat[] = [{ kind: 'plan' }];
  screens.forEach((s, si) => {
    s.items.forEach((_, ii) => beats.push({ kind: 'item', screen: si, item: ii, firstOfMission: ii === 0 }));
  });
  beats.push({ kind: 'finish' }, { kind: 'prep' });
  return beats;
}

/**
 * Where the walk opens. Arriving from the composer it starts at the plan; resumed later (the menu,
 * the launch refusal) it goes straight to the first REQUIRED item still open, or the plan when none.
 * Decided by the caller, never guessed from the game: a fresh composed game already has items that
 * need nothing (a preparation whose text is written), so "something is configured" says nothing about
 * whether the creator has been here before.
 */
/** A game with no placed mission has no route: its finish screen must not show an empty map. */
export function hasRouteToShow(stages: readonly { tasks?: readonly { coordinates?: unknown }[] }[] | undefined): boolean {
  return (stages ?? []).some((st) => (st.tasks ?? []).some((x) => isPlacedCoord(x.coordinates)));
}

export function firstBeat(beats: readonly SetupBeat[], screens: readonly SetupScreen[], resume: boolean): number {
  if (!resume) return 0;
  const i = beats.findIndex((b) => b.kind === 'item' && screens[b.screen].items[b.item].required && !screens[b.screen].items[b.item].configured);
  return i >= 0 ? i : 0;
}

/**
 * A word of praise for the screen AFTER an item the creator just completed, chosen by position so it
 * varies without being random (a re-render never changes it). '' when the previous item was left
 * open: nobody is congratulated for skipping.
 */
export const PRAISE_COUNT = 5;
export function praiseIndex(beatIndex: number, previousDone: boolean): number | null {
  if (!previousDone || beatIndex <= 1) return null;
  return beatIndex % PRAISE_COUNT;
}

export interface StageProgress { stageId: string; title: string; total: number; done: number; current: boolean }

/**
 * The progress bar, one segment per STAGE of the game (in game order), sized by how many items it
 * holds, filled by how many of them are behind the creator. The game screen's items count towards
 * the first segment. Stages with nothing to set are left out: an empty segment would be a step the
 * creator can never take.
 */
export function stageProgress(
  game: Game | null | undefined,
  screens: readonly SetupScreen[],
  beats: readonly SetupBeat[],
  at: number,
): StageProgress[] {
  if (!game) return [];
  const order = (game.stages ?? []).slice().sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
  const seg = new Map<string, StageProgress>();
  for (const st of order) seg.set(st.id, { stageId: st.id, title: String(st.title ?? ''), total: 0, done: 0, current: false });
  const firstId = order[0]?.id;
  beats.forEach((b, i) => {
    if (b.kind !== 'item') return;
    const sid = screens[b.screen]?.stageId || firstId;
    const p = sid ? seg.get(sid) : undefined;
    if (!p) return;
    p.total++;
    if (i < at) p.done++;
    if (i === at) p.current = true;
  });
  return [...seg.values()].filter((p) => p.total > 0);
}

export interface PlanStage { stageId: string; title: string; perTeam: number; total: number; missions: string[] }

/** The plan screen: each stage's topic (its title), and how many of its missions a team does. */
export function planStages(game: Game | null | undefined): PlanStage[] {
  if (!game) return [];
  return (game.stages ?? []).slice().sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0)).map((st) => {
    const tasks = (st.tasks ?? []).filter(Boolean);
    const req = typeof st.requiredTaskCount === 'number' && st.requiredTaskCount > 0 ? Math.min(st.requiredTaskCount, tasks.length) : tasks.length;
    return { stageId: st.id, title: String(st.title ?? ''), perTeam: req, total: tasks.length, missions: tasks.map((t) => String(t.title ?? '')) };
  });
}

/**
 * The prep list as plain text, to copy or send (Ahiya, 22.10: "so they can keep it in WhatsApp and
 * share it with the organizers"). One bullet per preparation, the mission it belongs to first. Every
 * word comes from the caller in the interface language, so a Hebrew list carries no English at all.
 */
export function prepShareText(
  gameTitle: string,
  entries: readonly BeforeGameEntry[],
  words: { heading: (title: string) => string; empty: string },
): string {
  const head = words.heading(gameTitle.trim());
  if (entries.length === 0) return `${head}\n\n${words.empty}`;
  const lines = entries.map((e) => `• ${e.title.trim() !== '' ? `${e.title.trim()}: ` : ''}${e.text.replace(/\s+/g, ' ').trim()}`);
  return `${head}\n\n${lines.join('\n')}`;
}

/** A WhatsApp share link for that text (wa.me opens the app, or WhatsApp Web, with it typed in). */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
