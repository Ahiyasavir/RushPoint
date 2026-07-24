import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { Button, Card, Input, Label } from '../components/ui';
import { useAuth } from '../components/AuthGate';
import { useT, useLanguage } from '../components/LanguageContext';
import type { T } from '../i18n';
import {
  db,
  listSignInProviders,
  addPasswordToAccount,
  linkGoogleToAccount,
  reauthWithGoogle,
  reauthWithCurrentPassword,
  updateDisplayNameLocal,
  changeMyEmail,
  changeMyPassword,
} from '../services/firebase';
import {
  activeSignInMethods,
  availableSignInActions,
  authErrorKey,
  reauthMethod,
  type ProviderRef,
} from '../lib/signInMethods';
import { updateMyProfile, exportMyData, deleteMyAccount } from '../services/calls';
import { restartCreatorTour } from '../components/CreatorTour';

type Status = { kind: 'ok' | 'err'; msg: string } | null;

// Maps any Firebase auth failure to a translated sentence. The code -> key decision is pure
// (lib/signInMethods.ts); this only looks the key up, so no raw Firebase English can ever
// reach a Hebrew console. `fallback` lets a caller keep its own more specific generic message.
function authMsg(s: T['settings'], e: unknown, fallback: string = s.authErrGeneric): string {
  switch (authErrorKey(e)) {
    case 'credentialAlreadyInUse': return s.authErrCredentialAlreadyInUse;
    case 'emailAlreadyInUse':      return s.authErrEmailAlreadyInUse;
    case 'providerAlreadyLinked':  return s.authErrProviderAlreadyLinked;
    case 'popupCancelled':         return s.authErrPopupCancelled;
    case 'popupBlocked':           return s.authErrPopupBlocked;
    case 'requiresRecentLogin':    return s.authErrRequiresRecentLogin;
    case 'weakPassword':           return s.authErrWeakPassword;
    case 'network':                return s.authErrNetwork;
    case 'wrongPassword':          return s.authErrWrongPassword;
    case 'tooManyRequests':        return s.authErrTooManyRequests;
    default:                       return fallback;
  }
}

export default function SettingsPage() {
  const t = useT();
  const s = t.settings;
  const { lang, setLang } = useLanguage();
  const { user, signOut, refreshUser } = useAuth();

  // One source of truth for every card's provider branching. Re-read after a link so the
  // page updates without a reload.
  const [providers, setProviders] = useState<ProviderRef[]>(() => listSignInProviders());
  const refreshProviders = useCallback(() => setProviders(listSignInProviders()), []);
  useEffect(() => { refreshProviders(); }, [user, refreshProviders]);

  const isPasswordAccount = activeSignInMethods(providers).password;

  return (
    <div className="max-w-lg mx-auto animate-fade-up space-y-5">
      <h1 className="font-brand text-3xl font-extrabold text-[--ink-1] mb-2">{s.title}</h1>

      <SectionHeader>{s.sectionAccount}</SectionHeader>
      <ProfileCard
        s={s}
        initialName={user?.displayName ?? ''}
        onSaved={refreshUser}
      />
      <EmailCard s={s} currentEmail={user?.email ?? ''} isPasswordAccount={isPasswordAccount} uid={user?.uid ?? ''} onSaved={refreshUser} />
      <PasswordCard s={s} isPasswordAccount={isPasswordAccount} />
      <SignInMethodsCard s={s} providers={providers} accountEmail={user?.email ?? ''} onChanged={refreshProviders} />

      <SectionHeader>{s.sectionPreferences}</SectionHeader>
      <LanguageCard lang={lang} setLang={setLang} s={s} />
      <TourCard t={t} />

      <SectionHeader>{s.sectionDataLegal}</SectionHeader>
      <DataCard s={s} />
      <LegalCard s={s} t={t} />
      <DangerCard s={s} onDeleted={signOut} />
    </div>
  );
}

// ── Section eyebrow ─────────────────────────────────────────────────────────────
function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-[--ink-3] pt-2 text-start">
      {children}
    </div>
  );
}

