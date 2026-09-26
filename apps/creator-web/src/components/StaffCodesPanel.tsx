// Staff codes (change: staff-capabilities).
//
// The organizer asked for three things: a game default that can keep staff from adding points,
// the right to widen that during the run, and several codes each with its own permissions. This
// panel is where the run-time half lives: every code of this run, what it may do, who signed in
// with it, and the controls to change any of that while the event is on. Edits apply from the
// staff's NEXT action (the server gate resolves live), so nobody has to hand out a new PIN.
//
// Reads come from the organizer's own Firestore listeners (owner-read in firestore.rules); every
// change goes through a callable. The rows are built by lib/staffCodes.ts with the SAME resolver
// the server uses, so the checklist can never claim a code is limited when it is not.
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  ALWAYS_GRANTED_CAPABILITIES,
  FIRESTORE_PATHS,
  STAFF_CAPABILITIES,
  STAFF_PRESETS,
  type StaffCapability,
} from '@rushpoint/shared';
import { db } from '../services/firebase';
import { inviteStaff, updateStaffCode, removeStaffMember } from '../services/calls';
import { buildStaffCodeRows, toggleCapability, type StaffCodeDocLike, type StaffGrantDocLike, type StaffCodeRow } from '../lib/staffCodes';
import { useT } from './LanguageContext';
import { Badge, Button, Input } from './ui';
import { dialog } from './dialog';
import { toast } from './toast';

type Ctx = { ownerUid: string; gameId: string; runId: string };

