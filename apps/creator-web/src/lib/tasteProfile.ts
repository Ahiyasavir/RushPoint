// The creator's taste profile: what to read from a mission, and where it is kept
// (change: composer-v2-taste). The codec and the affinity reading are in lib/tasteCodec.ts.
//
// Signals: regenerate is "not this kind" for the mission swapped away (-1); a mission still in the
// game when it launches is "yes, this kind" (+1). The composer and regenerate both add
// TASTE_WEIGHT × affinity to a candidate's score: a nudge among near-equals, never a veto.
//
// Kept per creator in localStorage, like the recent-picks memory (lib/recentBankPicks.ts), and for
// the same reason everything degrades: a read that throws is an empty profile, a write that throws is
// a no-op, and building a game never fails because of a nicety.
import type { Stage, Task } from '@rushpoint/shared';
import type { TaskBankEntry } from '../taskBank';
import { missionTagProfile } from './regenerateMission';
import { TASTE_TAG_IDS, decodeTaste, emptyTaste, encodeTaste, recordTasteMany } from './tasteCodec';
import type { BankTagId } from '../bankTags';

export * from './tasteCodec';

export interface TasteStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const TASTE_KEY_PREFIX = 'rp-taste';

export function tasteKey(uid: string | null | undefined): string {
  const clean = typeof uid === 'string' ? uid.trim() : '';
  return `${TASTE_KEY_PREFIX}:${clean || 'anon'}`;
}

function defaultStore(): TasteStore | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function readTaste(uid: string | null | undefined, store: TasteStore | undefined = defaultStore()): string {
  try {
    const raw = store?.getItem(tasteKey(uid));
    return encodeTaste(decodeTaste(raw));
  } catch {
    return encodeTaste(emptyTaste());
  }
}

export function writeTaste(uid: string | null | undefined, value: string, store: TasteStore | undefined = defaultStore()): void {
  try {
    store?.setItem(tasteKey(uid), encodeTaste(decodeTaste(value)));
  } catch {
    /* a full or blocked store loses a nudge, nothing else */
  }
}

/** Bank title → its taste tags, built once per bank array. */
const titleIndex = new WeakMap<readonly TaskBankEntry[], Map<string, { key: string; tags: BankTagId[] }>>();

function bankTitles(bank: readonly TaskBankEntry[]): Map<string, { key: string; tags: BankTagId[] }> {
  let index = titleIndex.get(bank);
  if (!index) {
    index = new Map();
    for (const e of bank) {
      try { index.set(e.build().title, { key: e.key, tags: e.tags.filter((t) => TASTE_TAG_IDS.includes(t)) }); } catch { /* a broken entry is skipped */ }
    }
    titleIndex.set(bank, index);
  }
  return index;
}

/**
 * The bank key of an UNEDITED bank mission (its title matches exactly), or null. What creators keep
 * and swap is counted per bank key (change: composer-v2-learning); a rewritten mission is the
 * creator's own and teaches the bank nothing.
 */
export function bankKeyForTask(task: Partial<Task> | null | undefined, bank: readonly TaskBankEntry[]): string | null {
  const title = typeof task?.title === 'string' ? task.title : '';
  return (title && Array.isArray(bank) ? bankTitles(bank).get(title)?.key : undefined) ?? null;
}

const SWAP_AUDIENCES = ['kids', 'youth', 'adults', 'corporate'] as const;
/** The share of a game's bank missions that makes an audience one the game clearly serves. */
const SWAP_AUDIENCE_SHARE = 0.7;

/**
 * What a swap must respect about the GAME it lands in (found 29.10: swapping every mission of 24
 * composed games brought one already in the game 14% of the time, a family twin of one 14%, and a
 * mission for another audience 5%, an office mission in a kids' game). Read from the game's other
 * unedited bank missions: their keys, and the audiences most of them serve. A game with no bank
 * missions (hand-built) has neither, and the swap is then left as it was. Total, never throws.
 */
export function swapGameFit(
  game: { stages?: readonly Stage[] } | null | undefined,
  sourceTaskId: string,
  bank: readonly TaskBankEntry[],
): { inGameKeys: string[]; audiences: string[] } {
  const inGameKeys: string[] = [];
  const stages = Array.isArray(game?.stages) ? game!.stages : [];
  for (const st of stages) {
    for (const t of Array.isArray(st?.tasks) ? st.tasks : []) {
      if (!t || t.id === sourceTaskId) continue;
      const key = bankKeyForTask(t, bank);
      if (key && !inGameKeys.includes(key)) inGameKeys.push(key);
    }
  }
  // Every audience that most of the game's bank missions serve (a 'mixed' one serves them all). A
  // composed kids' game also holds missions tagged for teens, so "the" audience is not one tag: the
  // replacement has to serve each audience the game clearly serves.
  const audiences: string[] = [];
  if (inGameKeys.length > 0) {
    const tagsByKey = new Map(bank.map((e) => [e.key, e.tags as readonly string[]]));
    for (const a of SWAP_AUDIENCES) {
      const n = inGameKeys.filter((k) => (tagsByKey.get(k) ?? []).includes(a) || (tagsByKey.get(k) ?? []).includes('mixed')).length;
      if (n >= inGameKeys.length * SWAP_AUDIENCE_SHARE) audiences.push(a);
    }
  }
  return { inGameKeys, audiences };
}

/**
 * The taste tags of a mission in a game. An UNEDITED bank mission (its title matches a bank mission
 * exactly) carries its bank tags, mechanics included; anything else is read from the mission itself,
 * which knows only what players do. A rewritten mission is no longer the bank's, so its bank tags
 * would lie (the reason Task carries no bank key, see regenerateMission.ts).
 */
export function tasteTagsForTask(task: Partial<Task> | null | undefined, bank: readonly TaskBankEntry[]): BankTagId[] {
  const title = typeof task?.title === 'string' ? task.title : '';
  const fromBank = title && Array.isArray(bank) ? bankTitles(bank).get(title) : undefined;
  if (fromBank) return [...fromBank.tags];
  return missionTagProfile(task).filter((t) => TASTE_TAG_IDS.includes(t));
}

/**
 * A real launch: every mission still in the game is a "yes, this kind" (one decay for the whole game,
 * see `recordTasteMany`). Never throws: a launch must not fail because of a nudge.
 */
export function recordLaunchTaste(
  uid: string | null | undefined,
  stages: readonly Stage[] | null | undefined,
  // Passed in, not imported: lib/missionBank reaches Firebase, and this module stays pure.
  bank: readonly TaskBankEntry[],
  store: TasteStore | undefined = defaultStore(),
): void {
  try {
    const lists = (Array.isArray(stages) ? stages : []).flatMap((s) => (s.tasks ?? []).map((t: Task) => tasteTagsForTask(t, bank)));
    writeTaste(uid, recordTasteMany(readTaste(uid, store), lists, 1), store);
  } catch {
    /* a nudge lost, nothing else */
  }
}
