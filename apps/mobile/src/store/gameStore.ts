import { create } from 'zustand';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SlotType   = 'green' | 'orange' | 'gold';
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
    // Green slots 0–3: first is immediately active
    { index: 0, type: 'green',  status: 'active'  },
    { index: 1, type: 'green',  status: 'locked'  },
    { index: 2, type: 'green',  status: 'locked'  },
    { index: 3, type: 'green',  status: 'locked'  },
    // Orange slot 4: unlocks after all 4 greens complete
    { index: 4, type: 'orange', status: 'locked'  },
    // Gold slots 5–7: unlock after orange completes
    { index: 5, type: 'gold',   status: 'locked'  },
    { index: 6, type: 'gold',   status: 'locked'  },
    { index: 7, type: 'gold',   status: 'locked'  },
  ];
}

// ─── Unlock rules ─────────────────────────────────────────────────────────────
// Returns the updated slots array after applying post-completion unlock logic.
function applyUnlockRules(slots: SlotState[], completedIndex: number): SlotState[] {
  const updated = [...slots];

  if (completedIndex < 3) {
    // Completing a green slot unlocks the next green slot
    updated[completedIndex + 1] = { ...updated[completedIndex + 1], status: 'active' };
  } else if (completedIndex === 3) {
    // Completing the 4th green slot unlocks the orange slot
    updated[4] = { ...updated[4], status: 'active' };
  } else if (completedIndex === 4) {
    // Completing orange unlocks all 3 gold slots simultaneously
    updated[5] = { ...updated[5], status: 'active' };
    updated[6] = { ...updated[6], status: 'active' };
    updated[7] = { ...updated[7], status: 'active' };
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