export function CapabilityChecklist({ value, onChange, disabled }: {
  value: readonly StaffCapability[];
  onChange: (next: StaffCapability[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const sc = t.runConsole.staffCodes;
  const names = t.runConsole.staffCaps;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[--ink-3]">
        <span>{sc.presetsLabel}</span>
        {(['marshal', 'judge', 'full'] as const).map((k) => (
          <Button key={k} type="button" variant="subtle" className="min-h-[36px] px-3 py-1 text-xs" disabled={disabled}
            onClick={() => onChange(STAFF_CAPABILITIES.filter((c) => STAFF_PRESETS[k].includes(c) || ALWAYS_GRANTED_CAPABILITIES.includes(c)))}>
            {sc.presets[k]}
          </Button>
        ))}
      </div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {STAFF_CAPABILITIES.map((cap) => {
          const locked = ALWAYS_GRANTED_CAPABILITIES.includes(cap);
          const on = locked || value.includes(cap);
          return (
            <li key={cap}>
              <label className={`flex items-start gap-2.5 min-h-[44px] rounded-lg px-2 py-1.5 ${locked ? 'opacity-70' : 'cursor-pointer hover:bg-[--surface-2]'}`}>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-[--rp-fire]"
                  checked={on}
                  disabled={disabled || locked}
                  onChange={(e) => onChange(toggleCapability(value, cap, e.target.checked))}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-[--ink-1]">
                    {names[cap].name}{locked && <span className="ms-1.5 text-[11px] text-[--ink-3]">({sc.locked})</span>}
                  </span>
                  <span className="block text-[12px] leading-snug text-[--ink-3]">{names[cap].help}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function StaffCodesPanel({ ctx, defaultCapabilities, startCreating = false, onCreated }: {
  ctx: Ctx;
  /** Open with the new-code form showing (the console's "invite staff" button). */
  startCreating?: boolean;
  /** The game's `staffDefaults`, resolved (absent = everything). Pre-fills a new code. */
  defaultCapabilities: readonly StaffCapability[];
  onCreated?: (pin: string) => void;
}) {
  const t = useT();
  const sc = t.runConsole.staffCodes;
  const names = t.runConsole.staffCaps;
  const [codes, setCodes] = useState<StaffCodeDocLike[]>([]);
  const [grants, setGrants] = useState<StaffGrantDocLike[]>([]);
  const [creating, setCreating] = useState(startCreating);
  useEffect(() => { if (startCreating) setCreating(true); }, [startCreating]);
  const [newLabel, setNewLabel] = useState('');
  const [newCaps, setNewCaps] = useState<StaffCapability[]>([...defaultCapabilities]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editCaps, setEditCaps] = useState<StaffCapability[]>([]);
  const [openPeople, setOpenPeople] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setNewCaps([...defaultCapabilities]); }, [defaultCapabilities]);

  useEffect(() => {
    const base = FIRESTORE_PATHS.run(ctx.ownerUid, ctx.gameId, ctx.runId);
    const un1 = onSnapshot(collection(db, `${base}/staffInvites`),
      (snap) => setCodes(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), () => undefined);
    const un2 = onSnapshot(collection(db, FIRESTORE_PATHS.staffGrantsCol(ctx.ownerUid, ctx.gameId, ctx.runId)),
      (snap) => setGrants(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), () => undefined);
    return () => { un1(); un2(); };
  }, [ctx.ownerUid, ctx.gameId, ctx.runId]);

  const rows = useMemo(() => buildStaffCodeRows(codes, grants), [codes, grants]);

  async function run(fn: () => Promise<unknown>, ok?: string): Promise<boolean> {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); return true; }
    catch { await dialog.alert(sc.failed); return false; }
    finally { setBusy(false); }
  }

  async function create() {
    const label = newLabel.trim();
    if (!label) return;
    let pin = '';
    const done = await run(async () => {
      const r = await inviteStaff({ ...ctx, name: label, capabilities: newCaps });
      pin = r.pin;
    }, sc.created);
    if (done) {
      setCreating(false);
      setNewLabel('');
      onCreated?.(pin);
    }
  }

  async function saveCaps(row: StaffCodeRow) {
    if (await run(() => updateStaffCode({ ...ctx, codeId: row.id, capabilities: editCaps }), sc.saved)) setEditing(null);
  }

  async function removePerson(uid: string, name: string) {
    if (!(await dialog.confirm(sc.removePersonConfirm({ name: name || uid.slice(0, 6) }), sc.removeCta, true))) return;
    await run(() => removeStaffMember({ ...ctx, staffUid: uid }));
  }

  async function removeAll(row: StaffCodeRow) {
    if (!(await dialog.confirm(sc.removeAllConfirm({ label: row.label, n: row.people.length }), sc.removeCta, true))) return;
    await run(() => removeStaffMember({ ...ctx, codeId: row.id }));
  }

  const summary = (row: StaffCodeRow) =>
    row.capabilities.filter((c) => !ALWAYS_GRANTED_CAPABILITIES.includes(c)).map((c) => names[c].name).join(' · ');

  return (
    <div className="space-y-3" data-testid="staff-codes">
      <p className="text-[12px] leading-snug text-[--ink-3]">{sc.intro}</p>

      {rows.length === 0 && !creating && <p className="text-sm text-[--ink-3]">{sc.empty}</p>}

      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border border-[--rp-border] p-3 space-y-2" data-testid="staff-code-row">
            <div className="flex flex-wrap items-center gap-2">
              <span dir="auto" className="font-semibold text-[--ink-1]">{row.label}</span>
              <span className="text-xs text-[--ink-3]">{sc.pin} <span className="font-mono text-ink-fire tracking-widest">{row.pin}</span></span>
              {row.disabled && <Badge color="red">{sc.disabledBadge}</Badge>}
              {row.usedUp && <Badge>{sc.usedUp}</Badge>}
            </div>
            {row.legacy
              ? <p className="text-[12px] text-[--ink-3]">{sc.legacy}</p>
              : <p className="text-[12px] text-[--ink-2]" data-testid="staff-code-caps">{summary(row) || names.safety.name}</p>}

            {editing === row.id ? (
              <div className="space-y-2">
                <CapabilityChecklist value={editCaps} onChange={setEditCaps} disabled={busy} />
                <div className="flex gap-2">
                  <Button disabled={busy} onClick={() => void saveCaps(row)}>{sc.save}</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>{sc.cancel}</Button>
                </div>
              </div>
            ) : !row.legacy && (
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" className="min-h-[40px] px-3 py-1.5 text-xs" disabled={busy}
                  onClick={() => { setEditing(row.id); setEditCaps(row.capabilities); }}>
                  {sc.editCaps}
                </Button>
                <Button variant="ghost" className="min-h-[40px] px-3 py-1.5 text-xs" disabled={busy}
                  onClick={() => void run(() => updateStaffCode({ ...ctx, codeId: row.id, disabled: !row.disabled }))}>
                  {row.disabled ? sc.enable : sc.disable}
                </Button>
                <Button variant="ghost" className="min-h-[40px] px-3 py-1.5 text-xs"
                  onClick={() => setOpenPeople(openPeople === row.id ? null : row.id)}>
                  {sc.showPeople} ({row.people.length})
                </Button>
              </div>
            )}
            {row.disabled && <p className="text-[12px] text-[--ink-3]">{sc.disableNote}</p>}

            {openPeople === row.id && (
              <div className="space-y-1.5">
                {row.people.length === 0 ? <p className="text-[12px] text-[--ink-3]">{sc.noPeople}</p> : (
                  <>
                    <p className="text-[12px] text-[--ink-2]">{sc.people({ n: row.people.length })}</p>
                    <ul className="space-y-1">
                      {row.people.map((p) => (
                        <li key={p.uid} className="flex items-center gap-2 text-sm">
                          <span dir="auto" className="flex-1 truncate text-[--ink-1]">{p.name || p.uid.slice(0, 6)}</span>
                          <Button variant="ghost" className="min-h-[40px] px-3 py-1 text-xs" disabled={busy}
                            onClick={() => void removePerson(p.uid, p.name)}>
                            {sc.removePerson}
                          </Button>
                        </li>
                      ))}
                    </ul>
                    {row.people.length > 1 && (
                      <Button variant="danger" className="min-h-[40px] px-3 py-1 text-xs" disabled={busy} onClick={() => void removeAll(row)}>
                        {sc.removeAll}
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {creating ? (
        <div className="rounded-xl border border-[--rp-border] p-3 space-y-2">
          <Input value={newLabel} maxLength={60} placeholder={sc.labelPlaceholder} onChange={(e) => setNewLabel(e.target.value)} dir="auto" />
          <CapabilityChecklist value={newCaps} onChange={setNewCaps} disabled={busy} />
          <div className="flex gap-2">
            <Button disabled={busy || !newLabel.trim()} onClick={() => void create()}>{sc.create}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setCreating(false)}>{sc.cancel}</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setCreating(true)} data-testid="staff-code-new">{sc.newCode}</Button>
      )}
    </div>
  );
}
