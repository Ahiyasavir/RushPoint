// Admin editing of the smart-build mission bank (change: admin-editable-mission-bank).
//
// The bank is NOT a Firestore collection: it is `src/taskBank.ts`, 89 missions
// written against the 40-rule authoring doctrine in that file's own header. This
// page edits DELTAS — one `missionBankOverrides/{key}` document per mission an
// admin has changed or removed — and `lib/missionBankOverlay.ts` merges them over
// the authored content wherever the composer reads it.
//
// Consequences that shape this screen, all of them deliberate:
//
//   • There is no "new mission" button. A new entry needs a `build()` factory —
//     task type, verification, capacity, quick-setup steps — which is authoring,
//     not editing, and stays in taskBank.ts.
//   • Every edited mission can be RESET, in one click, to exactly what the code
//     says. That is the whole reason an overlay was chosen over migrating the
//     bank into Firestore: the source content never went anywhere.
//   • Tags come from a closed picker, never a text box. The bank's tag registry
//     (`bankTags.ts`) is what every composer filter keys on; a free-text tag
//     would be a tag no filter can ever match.
//   • A deletion that would leave the composer without an opening or a closing
//     mission is refused by the merge, and this page says so rather than showing
//     a mission the admin believes they removed.
//
// Not in the primary nav (same treatment as /admin/users and /admin/templates):
// reachable by direct URL and from the templates tab, gated on the `admin` custom
// claim. The REAL boundary is server-side — all three callables assertAdmin.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../services/firebase';
import {
  listMissionBankOverrides, setMissionBankOverride, clearMissionBankOverride,
  type MissionBankOverrideRow,
} from '../services/calls';
import { TASK_BANK, type TaskBankEntry } from '../taskBank';
import { applyBankOverrides, hasContentEdit } from '../lib/missionBankOverlay';
import { invalidateMissionBank } from '../lib/missionBank';
import {
  BANK_TAG_IDS, bankTagLabel, difficultyBandFor, isDifficultyTagId, withDifficultyBand,
  type BankTagId,
} from '../bankTags';
import { isAdminClaim } from '../lib/adminGate';
import { Badge, Button, Card, EmptyState, Input, Label, MultiChipRow, Select, Skeleton, Textarea } from '../components/ui';
import { LoadingState } from '../components/LoadingState';
import { useLanguage, useT } from '../components/LanguageContext';
import { dialog } from '../components/dialog';
import { toast } from '../components/toast';

type GateState = 'checking' | 'denied' | 'allowed';
type Filter = 'all' | 'edited' | 'deleted' | 'unreviewed' | 'unverified';
/**
 * Curation order. `bank` is the authored order, which carries meaning (bookends,
 * families); the other two pull the unfinished work to the top so a pass over 103
 * missions can be resumed where it stopped instead of scrolled for.
 */
type SortMode = 'bank' | 'unreviewedFirst' | 'unverifiedFirst';

/** The editable state of ONE mission, as the form holds it. */
interface Draft {
  key: string;
  title: string;
  description: string;
  tags: BankTagId[];
  difficulty: number;
  /** '' means "no age floor" — the field is genuinely optional on the entry. */
  minAge: string;
  transitMinutes: string;
}

/** What the authored bank says about a mission, before any override. */
function sourceOf(key: string): TaskBankEntry | undefined {
  return TASK_BANK.find((e) => e.key === key);
}

function draftFrom(entry: TaskBankEntry): Draft {
  const built = entry.build();
  return {
    key: entry.key,
    title: built.title ?? '',
    description: built.description ?? '',
    tags: [...entry.tags],
    difficulty: entry.difficulty,
    minAge: entry.minAge === undefined ? '' : String(entry.minAge),
    transitMinutes: entry.transitMinutes === undefined ? '' : String(entry.transitMinutes),
  };
}

/**
 * The tags an admin may pick by hand.
 *
 * Two groups are deliberately absent, both for the same reason: they restate a
 * structural fact rather than an opinion, so offering them as free controls only
 * creates ways for the mission to contradict itself.
 *
 *   • `easy`/`medium`/`hard` — one fact with the 1-10 difficulty. Offering both
 *     is what let a mission ship at difficulty 8 still tagged `medium`. Derived
 *     on save (`withDifficultyBand`) and shown read-only beside the number.
 *   • `camera` — means "handed in as a photo or a video", i.e. the task type,
 *     which an override cannot change at all. The overlay keeps it pinned to the
 *     authored entry in both directions.
 */
const PICKABLE_TAG_IDS = BANK_TAG_IDS.filter((t) => !isDifficultyTagId(t) && t !== 'camera');