// ── Language ──────────────────────────────────────────────────────────────────
function LanguageCard({ lang, setLang, s }: { lang: 'he' | 'en'; setLang: (l: 'he' | 'en') => void; s: T['settings'] }) {
  const [saved, setSaved] = useState(false);
  function handle(l: 'he' | 'en') {
    setLang(l);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  return (
    <Card className="p-6">
      <div className="text-sm font-semibold text-[--ink-1] mb-4">{s.languageLabel}</div>
      <div className="grid grid-cols-2 gap-3">
        {(['he', 'en'] as const).map((l) => (
          <button
            key={l}
            onClick={() => handle(l)}
            className={`relative rounded-xl border-2 p-4 text-center transition-all duration-150 ${
              lang === l
                ? 'border-rp-fire bg-rp-fire/8 text-rp-fire'
                : 'border-[--rp-border] text-[--ink-2] hover:border-rp-fire/40 hover:bg-rp-fire/4'
            }`}
          >
            <div className="text-2xl mb-1.5">{l === 'he' ? '🇮🇱' : '🇺🇸'}</div>
            <div className="font-semibold text-sm">{l === 'he' ? s.languageHe : s.languageEn}</div>
            {lang === l && (
              <div className="absolute top-2 end-2 w-5 h-5 rounded-full bg-rp-fire text-white text-[10px] flex items-center justify-center font-bold">✓</div>
            )}
          </button>
        ))}
      </div>
      {saved && <p className="text-rp-go text-sm mt-3 text-center font-medium animate-fade-up">{s.savedMsg}</p>}
    </Card>
  );
}

// ── Guided tour (change: creator-guided-tour) ────────────────────────────────
// The tour auto-starts once for a brand new creator and is then remembered as
// seen; this is the only always-available way back into it besides the header
// help button, and it works whether it was skipped, finished, or never shown.
function TourCard({ t }: { t: T }) {
  return (
    <Card className="p-6">
      <div className="text-sm font-semibold text-[--ink-1] mb-1">{t.tour.settingsTitle}</div>
      <p className="text-xs text-[--ink-3] mb-4">{t.tour.settingsDesc}</p>
      <Button variant="ghost" onClick={() => restartCreatorTour()}>{t.tour.settingsBtn}</Button>
    </Card>
  );
}

// ── Profile / display name ──────────────────────────────────────────────────
function ProfileCard({ s, initialName, onSaved }: { s: T['settings']; initialName: string; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) { setStatus({ kind: 'err', msg: s.nameRequired }); return; }
    setBusy(true); setStatus(null);
    try {
      await updateMyProfile({ displayName: trimmed });
      await updateDisplayNameLocal(trimmed);
      await onSaved();
      setStatus({ kind: 'ok', msg: s.nameSaved });
    } catch (e) {
      setStatus({ kind: 'err', msg: authMsg(s, e) });
    } finally {
      setBusy(false);
    }
  }

  const dirty = name.trim() !== initialName.trim();
  return (
    <Card className="p-6">
      <div className="text-sm font-semibold text-[--ink-1] mb-4">{s.profileLabel}</div>
      <Label>{s.displayName}</Label>
      <Input value={name} onChange={(e) => { setName(e.target.value); setStatus(null); }} maxLength={80} />
      <StatusLine status={status} />
      <Button className="mt-3" disabled={busy || !dirty} loading={busy} onClick={save}>
        {busy ? s.nameSaving : s.nameSave}
      </Button>
    </Card>
  );
}

