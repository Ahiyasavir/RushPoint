import { create } from 'zustand';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SlotType   = 'green' | 'gate' | 'orange' | 'gold';
export type SlotStatus = 'locked' | 'active' | 'completed' | 'skipped';

export interface SlotState {
  index: number;
  type: SlotType;
  status: SlotStatus;
  taskId?: string;
  taskTitle?: string;
  completedAt?: number; // unix ms
}

// ─── Live mirror types ──────────────────────────────────────────────────────
// Phase 2: the store mirrors the authoritative Firestore `gameState/current`
// document via an onSnapshot listener (see useGameSync). startedAt/arrivedAt
// arrive as ISO strings or Firestore Timestamps, so they stay `unknown`.
export interface LiveSlot {
  index: number;
  type: SlotType;
  status: SlotStatus;
  taskId?: string;
  taskTitle?: string;
  startedAt?: unknown;
  completedAt?: unknown;
}

export interface LiveJudging {
  slotIndex: number;
  checkInId: string;
  arrivedAt: unknown;
}

export type MatchStatus = 'waiting' | 'matched' | 'won' | 'lost' | 'bypassed';

export interface LiveGame {
  slots: LiveSlot[];
  score: number;
  judging?: LiveJudging | null;
  // Phase 3
  gateArrivedAt?: unknown;
  craftingStartedAt?: unknown;
  finalSprintStartedAt?: unknown;
  matchStatus?: MatchStatus;
}

export type SyncState = 'loading' | 'live' | 'error';

interface GameState {
  // Team
  teamId: string | null;
  teamName: string;
  memberNames: string[];
  score: number;
  isOnline: boolean;

  // Slots — always exactly 8 (local Phase-1 buffer; superseded by `live`)
  slots: SlotState[];

  // ── Live Firestore mirror (Phase 2) ──
  live: LiveGame | null;
  syncState: SyncState;
  fromCache: boolean;

  // Actions
  initTeam: (teamId: string, teamName: string, members: string[]) => void;
  completeSlot: (index: number, taskTitle?: string) => void;
  addScore: (points: number) => void;
  setOnline: (online: boolean) => void;
  applyLiveGame: (game: LiveGame, fromCache: boolean) => void;
  setSyncState: (state: SyncState) => void;
  resetGame: () => void;
}

// ─── Initial slot layout ──────────────────────────────────────────────────────

function buildInitialSlots(): SlotState[] {
  return [
    // Green slots 0–3: field tasks
    { index: 0, type: 'green',  status: 'active' },
    { index: 1, type: 'green',  status: 'locked' },
    { index: 2, type: 'green',  status: 'locked' },
    { index: 3, type: 'green',  status: 'locked' },
    // Gate slot 4: matchmaking filter
    { index: 4, type: 'gate',   status: 'locked' },
    // Orange slot 5: find basket zone
    { index: 5, type: 'orange', status: 'locked' },
    // Gold slot 6: 20-min crafting + final judging
    { index: 6, type: 'gold',   status: 'locked' },
  ];
}

// ─── Unlock rules ─────────────────────────────────────────────────────────────
// Returns the updated slots array after applying post-completion unlock logic.
// Linear chain: each slot activates exactly the next one (mirrors server unlockNext).
function applyUnlockRules(slots: SlotState[], completedIndex: number): SlotState[] {
  const updated = [...slots];
  if (completedIndex + 1 < updated.length) {
    updated[completedIndex + 1] = { ...updated[completedIndex + 1], status: 'active' };
  }
  return updated;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useGameStore = create<GameState>((set) => ({
  teamId:      null,
  teamName:    '',
  memberNames: [],
  score:       0,
  isOnline:    true,
  slots:       buildInitialSlots(),
  live:        null,
  syncState:   'loading',
  fromCache:   false,

  initTeam: (teamId, teamName, members) =>
    set({
      teamId,
      teamName,
      memberNames: members,
      score: 0,
      slots: buildInitialSlots(),
      live: null,
      syncState: 'loading',
    }),

  applyLiveGame: (game, fromCache) =>
    set({ live: game, score: game.score, syncState: 'live', fromCache }),

  setSyncState: (state) => set({ syncState: state }),

  completeSlot: (index, taskTitle) =>
    set((state) => {
      const slots = state.slots.map((s) =>
        s.index === index
          ? { ...s, status: 'completed' as SlotStatus, taskTitle, completedAt: Date.now() }
          : s,
      );
      return { slots: applyUnlockRules(slots, index) };
    }),

  addScore: (points) =>
    set((state) => ({ score: state.score + points })),

  setOnline: (online) => set({ isOnline: online }),

  resetGame: () =>
    set({
      teamId: null, teamName: '', memberNames: [], score: 0,
      slots: buildInitialSlots(), live: null, syncState: 'loading', fromCache: false,
    }),
}));

// ─── Derived helpers ──────────────────────────────────────────────────────────

export function completedCount(slots: SlotState[]): number {
  return slots.filter((s) => s.status === 'completed').length;
}

export function isGameComplete(slots: SlotState[]): boolean {
  return slots.every((s) => s.status === 'completed');
}
