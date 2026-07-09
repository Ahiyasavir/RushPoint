// Pure array reorder for native drag-and-drop (change: v2.1-builder-shell-redesign).
// Moves the item at `from` to index `to`, returning a new array. Out-of-range or
// no-op moves return the original array unchanged. DOM-free for the test lane.
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = arr.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
