// Non-blocking toast/snackbar — imperative singleton like dialog.tsx, so any call
// site (even outside the React tree) can fire feedback without prop-drilling:
//
//   toast.success('Game saved')
//   toast.error('Copy failed')
//
// Mount <ToastHost/> once at the app root (next to <DialogHost/>). Unlike the
// dialog, a toast never traps focus or blocks the page — it announces via an
// aria-live region and auto-dismisses.
import { useEffect, useState } from 'react';
import { useT } from './LanguageContext';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; message: string }

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 3200;

let counter = 0;
let listener: ((items: ToastItem[]) => void) | null = null;
let items: ToastItem[] = [];

function emit() { listener?.(items.slice()); }

function push(kind: ToastKind, message: string) {
  const item: ToastItem = { id: ++counter, kind, message };
  items = [...items, item].slice(-MAX_VISIBLE);
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== item.id);
    emit();
  }, AUTO_DISMISS_MS);
}

export const toast = {
  success: (message: string) => push('success', message),
  error:   (message: string) => push('error', message),
  info:    (message: string) => push('info', message),
};

const ACCENT: Record<ToastKind, string> = {
  success: 'var(--rp-go)',
  error:   'var(--rp-alert)',
  info:    'var(--rp-plasma)',
};

export function ToastHost() {
  const c = useT().common;
  const [list, setList] = useState<ToastItem[]>([]);

  useEffect(() => {
    listener = setList;
    return () => { listener = null; };
  }, []);

  function remove(id: number) {
    items = items.filter((t) => t.id !== id);
    emit();
  }

  if (list.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-40 bottom-4 inset-x-4 flex flex-col items-center gap-2 sm:inset-x-auto sm:items-end sm:end-4 pointer-events-none"
    >
      {list.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto w-full sm:w-auto sm:max-w-sm flex items-start gap-2.5 rounded-xl bg-[--surface-0] dark:bg-[--surface-1] border border-[--rp-border] shadow-[0_8px_28px_-6px_rgba(10,12,26,0.25)] ps-3 pe-2 py-2.5 animate-fade-up"
          style={{ borderInlineStartWidth: 3, borderInlineStartColor: ACCENT[t.kind] }}
        >
          <p className="flex-1 text-sm text-[--ink-1] leading-snug" dir="auto">{t.message}</p>
          <button
            type="button"
            aria-label={c.dismiss}
            onClick={() => remove(t.id)}
            className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
