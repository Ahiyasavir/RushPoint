import React, { useEffect, useMemo, useRef, useState } from 'react';
import Map, { Marker, NavigationControl, Source, Layer, type MapLayerMouseEvent, type MarkerDragEvent } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { doc, getDoc } from 'firebase/firestore';
import { routeGeoJSON, STATION_COLOR, type RaceConfig, type StationType, type SmartStationConfig, type VerificationType } from '@rushpoint/shared';
import { callable } from '../services/api';
import { db, APP_ID, ensureAuth } from '../services/firebase';
import { useI18n } from '../i18n';
import { useRaceConfig, useStations, type BuilderStation } from '../data/raceConfig';
import { getMapStyle } from '../data/mapStyle';

const saveRaceConfigFn = callable<object>('saveRaceConfig');
const upsertStationFn  = callable<object, { id: string }>('upsertStation');
const deleteStationFn  = callable<{ id: string; kind: 'task' | 'zone' }>('deleteStation');

// What a green/gold task vs an orange zone needs. `kind` is derived from `type`.
const ADD_TYPES: { type: StationType; kind: 'task' | 'zone'; key: string }[] = [
  { type: 'green',  kind: 'task', key: 'builder.addGreen' },
  { type: 'gold',   kind: 'task', key: 'builder.addGold' },
  { type: 'orange', kind: 'zone', key: 'builder.addOrange' },
];

// The client-editable smart config (everything in SmartStationConfig except the
// always-true `enabled` flag) plus the write-only secret `expectedCode`. Kept as a
// flat block on the Draft so the guided panel can bind directly to it.
type SmartDraft = Omit<SmartStationConfig, 'enabled'> & {
  expectedCode?: string;
  hints?: { en: string; he: string }[]; // secret hint texts (server stores in stationSecrets, never returned)
};

type Draft = Partial<BuilderStation> & {
  kind: 'task' | 'zone'; type: StationType; lat: number; lng: number; id?: string;
  // Smart-station authoring state (task stations only). `smartEnabled` toggles the
  // guided panel; `smart` holds the config. Loaded lazily from Firestore on edit.
  smartEnabled?: boolean;
  smart?: SmartDraft;
};

function blankSmart(): SmartDraft {
  return {
    verificationType: 'manual_judge',
    canSkip: false,
    autoCompleteOnSuccess: true,
    needsAdminApproval: true,
    photoReviewRequired: true,
    allowRetry: true,
    showIntroScreen: true,
    showSuccessScreen: true,
    showFailureScreen: true,
    showPendingReviewScreen: true,
    showHintsOverTime: false,
  };
}

type LL = { lat: number; lng: number };
// Greedy nearest-neighbour chain from `origin` through `pts` — gives a sensible,
// non-zig-zagging route order along the valley without a full TSP solve. Pure,
// so the route line can recompute live as stations are added/dragged.
function orderByNearest(origin: LL, pts: readonly LL[]): LL[] {
  const remaining = pts.map((p) => ({ lat: p.lat, lng: p.lng }));
  const out: LL[] = [];
  let cur: LL = origin;
  const d2 = (a: LL, b: LL) => (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2;
  while (remaining.length) {
    let bi = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (d2(cur, remaining[i]) < d2(cur, remaining[bi])) bi = i;
    }
    cur = remaining[bi];
    out.push(cur);
    remaining.splice(bi, 1);
  }
  return out;
}

