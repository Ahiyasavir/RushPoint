import { createContext, useContext, useEffect, useState, lazy, Suspense, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import {
  watchAuth,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  resetPassword,
  signOut as fbSignOut,
  auth,
  db,
} from '../services/firebase';
import { Button, Card, Input, Label, Spinner } from './ui';
import { claimReferral } from '../services/calls';
import { dialog, DialogHost } from './dialog';
import { ToastHost } from './toast';
import { REFERRAL_BONUS_FREE_RUNS, FREE_PARTICIPANTS_PER_FREE_RUN, resolvePlayOrigin } from '@rushpoint/shared';
import { useT } from './LanguageContext';

const LegalPage = lazy(() => import('../pages/LegalPage'));

const LEGAL_PATHS = ['/privacy', '/terms'];

// The participant app, for the no-signup "try a sample game" demo link. The seed
// always keeps a live demo run reachable with the PLAY01 access code.
const PLAY_URL = import.meta.env.DEV
  ? resolvePlayOrigin(window.location.origin)
  : ((import.meta.env.VITE_PLAY_URL as string | undefined) ?? 'https://rushpoint-play.web.app');
const DEMO_URL = `${PLAY_URL}/?code=PLAY01`;

interface AuthCtx {
  user: User | null;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>({ user: null, signOut: async () => {}, refreshUser: async () => {} });
export const useAuth = () => useContext(Ctx);

const REF_KEY = 'rp_ref';
const incomingRef = new URLSearchParams(window.location.search).get('ref');
if (incomingRef) { try { localStorage.setItem(REF_KEY, incomingRef); } catch { /* private mode */ } }

export function AuthProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [, bump] = useState(0); // force a re-render after an in-place user.reload()

  useEffect(() => watchAuth((u) => { setUser(u); setReady(true); }), []);

  // Re-read the (mutated-in-place) Auth user — used after a profile rename so
  // the header/nav reflect the new display name without a full re-login.
  async function refreshUser() {
    await auth.currentUser?.reload();
    bump((n) => n + 1);
  }

  useEffect(() => {
    if (!user) return;
    let ref: string | null = null;
    try { ref = localStorage.getItem(REF_KEY); } catch { /* private mode */ }
    if (!ref || ref === user.uid) { if (ref) { try { localStorage.removeItem(REF_KEY); } catch { /* */ } } return; }
    try { localStorage.removeItem(REF_KEY); } catch { /* */ }
    claimReferral({ referrerUid: ref })
      .then((r) => { if (r.ok && !r.alreadyClaimed) void dialog.alert(`🎁 ${t.common.referralBonusApplied}`); })
      .catch(() => { /* invalid or expired invite, silently ignore */ });
  }, [user, t]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-[--surface-0] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-rp-fire/20 border-t-rp-fire animate-spin" />
      </div>
    );
  }

  // Legal pages are public: serve them without requiring auth.
  if (!user && LEGAL_PATHS.includes(window.location.pathname)) {
    const type = window.location.pathname === '/privacy' ? 'privacy' : 'terms';
    return (
      <Suspense fallback={<Spinner label="..." />}>
        <LegalPage type={type} standalone />
      </Suspense>
    );
  }

  if (!user) return <LoginScreen />;

  return <Ctx.Provider value={{ user, signOut: () => fbSignOut(), refreshUser }}>{children}</Ctx.Provider>;
}

const GOOGLE_SVG = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

