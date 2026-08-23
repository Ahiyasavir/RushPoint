import { useEffect, useId, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { FIRESTORE_PATHS, resolveDisplayName, resolveRegistrationFields, validateRequiredFields, type PublicGame, type RegistrationField } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { DEMO_GAME_ID } from '../lib/demoEntry';
import { getJoinInfo, joinRun, joinTeamAsDevice, type JoinInfo } from '../services/calls';
import { saveSession, loadSound, saveSound, type Session } from '../store';
import { Button, Card, Input, Screen } from '../components/ui';
import { useT } from '../i18nContext';
import { unlockAudio } from '../lib/sound';
import LegalFooter from '../components/LegalFooter';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { TAP_TARGET } from '../lib/interaction';
import { normalizeJoinCodeInput, joinErrorKey } from '../lib/joinCode';
import { creatorUrl } from '../lib/creatorUrl';
import { LoadingView } from '../components/LoadingView';
import { planTestDriveAutoJoin } from '../lib/testDriveAutoJoin';

// The legal footer moved to components/LegalFooter so the Final screen can show
// the same links (a player who finishes without ever re-reading Join still needs
// a route to the privacy policy).

export default function JoinScreen({ initialCode, autoJoin, onJoined, onStaff, onDemo }: {
  /**
   * The access code carried by the link, already resolved by lib/playRoute.ts.
   * The URL is parsed in exactly ONE place now: a screen re-reading
   * `window.location` is how a stale session ended up beating the link code.
   */
  initialCode?: string | null;
  /**
   * The link asked us to join without showing the form — the creator's own
   * rehearsal (`?code=X&testdrive`, change: test-drive-straight-to-play). Only a
   * REQUEST: `planTestDriveAutoJoin` still refuses unless the SERVER says this
   * code belongs to a test-drive run, so this can never skip a real
   * participant's registration.
   */
  autoJoin?: boolean;
  onJoined: (s: Session) => void;
  onStaff?: () => void;
  /**
   * Open the flagship instant-play demo (change: cold-launch-demo-entry). Passed
   * by App.tsx ONLY for a bare cold launch — no code in the URL and no stored
   * session — so a participant with a real link never sees it. Undefined means
   * "not that situation", and this screen renders exactly as it always has.
   */
  onDemo?: () => void;
}) {
  const { t, toggleLang, lang, colorblind, setColorblind } = useT();
  // Snapshot at mount, not at module-parse time (P9).
  const [linkCode] = useState<string>(() => normalizeJoinCodeInput(initialCode));
  const [code, setCode] = useState(linkCode);
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<string[]>(['']);
  const [err, setErr] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());
  // Shared team devices: team-mode games offer "my team is already in" — this
  // phone attaches to an existing team via its device join code.
  const [joinMode, setJoinMode] = useState<'create' | 'attach'>('create');
  const [teamCode, setTeamCode] = useState('');
  const [memberName, setMemberName] = useState('');
  // Auto-focus the code field and animate/focus a newly-added member row.
  const codeRef = useRef<HTMLInputElement>(null);
  // Ties the visible Hebrew label to the code field. Declared with the other
  // hooks at the top of the component — NOT beside its use below the `if (!info)`
  // early return, which is exactly the hooks-order mistake that crashed
  // TaskRunner in production (see CLAUDE.md, react-hooks/rules-of-hooks).
  const codeInputId = useId();
  const memberRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [justAdded, setJustAdded] = useState<number | null>(null);
  // Sound/haptic feedback preference (change: audio-haptic-feedback). Persisted in
  // the store; `feedback()` reads it live, so this state only drives the toggle UI.
  const [sound, setSound] = useState<boolean>(() => loadSound());
  function toggleSound() {
    const next = !sound;
    setSound(next);
    saveSound(next);
    if (next) unlockAudio(); // turning it on is a gesture — unlock so cues are audible
  }

  // Is the flagship demo actually there? (change: cold-launch-demo-entry)
  //
  // The demo button must never lead to a dead end: a backend with no demo seeded
  // would otherwise answer a first-ever tap with a "game not found" card, which is
  // worse than the code gate this change removes. So we PROBE the world-readable
  // `publicGames/{id}` doc — public read, no callable, no auth requirement beyond
  // the anonymous session App already established — and render the button only
  // once the game is confirmed present AND instant-play eligible (without
  // `allowInstantPlay` the promo screen has no "Play now" and the trip is
  // pointless). Any failure — offline, rules, missing doc — simply leaves the
  // button hidden and the join screen byte-identical to today.
  const [demoReady, setDemoReady] = useState(false);
  useEffect(() => {
    if (!onDemo) return;
    let alive = true;
    getDoc(doc(db, FIRESTORE_PATHS.publicGame(DEMO_GAME_ID)))
      .then((snap) => {
        if (!alive) return;
        const g = snap.exists() ? (snap.data() as PublicGame) : null;
        setDemoReady(!!g && g.allowInstantPlay === true);
      })
      .catch(() => { /* no demo offer; the join screen is unchanged */ });
    return () => { alive = false; };
  }, [onDemo]);

  useEffect(() => {
    if (linkCode.length >= 4) void lookup();
    // Only grab focus on the code step (no deep link took us to registration).
    else codeRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus the freshly-added member input so it's obvious which field is new.
  useEffect(() => {
    if (justAdded == null) return;
    memberRefs.current[justAdded]?.focus({ preventScroll: true });
  }, [justAdded]);

  function addMember() {
    setJustAdded(members.length);
    setMembers([...members, '']);
  }

  // Map a callable failure to ONE localized, actionable sentence (change:
  // join-flow-resilience). The decision is the pure `joinErrorKey`; this is only
  // the copy table. A raw server message must never reach a participant: the
  // finished-run and revoked-code throws carry English prose written for the
  // host, and this screen is Hebrew by default.
  function joinError(e: unknown): string {
    switch (joinErrorKey(e)) {
      case 'invalidCode': return t.join.invalidCode;
      case 'revoked': return t.join.codeRevoked;
      case 'finished': return t.join.finished;
      case 'full': return t.join.gameFull;
      case 'connection': return t.join.connectionError;
      default: return t.join.joinFailed;
    }
  }

  async function lookup() {
    unlockAudio(); // first user gesture — satisfy the iOS/Safari autoplay policy
    setErr('');
    try {
      const i = await getJoinInfo({ code: normalizeJoinCodeInput(code) });
      if (i.runStatus === 'finished') { setErr(t.join.finished); return; }
      setInfo(i);
    } catch (e) {
      setErr(joinError(e));
    }
  }

  async function submit() {
    if (!info) return;
    setErr('');
    // Validate required registration fields client-side so participants see
    // exactly which fields to fill instead of waiting for a cold server error.
    const allFields = resolveRegistrationFields(info.mode, info.registrationFields);
    // The member 'name' field is collected via the members list (memberNames),
    // NOT `values` — so validate the remaining custom fields against `values`,
    // and require at least one non-empty member name separately. (Validating
    // 'name' against `values` here used to block every join: the name lives in
    // `members`, so values['name'] was always empty.)
    const memberNames = members.map((m) => m.trim()).filter(Boolean);
    const errors = validateRequiredFields(allFields.filter((f) => f.id !== 'name'), values);
    // Team mode: each team must pick its own name (no defaulting to the first member).
    if (info.mode === 'team' && !(values.teamName ?? '').trim()) { errors.add('teamName'); }
    if (memberNames.length === 0) return; // guarded by the disabled Join button
    if (errors.size > 0) { setFieldErrors(errors); return; }
    setFieldErrors(new Set());
    await sendJoin(info, values, memberNames);
  }

  // The one place that actually joins. Shared by the form path above and the
  // rehearsal auto-join below so the two can never drift on what a Session holds
  // (notably `isTestDrive`, which every test-drive affordance downstream reads).
  async function sendJoin(
    j: JoinInfo,
    registrationData: Record<string, string>,
    memberNames: string[],
  ): Promise<void> {
    try {
      const displayName = resolveDisplayName(j.mode, registrationData, memberNames);
      const canonicalCode = normalizeJoinCodeInput(code);
      const res = await joinRun({ code: canonicalCode, displayName, registrationData, memberNames });
      const session: Session = {
        ownerUid: res.ownerUid, gameId: res.gameId, runId: res.runId,
        code: canonicalCode, displayName,
        teamId: res.teamId,
        isTestDrive: j.isTestDrive ?? false,
      };
      saveSession(session);
      onJoined(session);
    } catch (e) {
      setErr(joinError(e));
    }
  }

  // Attach this phone to a team that already joined (shared-team-devices).
  async function attach() {
    if (!info) return;
    setErr('');
    const canonicalCode = normalizeJoinCodeInput(code);
    try {
      const res = await joinTeamAsDevice({
        code: canonicalCode,
        teamCode: normalizeJoinCodeInput(teamCode),
        memberName: memberName.trim() || undefined,
      });
      const session: Session = {
        ownerUid: res.ownerUid, gameId: res.gameId, runId: res.runId,
        code: canonicalCode, displayName: memberName.trim(),
        teamId: res.teamId,
        isTestDrive: info.isTestDrive ?? false,
      };
      saveSession(session);
      onJoined(session);
    } catch (e) {
      // A network blip here used to read as a wrong team code. Everything else
      // keeps the attach-specific copy, which already says what to check.
      setErr(joinErrorKey(e) === 'connection' ? t.join.connectionError : t.devices.attachFailed);
    }
  }

  // In-flight guards (change: wave-b/async-action-guard). The old shared `busy`
  // useState could not stop a second tap landing in the same React batch — a real
  // risk here, since a double-tapped Join would fire joinRun twice and could
  // register the same phone as two teams.
  const lookupAction = useAsyncAction(lookup);
  const submitAction = useAsyncAction(submit);
  const attachAction = useAsyncAction(attach);
  const autoJoinAction = useAsyncAction(sendJoin);
  const busy = lookupAction.busy || submitAction.busy || attachAction.busy || autoJoinAction.busy;

  // ── Rehearsal auto-join (change: test-drive-straight-to-play) ───────────────
  // "בדיקה" in the builder opens this screen on the test run's own code with
  // `?testdrive`. The creator is looking at THEIR OWN game, so making them type a
  // name into a registration form first is pure friction — that form is for
  // participants. Once the lookup returns we join on their behalf and PlayScreen
  // takes over, which is the whole point: they see exactly what a player sees.
  //
  // Three things keep this from becoming a way around registration:
  //   * the planner refuses unless the SERVER reported this code as a test drive;
  //   * it refuses whenever the game has a required field a human must type;
  //   * `attempted` makes it fire at most once per mount, so a failed join lands
  //     on the ordinary form with its ordinary error instead of retry-looping.
  const attempted = useRef(false);
  // Mirrors `attempted` into render: while this is true the screen shows a short
  // "opening your game" state instead of flashing the registration form the
  // creator is never going to fill in.
  const [autoJoining, setAutoJoining] = useState(false);
  useEffect(() => {
    if (!info || attempted.current) return;
    const plan = planTestDriveAutoJoin({
      requested: !!autoJoin,
      isTestDrive: info.isTestDrive ?? false,
      runStatus: info.runStatus,
      mode: info.mode,
      registrationFields: info.registrationFields,
      playerName: t.join.testDrivePlayerName,
    });
    if (plan.kind !== 'join') return;
    attempted.current = true;
    setAutoJoining(true);
    // On success `onJoined` unmounts this screen; on failure `sendJoin` has
    // already set the error, so drop back to the normal form to show it.
    void autoJoinAction.run(info, plan.values, plan.memberNames)
      .finally(() => setAutoJoining(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, autoJoin]);

  // ── Rehearsal: joining on the creator's behalf ─────────────────────────────
  // Placed AHEAD of both step renders so neither the code field nor the
  // registration form flashes on the way into the game. `autoJoining` is false
  // again the moment the join settles, so a failure falls straight through to the
  // ordinary screens below with `err` already set.
  if (autoJoining) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <LoadingView messages={[t.join.testDriveEntering]} />
      </div>
    );
  }

  // ── Step 1: enter access code ──────────────────────────────────────────────
  if (!info) {
    return (
      <div className="min-h-screen flex flex-col max-w-md mx-auto w-full animate-race-in">

        {/* Full-bleed gradient hero */}
        {/* Tightened from pt-16/pb-12 (change: join-screen-fits-one-phone). The
            hero alone ate ~180px of vertical space, which is what pushed the
            join screen just past the fold and gave it that short, janky scroll. */}
        <div className="relative flex flex-col items-center justify-center px-6 pt-3 pb-5 text-center overflow-hidden">
          {/* Background glow */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#FFF0E0] via-[#FFFCF7] to-transparent" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-48 bg-gradient-radial from-rp-fire/20 to-transparent blur-3xl" />

          {/* Language + accessibility toggles. In NORMAL FLOW, not `absolute`:
              an absolutely-positioned cluster has no width of its own, so it
              shrink-wrapped ~170px of controls and grew inward until it sat on
              top of the centred hero icon (measured 11x20px overlap in Hebrew,
              5x20px in English — both directions, so not an RTL bug). A flex row
              cannot overlap its sibling, and it costs no extra height because
              the hero's top padding shrank by the same amount. */}
          <div className="relative w-full flex items-center justify-end gap-2 mb-1">
            <button
              onClick={toggleSound}
              role="switch"
              aria-checked={sound}
              aria-label={sound ? t.common.soundOn : t.common.soundOff}
              title={sound ? t.common.soundOn : t.common.soundOff}
              className={`text-xs font-semibold border rounded-full w-11 h-11 flex items-center justify-center transition-colors ${
                sound ? 'border-accent text-ink-fire' : 'border-glass-border text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {sound ? '🔊' : '🔇'}
            </button>
            <button
              onClick={() => setColorblind(!colorblind)}
              role="switch"
              aria-checked={colorblind}
              aria-label={t.common.colorblindMode}
              title={t.common.colorblindMode}
              className={`text-[10px] rounded-full w-11 h-11 flex items-center justify-center transition-colors opacity-60 hover:opacity-100 ${
                colorblind ? 'text-zinc-300' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              ◐
            </button>
            <button
              onClick={toggleLang}
              aria-label={t.join.langToggleAria}
              className="text-zinc-400 text-xs font-semibold border border-glass-border rounded-full inline-flex items-center justify-center min-h-[44px] px-3 hover:text-zinc-200 transition-colors"
            >
              {lang === 'he' ? 'English' : 'עברית'} {/* i18n-ignore — language switcher shows the target language in its own script */}
            </button>
          </div>

          <div className="relative">
            {/* App icon */}
            <div
              className="w-14 h-14 rounded-3xl flex items-center justify-center text-3xl mx-auto mb-3"
              style={{
                background: 'linear-gradient(135deg, #FF5722 0%, #FFB300 100%)',
                boxShadow: '0 8px 32px rgba(255,87,34,0.45), 0 2px 8px rgba(255,87,34,0.3)',
              }}
            >
              🏁
            </div>

            <h1 className="font-brand text-4xl font-extrabold tracking-tight leading-none mb-1.5"
              style={{ background: 'linear-gradient(135deg, #FF5722 0%, #FF8A00 50%, #FFB300 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              RushPoint
            </h1>
            <p className="text-zinc-500 text-sm leading-snug max-w-xs">
              {t.join.subtitle}
            </p>
          </div>

        </div>

        {/* Code input section */}
        <div className="flex-1 flex flex-col px-5 rp-safe-b">
          {/* The Hebrew hint is a real LABEL, never the placeholder: the field is
              dir="ltr" with tracking-[0.5em] so the Latin code reads as separated
              glyphs, and that same styling shredded Hebrew placeholder text into
              spaced-out, reversed-looking letters. A visible label also gives the
              field an accessible name that does not vanish once typing starts. */}
          <label htmlFor={codeInputId} className="block text-sm font-bold text-zinc-300 mb-2 text-center">
            {t.join.codeLabel}
          </label>
          <div className="relative mb-3">
            <input
              ref={codeRef}
              id={codeInputId}
              value={code}
              dir="ltr"
              onChange={(e) => setCode(normalizeJoinCodeInput(e.target.value))}
              // Decorative SLOT DOTS, never a sample code. A sample like "ABC123"
              // inherits `font-mono font-bold` from the base class and lands at
              // 4.80:1 — the exact typographic signature of a real access code, so
              // the field looked already filled on a cold landing. Dots carry no
              // language (nothing to translate, no leak), and the styling below
              // explicitly overrides weight/colour so they read as empty slots
              // waiting for input rather than as content.
              placeholder="••••••" // i18n-ignore — decorative slot marks, not copy
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              className="
                w-full px-6 py-4 rounded-2xl
                text-center text-3xl font-mono font-bold tracking-[0.5em]
                bg-white border-2 border-glass-border
                text-zinc-100
                placeholder:text-zinc-600 placeholder:font-normal
                shadow-[0_2px_16px_rgba(26,10,0,0.08)]
                focus:outline-none focus:border-rp-fire/60 focus:ring-4 focus:ring-rp-fire/15
                transition-all duration-200
              "
              // No maxLength: the browser truncates a PASTE before onChange runs,
              // so an 8-char cap turned a pasted join link into "HTTPS://". The
              // cap lives in normalizeJoinCodeInput instead.
              onKeyDown={(e) => { if (e.key === 'Enter') void lookupAction.run(); }}
            />
          </div>

          {err && (
            <p role="status" aria-live="polite" className="text-ink-alert text-sm text-center mb-4 font-medium animate-fade-up">{err}</p>
          )}

          {/* Whole groups were signing in phone-by-phone and then could not work
              out why they were separate teams (change: one-device-per-team-clarity).
              Say it BEFORE the code is entered, not in the registration step. */}
          <p className="text-[11px] text-zinc-500 text-center mb-3 leading-snug px-2">
            {t.join.oneDeviceNote}
          </p>

          <Button
            disabled={busy || code.length < 4}
            loading={lookupAction.busy}
            onClick={() => void lookupAction.run()}
            className="!py-4 !text-lg !rounded-2xl"
          >
            {busy ? t.join.lookingUp : t.join.continue}
          </Button>

          {/* The no-code way in (change: cold-launch-demo-entry). Deliberately a
              SECONDARY affordance under the primary code CTA: a real participant
              arrives with a code and must not be pulled sideways, while a Play
              Store installer with nothing to enter still has somewhere to go. */}
          {onDemo && demoReady && (
            <div className="mt-4 text-center animate-fade-up">
              <button
                type="button"
                onClick={onDemo}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-2xl border border-glass-border bg-white/70 text-sm font-bold text-ink-fire hover:bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
              >
                <span aria-hidden="true">🎭</span> {t.join.tryDemo}
              </button>
              <p className="text-[11px] text-zinc-500 mt-2 leading-snug px-4">{t.join.tryDemoSub}</p>
            </div>
          )}

          {/* Everything below the rule is NOT the player's path. Before, the
              staff link (14px, darker, emoji, own caption) read as a section
              heading and outranked both the demo and the creator link — backwards
              by audience size — and five consecutive 11px/zinc-500 paragraphs ran
              together with no separator. Now: one hairline rule marks "this is the
              other-audience shelf", both entries are the same quiet weight, and
              the more common need (build a game) comes before the rarest (staff).
              The 🔑 emoji is gone: it also marks the "join" how-to card, and these
              are precisely the two things players already confuse. */}
          <div className="mt-5 pt-3 border-t border-glass-border text-center space-y-1.5">
              <p className="text-[11px] text-zinc-500">
                {t.join.createOwnCta}{' '}
                <a
                  href={creatorUrl()}
                  className="font-bold text-ink-fire underline underline-offset-2 hover:opacity-80"
                >
                  {t.join.createOwnLink}
                </a>
              </p>
              {onStaff && (
                <p className="text-[11px] text-zinc-500">
                  {/* Visually 11px to stay quiet, but a REAL 44px tap target:
                      organizers hit this outdoors, one-handed. Styling it down
                      to inline text shrank it to 17px. */}
                  <button
                    className="inline-flex items-center justify-center min-h-[44px] px-3 font-bold text-zinc-400 underline underline-offset-2 hover:text-zinc-300 transition-colors"
                    onClick={onStaff}
                  >
                    {t.join.staff}
                  </button>
                </p>
              )}
          </div>

          {/* How it works — a FIXED gap, not `mt-auto`. Pushing this to the bottom
              of a min-h-screen box left 103px of dead space on a Pixel 7 and 0px on
              an iPhone SE: the same screen with two different rhythms. */}
          <div className="mt-6">
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { icon: '🔑', label: t.join.how1Label, sub: t.join.how1Sub },
                { icon: '🧭', label: t.join.how2Label, sub: t.join.how2Sub },
                { icon: '🏆', label: t.join.how3Label, sub: t.join.how3Sub },
              ].map((s, i) => (
                <div
                  key={s.label}
                  className="rounded-2xl bg-white/70 border border-glass-border px-2 py-2 text-center shadow-[0_1px_4px_rgba(26,10,0,0.05)] animate-fade-up"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="text-xl mb-1">{s.icon}</div>
                  <div className="text-[13px] font-bold text-zinc-200">{s.label}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 leading-tight">{s.sub}</div>
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-zinc-500 mt-2 flex items-center justify-center gap-1.5">
              <span className="text-ink-go">●</span> {t.join.noAccountNeeded}
            </p>
            <LegalFooter />
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2: registration form ──────────────────────────────────────────────
  const accent = info.branding?.primaryColor ?? '#FF5722';
  const isSolo = info.mode !== 'team';
  // Solo play = one entity, so collapse to a single name field (change:
  // solo-mode-registration). Team mode is returned unchanged.
  const fields = resolveRegistrationFields(info.mode, info.registrationFields);
  const teamFields = fields.filter((f) => f.level === 'team');
  const memberFields = fields.filter((f) => f.level === 'member');
  const description = (info.description ?? '').trim();

  return (
    <Screen>
      {/* Game hero */}
      <div className="mb-7 animate-race-in">
        <div
          className="h-1 w-12 rounded-full mb-4 shadow-stage-badge"
          style={{ background: `linear-gradient(90deg, ${accent}, ${accent}80)` }}
        />
        <h1 dir="auto" className="font-brand text-3xl font-extrabold tracking-tight leading-snug" style={{ color: accent }}>
          {info.branding?.name ?? info.title}
        </h1>
        {/* Real description, or a neutral non-demo empty state (change:
            fix-live-launch-demo-text). Never demo placeholder copy. */}
        <p dir="auto" className="text-zinc-400 text-sm mt-2 leading-relaxed">
          {description || t.promo.noDescription}
        </p>
        {info.requirement && (
          <div className="inline-flex items-center text-xs font-medium text-zinc-500 bg-app-card border border-glass-border rounded-full px-3 py-1 mt-3">
            {info.requirement === 'gps' ? t.promo.reqGps : t.promo.reqAnywhere}
          </div>
        )}
      </div>

      {/* Team-mode leads with creating a fresh team; attaching this phone to a
          team that's already in (shared-team-devices) is a demoted secondary
          link below the primary action. */}
      {!isSolo && joinMode === 'attach' ? (
        <>
          <div className="space-y-4 flex-1">
            <Card className="p-5">
              <p className="text-sm text-zinc-400 mb-4 leading-relaxed">{t.devices.attachExplain}</p>
              <Input
                value={teamCode}
                dir="ltr"
                onChange={(e) => setTeamCode(e.target.value.toUpperCase())}
                placeholder={t.devices.teamCodePlaceholder}
                className="text-center font-mono text-xl tracking-[0.4em] mb-3"
                maxLength={6}
              />
              <Input
                value={memberName}
                dir="auto"
                onChange={(e) => setMemberName(e.target.value)}
                placeholder={t.devices.memberNamePlaceholder}
              />
            </Card>
          </div>
          {err && <p role="status" aria-live="polite" className="text-ink-alert text-sm text-center my-3 font-medium animate-fade-up">{err}</p>}
          <Button
            disabled={busy || teamCode.trim().length < 6}
            loading={attachAction.busy}
            onClick={() => void attachAction.run()}
            className="mt-5 !py-4 !text-lg !rounded-2xl"
          >
            {busy ? t.devices.attaching : t.devices.attachCta}
          </Button>
          <button
            type="button"
            onClick={() => { setJoinMode('create'); setErr(''); }}
            className="mx-auto mt-4 block min-h-[44px] px-2 text-sm font-semibold text-ink-fire underline-offset-2"
          >
            {t.devices.joinModeCreate}
          </button>
        </>
      ) : (
      <>
      <div className="space-y-4 flex-1">
        {teamFields.map((f) => (
          <FieldInput key={f.id} field={f} value={values[f.id] ?? ''} onChange={(v) => setValues({ ...values, [f.id]: v })} hasError={fieldErrors.has(f.id)} />
        ))}

        {/* Team mode: each team picks its own name instead of defaulting to the
            first member's name. Skipped if the creator already added a custom
            teamName registration field (rendered above via teamFields). */}
        {!isSolo && !teamFields.some((f) => f.id === 'teamName') && (
          <Card className="p-5">
            <div className="text-sm font-bold text-zinc-200 mb-4 flex items-center gap-2">
              <span>🏷️</span>
              {t.join.teamName} *
            </div>
            <Input
              value={values.teamName ?? ''}
              dir="auto"
              placeholder={t.join.teamNamePlaceholder}
              data-testid="join-team-name"
              className={fieldErrors.has('teamName') ? 'border-rp-alert' : ''}
              onChange={(e) => setValues({ ...values, teamName: e.target.value })}
            />
          </Card>
        )}

        <Card className="p-5">
          <div className="text-sm font-bold text-zinc-200 mb-4 flex items-center gap-2">
            <span>{isSolo ? '👤' : '👥'}</span>
            {isSolo ? t.join.yourName : t.join.teamMembers} *
          </div>
          {isSolo ? (
            // Solo: exactly one name input. No member list, no add-member.
            <Input value={members[0] ?? ''} placeholder={t.join.yourName} data-testid="join-name"
              onChange={(e) => setMembers([e.target.value])} />
          ) : (
            <>
              {members.map((m, i) => (
                <div key={i} className={`flex gap-2 mb-2.5 ${i === justAdded ? 'animate-task-appear motion-reduce:animate-none' : ''}`}>
                  <Input
                    ref={(el: HTMLInputElement | null) => { memberRefs.current[i] = el; }}
                    value={m} placeholder={t.join.memberPlaceholder(i + 1)}
                    data-testid="join-member"
                    onChange={(e) => setMembers(members.map((x, j) => (j === i ? e.target.value : x)))} />
                  {members.length > 1 && (
                    <button aria-label={t.join.removeMember(m)} className={`${TAP_TARGET} shrink-0 flex items-center justify-center text-ink-alert font-bold`} onClick={() => setMembers(members.filter((_, j) => j !== i))}>✕</button>
                  )}
                </div>
              ))}
              <button className="text-ink-fire text-sm mt-1 font-bold inline-flex items-center gap-1 min-h-[44px] px-2 -ms-2" onClick={addMember}>
                ＋ {t.join.addMember}
              </button>
            </>
          )}
          {memberFields.filter((f) => f.id !== 'name').map((f) => (
            <div key={f.id} className="mt-4">
              <FieldInput field={f} value={values[f.id] ?? ''} onChange={(v) => setValues({ ...values, [f.id]: v })} hasError={fieldErrors.has(f.id)} />
            </div>
          ))}
        </Card>
      </div>

      {err && <p role="status" aria-live="polite" className="text-ink-alert text-sm text-center my-3 font-medium animate-fade-up">{err}</p>}

      <Button
        disabled={busy || !members.some((m) => m.trim()) || (!isSolo && !(values.teamName ?? '').trim())}
        loading={submitAction.busy}
        onClick={() => void submitAction.run()}
        data-testid="join-submit"
        className="mt-5 !py-4 !text-lg !rounded-2xl"
      >
        {busy ? t.join.joining : t.join.joinCta}
      </Button>
      {!isSolo && (
        <button
          type="button"
          onClick={() => { setJoinMode('attach'); setErr(''); }}
          className="mx-auto mt-4 block min-h-[44px] px-2 text-sm font-semibold text-ink-fire underline-offset-2"
        >
          {t.devices.joinModeAttach}
        </button>
      )}
      </>
      )}
      {/* Also on the registration step: a deep link with a code skips step 1
          entirely, so this is the only legal surface those players ever see. */}
      <LegalFooter />
    </Screen>
  );
}

function FieldInput({ field, value, onChange, hasError }: { field: RegistrationField; value: string; onChange: (v: string) => void; hasError?: boolean }) {
  const errRing = hasError ? ' border-rp-alert' : '';
  // The visible <label> was never associated with its control (change:
  // play-web-accessibility): a screen reader fell back to the placeholder, and
  // tapping the label did nothing, throwing away a free second tap target on a
  // form filled one handed outdoors.
  const id = useId();
  if (field.type === 'checkbox') {
    return (
      <label className={`flex items-center gap-3 text-sm text-zinc-300 bg-white border border-glass-border rounded-xl px-4 py-3${errRing}`}>
        <input type="checkbox" checked={value === 'true'} onChange={(e) => onChange(String(e.target.checked))} className="w-4 h-4" />
        {field.label}{field.required && ' *'}
      </label>
    );
  }
  if (field.type === 'select') {
    return (
      <div>
        <label htmlFor={id} className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">{field.label}{field.required && ' *'}</label>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
          className={`w-full px-4 py-4 rounded-2xl bg-white border border-glass-border text-zinc-100 focus:outline-none focus:border-rp-fire/40${errRing}`}>
          <option value="">…</option>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">{field.label}{field.required && ' *'}</label>
      <Input
        id={id}
        type={field.type === 'number' ? 'number' : field.type === 'phone' ? 'tel' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.label}
        className={hasError ? 'border-rp-alert' : undefined}
      />
    </div>
  );
}