/** A finite non-negative number, or null for "clear this field". */
function optionalNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function AdminMissionBankPage() {
  const t = useT();
  const { lang } = useLanguage();
  const m = t.adminMissionBank;
  const nav = useNavigate();
  const tagLabel = (id: BankTagId) => bankTagLabel(id, lang === 'en' ? 'en' : 'he');

  const [gate, setGate] = useState<GateState>('checking');
  const [overrides, setOverrides] = useState<MissionBankOverrideRow[] | null>(null);
  // The REASON, not just "it failed". This page is admin-only, so the raw server
  // message is safe here and is the difference between "the bank is broken" and
  // "this call needs a claim" (the same call the templates tab learned to make).
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortMode>('bank');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function load() {
    setFailed(null);
    // The composer's own cached copy is now stale by definition: the admin who
    // just made the edit is the one person who must not be left looking at the
    // pre-edit bank (the same reasoning as invalidateTemplateCache()).
    invalidateMissionBank();
    try {
      const { overrides } = await listMissionBankOverrides({});
      setOverrides(overrides);
    } catch (e) {
      console.error('[adminMissionBank] listMissionBankOverrides failed:', e);
      setOverrides((prev) => prev ?? []);
      setFailed(e instanceof Error && e.message ? e.message : m.loadFailed);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function checkGate() {
      const user = auth.currentUser;
      if (!user) { if (!cancelled) setGate('denied'); return; }
      try {
        const token = await user.getIdTokenResult();
        if (cancelled) return;
        if (!isAdminClaim(token.claims as Record<string, unknown>)) { setGate('denied'); return; }
        setGate('allowed');
        void load();
      } catch {
        if (!cancelled) setGate('denied');
      }
    }
    void checkGate();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byKey = useMemo(() => {
    const map = new Map<string, MissionBankOverrideRow>();
    for (const o of overrides ?? []) map.set(o.key, o);
    return map;
  }, [overrides]);

  // The EFFECTIVE bank — the same merge the composer runs — plus the deletions it
  // refused, so this page shows exactly what creators are being offered rather
  // than what the documents claim.
  const merged = useMemo(() => applyBankOverrides(TASK_BANK, overrides ?? []), [overrides]);
  const liveKeys = useMemo(() => new Set(merged.entries.map((e) => e.key)), [merged]);
  const refused = useMemo(() => new Set(merged.refusedDeletions), [merged]);
  // A bookend tag the merge had to put back, because removing it would have left
  // the composer with no opener or no finale (the quiet twin of a refused delete).
  const restored = useMemo(() => new Set(merged.restoredBookends), [merged]);

  // Rows are driven by the AUTHORED bank, not by the merged one: a deleted
  // mission still has to appear here, or it could never be put back.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = TASK_BANK.filter((entry) => {
      const override = byKey.get(entry.key);
      const deleted = override?.deleted === true && !refused.has(entry.key);
      // `edited` means the CONTENT changed. A mission that has only been ticked
      // as reviewed is not an edit, and counting it as one would make this filter
      // useless the moment a curation pass starts.
      if (filter === 'edited' && !hasContentEdit(override)) return false;
      if (filter === 'deleted' && !deleted) return false;
      if (filter === 'unreviewed' && override?.reviewedCopy === true) return false;
      if (filter === 'unverified' && override?.verifiedSetup === true) return false;
      if (!q) return true;
      const built = entry.build();
      const title = override?.title ?? built.title ?? '';
      const haystack = [entry.key, title, built.description ?? '', ...(override?.tags ?? entry.tags)]
        .join(' ').toLowerCase();
      return haystack.includes(q);
    });
    if (sort === 'bank') return matched;
    // A STABLE partition, not a comparator over booleans: within each half the
    // authored order survives, so the list does not reshuffle under the admin as
    // they tick things off.
    const flag = sort === 'unreviewedFirst' ? 'reviewedCopy' : 'verifiedSetup';
    const done = (e: TaskBankEntry) => byKey.get(e.key)?.[flag] === true;
    return [...matched.filter((e) => !done(e)), ...matched.filter(done)];
  }, [byKey, filter, query, refused, sort]);

  /** How far the curation pass has actually got. */
  const progress = useMemo(() => ({
    reviewed: TASK_BANK.filter((e) => byKey.get(e.key)?.reviewedCopy === true).length,
    verified: TASK_BANK.filter((e) => byKey.get(e.key)?.verifiedSetup === true).length,
  }), [byKey]);

  /**
   * Tick or untick one curation flag.
   *
   * The whole row travels, because `setMissionBankOverride` REPLACES the stored
   * document — sending only the flag would silently discard the content edit that
   * is usually sitting right beside it. When nothing is left to say (no content
   * edit and no other flag), the row is cleared rather than kept as an empty
   * husk, so unticking really does return the mission to untouched.
   */
  async function setFlag(entry: TaskBankEntry, flag: 'reviewedCopy' | 'verifiedSetup', on: boolean) {
    const existing = byKey.get(entry.key);
    const other = flag === 'reviewedCopy' ? 'verifiedSetup' : 'reviewedCopy';
    const otherOn = existing?.[other] === true;
    setBusyKey(entry.key);
    try {
      if (!on && !otherOn && !hasContentEdit(existing)) {
        await clearMissionBankOverride({ key: entry.key });
      } else {
        const live = merged.entries.find((e) => e.key === entry.key) ?? entry;
        const built = live.build();
        await setMissionBankOverride({
          key: entry.key,
          ...(existing?.deleted === true ? { deleted: true } : {}),
          ...(hasContentEdit(existing)
            ? {
              title: built.title ?? undefined,
              description: built.description ?? undefined,
              tags: live.tags,
              difficulty: live.difficulty,
              minAge: live.minAge ?? null,
              transitMinutes: live.transitMinutes ?? null,
            }
            : {}),
          ...(otherOn ? { [other]: true } : {}),
          ...(on ? { [flag]: true } : {}),
        });
      }
      await load();
    } catch (e) {
      console.error('[adminMissionBank] setFlag failed:', e);
      toast.error(e instanceof Error && e.message ? e.message : m.saveFailed);
    } finally {
      setBusyKey(null);
    }
  }

  function openEditor(entry: TaskBankEntry) {
    // Seeded from the MERGED entry, so the form opens on what is live today, not
    // on the authored content the admin already replaced.
    const live = merged.entries.find((e) => e.key === entry.key);
    setDraft(draftFrom(live ?? entry));
    setEditingKey(entry.key);
  }

  async function save() {
    if (!draft) return;
    const source = sourceOf(draft.key);
    if (!source) return;
    const title = draft.title.trim();
    const description = draft.description.trim();
    if (!title || draft.tags.length === 0) { toast.error(m.saveFailed); return; }

    setSaving(true);
    try {
      // The whole edited state of this mission travels in one call. `null` on the
      // two optional numbers is a deliberate CLEAR — the callable transport
      // collapses `undefined` to `null`, so "unset" has to be said explicitly and
      // the server has to read it that way (see functions/src/admin/missionBank.ts).
      const existing = byKey.get(draft.key);
      await setMissionBankOverride({
        key: draft.key,
        ...(existing?.deleted === true ? { deleted: true } : {}),
        title,
        description,
        // The band tag is derived, never typed — see PICKABLE_TAG_IDS.
        tags: withDifficultyBand(draft.tags, draft.difficulty),
        difficulty: draft.difficulty,
        minAge: optionalNumber(draft.minAge),
        transitMinutes: optionalNumber(draft.transitMinutes),
        // Carried, not re-asserted: a content edit must not silently untick the
        // curation flags sitting on the same replaced document.
        ...(existing?.reviewedCopy === true ? { reviewedCopy: true } : {}),
        ...(existing?.verifiedSetup === true ? { verifiedSetup: true } : {}),
      });
      setEditingKey(null);
      setDraft(null);
      await load();
    } catch (e) {
      console.error('[adminMissionBank] setMissionBankOverride failed:', e);
      toast.error(e instanceof Error && e.message ? e.message : m.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  /** Take a mission out of the pool, or put it back. */
  async function setDeleted(entry: TaskBankEntry, deleted: boolean) {
    const live = merged.entries.find((e) => e.key === entry.key) ?? entry;
    if (deleted) {
      const ok = await dialog.confirm(m.deleteConfirmBody(live.build().title ?? entry.key), m.deleteConfirmCta, true);
      if (!ok) return;
    }
    setBusyKey(entry.key);
    try {
      const existing = byKey.get(entry.key);
      const flags = {
        ...(existing?.reviewedCopy === true ? { reviewedCopy: true as const } : {}),
        ...(existing?.verifiedSetup === true ? { verifiedSetup: true as const } : {}),
      };
      const onlyTheDeletion = !existing?.title && !existing?.description
        && !existing?.tags && existing?.difficulty === undefined
        && existing?.minAge === undefined && existing?.transitMinutes === undefined
        && Object.keys(flags).length === 0;
      if (!deleted && existing && onlyTheDeletion) {
        // The row held nothing but the deletion, so putting the mission back is
        // the same act as resetting it. Leaving an empty row behind would mark an
        // untouched mission as "edited" forever.
        await clearMissionBankOverride({ key: entry.key });
      } else {
        const built = live.build();
        await setMissionBankOverride({
          key: entry.key,
          ...(deleted ? { deleted: true } : {}),
          // Carry the current content across so un-deleting cannot silently drop
          // an edit made before the deletion.
          title: built.title ?? undefined,
          description: built.description ?? undefined,
          tags: live.tags,
          difficulty: live.difficulty,
          minAge: live.minAge ?? null,
          transitMinutes: live.transitMinutes ?? null,
          ...flags,
        });
      }
      await load();
    } catch (e) {
      console.error('[adminMissionBank] delete/restore failed:', e);
      toast.error(e instanceof Error && e.message ? e.message : m.saveFailed);
    } finally {
      setBusyKey(null);
    }
  }

  async function reset(entry: TaskBankEntry) {
    setBusyKey(entry.key);
    try {
      await clearMissionBankOverride({ key: entry.key });
      if (editingKey === entry.key) { setEditingKey(null); setDraft(null); }
      await load();
    } catch (e) {
      console.error('[adminMissionBank] clearMissionBankOverride failed:', e);
      toast.error(e instanceof Error && e.message ? e.message : m.saveFailed);
    } finally {
      setBusyKey(null);
    }
  }

  if (gate === 'checking') {
    return (
      <div className="animate-fade-up space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  if (gate === 'denied') return <EmptyState icon="🔒" title={m.deniedTitle} body={m.deniedBody} />;
  if (!overrides) {
    return (
      <div className="animate-fade-up space-y-4">
        <LoadingState messages={m.loading} className="!py-6" />
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[--ink-1]">{m.title}</h1>
          <p className="text-sm text-[--ink-3]">{m.subtitle}</p>
          <p className="text-[13px] text-[--ink-3] mt-1">{m.noCreateHint}</p>
        </div>
        <button
          type="button"
          onClick={() => nav('/admin/templates')}
          className="text-xs font-medium text-[--ink-3] hover:text-[--ink-1] underline underline-offset-2 shrink-0"
        >
          {m.backToTemplates}
        </button>
      </div>

      {failed && (
        <Card>
          <p className="text-sm text-[--ink-2]">{m.loadFailed}</p>
          <p className="text-[13px] text-[--ink-3] mt-1 break-words">{failed}</p>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          dense
          className="max-w-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={m.searchPlaceholder}
          aria-label={m.searchPlaceholder}
        />
        {(['all', 'edited', 'deleted', 'unreviewed', 'unverified'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`min-h-[40px] px-3 rounded-lg border text-[13px] transition-colors ${
              filter === f ? 'border-rp-fire bg-rp-fire/10 text-ink-fire font-medium'
                : 'border-[--rp-border] text-[--ink-2] hover:bg-[--surface-2]'}`}
          >
            {f === 'all' ? m.filterAll
              : f === 'edited' ? m.filterEdited
                : f === 'deleted' ? m.filterDeleted
                  : f === 'unreviewed' ? m.filterUnreviewed : m.filterUnverified}
          </button>
        ))}
        <Select
          className="max-w-[200px]"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          aria-label={m.sortLabel}
        >
          <option value="bank">{m.sortBank}</option>
          <option value="unreviewedFirst">{m.sortUnreviewedFirst}</option>
          <option value="unverifiedFirst">{m.sortUnverifiedFirst}</option>
        </Select>
        <span className="text-[13px] text-[--ink-3] ms-auto">
          {m.countLabel(rows.length, TASK_BANK.length)}
          {' · '}
          {m.progressLabel(progress.reviewed, progress.verified, TASK_BANK.length)}
        </span>
      </div>

      {rows.length === 0
        ? <EmptyState icon="🔎" title={m.emptyTitle} body={m.emptyBody} />
        : (
          <div className="space-y-2">
            {rows.map((entry) => {
              const override = byKey.get(entry.key);
              const live = merged.entries.find((e) => e.key === entry.key);
              const deleted = !liveKeys.has(entry.key);
              const built = (live ?? entry).build();
              const isEditing = editingKey === entry.key;
              const busy = busyKey === entry.key;

              return (
                <Card key={entry.key}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-medium text-[--ink-1] ${deleted ? 'line-through opacity-60' : ''}`}>
                          {built.title}
                        </span>
                        {deleted && <Badge color="red">{m.deletedBadge}</Badge>}
                        {!deleted && hasContentEdit(override) && <Badge color="gold">{m.editedBadge}</Badge>}
                      </div>
                      {/* The two curation ticks. Deliberately on the ROW rather than
                          inside the editor: the point is to sweep a hundred missions
                          without opening each one. */}
                      <div className="flex flex-wrap items-center gap-4 mt-2">
                        {([
                          ['reviewedCopy', m.reviewedCopyLabel, m.reviewedCopyHint],
                          ['verifiedSetup', m.verifiedSetupLabel, m.verifiedSetupHint],
                        ] as const).map(([flag, label, hint]) => (
                          <label key={flag} className="flex items-center gap-2 cursor-pointer" title={hint}>
                            <input
                              type="checkbox"
                              className="w-4 h-4 accent-rp-fire"
                              checked={override?.[flag] === true}
                              disabled={busy}
                              onChange={(ev) => void setFlag(entry, flag, ev.target.checked)}
                            />
                            <span className="text-[13px] text-[--ink-2]">{label}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-[13px] text-[--ink-3] mt-0.5 break-words">
                        {m.keyLabel}: {entry.key}
                        {entry.family ? ` · ${m.familyLabel}: ${entry.family}` : ''}
                        {` · ${m.difficultyShort}: ${(live ?? entry).difficulty}`}
                      </p>
                      <p className="text-[13px] text-[--ink-3] mt-0.5">
                        {(live ?? entry).tags.map(tagLabel).join(' · ')}
                      </p>
                      {/* The merge refused this deletion because it would have left the
                          composer without a bookend. Saying so is the difference between
                          a rule and a bug. */}
                      {refused.has(entry.key) && (
                        <p className="text-[13px] text-ink-fire mt-1">{m.refusedDeletion}</p>
                      )}
                      {restored.has(entry.key) && (
                        <p className="text-[13px] text-ink-fire mt-1">{m.restoredBookend}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <Button variant="ghost" onClick={() => (isEditing ? (setEditingKey(null), setDraft(null)) : openEditor(entry))}>
                        {isEditing ? m.cancelBtn : m.editBtn}
                      </Button>
                      {override && (
                        <Button variant="ghost" loading={busy} onClick={() => reset(entry)} title={m.resetHint}>
                          {m.resetBtn}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        loading={busy}
                        onClick={() => setDeleted(entry, !deleted)}
                        className={deleted ? '' : 'text-ink-fire'}
                      >
                        {deleted ? m.restoreBtn : m.deleteBtn}
                      </Button>
                    </div>
                  </div>

                  {isEditing && draft && (
                    <div className="mt-4 space-y-3 border-t border-[--rp-border] pt-4">
                      <div>
                        <Label>{m.titleLabel}</Label>
                        <Input
                          value={draft.title}
                          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                          dir="auto"
                        />
                      </div>
                      <div>
                        <Label>{m.descriptionLabel}</Label>
                        <Textarea
                          rows={4}
                          value={draft.description}
                          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                          dir="auto"
                        />
                      </div>
                      <MultiChipRow
                        label={m.tagsLabel}
                        hint={m.tagsHint}
                        options={PICKABLE_TAG_IDS}
                        values={draft.tags}
                        render={tagLabel}
                        onToggle={(tag) => setDraft({
                          ...draft,
                          tags: draft.tags.includes(tag)
                            ? draft.tags.filter((x) => x !== tag)
                            : [...draft.tags, tag],
                        })}
                      />
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <Label>{m.difficultyLabel}</Label>
                          <Input
                            type="number" min={1} max={10} step={1}
                            value={String(draft.difficulty)}
                            onChange={(e) => setDraft({ ...draft, difficulty: Number(e.target.value) })}
                          />
                          {/* Derived, not picked — the band and the number are one
                              fact, so showing the consequence of the number here is
                              what stops the two from being edited into a contradiction. */}
                          <p className="text-[13px] text-[--ink-3] mt-1">
                            {m.bandDerived(tagLabel(difficultyBandFor(draft.difficulty)))}
                          </p>
                        </div>
                        <div>
                          <Label>{m.minAgeLabel}</Label>
                          <Input
                            type="number" min={0} step={1}
                            placeholder={m.minAgeNone}
                            value={draft.minAge}
                            onChange={(e) => setDraft({ ...draft, minAge: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label>{m.transitLabel}</Label>
                          <Input
                            type="number" min={0} step={1}
                            placeholder={m.transitNone}
                            value={draft.transitMinutes}
                            onChange={(e) => setDraft({ ...draft, transitMinutes: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button loading={saving} onClick={save}>{saving ? m.saving : m.saveBtn}</Button>
                        <Button variant="ghost" onClick={() => { setEditingKey(null); setDraft(null); }}>
                          {m.cancelBtn}
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
    </div>
  );
}
