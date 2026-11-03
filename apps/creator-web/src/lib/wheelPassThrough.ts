// Does a map need ctrl + wheel to zoom? Only when the page around it can actually scroll
// (Ahiya, 3.11: "pages with no scroll and a map, and still the mouse wheel does not zoom").
//
// `cooperativeGestures` exists so a wheel over a map inside a scrolling panel scrolls the panel
// (change: quick-setup-one-card). On a screen that does not scroll there is nothing for the wheel to
// pass through to, so demanding a modifier key only takes zoom away. Pure: the caller measures.

export interface ScrollBox { overflowY: string; scrollHeight: number; clientHeight: number }

/** One box scrolls when its style allows it AND its content is taller than it (1px of rounding slack). */
export function boxScrolls(b: ScrollBox): boolean {
  return (b.overflowY === 'auto' || b.overflowY === 'scroll' || b.overflowY === 'overlay') && b.scrollHeight > b.clientHeight + 1;
}

/** The map's ancestors, innermost first, plus the document's scrolling element last. */
export function anyAncestorScrolls(chain: readonly ScrollBox[]): boolean {
  return chain.some(boxScrolls);
}

/** Cooperative gestures stay on only when they were asked for and something around the map scrolls. */
export function wantsCooperativeGestures(requested: boolean, chain: readonly ScrollBox[]): boolean {
  return requested && anyAncestorScrolls(chain);
}

/** Reads the chain from the DOM. The document counts as scrollable like an `auto` box. */
export function scrollChainOf(el: HTMLElement | null): ScrollBox[] {
  const out: ScrollBox[] = [];
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    out.push({ overflowY: cs.overflowY, scrollHeight: n.scrollHeight, clientHeight: n.clientHeight });
  }
  const doc = document.scrollingElement as HTMLElement | null;
  if (doc) out.push({ overflowY: 'auto', scrollHeight: doc.scrollHeight, clientHeight: doc.clientHeight });
  return out;
}
