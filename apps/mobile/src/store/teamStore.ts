import { create } from 'zustand';
import type { Team, Assignment, Task, FlashMission } from '@rushpoint/shared';

interface TeamState {
  team: Team | null;
  assignment: Assignment | null;
  currentTask: Task | null;
  flashMissions: FlashMission[];
  isOnline: boolean;

  setTeam: (team: Team) => void;
  setAssignment: (assignment: Assignment) => void;
  setCurrentTask: (task: Task | null) => void;
  setFlashMissions: (missions: FlashMission[]) => void;
  setOnline: (online: boolean) => void;
  clearAll: () => void;
}

export const useTeamStore = create<TeamState>((set) => ({
  team: null,
  assignment: null,
  currentTask: null,
  flashMissions: [],
  isOnline: true,

  setTeam: (team) => set({ team }),
  setAssignment: (assignment) => set({ assignment }),
  setCurrentTask: (task) => set({ currentTask: task }),
  setFlashMissions: (missions) => set({ flashMissions: missions }),
  setOnline: (online) => set({ isOnline: online }),
  clearAll: () => set({
    team: null,
    assignment: null,
    currentTask: null,
    flashMissions: [],
  }),
}));
