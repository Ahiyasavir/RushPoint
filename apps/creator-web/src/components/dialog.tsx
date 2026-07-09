// Non-blocking dialog system — drop-in replacement for native alert/confirm/prompt.
// Native dialogs freeze the renderer (and break automated/headless testing); these
// render an in-app modal and return a Promise, so call sites just `await dialog.x()`.
//
//   await dialog.alert('Saved.')
//   if (await dialog.confirm('Delete?')) …
//   const name = await dialog.prompt('Staff name?')   // string | null
//
// Mount <DialogHost/> once at the app root.
import { useEffect, useState } from 'react';
import { Button, Card, Input } from './ui';
import { useT } from './LanguageContext';

type DialogKind = 'alert' | 'confirm' | 'prompt';
interface DialogRequest {
  id: number;
  kind: DialogKind;
  message: string;
  defaultValue?: string;
  confirmLabel?: string;
  resolve: (value: boolean | string | null) => void;
}

let counter = 0;
let listener: ((req: DialogRequest | null) => void) | null = null;

function push(kind: DialogKind, message: string, opts?: { defaultValue?: string; confirmLabel?: string }) {
  return new Promise<boolean | string | null>((resolve) => {
    const req: DialogRequest = { id: ++counter, kind, message, resolve, ...opts };
    // No host mounted (e.g. very early) → fall back to a resolved default so nothing hangs.
    if (!listener) { resolve(kind === 'confirm' ? false : kind === 'prompt' ? null : undefined!); return; }
    listener(req);
  });
}

export const dialog = {
  alert: (message: string) => push('alert', message).then(() => undefined),
  confirm: (message: string, confirmLabel?: string) =>
    push('confirm', message, { confirmLabel }) as Promise<boolean>,
  prompt: (message: string, defaultValue = '') =>
    push('prompt', message, { defaultValue }) as Promise<string | null>,
};

export function DialogHost() {
  const c = useT().common;
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    listener = (r) => { setReq(r); setValue(r?.defaultValue ?? ''); };
    return () => { listener = null; };
  }, []);

  if (!req) return null;

  const close = (result: boolean | string | null) => { req.resolve(result); setReq(null); };
  const onConfirm = () =>
    close(req.kind === 'prompt' ? value : req.kind === 'confirm' ? true : undefined!);
  const onCancel = () => close(req.kind === 'prompt' ? null : false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget && req.kind === 'alert') onConfirm(); }}
    >
      <Card className="w-full max-w-sm p-6 space-y-4">
        <p className="text-sm text-zinc-200 whitespace-pre-line">{req.message}</p>

        {req.kind === 'prompt' && (
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel(); }}
          />
        )}

        <div className="flex justify-end gap-2">
          {req.kind !== 'alert' && (
            <Button variant="ghost" onClick={onCancel}>{c.cancel}</Button>
          )}
          <Button
            variant={req.confirmLabel?.toLowerCase().includes('delete') ? 'danger' : 'primary'}
            autoFocus={req.kind !== 'prompt'}
            onClick={onConfirm}
          >
            {req.confirmLabel ?? (req.kind === 'alert' ? 'OK' : req.kind === 'confirm' ? 'Confirm' : 'Submit')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
