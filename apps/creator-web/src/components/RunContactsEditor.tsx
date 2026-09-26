import { useEffect, useState } from 'react';
import { MAX_RUN_CONTACTS, normalizePhone, type RunContact } from '@rushpoint/shared';
import { useT } from './LanguageContext';
import { Button } from './ui';
import { setRunContacts } from '../services/calls';
import { toast } from './toast';

// Tonight's phone numbers (change: quick-dial-and-actions, D2). Players see the ones marked
// "players" as a "call" button next to SOS; staff see theirs in the staff app. The server
// validates again and refuses a number it cannot dial, so the check here is only a hint.

type Draft = { label: string; phone: string; players: boolean; staff: boolean };
const toDraft = (c: RunContact): Draft => ({
  label: c.label, phone: c.phone, players: c.visibleTo.includes('players'), staff: c.visibleTo.includes('staff'),
});

export default function RunContactsEditor({ ctx, contacts }: {
  ctx: { ownerUid: string; gameId: string; runId: string };
  contacts: RunContact[] | undefined;
}) {
  const t = useT();
  const rc = t.runConsole.contacts;
  const [rows, setRows] = useState<Draft[]>(() => (contacts ?? []).map(toDraft));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Follow the server while the organizer has nothing unsaved (another tab, a co-organizer).
  const serverKey = JSON.stringify(contacts ?? []);
  useEffect(() => {
    if (!dirty) setRows((contacts ?? []).map(toDraft));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the list's CONTENT
  }, [serverKey]);

  const edit = (i: number, patch: Partial<Draft>) => {
    setDirty(true);
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  async function save() {
    setSaving(true);
    try {
      await setRunContacts({
        ...ctx,
        contacts: rows.map((r) => ({
          label: r.label, phone: r.phone,
          visibleTo: [...(r.players ? ['players' as const] : []), ...(r.staff ? ['staff' as const] : [])],
        })),
      });
      setDirty(false);
      toast.success(rc.saved);
    } catch {
      toast.error(rc.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const problems = rows.map((r) =>
    !r.label.trim() ? rc.needLabel : !normalizePhone(r.phone) ? rc.badPhone : !r.players && !r.staff ? rc.needAudience : '');
  const canSave = dirty && problems.every((p) => !p);

  return (
    <div className="mt-4 rounded-xl border border-[--rp-border] p-3">
      <h3 className="text-sm font-semibold text-[--ink-1]">📞 {rc.title}</h3>
      <p className="text-[13px] text-[--ink-3] mt-0.5 mb-2">{rc.help}</p>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg bg-[--surface-2] p-2 space-y-1.5">
            <div className="flex flex-wrap gap-2">
              <input value={r.label} onChange={(e) => edit(i, { label: e.target.value })} placeholder={rc.labelPlaceholder}
                aria-label={rc.labelPlaceholder} dir="auto" maxLength={40}
                className="flex-1 min-w-[8rem] min-h-[44px] rounded-lg border border-[--rp-border] bg-[--surface-0] px-2 text-sm text-[--ink-1]" />
              <input value={r.phone} onChange={(e) => edit(i, { phone: e.target.value })} placeholder={rc.phonePlaceholder}
                aria-label={rc.phonePlaceholder} dir="ltr" inputMode="tel" type="tel"
                className="w-40 min-h-[44px] rounded-lg border border-[--rp-border] bg-[--surface-0] px-2 text-sm text-[--ink-1]" />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[13px] text-[--ink-2]">
              <label className="inline-flex items-center gap-1.5 min-h-[44px]">
                <input type="checkbox" checked={r.players} onChange={(e) => edit(i, { players: e.target.checked })} />{rc.players}
              </label>
              <label className="inline-flex items-center gap-1.5 min-h-[44px]">
                <input type="checkbox" checked={r.staff} onChange={(e) => edit(i, { staff: e.target.checked })} />{rc.staff}
              </label>
              <button type="button" onClick={() => { setDirty(true); setRows((prev) => prev.filter((_, j) => j !== i)); }}
                className="ms-auto min-h-[44px] px-2 text-ink-alert underline">{rc.remove}</button>
            </div>
            {problems[i] && <p className="text-[12px] text-ink-amber">{problems[i]}</p>}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {rows.length < MAX_RUN_CONTACTS && (
          <Button variant="ghost" onClick={() => { setDirty(true); setRows((prev) => [...prev, { label: '', phone: '', players: true, staff: true }]); }}>
            {rc.add}
          </Button>
        )}
        <Button disabled={!canSave} loading={saving} onClick={() => void save()}>{rc.save}</Button>
      </div>
    </div>
  );
}
