// Trackable collectibles (change: trackable-collectibles) — a virtual item picked up at
// one task and dropped at another, carrying a travel log. Pure state helpers so the
// pickup/drop rules are unit-tested without Firestore. Within-run only in v1.

export interface Trackable {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  homeTaskId?: string;            // where it starts / belongs
  currentHolderTeamId?: string | null; // null / absent = not held (at a task or home)
  currentTaskId?: string | null; // where it currently sits when not held
}

export interface TrackableLogEntry {
  teamId: string;
  teamName?: string;
  taskId?: string;
  action: 'pickup' | 'drop';
  at: string;
}

/** A team may pick up a trackable only if nobody is currently holding it. */
export function canPickUp(t: Pick<Trackable, 'currentHolderTeamId'>): boolean {
  return !t.currentHolderTeamId;
}

/** A team may drop a trackable only if it is the current holder. */
export function canDrop(t: Pick<Trackable, 'currentHolderTeamId'>, teamId: string): boolean {
  return !!t.currentHolderTeamId && t.currentHolderTeamId === teamId;
}