// ── Email ─────────────────────────────────────────────────────────────────────
function EmailCard({ s, currentEmail, isPasswordAccount, uid, onSaved }: {
  s: T['settings']; currentEmail: string; isPasswordAccount: boolean; uid: string; onSaved: () => Promise<void>;
}) {
  const [newEmail, setNewEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function save() {
    setBusy(true); setStatus(null);
    try {
      await changeMyEmail(pwd, newEmail);
      if (uid) await setDoc(doc(db, 'users', uid), { email: newEmail.trim() }, { merge: true });
      await onSaved();
      setStatus({ kind: 'ok', msg: s.emailChanged });
      setNewEmail(''); setPwd('');
    } catch (e) {
      setStatus({ kind: 'err', msg: authMsg(s, e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="text-sm font-semibold text-[--ink-1] mb-1">{s.emailLabel}</div>
      <p className="text-xs text-[--ink-3] mb-4">{s.emailDesc}</p>
      <Label>{s.email}</Label>
      <Input value={currentEmail} readOnly className="opacity-60 cursor-not-allowed mb-3" />
      {isPasswordAccount ? (
        <>
          <Label>{s.emailNew}</Label>
          <Input type="email" value={newEmail} onChange={(e) => { setNewEmail(e.target.value); setStatus(null); }}
            placeholder="you@example.com" autoComplete="email" className="mb-3" />
          <Label>{s.emailCurrentPwd}</Label>
          <Input type="password" value={pwd} onChange={(e) => { setPwd(e.target.value); setStatus(null); }}
            placeholder="••••••••" autoComplete="current-password" />
          <StatusLine status={status} />
          <Button className="mt-3" disabled={busy || !newEmail.trim() || !pwd} loading={busy} onClick={save}>
            {busy ? s.emailChanging : s.emailChangeBtn}
          </Button>
        </>
      ) : (
        <p className="text-xs text-[--ink-3] bg-[--surface-2] rounded-lg px-3 py-2.5">{s.emailGoogleNote}</p>
      )}
    </Card>
  );
}

// ── Password ──────────────────────────────────────────────────────────────────
function PasswordCard({ s, isPasswordAccount }: { s: T['settings']; isPasswordAccount: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function save() {
    if (next.length < 8) { setStatus({ kind: 'err', msg: s.passwordTooShort }); return; }
    if (next !== confirm) { setStatus({ kind: 'err', msg: s.passwordMismatch }); return; }
    setBusy(true); setStatus(null);
    try {
      await changeMyPassword(current, next);
      setStatus({ kind: 'ok', msg: s.passwordChanged });
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e) {
      setStatus({ kind: 'err', msg: authMsg(s, e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="text-sm font-semibold text-[--ink-1] mb-1">{s.passwordLabel}</div>
      {isPasswordAccount ? (
        <>
          <p className="text-xs text-[--ink-3] mb-4">{s.passwordDesc}</p>
          <Label>{s.passwordCurrent}</Label>
          <Input type="password" value={current} onChange={(e) => { setCurrent(e.target.value); setStatus(null); }}
            autoComplete="current-password" className="mb-3" />
          <Label>{s.passwordNew}</Label>
          <Input type="password" value={next} onChange={(e) => { setNext(e.target.value); setStatus(null); }}
            autoComplete="new-password" className="mb-3" />
          <Label>{s.passwordConfirm}</Label>
          <Input type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setStatus(null); }}
            autoComplete="new-password"
            className={confirm && confirm !== next ? '!border-rp-alert/60' : ''} />
          <StatusLine status={status} />
          <Button className="mt-3" disabled={busy || !current || !next || !confirm} loading={busy} onClick={save}>
            {busy ? s.passwordChanging : s.passwordChangeBtn}
          </Button>
        </>
      ) : (
        <p className="text-xs text-[--ink-3] bg-[--surface-2] rounded-lg px-3 py-2.5 mt-3">{s.passwordGoogleNote}</p>
      )}
    </Card>
  );
}

// ── Sign in methods (change: creator-signin-methods) ─────────────────────────
// States plainly which methods the account has, and offers ONLY the one it is missing.
// Nothing here removes a method, so a "last remaining sign-in method" lockout is unreachable.
function SignInMethodsCard({ s, providers, accountEmail, onChanged }: {
  s: T['settings']; providers: ProviderRef[]; accountEmail: string; onChanged: () => void;
}) {
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState<'password' | 'google' | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [reauthFor, setReauthFor] = useState<'password' | 'google' | null>(null);
  const [reauthPwd, setReauthPwd] = useState('');

  const methods = activeSignInMethods(providers);
  const actions = availableSignInActions(providers);

  // Each action resolves to the message to show, or throws for the error mapper.
  async function perform(kind: 'password' | 'google'): Promise<Status> {
    if (kind === 'password') {
      await addPasswordToAccount(pwd);
      setPwd(''); setConfirm('');
      return { kind: 'ok', msg: s.addPasswordDone };
    }
    const r = await linkGoogleToAccount();
    if (r.ok) return { kind: 'ok', msg: s.linkGoogleDone };
    if (r.reason === 'mismatch') {
      return { kind: 'err', msg: s.linkGoogleMismatch({ googleEmail: r.googleEmail, accountEmail: r.accountEmail }) };
    }
    if (r.reason === 'missing-google-email')  return { kind: 'err', msg: s.linkGoogleNoGoogleEmail };
    if (r.reason === 'missing-account-email') return { kind: 'err', msg: s.linkGoogleNoAccountEmail };
    return { kind: 'err', msg: s.linkGoogleRollbackFailed };
  }

  // `auth/requires-recent-login` is a flow, not a dead end: re-confirm with a method the
  // account actually has, then retry ONCE (retry=false on the second pass, so it can't loop).
  async function attempt(kind: 'password' | 'google', retry = true) {
    if (kind === 'password') {
      if (pwd.length < 8)   { setStatus({ kind: 'err', msg: s.passwordTooShort }); return; }
      if (pwd !== confirm)  { setStatus({ kind: 'err', msg: s.passwordMismatch }); return; }
    }
    setBusy(kind); setStatus(null);
    try {
      setStatus(await perform(kind));
      setReauthFor(null); setReauthPwd('');
      onChanged();
    } catch (e) {
      if (retry && authErrorKey(e) === 'requiresRecentLogin') {
        const how = reauthMethod(providers);
        if (how === 'password') { setReauthFor(kind); setStatus({ kind: 'err', msg: s.reauthPrompt }); return; }
        if (how === 'google') {
          try { await reauthWithGoogle(); } catch (e2) { setStatus({ kind: 'err', msg: authMsg(s, e2) }); return; }
          await attempt(kind, false);
          return;
        }
      }
      setStatus({ kind: 'err', msg: authMsg(s, e) });
    } finally {
      setBusy(null);
    }
  }

  async function confirmReauth() {
    const kind = reauthFor;
    if (!kind) return;
    setBusy(kind); setStatus(null);
    try {
      await reauthWithCurrentPassword(reauthPwd);
    } catch (e) {
      setStatus({ kind: 'err', msg: authMsg(s, e) });
      setBusy(null);
      return;
    }
    setReauthFor(null); setReauthPwd(''); setBusy(null);
    await attempt(kind, false);
  }

  return (
    <Card className="p-6">
      <div className="text-sm font-semibold text-[--ink-1] mb-1">{s.methodsLabel}</div>
      <p className="text-xs text-[--ink-3] mb-4">{s.methodsDesc}</p>

      <div className="space-y-2">
        <MethodRow s={s} name={s.methodsPasswordName} active={methods.password} />
        <MethodRow s={s} name={s.methodsGoogleName} active={methods.google} />
      </div>

      {!actions.canAddPassword && !actions.canLinkGoogle && (
        <p className="text-xs text-[--ink-3] bg-[--surface-2] rounded-lg px-3 py-2.5 mt-4">{s.methodsAllSet}</p>
      )}

      {actions.canAddPassword && (
        <div className="mt-5 pt-5 border-t border-[--rp-border]">
          <div className="text-sm font-semibold text-[--ink-1] mb-1">{s.addPasswordTitle}</div>
          <p className="text-xs text-[--ink-3] mb-3">{s.addPasswordDesc(accountEmail)}</p>
          <Label>{s.addPasswordNew}</Label>
          <Input type="password" value={pwd} onChange={(e) => { setPwd(e.target.value); setStatus(null); }}
            autoComplete="new-password" className="mb-3" />
          <Label>{s.addPasswordConfirm}</Label>
          <Input type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setStatus(null); }}
            autoComplete="new-password"
            className={confirm && confirm !== pwd ? '!border-rp-alert/60' : ''} />
          <Button className="mt-3" disabled={busy !== null || !pwd || !confirm} loading={busy === 'password'} onClick={() => attempt('password')}>
            {busy === 'password' ? s.addPasswordBusy : s.addPasswordBtn}
          </Button>
        </div>
      )}

      {actions.canLinkGoogle && (
        <div className="mt-5 pt-5 border-t border-[--rp-border]">
          <div className="text-sm font-semibold text-[--ink-1] mb-1">{s.linkGoogleTitle}</div>
          <p className="text-xs text-[--ink-3] mb-2">{s.linkGoogleDesc(accountEmail)}</p>
          <p className="text-xs text-[--ink-3] bg-[--surface-2] rounded-lg px-3 py-2.5 mb-3">{s.linkGoogleSameEmail}</p>
          <Button variant="ghost" disabled={busy !== null} loading={busy === 'google'} onClick={() => attempt('google')}>
            {busy === 'google' ? s.linkGoogleBusy : s.linkGoogleBtn}
          </Button>
        </div>
      )}

      {reauthFor && (
        <div className="mt-4 rounded-xl border border-[--rp-border] bg-[--surface-2] p-4">
          <Label>{s.passwordCurrent}</Label>
          <Input type="password" value={reauthPwd} onChange={(e) => setReauthPwd(e.target.value)}
            autoComplete="current-password" autoFocus />
          <Button className="mt-3" disabled={busy !== null || !reauthPwd} loading={busy !== null} onClick={confirmReauth}>
            {busy !== null ? s.reauthBusy : s.reauthConfirmBtn}
          </Button>
        </div>
      )}

      <StatusLine status={status} />
    </Card>
  );
}

function MethodRow({ s, name, active }: { s: T['settings']; name: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-[--surface-2] px-3 py-2.5">
      <span className="text-sm font-medium text-[--ink-1] text-start">{name}</span>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
        active ? 'bg-rp-go/10 text-rp-go' : 'bg-[--surface-1] text-[--ink-3]'
      }`}>
        {active ? s.methodsActive : s.methodsInactive}
      </span>
    </div>
  );
}

// ── Data export ─────────────────────────────────────────────────────────────
function DataCard({ s }: { s: T['settings'] }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function exportData() {
    setBusy(true); setStatus(null);
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rushpoint-data-${data.account.uid}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus({ kind: 'ok', msg: s.dataExported });
    } catch (e) {
      setStatus({ kind: 'err', msg: authMsg(s, e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="text-sm font-semibold text-[--ink-1] mb-1">{s.dataLabel}</div>
      <p className="text-xs text-[--ink-3] mb-4">{s.dataDesc}</p>
      <Button variant="ghost" disabled={busy} loading={busy} onClick={exportData}>
        {busy ? s.dataExporting : s.dataExportBtn}
      </Button>
      <StatusLine status={status} />
    </Card>
  );
}

// ── Legal documents ───────────────────────────────────────────────────────────
// Settings is where a creator goes looking for account/compliance material, so
// the policies get a card here in addition to the always-visible app footer.
// target="_blank" (not <Link>) is deliberate: a creator opening the policy from
// Settings is usually checking one clause, and shouldn't lose their place.
function LegalCard({ s, t }: { s: T['settings']; t: T }) {
  const linkClass = 'text-sm text-rp-fire hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60';
  return (
    <Card className="p-6">
      <div className="text-sm font-semibold text-[--ink-1] mb-1">{s.legalLabel}</div>
      <p className="text-xs text-[--ink-3] mb-4">{s.legalDesc}</p>
      <div className="flex flex-col items-start gap-2 text-start">
        <a href="/privacy" target="_blank" rel="noreferrer" className={linkClass}>{t.common.privacyLink}</a>
        <a href="/terms" target="_blank" rel="noreferrer" className={linkClass}>{t.common.termsLink}</a>
      </div>
    </Card>
  );
}

// ── Danger zone (delete account) ──────────────────────────────────────────────
function DangerCard({ s, onDeleted }: { s: T['settings']; onDeleted: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const confirmed = typed.trim() === s.deleteConfirmWord;

  async function doDelete() {
    setBusy(true); setStatus(null);
    try {
      await deleteMyAccount({ confirm: true });
      await onDeleted(); // signs out; auth listener routes back to the login screen
    } catch (e) {
      setStatus({ kind: 'err', msg: authMsg(s, e, s.deleteFailed) });
      setBusy(false);
    }
  }

  return (
    <Card className="p-6 border-rp-alert/30">
      <div className="text-sm font-semibold text-rp-alert mb-1">{s.dangerLabel}</div>
      <p className="text-xs text-[--ink-3] mb-4">{s.dangerDesc}</p>

      {!open ? (
        <Button variant="danger" onClick={() => setOpen(true)}>{s.deleteBtn}</Button>
      ) : (
        <div className="rounded-xl border border-rp-alert/30 bg-rp-alert/5 p-4">
          <div className="text-sm font-semibold text-[--ink-1] mb-1">{s.deleteConfirmTitle}</div>
          <p className="text-xs text-[--ink-2] mb-3 leading-relaxed">{s.deleteConfirmBody}</p>
          <Label>{s.deleteConfirmHint(s.deleteConfirmWord)}</Label>
          <Input value={typed} onChange={(e) => { setTyped(e.target.value); setStatus(null); }}
            placeholder={s.deleteConfirmWord} autoFocus
            className={busy ? 'opacity-60' : ''} disabled={busy} />
          <StatusLine status={status} />
          <div className="flex gap-2 mt-3">
            <Button variant="danger" disabled={!confirmed || busy} onClick={doDelete}>
              {busy ? s.deleting : s.deleteConfirmCta}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => { setOpen(false); setTyped(''); setStatus(null); }}>
              ✕
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Shared status line ────────────────────────────────────────────────────────
function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p className={`text-sm mt-2 font-medium ${status.kind === 'ok' ? 'text-rp-go' : 'text-rp-alert'}`}>
      {status.msg}
    </p>
  );
}
