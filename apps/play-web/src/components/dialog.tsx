// Non-blocking dialog system for the participant app — replaces native
// alert/confirm (which freeze the renderer and break headless testing).
// Mount <DialogHost/> once at the app root; call `await dialog.confirm(...)`.
import { useEffect, useRef, useState } from 'react';
import { Button, Card } from './ui';
import { useT } from '../i18nContext';

type DialogKind = 'alert' | 'confirm';
interface DialogRequest {
  id: number;
  kind: DialogKind;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
}

let counter = 0;
// FIFO queue so a second dialog opened while one is showing doesn't overwrite
// (and silently abandon) the first — previously the first promise never
// resolved, hanging its awaiter. Requests show one at a time, in order.
const queue: DialogRequest[] = [];
let show: ((req: DialogRequest | null) => void) | null = null;

function push(kind: DialogKind, message: string, opts?: { confirmLabel?: string; danger?: boolean }) {
  return new Promise<boolean>((resolve) => {
    const req: DialogRequest = { id: ++counter, kind, message, resolve, ...opts };
    if (!show) { resolve(kind !== 'confirm'); return; }
    queue.push(req);
    if (queue.length === 1) show(req); // host is idle → display immediately
  });
}

export const dialog = {
  alert: (message: string) => push('alert', message).then(() => undefined),
  confirm: (message: string, opts?: { confirmLabel?: string; danger?: boolean }) =>
    push('confirm', message, opts),
};

export function DialogHost() {
  const { t } = useT();
  const [req, setReq] = useState<DialogRequest | null>(null);
  // change: play-touch-rtl-a11y. This surface gates SOS, leaving a run and paid
  // hints, but it was not a dialog: no role, no aria-modal, no focus move and no
  // Escape, so a keyboard or screen-reader user was never told a decision was
  // being asked of them.
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    show = setReq;
    return () => { show = null; };
  }, []);

  // Keyed on req.id, not on `req`, so a QUEUED second request also takes focus
  // when it surfaces. The element to restore is captured the first time a request
  // opens and held until the queue drains back to idle.
  useEffect(() => {
    if (!req) { restoreRef.current = null; return; }
    if (!restoreRef.current) {
      const active = document.activeElement;
      restoreRef.current = active instanceof HTMLElement ? active : null;
    }
    confirmRef.current?.focus();
  }, [req]);

  // Escape resolves exactly as the Cancel button does, so no caller's contract
  // changes: an `alert` still resolves, a `confirm` still resolves false.
  useEffect(() => {
    if (!req) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeRef.current?.(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [req]);

  // Resolve this request, drop it from the queue, then surface the next one.
  const close = (result: boolean) => {
    req?.resolve(result);
    queue.shift();
    const next = queue[0] ?? null;
    setReq(next);
    if (!next) {
      // Queue drained: hand focus back to whatever the user was on.
      restoreRef.current?.focus();
      restoreRef.current = null;
    }
  };
  // The Escape listener is registered once per request, so it must reach the
  // CURRENT close without re-subscribing on every render.
  const closeRef = useRef(close);
  closeRef.current = close;

  if (!req) return null;

  const labelId = `rp-dialog-msg-${req.id}`;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <Card
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className="w-full max-w-md p-6 space-y-5"
      >
        <p id={labelId} className="text-base text-zinc-100 whitespace-pre-line text-center">{req.message}</p>
        <div className="space-y-2.5">
          <Button ref={confirmRef} variant={req.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            {req.confirmLabel ?? (req.kind === 'alert' ? t.common.ok : t.common.confirm)}
          </Button>
          {req.kind === 'confirm' && (
            <Button variant="ghost" onClick={() => close(false)}>{t.common.cancel}</Button>
          )}
        </div>
      </Card>
    </div>
  );
}
