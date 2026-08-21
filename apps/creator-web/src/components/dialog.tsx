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
  danger?: boolean;
  resolve: (value: boolean | string | null) => void;
}

let counter = 0;
let listener: ((req: DialogRequest | null) => void) | null = null;

function push(kind: DialogKind, message: string, opts?: { defaultValue?: string; confirmLabel?: string; danger?: boolean }) {
  return new Promise<boolean | string | null>((resolve) => {
    const req: DialogRequest = { id: ++counter, kind, message, resolve, ...opts };
    // No host mounted (e.g. very early) → fall back to a resolved default so nothing hangs.
    if (!listener) { resolve(kind === 'confirm' ? false : kind === 'prompt' ? null : undefined!); return; }
    listener(req);
  });
}

export const dialog = {
  alert: (message: string) => push('alert', message).then(() => undefined),
  confirm: (message: string, confirmLabel?: string, danger?: boolean) =>
    push('confirm', message, { confirmLabel, danger }) as Promise<boolean>,
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
      // z-[110] — ABOVE every other overlay in the app, including the launch
      // liftoff at z-[100]. This is not cosmetic. A failed launch does
      // `await dialog.alert(...)` from inside the liftoff's try/finally, so the
      // liftoff is still up when the alert renders; at z-50 the alert was drawn
      // UNDERNEATH it and the creator saw "preparing your run…" forever, on a
      // launch that had already failed, with an invisible dialog waiting for a
      // click that could never be aimed at it. The app was not hung — it just
      // looked exactly like it was.
      //
      // A blocking alert/confirm is the most urgent thing on screen by
      // definition, so it outranks progress overlays rather than the other way
      // round. Keep this the highest z-index in creator-web; the ordering is
      // asserted by scripts/test-creator-a11y-scan.ts.
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget && req.kind === 'alert') onConfirm(); }}
    >
      <Card className="w-full max-w-sm p-6 space-y-4">
        <p className="text-sm text-[--ink-1] whitespace-pre-line">{req.message}</p>

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
            // Prefer the explicit `danger` flag; fall back to sniffing an English
            // label so callers that don't set it still get red for "delete" (the
            // sniff never fires for a localized/Hebrew label, hence the flag).
            variant={(req.danger ?? req.confirmLabel?.toLowerCase().includes('delete')) ? 'danger' : 'primary'}
            autoFocus={req.kind !== 'prompt'}
            onClick={onConfirm}
          >
            {req.confirmLabel ?? (req.kind === 'alert' ? c.ok : req.kind === 'confirm' ? c.confirmLabel : c.submit)}
          </Button>
        </div>
      </Card>
    </div>
  );
}