function LoginScreen() {
  const t = useT();
  const [mode, setMode] = useState<'in' | 'up'>('in');

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [confirm, setConfirm]   = useState('');

  const [err, setErr]   = useState('');
  const [busy, setBusy] = useState(false);

  function switchMode(next: 'in' | 'up') {
    setMode(next); setErr(''); setPassword(''); setConfirm('');
  }

  function validateSignUp(): string | null {
    if (!fullName.trim()) return t.auth.validationName;
    if (!email.trim())    return t.auth.validationEmail;
    if (password.length < 8) return t.auth.validationPwdLen;
    if (password !== confirm) return t.auth.validationPwdMatch;
    return null;
  }

  async function submit() {
    setErr('');
    if (mode === 'up') {
      const ve = validateSignUp();
      if (ve) { setErr(ve); return; }
    }
    setBusy(true);
    try {
      if (mode === 'in') {
        await signInWithEmail(email, password);
      } else {
        const cred = await signUpWithEmail(email, password, fullName.trim());
        await setDoc(doc(db, 'users', cred.user.uid), {
          uid: cred.user.uid,
          displayName: fullName.trim(),
          email: cred.user.email,
          createdAt: new Date().toISOString(),
        }, { merge: true });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Firebase: /, '') : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setErr(''); setBusy(true);
    try { await signInWithGoogle(); }
    catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^Firebase: /, '') : 'Google sign-in failed';
      if (!/popup-closed-by-user|cancelled-popup-request|popup-blocked/.test(msg)) setErr(msg);
    }
    finally { setBusy(false); }
  }

  async function forgotPassword() {
    setErr('');
    if (!email.trim()) { setErr(t.auth.resetNeedEmail); return; }
    setBusy(true);
    try {
      await resetPassword(email.trim());
      await dialog.alert(t.auth.resetSent(email.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Firebase: /, '') : 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  const isSignInReady = email.trim() && password;
  const isSignUpReady = fullName.trim() && email.trim() && password && confirm;

  const l = t.landing;

  const authCard = (
    <Card className="w-full max-w-sm relative overflow-hidden">
      <div className="h-1 w-full bg-gradient-to-r from-rp-fire to-rp-amber" />
      <div className="p-6">
        <div className="mb-5 text-center">
          <div
            className="w-12 h-12 rounded-2xl mx-auto mb-3.5 flex items-center justify-center text-2xl"
            style={{ background: 'linear-gradient(135deg,#FF5722,#FFB300)', boxShadow: '0 4px 16px rgba(255,87,34,0.35)' }}
          >🏁</div>
          <h2 className="font-brand text-xl font-extrabold text-[--ink-1] tracking-tight">
            {mode === 'in' ? t.auth.welcomeBack : t.auth.createAccount}
          </h2>
          <p className="text-[--ink-3] text-sm mt-1">
            {mode === 'in' ? t.auth.welcomeBackSub : t.auth.createAccountSub}
          </p>
        </div>

        <Button variant="ghost" className="w-full !py-2.5 mb-4" disabled={busy} onClick={google}>
          <span className="flex items-center justify-center gap-2.5 font-semibold text-sm">
            {GOOGLE_SVG} {t.auth.continueWithGoogle}
          </span>
        </Button>

        <div className="flex items-center gap-3 text-[--ink-3] text-xs mb-4">
          <div className="flex-1 h-px bg-[--rp-border]" />
          <span>{t.auth.orWithEmail}</span>
          <div className="flex-1 h-px bg-[--rp-border]" />
        </div>

        <div className="space-y-3">
          {mode === 'up' && (
            <div>
              <Label>{t.auth.fullName}</Label>
              <Input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                placeholder="ישראל ישראלי" autoComplete="name" /> {/* i18n-ignore mockup sample */}
            </div>
          )}

          <div>
            <Label>{t.auth.email}</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" autoComplete="email" />
          </div>

          <div>
            <Label>{t.auth.password}</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              onKeyDown={(e) => mode === 'in' && e.key === 'Enter' && submit()} />
            {mode === 'up' && password && (
              <div className="flex gap-1 mt-1.5">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className={`flex-1 h-1 rounded-full transition-all duration-200 ${
                    password.length >= [8, 10, 14, 18][i]
                      ? ['bg-rp-alert', 'bg-rp-amber', 'bg-rp-amber', 'bg-rp-go'][i]
                      : 'bg-[--surface-2]'
                  }`} />
                ))}
              </div>
            )}
          </div>

          {mode === 'in' && (
            <div className="text-end -mt-1.5">
              <button type="button" onClick={forgotPassword} disabled={busy}
                className="text-xs text-[--ink-3] hover:text-rp-fire transition-colors disabled:opacity-40">
                {t.auth.forgotPassword}
              </button>
            </div>
          )}

          {mode === 'up' && (
            <div>
              <Label>{t.auth.confirmPassword}</Label>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••" autoComplete="new-password"
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                className={confirm && confirm !== password ? '!border-rp-alert/60 !ring-rp-alert/20' : ''} />
              {confirm && confirm !== password && (
                <p className="text-[11px] text-rp-alert mt-1">{t.auth.passwordsMismatch}</p>
              )}
            </div>
          )}

          {err && (
            <div className="rounded-lg bg-rp-alert/8 border border-rp-alert/20 px-3 py-2">
              <p className="text-rp-alert text-xs font-medium">{err}</p>
            </div>
          )}

          <Button className="w-full !mt-4"
            disabled={busy || (mode === 'in' ? !isSignInReady : !isSignUpReady)}
            onClick={submit}>
            {busy
              ? (mode === 'in' ? t.auth.signingIn : t.auth.creating)
              : (mode === 'in' ? t.auth.signInBtn : t.auth.createBtn)}
          </Button>

          {mode === 'up' && (
            <p className="text-center text-[10px] text-[--ink-3] leading-relaxed pt-1">
              {t.auth.agreeToTerms(
                <a href="/terms" target="_blank" rel="noreferrer" className="underline hover:text-rp-fire">{l.termsLink}</a> as unknown as string,
                <a href="/privacy" target="_blank" rel="noreferrer" className="underline hover:text-rp-fire">{l.privacyLink}</a> as unknown as string,
              )}
            </p>
          )}

          <p className="text-center text-xs text-[--ink-3] pt-1">
            {mode === 'in' ? t.auth.noAccount : t.auth.haveAccount}{' '}
            <button className="text-rp-fire font-semibold hover:underline"
              onClick={() => switchMode(mode === 'in' ? 'up' : 'in')}>
              {mode === 'in' ? t.auth.signUpFree : t.auth.signIn}
            </button>
          </p>
        </div>
      </div>
    </Card>
  );

  // The logged-in App mounts its own DialogHost/ToastHost, but the logged-out screen
  // renders instead of App — so without these, dialog.*/toast.* calls made here (the
  // forgot-password confirmation, the referral-bonus alert) silently no-op. Mounting
  // them here makes that pre-signin feedback actually render. These two branches are
  // mutually exclusive with App, so the module-singleton host is never double-owned.
  return (
    <>
      <Landing authCard={authCard} />
      <DialogHost />
      <ToastHost />
    </>
  );
}

