// The SOS sheet (change: sos-callback-and-authorities).
//
// Ahiya, 2026-10-05: SOS should not only send people to Magen David Adom. "A button to contact the
// authorities, and then it gives them all the options", and the alert should ask for a phone number
// of one of the team so the organizers can call back.
//
// Two jobs, in the order that matters:
//   1. The authorities. Real `tel:` links (EMERGENCY_SERVICES), so the phone dials even if this
//      app's JS is stuck, and the sheet stays open so the organizer alert can still be sent.
//   2. The organizer alert, with a callback number. An empty number never blocks sending: in an
//      emergency an alert without a number beats no alert. A number that cannot be dialled is
//      pointed out instead of sent (sosCallbackVerdict, the same rule the server applies).
//
// Rendered through a portal: PlayScreen has several screens that carry an SOS button.
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EMERGENCY_SERVICES, sosCallbackVerdict } from '@rushpoint/shared';
import { Button, Card, Input } from './ui';
import { Icon } from './Icon';
import { useT } from '../i18nContext';

/** The number is remembered per run on this phone, so a second SOS does not ask again. */
const phoneKey = (runId: string) => `rp-sos-phone:${runId}`;
function readPhone(runId: string): string {
  try { return localStorage.getItem(phoneKey(runId)) ?? ''; } catch { return ''; }
}
function writePhone(runId: string, phone: string): void {
  try { if (phone) localStorage.setItem(phoneKey(runId), phone); } catch { /* storage off */ }
}

type Phase = 'compose' | 'sending' | 'sent' | 'failed';

export default function SosSheet({ runId, onSend, onClose }: {
  runId: string;
  /** Sends the alert; resolves on success, rejects on failure. */
  onSend: (callbackPhone: string | undefined) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useT();
  const p = t.play;
  const [phone, setPhone] = useState(() => readPhone(runId));
  const [phoneErr, setPhoneErr] = useState(false);
  const [showServices, setShowServices] = useState(false);
  const [phase, setPhase] = useState<Phase>('compose');
  const [sentPhone, setSentPhone] = useState<string | undefined>(undefined);
  const titleId = useId();
  const firstRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstRef.current?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); restore?.focus(); };
  }, [onClose]);

  async function send() {
    if (phase === 'sending') return;
    const v = sosCallbackVerdict(phone);
    if (!v.ok) { setPhoneErr(true); return; }
    setPhoneErr(false);
    setPhase('sending');
    try {
      await onSend(v.phone);
      if (v.phone) writePhone(runId, v.phone);
      setSentPhone(v.phone);
      setPhase('sent');
    } catch {
      setPhase('failed');
    }
  }

  const services = (
    <div className="space-y-2">
      <button ref={firstRef} type="button" aria-expanded={showServices} onClick={() => setShowServices((s) => !s)}
        data-testid="sos-authorities"
        className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl border-[3px] border-ink-alert bg-white px-5 text-base font-extrabold text-ink-alert active:scale-[0.98] transition-transform">
        <Icon name="phone" className="w-5 h-5" /> {p.sosAuthorities}
      </button>
      {showServices && (
        <ul className="space-y-2" data-testid="sos-services">
          {EMERGENCY_SERVICES.map((s) => (
            <li key={s.id}>
              <a href={`tel:${s.number}`} data-testid={`sos-call-${s.id}`} aria-label={`${p.sosServices[s.id]} ${s.number}`}
                className="flex w-full min-h-[52px] items-center justify-between gap-3 rounded-xl bg-ink-alert px-4 text-base font-bold text-white active:scale-[0.98] transition-transform">
                <span>{p.sosServices[s.id]}</span>
                <span dir="ltr" className="font-mono text-lg">{s.number}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <Card role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full max-w-md p-5 space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <h2 id={titleId} className="text-xl font-extrabold text-ink-alert text-center">{p.sosTitle}</h2>
        {phase === 'sent' ? (
          <p role="status" className="text-base text-zinc-100 whitespace-pre-line text-center">
            {sentPhone ? p.sosSentWithPhone({ phone: sentPhone }) : p.sosSent}
          </p>
        ) : (
          <p className="text-sm text-zinc-300 whitespace-pre-line text-center">{phase === 'failed' ? p.sosFailed : p.sosIntro}</p>
        )}

        {services}

        {phase !== 'sent' && (
          <div className="space-y-2 border-t border-glass-border pt-4">
            <label className="block text-sm font-semibold text-zinc-100" htmlFor={`${titleId}-phone`}>{p.sosCallbackLabel}</label>
            <Input id={`${titleId}-phone`} type="tel" inputMode="tel" autoComplete="tel" dir="ltr"
              value={phone} placeholder="0501234567"
              aria-invalid={phoneErr || undefined}
              onChange={(e) => { setPhone(e.target.value); if (phoneErr) setPhoneErr(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} />
            {phoneErr
              ? <p role="alert" className="text-sm text-danger">{p.sosCallbackInvalid}</p>
              : <p className="text-[13px] text-zinc-400">{p.sosCallbackHint}</p>}
            <Button variant="danger" loading={phase === 'sending'} onClick={() => void send()} data-testid="sos-send">
              {phase === 'failed' ? p.sosRetry : p.sosSend}
            </Button>
          </div>
        )}
        <Button variant="ghost" onClick={onClose}>{phase === 'sent' ? t.common.ok : t.common.cancel}</Button>
      </Card>
    </div>,
    document.body,
  );
}
