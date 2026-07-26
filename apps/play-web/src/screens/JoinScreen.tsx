import { useEffect, useId, useRef, useState } from 'react';
import { resolveDisplayName, resolveRegistrationFields, validateRequiredFields, type RegistrationField } from '@rushpoint/shared';
import { getJoinInfo, joinRun, joinTeamAsDevice, type JoinInfo } from '../services/calls';
import { saveSession, loadSound, saveSound, type Session } from '../store';
import { Button, Card, Input, Screen } from '../components/ui';
import { useT } from '../i18nContext';
import { unlockAudio } from '../lib/sound';
import LegalFooter from '../components/LegalFooter';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { TAP_TARGET } from '../lib/interaction';
import { normalizeJoinCodeInput, joinErrorKey } from '../lib/joinCode';

// The legal footer moved to components/LegalFooter so the Final screen can show
// the same links (a player who finishes without ever re-reading Join still needs
// a route to the privacy policy).

export default function JoinScreen({ initialCode, onJoined, onStaff }: {
  /**
   * The access code carried by the link, already resolved by lib/playRoute.ts.
   * The URL is parsed in exactly ONE place now: a screen re-reading
   * `window.location` is how a stale session ended up beating the link code.
   */
  initialCode?: string | null;
  onJoined: (s: Session) => void;
  onStaff?: () => void;
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
    try {
      const displayName = resolveDisplayName(info.mode, values, memberNames);
      const canonicalCode = normalizeJoinCodeInput(code);
      const res = await joinRun({ code: canonicalCode, displayName, registrationData: values, memberNames });
      const session: Session = {
        ownerUid: res.ownerUid, gameId: res.gameId, runId: res.runId,
        code: canonicalCode, displayName,
        teamId: res.teamId,
        isTestDrive: info.isTestDrive ?? false,
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
  const busy = lookupAction.busy || submitAction.busy || attachAction.busy;

  // ── Step 1: enter access code ──────────────────────────────────────────────
  if (!info) {
    return (
      <div className="min-h-screen flex flex-col max-w-md mx-auto w-full animate-race-in">

        {/* Full-bleed gradient hero */}
        <div className="relative flex flex-col items-center justify-center px-6 pt-16 pb-12 text-center overflow-hidden">
          {/* Background glow */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#FFF0E0] via-[#FFFCF7] to-transparent" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-48 bg-gradient-radial from-rp-fire/20 to-transparent blur-3xl" />

          <div className="relative">
            {/* App icon */}
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mx-auto mb-6"
              style={{
                background: 'linear-gradient(135deg, #FF5722 0%, #FFB300 100%)',
                boxShadow: '0 8px 32px rgba(255,87,34,0.45), 0 2px 8px rgba(255,87,34,0.3)',
              }}
            >
              🏁
            </div>

            <h1 className="font-brand text-5xl font-extrabold tracking-tight leading-none mb-3"
              style={{ background: 'linear-gradient(135deg, #FF5722 0%, #FF8A00 50%, #FFB300 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              RushPoint
            </h1>
            <p className="text-zinc-500 text-base leading-relaxed max-w-xs">
              {t.join.subtitle}
            </p>
          </div>

          {/* Language + accessibility toggles */}
          <div className="absolute top-4 end-4 flex items-center gap-2">
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
        </div>

        {/* Code input section */}
        <div className="flex-1 flex flex-col px-5 rp-safe-b">
          <div className="relative mb-4">
            <input
              ref={codeRef}
              value={code}
              dir="ltr"
              onChange={(e) => setCode(normalizeJoinCodeInput(e.target.value))}
              placeholder={t.join.codePlaceholder}
              aria-label={t.join.codePlaceholder}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              className="
                w-full px-6 py-5 rounded-2xl
                text-center text-3xl font-mono font-bold tracking-[0.5em]
                bg-white border-2 border-glass-border
                text-zinc-100 placeholder:text-zinc-500
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

          <Button
            disabled={busy || code.length < 4}
            loading={lookupAction.busy}
            onClick={() => void lookupAction.run()}
            className="!py-4 !text-lg !rounded-2xl"
          >
            {busy ? t.join.lookingUp : t.join.continue}
          </Button>

          {onStaff && (
            <button
              className="text-zinc-400 text-sm mt-5 mx-auto inline-flex items-center justify-center min-h-[44px] px-3 font-medium hover:text-zinc-300 transition-colors"
              onClick={onStaff}
            >
              {t.join.staff}
            </button>
          )}

          {/* How it works — fills the lower screen + sets expectations */}
          <div className="mt-auto pt-10">
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { icon: '🔑', label: t.join.how1Label, sub: t.join.how1Sub },
                { icon: '🧭', label: t.join.how2Label, sub: t.join.how2Sub },
                { icon: '🏆', label: t.join.how3Label, sub: t.join.how3Sub },
              ].map((s, i) => (
                <div
                  key={s.label}
                  className="rounded-2xl bg-white/70 border border-glass-border px-2 py-3.5 text-center shadow-[0_1px_4px_rgba(26,10,0,0.05)] animate-fade-up"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="text-xl mb-1">{s.icon}</div>
                  <div className="text-[13px] font-bold text-zinc-200">{s.label}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 leading-tight">{s.sub}</div>
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-zinc-500 mt-5 flex items-center justify-center gap-1.5">
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
