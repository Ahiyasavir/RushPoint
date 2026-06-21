import { useState } from 'react';
import type { RegistrationField } from '@rushpoint/shared';
import { getJoinInfo, joinRun, type JoinInfo } from '../services/calls';
import { saveSession, type Session } from '../store';
import { Button, Card, Input, Screen } from '../components/ui';

export default function JoinScreen({ onJoined, onStaff }: { onJoined: (s: Session) => void; onStaff?: () => void }) {
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<string[]>(['']);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function lookup() {
    setErr(''); setBusy(true);
    try {
      const i = await getJoinInfo({ code: code.trim().toUpperCase() });
      setInfo(i);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace('Firebase: ', '') : 'Invalid code');
    } finally { setBusy(false); }
  }

  async function submit() {
    if (!info) return;
    setErr(''); setBusy(true);
    try {
      // First member name is the team display name fallback
      const memberNames = members.map((m) => m.trim()).filter(Boolean);
      const displayName = (values['teamName'] || memberNames[0] || 'Team').toString();
      const res = await joinRun({
        code: code.trim().toUpperCase(),
        displayName,
        registrationData: values,
        memberNames,
      });
      const session: Session = {
        ownerUid: res.ownerUid, gameId: res.gameId, runId: res.runId,
        code: code.trim().toUpperCase(), displayName,
      };
      saveSession(session);
      onJoined(session);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace('Firebase: ', '') : 'Join failed');
    } finally { setBusy(false); }
  }

  // ── Step 1: enter code ──
  if (!info) {
    return (
      <Screen>
        <div className="flex-1 flex flex-col justify-center">
          <h1 className="font-brand text-3xl font-extrabold text-accent text-center mb-2">RushPoint</h1>
          <p className="text-zinc-500 text-center mb-8">Enter the access code from your host</p>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            className="text-center text-2xl font-mono tracking-[0.4em] mb-4"
            maxLength={8}
            onKeyDown={(e) => e.key === 'Enter' && lookup()}
          />
          {err && <p className="text-danger text-sm text-center mb-3">{err}</p>}
          <Button disabled={busy || code.length < 4} onClick={lookup}>Continue</Button>
          {onStaff && (
            <button className="text-zinc-500 text-sm mt-6 mx-auto" onClick={onStaff}>
              I'm staff →
            </button>
          )}
        </div>
      </Screen>
    );
  }

  // ── Step 2: registration form ──
  const teamFields = info.registrationFields.filter((f) => f.level === 'team');
  const memberFields = info.registrationFields.filter((f) => f.level === 'member');

  return (
    <Screen>
      <div className="mb-6">
        <h1 className="font-brand text-2xl font-extrabold" style={{ color: info.branding?.primaryColor ?? '#F97316' }}>
          {info.branding?.name ?? info.title}
        </h1>
        {info.description && <p className="text-zinc-500 text-sm mt-1">{info.description}</p>}
      </div>

      <div className="space-y-4 flex-1">
        {teamFields.map((f) => (
          <FieldInput key={f.id} field={f} value={values[f.id] ?? ''} onChange={(v) => setValues({ ...values, [f.id]: v })} />
        ))}

        <Card className="p-4">
          <div className="text-sm font-medium text-zinc-300 mb-3">
            {info.mode === 'team' ? 'Team members' : 'Your name'}
          </div>
          {members.map((m, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <Input value={m} placeholder={`Member ${i + 1}`}
                onChange={(e) => setMembers(members.map((x, j) => (j === i ? e.target.value : x)))} />
              {members.length > 1 && (
                <button className="px-3 text-danger" onClick={() => setMembers(members.filter((_, j) => j !== i))}>✕</button>
              )}
            </div>
          ))}
          {info.mode === 'team' && (
            <button className="text-accent text-sm mt-1" onClick={() => setMembers([...members, ''])}>+ Add member</button>
          )}
          {memberFields.filter((f) => f.id !== 'name').map((f) => (
            <div key={f.id} className="mt-3">
              <FieldInput field={f} value={values[f.id] ?? ''} onChange={(v) => setValues({ ...values, [f.id]: v })} />
            </div>
          ))}
        </Card>
      </div>

      {err && <p className="text-danger text-sm text-center my-3">{err}</p>}
      <Button disabled={busy || !members.some((m) => m.trim())} onClick={submit} className="mt-4">
        Join the race
      </Button>
    </Screen>
  );
}

function FieldInput({ field, value, onChange }: { field: RegistrationField; value: string; onChange: (v: string) => void }) {
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={value === 'true'} onChange={(e) => onChange(String(e.target.checked))} />
        {field.label}{field.required && ' *'}
      </label>
    );
  }
  if (field.type === 'select') {
    return (
      <div>
        <label className="block text-xs text-zinc-500 mb-1">{field.label}{field.required && ' *'}</label>
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3.5 rounded-xl bg-app-card border border-glass-border text-zinc-100">
          <option value="">—</option>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div>
      <label className="block text-xs text-zinc-500 mb-1">{field.label}{field.required && ' *'}</label>
      <Input
        type={field.type === 'number' ? 'number' : field.type === 'phone' ? 'tel' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.label}
      />
    </div>
  );
}
