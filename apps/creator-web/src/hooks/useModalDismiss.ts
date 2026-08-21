import { useEffect, useRef, type RefObject } from 'react';

/**
 * Escape-to-close (and optional focus management) for a dismissible overlay.
 * (change: creator-modal-escape)
 *
 * Every overlay in creator-web already closes on an outside CLICK — a backdrop
 * `<div onClick={onClose}>`. That is a mouse affordance and nothing else, so on
 * its own it leaves a keyboard user with only whatever ✕ happens to be in the
 * panel, and no way at all where there isn't one. `ExclusiveGroupsModal` put it
 * well — "the modal conventions the rest of creator-web already follows" — but
 * the convention was copy-pasted into four components and missing from six
 * others: the share sheet, the task library, the wizard's expanded map, the
 * builder spotlight, the run console's panel modal and the trash confirm.
 *
 * So it is a hook, not a fifth copy.
 *
 * @param onClose   called on Escape. Keep it stable (useCallback) or accept that
 *                  the listener re-binds on every render — harmless, just noise.
 * @param panelRef  when given, the panel is focused on mount and focus is
 *                  RESTORED to whatever was focused before, on unmount. Optional
 *                  on purpose: a spotlight or a menu that must not steal focus
 *                  passes nothing and gets Escape alone.
 * @param active    false disables the whole thing, for a component that renders
 *                  while closed. Defaults to true.
 *
 * The listener is on `window` in the CAPTURE phase so an Escape inside a text
 * input still closes the overlay — without capture, a component that stops
 * propagation on its own inputs would swallow it.
 *
 * ⚠ NESTING is `active`'s job, not the hook's. Two overlays stacked on each other
 * both listen on `window`, so a single Escape would close BOTH — and no amount of
 * `stopPropagation` fixes that, because listeners on the SAME target fire in
 * registration order, which has nothing to do with which overlay is on top. A
 * parent that can render a child overlay must therefore pass
 * `active={!childIsOpen}` (see TaskLibrary). Deliberately explicit: a hook that
 * guessed the stacking order would be wrong in exactly the cases that matter.
 */
export function useModalDismiss(
  onClose: () => void,
  panelRef?: RefObject<HTMLElement | null>,
  active = true,
): void {
  // Held in a ref so an inline arrow for `onClose` does not re-run the effect
  // (and therefore does not re-steal focus) on every parent render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!active) return;
    const panel = panelRef?.current ?? null;
    if (panel) {
      openerRef.current = document.activeElement;
      panel.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      // Only restore what we took. An overlay that never focused anything must
      // not yank focus somewhere on the way out.
      if (panel) (openerRef.current as HTMLElement | null)?.focus?.();
    };
    // `panelRef` is a stable ref object; `onClose` is read through closeRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