function Landing({ authCard }: { authCard: ReactNode }) {
  const t = useT();
  const l = t.landing;

  return (
    <div className="min-h-screen bg-[--surface-1] text-[--ink-1] relative overflow-hidden">
      {/* Ambient depth */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[46rem] h-[46rem] rounded-full opacity-70"
          style={{ background: 'radial-gradient(circle, rgba(255,87,34,0.16) 0%, transparent 62%)', filter: 'blur(90px)' }} />
        <div className="absolute top-1/3 -left-48 w-[40rem] h-[40rem] rounded-full opacity-50"
          style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 62%)', filter: 'blur(90px)' }} />
        <div className="absolute bottom-0 left-1/3 w-[36rem] h-[36rem] rounded-full opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(255,179,0,0.12) 0%, transparent 62%)', filter: 'blur(90px)' }} />
        <div className="absolute inset-0"
          style={{
            backgroundImage: 'linear-gradient(to right, rgba(10,12,26,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(10,12,26,0.04) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, #000 0%, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, #000 0%, transparent 70%)',
          }} />
      </div>

      <div className="relative max-w-6xl mx-auto px-5">
        {/* Top bar */}
        <div className="h-16 flex items-center justify-between">
          <span className="font-brand text-xl font-extrabold bg-gradient-to-r from-rp-fire to-rp-amber bg-clip-text text-transparent">
            RushPoint
          </span>
          <a href="#signin" className="text-sm text-[--ink-3] hover:text-[--ink-1] transition-colors font-medium">{l.signInNav}</a>
        </div>

        {/* Hero */}
        <div className="grid md:grid-cols-2 gap-12 items-center min-h-[calc(100vh-4rem)] pb-16">
          <div className="animate-fade-up">
            {incomingRef ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-rp-fire/40 bg-rp-fire/8 px-3.5 py-1.5 text-xs text-rp-fire font-semibold mb-5">
                {l.referralBadge(REFERRAL_BONUS_FREE_RUNS)}
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-full border border-[--rp-border] bg-[--surface-0]/70 backdrop-blur px-3.5 py-1.5 text-xs text-[--ink-2] font-medium mb-5 shadow-sm">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rp-fire opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-rp-fire" />
                </span>
                {l.badge}
              </div>
            )}
            <h1 className="font-brand text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.02]">
              {l.heroLine1}<br />
              <span className="bg-gradient-to-r from-rp-fire via-rp-amber to-rp-amber bg-clip-text text-transparent">
                {l.heroLine2}
              </span>
            </h1>
            <p className="text-[--ink-2] text-lg sm:text-xl mt-6 max-w-md leading-relaxed">{l.heroSub}</p>
            <div className="flex flex-wrap items-center gap-3 mt-8">
              <a href="#signin"><Button className="!px-7 !py-3 !text-base">{l.ctaPrimary}</Button></a>
              <a href={DEMO_URL} target="_blank" rel="noreferrer">
                <Button variant="ghost" className="!px-6 !py-3 !text-base">{l.tryDemo}</Button>
              </a>
              <a href="#how" className="text-sm font-medium text-[--ink-2] hover:text-[--ink-1] px-3 py-2.5 rounded-xl hover:bg-[--surface-2] transition-colors">{l.ctaSecondary}</a>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-7 text-xs text-[--ink-3] font-medium">
              <span className="flex items-center gap-1.5"><span className="text-rp-go">✓</span> {l.trustNoCc}</span>
              <span className="flex items-center gap-1.5"><span className="text-rp-go">✓</span> {l.trustDemo}</span>
              <span className="flex items-center gap-1.5"><span className="text-rp-go">✓</span> {l.trustFreePlayers(FREE_PARTICIPANTS_PER_FREE_RUN)}</span>
            </div>

            {/* Use-case strip — leads with the launch wedges (events) */}
            <div className="mt-8">
              <p className="text-[11px] uppercase tracking-widest text-[--ink-3] font-semibold mb-2.5">{l.useCasesTitle}</p>
              <div className="flex flex-wrap gap-2">
                {l.useCases.map((u) => (
                  <span key={u.label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[--rp-border] bg-[--surface-0]/60 px-3 py-1.5 text-xs font-medium text-[--ink-2]">
                    <span>{u.emoji}</span> {u.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex md:justify-end justify-center animate-fade-up" style={{ animationDelay: '120ms' }}>
            <PhoneMockup />
          </div>
        </div>

        {/* Sign-up band */}
        <div id="signin" className="scroll-mt-20 flex flex-col items-center pb-20">
          <h2 className="font-brand text-2xl font-bold text-[--ink-1]">{l.signupBandTitle}</h2>
          <p className="text-[--ink-3] text-sm mt-1 mb-7">{l.signupBandSub}</p>
          {authCard}
        </div>

        {/* Features */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-16">
          {l.features.map((f) => (
            <Card key={f.title} className="p-5 hover:-translate-y-1 transition-transform duration-200">
              <div className="text-2xl mb-3">{f.icon}</div>
              <div className="font-brand font-bold text-[--ink-1]">{f.title}</div>
              <p className="text-sm text-[--ink-3] mt-1.5 leading-relaxed">{f.body}</p>
            </Card>
          ))}
        </div>

        {/* How it works */}
        <div id="how" className="scroll-mt-20 pb-20">
          <h2 className="text-center font-brand text-2xl font-bold text-[--ink-1] mb-10">{l.howTitle}</h2>
          <div className="grid sm:grid-cols-3 gap-5">
            {l.steps.map((s) => (
              <Card key={s.n} className="p-6">
                <div
                  className="w-9 h-9 rounded-xl text-white font-bold text-sm flex items-center justify-center mb-4"
                  style={{ background: 'linear-gradient(135deg, #FF5722, #FFB300)', boxShadow: '0 2px 12px rgba(255,87,34,0.3)' }}
                >
                  {s.n}
                </div>
                <div className="font-brand font-bold text-[--ink-1] text-base">{s.title}</div>
                <p className="text-sm text-[--ink-3] mt-1.5 leading-relaxed">{s.body}</p>
              </Card>
            ))}
          </div>
          <div className="text-center mt-10">
            <a href="#signin"><Button className="!px-8 !py-2.5">{l.ctaPrimary}</Button></a>
          </div>
        </div>

        <footer className="border-t border-[--rp-border] py-6 text-center text-xs text-[--ink-3] space-y-2">
          <p>{l.footerText}</p>
          <p className="flex items-center justify-center gap-3">
            <a href="/privacy" target="_blank" rel="noreferrer" className="hover:text-[--ink-1] hover:underline transition-colors">{l.privacyLink}</a>
            <span aria-hidden="true">·</span>
            <a href="/terms" target="_blank" rel="noreferrer" className="hover:text-[--ink-1] hover:underline transition-colors">{l.termsLink}</a>
            <span aria-hidden="true">·</span>
            <a href="mailto:legal@rushpoint.app" className="hover:text-[--ink-1] hover:underline transition-colors">legal@rushpoint.app</a>
          </p>
        </footer>
      </div>
    </div>
  );
}

function PhoneMockup() {
  const board = [
    { rank: 1, name: 'הפלאפל פייב', score: 740, me: false },
    { rank: 2, name: 'שועלי המדבר', score: 690, me: true },
    { rank: 3, name: 'מנהרי השער', score: 615, me: false },
  ];
  return (
    <div className="relative w-[290px] shrink-0" aria-hidden="true">
      <div className="absolute -inset-8 rounded-[3rem] bg-orange-500/25 blur-3xl" />
      <div className="relative rounded-[2.5rem] border border-white/10 bg-zinc-950 p-2.5 shadow-2xl">
        <div className="rounded-[2rem] overflow-hidden bg-orange-50">
          <div className="h-6 bg-orange-50 flex items-center justify-center">
            <div className="w-16 h-1.5 rounded-full bg-zinc-300" />
          </div>
          <div className="px-4 pt-1 pb-3">
            <div className="text-[13px] font-extrabold text-orange-600">מסע אוצר העיר העתיקה</div> {/* i18n-ignore mockup sample */}
            <div className="text-[10px] text-zinc-500">ניקוד: <span className="font-mono text-orange-600">690</span></div> {/* i18n-ignore mockup sample */}
            <div className="mt-2 flex gap-1">
              <div className="h-1.5 flex-1 rounded-full bg-orange-500" />
              <div className="h-1.5 flex-1 rounded-full bg-orange-500" />
              <div className="h-1.5 flex-1 rounded-full bg-zinc-200" />
            </div>
          </div>
          <div className="relative mx-4 h-28 rounded-xl overflow-hidden bg-gradient-to-br from-amber-100 to-orange-200">
            <svg viewBox="0 0 200 110" className="absolute inset-0 w-full h-full">
              <path d="M20 90 C 60 70, 80 40, 130 35 S 180 25, 185 18" fill="none" stroke="#ea580c" strokeWidth="3" strokeDasharray="6 6" strokeLinecap="round" />
              <circle cx="20" cy="90" r="6" fill="#16a34a" />
              <circle cx="130" cy="35" r="5" fill="#ea580c" />
              <circle cx="185" cy="18" r="5" fill="#f97316" />
            </svg>
            <div className="absolute bottom-1.5 right-1.5 text-[9px] bg-white/80 rounded px-1.5 py-0.5 text-zinc-600">240מ להמשך</div> {/* i18n-ignore mockup sample */}
          </div>
          <div className="m-4 mt-3 rounded-xl border border-orange-200 bg-white p-3">
            <div className="text-[11px] font-semibold text-zinc-800">📷 תמונה בשער יפו</div> {/* i18n-ignore mockup sample */}
            <div className="text-[10px] text-zinc-500 mt-0.5">צלמו את כל הקבוצה מתחת לקשת.</div> {/* i18n-ignore mockup sample */}
            <div className="mt-2 h-6 rounded-lg bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">שלח תמונה</div> {/* i18n-ignore mockup sample */}
          </div>
          <div className="mx-4 mb-4 rounded-xl bg-white border border-zinc-200 p-2.5">
            <div className="text-[10px] font-semibold text-zinc-700 mb-1.5">🏆 לוח תוצאות</div> {/* i18n-ignore mockup sample */}
            {board.map((r) => (
              <div key={r.rank} className={`flex items-center justify-between text-[10px] py-0.5 ${r.me ? 'text-orange-600 font-bold' : 'text-zinc-500'}`}>
                <span className="truncate"><span className="font-mono me-1.5">{r.rank}</span>{r.name}</span>
                <span className="font-mono">{r.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AuthProvider;