function blankDraft(type: StationType, lat: number, lng: number): Draft {
  const kind = type === 'orange' ? 'zone' : 'task';
  return {
    kind, type, lat, lng,
    title: '', titleHe: '', description: '', descriptionHe: '', locationHint: '',
    difficulty: 5, pointValue: 100, estimatedMinutes: 15, maxConcurrentTeams: 3,
    maxDurationMinutes: 30, status: 'active', riddle: '', riddleHe: '', maxTeams: 3,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Race Builder — design the route + stations on a map. Drag Start/Finish/Gate and
// any station; click the map (with an "Add" type armed) to drop a new station;
// edit details in the side panel. Persists to Firestore via admin callables.
// ═══════════════════════════════════════════════════════════════════════════════
export default function BuilderPage() {
  const { t } = useI18n();
  const liveConfig = useRaceConfig();
  const stations = useStations();

  // Local, editable copy of the framing config (synced from live once on load).
  const [cfg, setCfg] = useState<RaceConfig>(liveConfig);
  const [cfgDirty, setCfgDirty] = useState(false);
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!loadedRef.current) { setCfg(liveConfig); loadedRef.current = true; }
  }, [liveConfig]);

  const [addType, setAddType] = useState<StationType | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const flash = (m: string) => { setNotice(m); window.setTimeout(() => setNotice(null), 3500); };

  // Open an existing station in the side panel. For task stations we lazily fetch
  // the persisted `smart` config from Firestore (BuilderStation doesn't carry it),
  // so editing a smart station shows its current settings. `expectedCode` is never
  // returned (server secret) — that input stays blank and is only sent if re-typed.
  function pickStation(s: BuilderStation) {
    setAddType(null);
    setDraft({ ...s });
    if (s.kind !== 'task' || !s.id) return;
    void ensureAuth()
      .then(() => getDoc(doc(db, `artifacts/${APP_ID}/public/data/tasks/${s.id}`)))
      .then((snap) => {
        const data = snap.data() as { smart?: SmartStationConfig } | undefined;
        const sc = data?.smart;
        if (!sc?.enabled) return;
        const { enabled: _enabled, ...rest } = sc;
        setDraft((cur) => (cur && cur.id === s.id
          ? { ...cur, smartEnabled: true, smart: { ...blankSmart(), ...rest } }
          : cur));
      })
      .catch(() => { /* non-fatal — panel just opens without preloaded smart config */ });
  }

  // The route line derives from the LIVE coordinate state: start → green field
  // stations (nearest-neighbour ordered) → gate → finish. Recomputes the moment
  // any of those points is dragged or a green station is added/removed — no save
  // or refresh needed. Saving persists exactly these mid-nodes (below).
  const routeMidNodes = useMemo(
    () => [...orderByNearest(cfg.start, stations.filter((s) => s.type === 'green')), cfg.gate],
    [cfg.start, cfg.gate, stations],
  );
  const routeData = useMemo(
    () => routeGeoJSON([cfg.start, ...routeMidNodes, cfg.finish]),
    [cfg.start, cfg.finish, routeMidNodes],
  );

  // ── Config marker drag ───────────────────────────────────────────────────────
  const moveConfigPoint = (key: 'start' | 'finish' | 'gate', e: MarkerDragEvent) => {
    setCfg((c) => ({ ...c, [key]: { lat: e.lngLat.lat, lng: e.lngLat.lng } }));
    setCfgDirty(true);
  };

  async function saveConfig() {
    setBusy(true);
    try {
      await saveRaceConfigFn({
        start: cfg.start, finish: cfg.finish, gate: cfg.gate,
        center: cfg.center, zoom: cfg.zoom, routeWaypoints: routeMidNodes,
      });
      setCfgDirty(false);
      flash(t('builder.savedRoute'));
    } catch { flash(t('builder.saveError')); } finally { setBusy(false); }
  }

  // ── Station create/update ──────────────────────────────────────────────────
  function payloadFromDraft(d: Draft) {
    const base = { id: d.id, kind: d.kind, type: d.type, coordinates: { lat: d.lat, lng: d.lng } };
    if (d.kind === 'zone') {
      return { ...base, title: d.title, titleHe: d.titleHe, riddle: d.riddle, riddleHe: d.riddleHe, maxTeams: d.maxTeams };
    }
    // When the smart toggle is on, attach a sanitized smart config. We drop blank
    // strings and only send `expectedCode` when the admin typed one (it's stripped
    // into a server-side secret store). When off, we send `smart: null` so the
    // server clears any previously-stored smart config (plain task again).
    const smart = d.smartEnabled ? buildSmartPayload(d.smart) : null;
    return {
      ...base, title: d.title, titleHe: d.titleHe, description: d.description, descriptionHe: d.descriptionHe,
      locationHint: d.locationHint, difficulty: d.difficulty, pointValue: d.pointValue,
      estimatedMinutes: d.estimatedMinutes, maxConcurrentTeams: d.maxConcurrentTeams,
      maxDurationMinutes: d.maxDurationMinutes, status: d.status, isActive: d.isActive !== false,
      smart,
    };
  }

  // Assemble the `smart` object sent to upsertStation. `enabled:true` is always set;
  // empty strings are pruned so we don't persist blanks; `expectedCode` rides along
  // only when present (the server moves it into the secret store).
  function buildSmartPayload(s: SmartDraft | undefined): Record<string, unknown> {
    const src = s ?? blankSmart();
    const out: Record<string, unknown> = { enabled: true, verificationType: src.verificationType };
    const strKeys: (keyof SmartDraft)[] = [
      'longInstructions', 'longInstructionsHe', 'extraInfo', 'mediaUrl', 'imageUrl', 'adminNotes', 'codeInputLabel',
    ];
    for (const k of strKeys) {
      const v = src[k];
      if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
    }
    const numKeys: (keyof SmartDraft)[] = ['timeLimitSeconds', 'attemptLimit', 'hintCount'];
    for (const k of numKeys) {
      const v = src[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    const boolKeys: (keyof SmartDraft)[] = [
      'canSkip', 'autoCompleteOnSuccess', 'photoReviewRequired', 'needsAdminApproval', 'allowRetry',
      'showIntroScreen', 'showSuccessScreen', 'showFailureScreen', 'showPendingReviewScreen', 'showHintsOverTime',
    ];
    for (const k of boolKeys) {
      const v = src[k];
      if (typeof v === 'boolean') out[k] = v;
    }
    if (src.verificationType === 'code_verification' && typeof src.expectedCode === 'string' && src.expectedCode.trim() !== '') {
      out.expectedCode = src.expectedCode.trim();
    }
    const n = typeof src.hintCount === 'number' ? Math.max(0, Math.floor(src.hintCount)) : 0;
    if (src.verificationType === 'code_verification' && n > 0 && Array.isArray(src.hints)) {
      out.hints = src.hints.slice(0, n).map((h) => ({ en: (h?.en ?? '').trim(), he: (h?.he ?? '').trim() }));
    }
    return out;
  }

  async function saveStation(d: Draft) {
    setBusy(true);
    try {
      const { id } = await upsertStationFn(payloadFromDraft(d));
      setDraft({ ...d, id });
      // A green station change reshapes the route line → prompt a route re-save.
      if (d.type === 'green') setCfgDirty(true);
      flash(t('builder.savedStation'));
    } catch { flash(t('builder.saveError')); } finally { setBusy(false); }
  }

  // Drag an existing station marker → persist the new position (full field set).
  async function moveStation(s: BuilderStation, e: MarkerDragEvent) {
    const d: Draft = { ...s, lat: e.lngLat.lat, lng: e.lngLat.lng };
    await saveStation(d);
  }

  async function removeStation(d: Draft) {
    if (!d.id) { setDraft(null); return; }
    setBusy(true);
    try {
      await deleteStationFn({ id: d.id, kind: d.kind });
      setDraft(null);
      flash(t('builder.deletedStation'));
    } catch (err) {
      flash((err as { message?: string })?.message ?? t('builder.saveError'));
    } finally { setBusy(false); }
  }

  // ── Map click → add a station of the armed type ──────────────────────────────
  function onMapClick(e: MapLayerMouseEvent) {
    if (!addType) { setDraft(null); return; }
    setDraft(blankDraft(addType, e.lngLat.lat, e.lngLat.lng));
    setAddType(null);
  }

  const grouped = useMemo(() => ({
    green:  stations.filter((s) => s.type === 'green'),
    orange: stations.filter((s) => s.type === 'orange'),
    gold:   stations.filter((s) => s.type === 'gold'),
  }), [stations]);

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('builder.title')}</h1>
          <p className="text-zinc-500 text-sm">{t('builder.subtitle')}</p>
        </div>
        <button
          onClick={() => void saveConfig()}
          disabled={busy || !cfgDirty}
          className="shrink-0 px-4 py-2 rounded-xl bg-neon-green text-black font-bold text-sm disabled:opacity-40"
        >
          {cfgDirty ? t('builder.saveRoute') : t('builder.routeSaved')}
        </button>
      </div>

      {notice && (
        <div className="mb-3 rounded-xl bg-neon-green/5 border border-neon-green/30 px-4 py-2.5 text-neon-green text-sm">{notice}</div>
      )}

      {/* Add toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs uppercase tracking-wider text-zinc-500 me-1">{t('builder.addStation')}</span>
        {ADD_TYPES.map((a) => (
          <button
            key={a.type}
            onClick={() => setAddType(addType === a.type ? null : a.type)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${
              addType === a.type ? 'text-black' : 'text-white hover:bg-white/5'
            }`}
            style={addType === a.type
              ? { backgroundColor: STATION_COLOR[a.type], borderColor: STATION_COLOR[a.type] }
              : { borderColor: STATION_COLOR[a.type] }}
          >
            ＋ {t(a.key)}
          </button>
        ))}
        {addType && <span className="text-xs text-zinc-400">{t('builder.clickToPlace')}</span>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* Map */}
        <div className={`rounded-2xl overflow-hidden border border-neon-green/20 h-[560px] ${addType ? 'cursor-crosshair' : ''}`}>
          <Map
            initialViewState={{ longitude: cfg.center.lng, latitude: cfg.center.lat, zoom: cfg.zoom }}
            mapStyle={getMapStyle()}
            attributionControl={true}
            onClick={onMapClick}
          >
            <NavigationControl position="top-right" />

            <Source id="route" type="geojson" data={routeData}>
              <Layer id="route-line" type="line"
                layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                paint={{ 'line-color': '#00ffaa', 'line-width': 3, 'line-opacity': 0.7 }} />
            </Source>

            {/* Start / Finish / Gate — draggable framing markers */}
            <Marker longitude={cfg.start.lng} latitude={cfg.start.lat} anchor="bottom" draggable onDragEnd={(e) => moveConfigPoint('start', e)}>
              <div title={t('builder.start')} className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-white text-black border border-neon-green shadow-lg cursor-move">▶ START</div>
            </Marker>
            <Marker longitude={cfg.finish.lng} latitude={cfg.finish.lat} anchor="bottom" draggable onDragEnd={(e) => moveConfigPoint('finish', e)}>
              <div title={t('builder.finish')} className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-neon-gold text-black border border-white shadow-lg cursor-move">🏁 {t('builder.finish')}</div>
            </Marker>
            <Marker longitude={cfg.gate.lng} latitude={cfg.gate.lat} anchor="center" draggable onDragEnd={(e) => moveConfigPoint('gate', e)}>
              <div title={t('builder.gate')} className="w-5 h-5 rounded-full border-2 border-white shadow-lg cursor-move" style={{ backgroundColor: STATION_COLOR.gate }} />
            </Marker>

            {/* Station markers — draggable, click to edit */}
            {stations.map((s) => (
              <Marker key={`${s.kind}-${s.id}`} longitude={s.lng} latitude={s.lat} anchor="center" draggable
                onDragEnd={(e) => void moveStation(s, e)}
                onClick={(e) => { e.originalEvent.stopPropagation(); pickStation(s); }}>
                <div
                  title={s.label}
                  className={`w-4 h-4 rounded-full border-2 shadow-lg cursor-pointer ${draft?.id === s.id ? 'border-white ring-2 ring-white' : 'border-white/70'}`}
                  style={{ backgroundColor: STATION_COLOR[s.type] }}
                />
              </Marker>
            ))}

            {/* New, unsaved draft marker */}
            {draft && !draft.id && (
              <Marker longitude={draft.lng} latitude={draft.lat} anchor="center">
                <div className="w-4 h-4 rounded-full border-2 border-white animate-pulse shadow-lg" style={{ backgroundColor: STATION_COLOR[draft.type] }} />
              </Marker>
            )}
          </Map>
        </div>

        {/* Side panel: form OR station list */}
        <div className="rounded-2xl border border-glass-border bg-app-card p-4 h-[560px] overflow-y-auto">
          {draft ? (
            <StationForm
              draft={draft}
              busy={busy}
              onChange={setDraft}
              onSave={() => void saveStation(draft)}
              onDelete={() => void removeStation(draft)}
              onClose={() => setDraft(null)}
            />
          ) : (
            <StationList grouped={grouped} onPick={pickStation} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Station list (grouped by stage) ──────────────────────────────────────────
function StationList({ grouped, onPick }: {
  grouped: { green: BuilderStation[]; orange: BuilderStation[]; gold: BuilderStation[] };
  onPick: (s: BuilderStation) => void;
}) {
  const { t } = useI18n();
  const sections: { type: StationType; key: string; items: BuilderStation[] }[] = [
    { type: 'green',  key: 'builder.stageGreen',  items: grouped.green },
    { type: 'orange', key: 'builder.stageOrange', items: grouped.orange },
    { type: 'gold',   key: 'builder.stageGold',   items: grouped.gold },
  ];
  return (
    <div className="space-y-4">
      <p className="text-zinc-400 text-sm">{t('builder.listHint')}</p>
      {sections.map((sec) => (
        <div key={sec.type}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATION_COLOR[sec.type] }} />
            <span className="text-xs uppercase tracking-wider text-zinc-400">{t(sec.key)} · {sec.items.length}</span>
          </div>
          <div className="space-y-1.5">
            {sec.items.length === 0
              ? <p className="text-zinc-600 text-xs ps-4">{t('builder.none')}</p>
              : sec.items.map((s) => (
                <button key={`${s.kind}-${s.id}`} onClick={() => onPick(s)}
                  className="w-full text-start px-3 py-2 rounded-lg bg-app-surface border border-glass-border hover:border-neon-green/40 transition-colors">
                  <span className="text-white text-sm font-medium">{s.label}</span>
                  <span className="block text-[11px] text-zinc-500 font-mono">{s.lat.toFixed(4)}, {s.lng.toFixed(4)}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Station form ──────────────────────────────────────────────────────────────
function StationForm({ draft, busy, onChange, onSave, onDelete, onClose }: {
  draft: Draft; busy: boolean;
  onChange: (d: Draft) => void; onSave: () => void; onDelete: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const isZone = draft.kind === 'zone';

  const field = 'w-full px-3 py-2 rounded-lg bg-app-surface border border-glass-border text-white text-sm';
  const label = 'text-[11px] uppercase tracking-wider text-zinc-500';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-white font-semibold">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: STATION_COLOR[draft.type] }} />
          {draft.id ? t('builder.editStation') : t('builder.newStation')}
        </span>
        <button onClick={onClose} className="text-zinc-500 hover:text-white text-sm">✕</button>
      </div>

      <p className="text-[11px] text-zinc-500 font-mono">📍 {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)} · {t('builder.dragHint')}</p>

      <div>
        <label className={label}>{t('builder.fieldTitle')}</label>
        <input className={field} value={draft.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
      </div>
      <div>
        <label className={label}>{t('builder.fieldTitleHe')}</label>
        <input className={field} dir="rtl" value={draft.titleHe ?? ''} onChange={(e) => set({ titleHe: e.target.value })} />
      </div>

      {isZone ? (
        <>
          <div>
            <label className={label}>{t('builder.fieldRiddle')}</label>
            <textarea rows={2} className={field} value={draft.riddle ?? ''} onChange={(e) => set({ riddle: e.target.value })} />
          </div>
          <div>
            <label className={label}>{t('builder.fieldRiddleHe')}</label>
            <textarea rows={2} className={field} dir="rtl" value={draft.riddleHe ?? ''} onChange={(e) => set({ riddleHe: e.target.value })} />
          </div>
          <div>
            <label className={label}>{t('builder.fieldMaxTeams')}</label>
            <input type="number" min={1} className={field} value={draft.maxTeams ?? 3} onChange={(e) => set({ maxTeams: Number(e.target.value) })} />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className={label}>{t('builder.fieldDesc')}</label>
            <textarea rows={2} className={field} value={draft.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
          </div>
          <div>
            <label className={label}>{t('builder.fieldDescHe')}</label>
            <textarea rows={2} className={field} dir="rtl" value={draft.descriptionHe ?? ''} onChange={(e) => set({ descriptionHe: e.target.value })} />
          </div>
          <div>
            <label className={label}>{t('builder.fieldHint')}</label>
            <input className={field} value={draft.locationHint ?? ''} onChange={(e) => set({ locationHint: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label}>{t('builder.fieldDifficulty')}</label>
              <input type="number" min={1} max={10} className={field} value={draft.difficulty ?? 5} onChange={(e) => set({ difficulty: Number(e.target.value) })} />
            </div>
            <div>
              <label className={label}>{t('builder.fieldPoints')}</label>
              <input type="number" min={0} className={field} value={draft.pointValue ?? 100} onChange={(e) => set({ pointValue: Number(e.target.value) })} />
            </div>
            <div>
              <label className={label}>{t('builder.fieldEstMin')}</label>
              <input type="number" min={1} className={field} value={draft.estimatedMinutes ?? 15} onChange={(e) => set({ estimatedMinutes: Number(e.target.value) })} />
            </div>
            <div>
              <label className={label}>{t('builder.fieldMaxTeams')}</label>
              <input type="number" min={1} className={field} value={draft.maxConcurrentTeams ?? 3} onChange={(e) => set({ maxConcurrentTeams: Number(e.target.value) })} />
            </div>
            <div>
              <label className={label}>{t('builder.fieldMaxDur')}</label>
              <input type="number" min={1} className={field} value={draft.maxDurationMinutes ?? 30} onChange={(e) => set({ maxDurationMinutes: Number(e.target.value) })} />
            </div>
            <div>
              <label className={label}>{t('builder.fieldStatus')}</label>
              <select className={field} value={draft.status ?? 'active'} onChange={(e) => set({ status: e.target.value })}>
                <option value="active">{t('builder.statusActive')}</option>
                <option value="paused">{t('builder.statusPaused')}</option>
                <option value="closed">{t('builder.statusClosed')}</option>
              </select>
            </div>
          </div>

          <SmartStationPanel draft={draft} set={set} field={field} label={label} />
        </>
      )}

      <div className="flex items-center gap-2 pt-2">
        <button onClick={onSave} disabled={busy}
          className="flex-1 py-2.5 rounded-xl bg-neon-green text-black font-bold text-sm disabled:opacity-50">
          {busy ? t('builder.saving') : t('builder.save')}
        </button>
        {draft.id && (
          <button onClick={onDelete} disabled={busy}
            className="px-4 py-2.5 rounded-xl border border-neon-red/40 text-neon-red text-sm font-semibold hover:bg-neon-red/10 disabled:opacity-50">
            {t('builder.delete')}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Smart-station guided config panel ───────────────────────────────────────
// Renders inside the task StationForm. A "Make this a smart station" toggle flips
// `smartEnabled`; when on, a grouped builder (Basics / Content & Media /
// Verification / Screens) exposes the SmartStationConfig fields. `expectedCode`
// only shows for code_verification.
const VERIFICATION_TYPES: { value: VerificationType; key: string }[] = [
  { value: 'manual_judge',     key: 'builder.smartVerifyManual' },
  { value: 'code_verification', key: 'builder.smartVerifyCode' },
  { value: 'photo_upload',     key: 'builder.smartVerifyPhoto' },
];

function SmartStationPanel({ draft, set, field, label }: {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  field: string;
  label: string;
}) {
  const { t } = useI18n();
  const enabled = draft.smartEnabled === true;
  const sc = draft.smart ?? blankSmart();
  const setSmart = (patch: Partial<SmartDraft>) => set({ smart: { ...sc, ...patch } });
  const setHint = (i: number, key: 'en' | 'he', value: string) => {
    const hints = [...(sc.hints ?? [])];
    while (hints.length <= i) hints.push({ en: '', he: '' });
    hints[i] = { ...hints[i], [key]: value };
    setSmart({ hints });
  };

  const toggle = (on: boolean) =>
    set(on ? { smartEnabled: true, smart: draft.smart ?? blankSmart() } : { smartEnabled: false });

  const section = 'text-[11px] uppercase tracking-wider text-neon-green/80 font-semibold pt-1';
  const help = 'text-[11px] text-zinc-500';

  return (
    <div className="rounded-xl border border-neon-green/25 bg-neon-green/5 p-3 space-y-3 mt-1">
      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-white text-sm font-semibold">{t('builder.smartToggle')}</span>
        <input type="checkbox" className="w-4 h-4 accent-neon-green" checked={enabled} onChange={(e) => toggle(e.target.checked)} />
      </label>
      <p className={help}>{t('builder.smartToggleHelp')}</p>

      {enabled && (
        <div className="space-y-3 pt-1">
          {/* ── Verification (drives the rest) ── */}
          <div className={section}>{t('builder.smartSecVerify')}</div>
          <div>
            <label className={label}>{t('builder.smartVerifyType')}</label>
            <select className={field} value={sc.verificationType}
              onChange={(e) => setSmart({ verificationType: e.target.value as VerificationType })}>
              {VERIFICATION_TYPES.map((v) => (
                <option key={v.value} value={v.value}>{t(v.key)}</option>
              ))}
            </select>
            <p className={help}>{t('builder.smartVerifyTypeHelp')}</p>
          </div>

          {sc.verificationType === 'code_verification' && (
            <>
              <div>
                <label className={label}>{t('builder.smartExpectedCode')}</label>
                <input className={field} value={sc.expectedCode ?? ''} placeholder={draft.id ? t('builder.smartExpectedCodePlaceholder') : ''}
                  onChange={(e) => setSmart({ expectedCode: e.target.value })} />
                <p className={help}>{t('builder.smartExpectedCodeHelp')}</p>
              </div>
              <div>
                <label className={label}>{t('builder.smartCodeLabel')}</label>
                <input className={field} value={sc.codeInputLabel ?? ''} onChange={(e) => setSmart({ codeInputLabel: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label}>{t('builder.smartAttemptLimit')}</label>
                  <input type="number" min={0} className={field} value={sc.attemptLimit ?? 0} onChange={(e) => setSmart({ attemptLimit: Number(e.target.value) })} />
                </div>
                <div>
                  <label className={label}>{t('builder.smartHintCount')}</label>
                  <input type="number" min={0} className={field} value={sc.hintCount ?? 0} onChange={(e) => setSmart({ hintCount: Number(e.target.value) })} />
                </div>
              </div>
              {(sc.hintCount ?? 0) > 0 && (
                <div className="space-y-2">
                  <label className={label}>{t('builder.smartHintTexts')}</label>
                  {Array.from({ length: Math.min(Math.floor(sc.hintCount ?? 0), 10) }).map((_, i) => (
                    <div key={i} className="grid grid-cols-2 gap-2">
                      <input className={field} placeholder={`${t('builder.smartHintEn')} ${i + 1}`}
                        value={sc.hints?.[i]?.en ?? ''} onChange={(e) => setHint(i, 'en', e.target.value)} />
                      <input className={field} dir="rtl" placeholder={`${t('builder.smartHintHe')} ${i + 1}`}
                        value={sc.hints?.[i]?.he ?? ''} onChange={(e) => setHint(i, 'he', e.target.value)} />
                    </div>
                  ))}
                  <p className={help}>{t('builder.smartHintTextsHelp')}</p>
                </div>
              )}
              <SmartCheck label={t('builder.smartAutoComplete')} checked={sc.autoCompleteOnSuccess !== false} onChange={(v) => setSmart({ autoCompleteOnSuccess: v })} />
            </>
          )}

          {sc.verificationType === 'photo_upload' && (
            <>
              <SmartCheck label={t('builder.smartPhotoReview')} checked={sc.photoReviewRequired !== false} onChange={(v) => setSmart({ photoReviewRequired: v })} />
              <SmartCheck label={t('builder.smartAllowRetry')} checked={sc.allowRetry !== false} onChange={(v) => setSmart({ allowRetry: v })} />
            </>
          )}

          {sc.verificationType === 'manual_judge' && (
            <SmartCheck label={t('builder.smartNeedsApproval')} checked={sc.needsAdminApproval !== false} onChange={(v) => setSmart({ needsAdminApproval: v })} />
          )}

          {/* ── Content & Media ── */}
          <div className={section}>{t('builder.smartSecContent')}</div>
          <div>
            <label className={label}>{t('builder.smartLongInstr')}</label>
            <textarea rows={2} className={field} value={sc.longInstructions ?? ''} onChange={(e) => setSmart({ longInstructions: e.target.value })} />
          </div>
          <div>
            <label className={label}>{t('builder.smartLongInstrHe')}</label>
            <textarea rows={2} className={field} dir="rtl" value={sc.longInstructionsHe ?? ''} onChange={(e) => setSmart({ longInstructionsHe: e.target.value })} />
          </div>
          <div>
            <label className={label}>{t('builder.smartExtraInfo')}</label>
            <textarea rows={2} className={field} value={sc.extraInfo ?? ''} onChange={(e) => setSmart({ extraInfo: e.target.value })} />
          </div>
          <div>
            <label className={label}>{t('builder.smartImageUrl')}</label>
            <input className={field} value={sc.imageUrl ?? ''} onChange={(e) => setSmart({ imageUrl: e.target.value })} />
          </div>
          <div>
            <label className={label}>{t('builder.smartMediaUrl')}</label>
            <input className={field} value={sc.mediaUrl ?? ''} onChange={(e) => setSmart({ mediaUrl: e.target.value })} />
          </div>
          <div>
            <label className={label}>{t('builder.smartAdminNotes')}</label>
            <textarea rows={2} className={field} value={sc.adminNotes ?? ''} onChange={(e) => setSmart({ adminNotes: e.target.value })} />
            <p className={help}>{t('builder.smartAdminNotesHelp')}</p>
          </div>

          {/* ── Basics (timing / flow) ── */}
          <div className={section}>{t('builder.smartSecBasics')}</div>
          <div>
            <label className={label}>{t('builder.smartTimeLimit')}</label>
            <input type="number" min={0} className={field} value={sc.timeLimitSeconds ?? 0} onChange={(e) => setSmart({ timeLimitSeconds: Number(e.target.value) })} />
            <p className={help}>{t('builder.smartTimeLimitHelp')}</p>
          </div>
          <SmartCheck label={t('builder.smartCanSkip')} checked={sc.canSkip === true} onChange={(v) => setSmart({ canSkip: v })} />

          {/* ── Screens ── */}
          <div className={section}>{t('builder.smartSecScreens')}</div>
          <SmartCheck label={t('builder.smartShowIntro')} checked={sc.showIntroScreen !== false} onChange={(v) => setSmart({ showIntroScreen: v })} />
          <SmartCheck label={t('builder.smartShowSuccess')} checked={sc.showSuccessScreen !== false} onChange={(v) => setSmart({ showSuccessScreen: v })} />
          <SmartCheck label={t('builder.smartShowFailure')} checked={sc.showFailureScreen !== false} onChange={(v) => setSmart({ showFailureScreen: v })} />
          <SmartCheck label={t('builder.smartShowPending')} checked={sc.showPendingReviewScreen !== false} onChange={(v) => setSmart({ showPendingReviewScreen: v })} />
          <SmartCheck label={t('builder.smartShowHints')} checked={sc.showHintsOverTime === true} onChange={(v) => setSmart({ showHintsOverTime: v })} />
        </div>
      )}
    </div>
  );
}

function SmartCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer py-0.5">
      <span className="text-white text-sm">{label}</span>
      <input type="checkbox" className="w-4 h-4 accent-neon-green" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
