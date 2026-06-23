import { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { Button, Card, Input, Label } from '../components/ui';
import { useAuth } from '../components/AuthGate';
import { useT, useLanguage } from '../components/LanguageContext';
import type { T } from '../i18n';
import {
  db,
  hasPasswordProvider,
  updateDisplayNameLocal,
  changeMyEmail,
  changeMyPassword,
} from '../services/firebase';
import { updateMyProfile, exportMyData, deleteMyAccount } from '../services/calls';

type Status = { kind: 'ok' | 'err'; msg: string } | null;

// Maps a Firebase auth error to a friendly, localized message.
function authErr(e: unknown, reauthMsg: string, fallback: string): string {
  const code = (e as { code?: string })?.code ?? '';
  if (/wrong-password|invalid-credential|invalid-login-credentials/.test(code)) return reauthMsg;
  if (e instanceof Error) return e.message.replace(/^Firebase: /, '');
  return fallback;
}

export default function SettingsPage() {
  const t = useT();
  const s = t.settings;
  const { lang, setLang } = useLanguage();
  const { user, signOut, refreshUser } = useAuth();
  const isPasswordAccount = hasPasswordProvider();

  return (
    <div className="max-w-lg mx-auto animate-fade-up space-y-5">
      <h1 className="font-brand text-3xl font-extrabold text-[--ink-1] mb-2">{s.title}</h1>

      <LanguageCard lang={lang} setLang={setLang} s={s} />
      <ProfileCard
        s={s}
        initialName={user?.displayName ?? ''}
        onSaved={refreshUser}
      />
      <EmailCard s={s} currentEmail={user?.email ?? ''} isPasswordAccount={isPasswordAccount} uid={user?.uid ?? ''} onSaved={refreshUser} />
      <PasswordCard s={s} isPasswordAccount={isPasswordAccount} />
      <DataCard s={s} />
      <DangerCard s={s} onDeleted={signOut} />
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
      setStatus({ kind: 'err', msg: authErr(e, s.reauthError, s.genericError) });
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
      <Button className="mt-3" disabled={busy || !dirty} onClick={save}>
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
      setStatus({ kind: 'err', msg: authErr(e, s.reauthError, s.genericError) });
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
          <Button className="mt-3" disabled={busy || !newEmail.trim() || !pwd} onClick={save}>
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
      setStatus({ kind: 'err', msg: authErr(e, s.reauthError, s.genericError) });
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
          <Button className="mt-3" disabled={busy || !current || !next || !confirm} onClick={save}>
            {busy ? s.passwordChanging : s.passwordChangeBtn}
          </Button>
        </>
      ) : (
        <p className="text-xs text-[--ink-3] bg-[--surface-2] rounded-lg px-3 py-2.5 mt-3">{s.passwordGoogleNote}</p>
      )}
    </Card>
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
      setStatus({ kind: 'err', msg: authErr(e, s.reauthError, s.genericError) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="text-sm font-semibold text-[--ink-1] mb-1">{s.dataLabel}</div>
      <p className="text-xs text-[--ink-3] mb-4">{s.dataDesc}</p>
      <Button variant="ghost" disabled={busy} onClick={exportData}>
        {busy ? s.dataExporting : s.dataExportBtn}
      </Button>
      <StatusLine status={status} />
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
      setStatus({ kind: 'err', msg: authErr(e, s.reauthError, s.deleteFailed) });
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
