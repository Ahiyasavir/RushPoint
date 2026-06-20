// Non-blocking dialog system for the participant app — replaces native
// alert/confirm (which freeze the renderer and break headless testing).
// Mount <DialogHost/> once at the app root; call `await dialog.confirm(...)`.
import { useEffect, useState } from 'react';
import { Button, Card } from './ui';

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
let listener: ((req: DialogRequest | null) => void) | null = null;

function push(kind: DialogKind, message: string, opts?: { confirmLabel?: string; danger?: boolean }) {
  return new Promise<boolean>((resolve) => {
    const req: DialogRequest = { id: ++counter, kind, message, resolve, ...opts };
    if (!listener) { resolve(kind !== 'confirm'); return; }
    listener(req);
  });
}

export const dialog = {
  alert: (message: string) => push('alert', message).then(() => undefined),
  confirm: (message: string, opts?: { confirmLabel?: string; danger?: boolean }) =>
    push('confirm', message, opts),
};

export function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(null);

  useEffect(() => {
    listener = setReq;
    return () => { listener = null; };
  }, []);

  if (!req) return null;

  const close = (result: boolean) => { req.resolve(result); setReq(null); };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <Card className="w-full max-w-md p-6 space-y-5">
        <p className="text-base text-zinc-100 whitespace-pre-line text-center">{req.message}</p>
        <div className="space-y-2.5">
          <Button variant={req.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            {req.confirmLabel ?? (req.kind === 'alert' ? 'OK' : 'Confirm')}
          </Button>
          {req.kind === 'confirm' && (
            <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
          )}
        </div>
      </Card>
    </div>
  );
}
