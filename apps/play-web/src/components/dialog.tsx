// Non-blocking dialog system for the participant app — replaces native
// alert/confirm (which freeze the renderer and break headless testing).
// Mount <DialogHost/> once at the app root; call `await dialog.confirm(...)`.
import { useEffect, useState } from 'react';
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

  useEffect(() => {
    show = setReq;
    return () => { show = null; };
  }, []);

  if (!req) return null;

  // Resolve this request, drop it from the queue, then surface the next one.
  const close = (result: boolean) => {
    req.resolve(result);
    queue.shift();
    setReq(queue[0] ?? null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <Card className="w-full max-w-md p-6 space-y-5">
        <p className="text-base text-zinc-100 whitespace-pre-line text-center">{req.message}</p>
        <div className="space-y-2.5">
          <Button variant={req.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
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
