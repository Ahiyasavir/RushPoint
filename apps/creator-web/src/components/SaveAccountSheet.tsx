// "Save your game": the account sheet a GUEST creator sees (change: creator-acquisition-and-return).
// A guest builds as an anonymous user; this links a real credential onto that same user, so the game
// they built is simply theirs. It opens from the guest bar, or at the moment an action needs an
// account (launch, publish): `askToSaveAccount(reason)` resolves true once the account exists, so
// the caller can carry straight on with what the creator was doing.
import { useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db, signOut as fbSignOutOnly, upgradeGuestWithEmail, upgradeGuestWithGoogle } from '../services/firebase';
import { createGuestClaim } from '../services/calls';
import { keepGuestClaim, readGuestClaim } from '../lib/guestClaim';
import { useAuth, GOOGLE_SVG } from './AuthGate';
import { useT } from './LanguageContext';
import { Button, Input, Label } from './ui';
import { Icon } from './Icon';
import { authErrorInfo } from '../lib/authError';
import { markSignedIn } from '../lib/guestCreator';
import { track } from '../lib/track';
import { TAP_TARGET } from '../lib/interaction';

export type SaveReason = 'bar' | 'launch' | 'publish' | 'reveal' | 'continue';

type Pending = { reason: SaveReason; required: boolean; resolve: (ok: boolean) => void };
let open: ((p: Pending) => void) | null = null;

/** Ask a guest to save. Resolves true when the account now exists, false if they closed the sheet. */
export function askToSaveAccount(reason: SaveReason, { required = false }: { required?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!open) { resolve(false); return; }
    open({ reason, required, resolve });
  });
}

export function SaveAccountHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => { open = setPending; return () => { open = null; }; }, []);
  if (!pending) return null;
  return <SaveAccountSheet reason={pending.reason} required={pending.required} onDone={(ok) => { pending.resolve(ok); setPending(null); }} />;
}

function SaveAccountSheet({ reason, required, onDone }: { reason: SaveReason; required: boolean; onDone: (ok: boolean) => void }) {
  const t = useT();
  const ts = t.saveAccount;
  const { refreshUser } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    // A REQUIRED save cannot be dismissed: the guest has used their free edits (lib/guestCreator).
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !required) onDone(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone, required]);

  async function finish(user: { uid: string; email: string | null; displayName: string | null }) {
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      displayName: user.displayName ?? (name.trim() || null),
      email: user.email,
      createdAt: new Date().toISOString(),
    }, { merge: true }).catch(() => undefined);
    markSignedIn();
    track('guest_saved', { reason });
    await refreshUser();
    onDone(true);
  }

  // A guest who really has an account already must have a way to it: signing out of the guest is the
  // only door to the sign-in form. The claim is taken first, so the game follows them to that account;
  // without it we stay here, because leaving would strand the game.
  async function toSignIn() {
    setErr(''); setBusy(true);
    try {
      keepGuestClaim((await createGuestClaim()).code);
      if (!readGuestClaim()) throw new Error('no storage');
    } catch { setErr(ts.handoverFailed); setBusy(false); return; }
    markSignedIn();
    onDone(false);
    await fbSignOutOnly();
  }

  function explain(e: unknown) {
    const code = (e as { code?: string } | null)?.code ?? '';
    if (code.includes('credential-already-in-use') || code.includes('email-already-in-use')) { setErr(ts.alreadyHasAccount); return; }
    const info = authErrorInfo(e);
    if (info.silent) return;
    setErr((t.auth.errors as Record<string, string>)[info.key] ?? t.auth.errors.unknown);
  }

  async function google() {
    setErr(''); setBusy(true);
    try { const cred = await upgradeGuestWithGoogle(); await finish(cred.user); }
    catch (e) { explain(e); }
    finally { setBusy(false); }
  }

  async function withEmail() {
    setErr('');
    if (!name.trim()) { setErr(t.auth.validationName); return; }
    if (!email.trim()) { setErr(t.auth.validationEmail); return; }
    if (password.length < 8) { setErr(t.auth.validationPwdLen); return; }
    setBusy(true);
    try { const cred = await upgradeGuestWithEmail(email.trim(), password, name.trim()); await finish(cred.user); }
    catch (e) { explain(e); }
    finally { setBusy(false); }
  }

  const title = reason === 'launch' ? ts.titleLaunch : reason === 'publish' ? ts.titlePublish
    : reason === 'reveal' ? ts.titleReveal : reason === 'continue' ? ts.titleContinue : ts.titleBar;

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[--surface-1] shadow-2xl">
        <div className="h-1.5 w-full bg-gradient-to-l from-rp-fire to-rp-amber" />
        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex w-11 h-11 shrink-0 items-center justify-center rounded-2xl bg-rp-fire/10 text-ink-fire">
              <Icon name="sparkle" className="w-6 h-6" />
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-[19px] font-extrabold leading-snug text-[--ink-1]">{title}</h2>
              <p className="text-[14px] text-[--ink-2] mt-1 leading-snug">{required ? ts.subRequired : ts.sub}</p>
            </div>
            {!required && (
              <button type="button" onClick={() => onDone(false)} aria-label={ts.close} className={`${TAP_TARGET} -m-2 rounded-full text-[--ink-3] hover:bg-[--surface-2]`}>
                <Icon name="close" className="w-5 h-5" />
              </button>
            )}
          </div>

          <Button variant="ghost" className="w-full !py-3 mt-5" disabled={busy} onClick={google}>
            <span className="flex items-center justify-center gap-2.5 font-semibold text-sm">{GOOGLE_SVG} {t.auth.continueWithGoogle}</span>
          </Button>
          <div className="flex items-center gap-3 text-[--ink-3] text-xs my-4">
            <div className="flex-1 h-px bg-[--rp-border]" /><span>{t.auth.orWithEmail}</span><div className="flex-1 h-px bg-[--rp-border]" />
          </div>
          <div className="space-y-3">
            <div><Label>{t.auth.fullName}</Label><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
            <div><Label>{t.auth.email}</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" /></div>
            <div><Label>{t.auth.password}</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
              onKeyDown={(e) => { if (e.key === 'Enter') void withEmail(); }} /></div>
            {err && <p role="alert" className="rounded-lg bg-rp-alert/8 border border-rp-alert/20 px-3 py-2 text-ink-alert text-[13px] font-medium leading-snug">{err}</p>}
            <Button className="w-full !mt-4 !py-3" disabled={busy} onClick={withEmail}>{busy ? t.auth.creating : ts.cta}</Button>
            <p className="text-center text-[12px] text-[--ink-3] leading-relaxed">{ts.keeps}</p>
            <button type="button" disabled={busy} onClick={() => void toSignIn()} className="w-full min-h-[44px] text-[13px] font-medium text-[--ink-2] hover:text-[--ink-1]">{ts.haveAccount}</button>
            {reason === 'reveal' && !required && (
              <button type="button" onClick={() => onDone(false)} className="w-full min-h-[44px] text-[14px] font-medium text-[--ink-3] hover:text-[--ink-1]">{ts.later}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
