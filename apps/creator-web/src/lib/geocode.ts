// Place search behind the Builder's map picker.
//
// ─── Why Nominatim is PRIMARY and MapTiler is the fallback ───────────────────
// The tile style and the geocoder used to be chosen by the same switch: "is a
// MapTiler key configured?". Adding the key therefore silently moved address
// search off OpenStreetMap's Nominatim and onto MapTiler's geocoder — and
// MapTiler's Israeli/Hebrew address coverage is far weaker. A real creator typing
// "רמות משעול מורן 3" (a street in Ramot, Jerusalem) got Rehovot, Karmiel,
// Menashe and Ofakim back; Nominatim returns the exact house number, first hit.
// Adding `proximity` to the MapTiler call made it WORSE, so this is a coverage
// gap, not a tuning one.
//
// So the two decisions are now separate: tiles still follow the key, search asks
// Nominatim first and only falls back to MapTiler when Nominatim errors or has
// nothing (a rate limit, a blocked host, a market Nominatim covers poorly).
//
// Every function here is total: a malformed or partial provider payload yields
// the entries that ARE usable and drops the rest — a geocoder is a suggestion
// box, and one bad row must never take the whole result list down.
//
// Unit-tested by scripts/test-geocode.ts (auto-discovered by `npm test`).

/** One search hit. `detail` is the administrative tail, shown smaller. */
export interface GeoResult {
  label: string;
  detail: string;
  lat: number;
  lng: number;
}

/** The map view a search is biased towards (the creator is looking at it). */
export interface GeoBias {
  lat: number;
  lng: number;
}

/** Half-width of the Nominatim `viewbox` bias, in degrees (~40 km). */
const BIAS_DEG = 0.35;

/**
 * Minimum gap between two Nominatim requests, per the OSM Nominatim Usage Policy
 * (https://operations.osmfoundation.org/policies/nominatim/), which caps public
 * use at one request per second.
 *
 * Search here is already deliberately press-to-search rather than
 * autocomplete-as-you-type — that decision is the main reason volume stays in
 * "a handful per creator per game" territory instead of one request per keystroke.
 * This gate is the belt to that braces: a double-tapped button, a held Enter key
 * or a future caller that loops cannot exceed the documented rate.
 */
export const NOMINATIM_MIN_INTERVAL_MS = 1000;

/**
 * How long to wait before the next Nominatim request may go out.
 *
 * Total and conservative: an absent, malformed or FUTURE last-request stamp (a
 * clock moved backwards) yields the full interval rather than 0, because the
 * failure that matters is exceeding someone else's published rate limit.
 */
export function nominatimDelayMs(lastRequestAtMs: unknown, nowMs: unknown): number {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return NOMINATIM_MIN_INTERVAL_MS;
  if (lastRequestAtMs === null || lastRequestAtMs === undefined) return 0;
  if (typeof lastRequestAtMs !== 'number' || !Number.isFinite(lastRequestAtMs)) {
    return NOMINATIM_MIN_INTERVAL_MS;
  }
  const elapsed = nowMs - lastRequestAtMs;
  if (elapsed < 0) return NOMINATIM_MIN_INTERVAL_MS;
  if (elapsed >= NOMINATIM_MIN_INTERVAL_MS) return 0;
  return NOMINATIM_MIN_INTERVAL_MS - elapsed;
}

/** When the last Nominatim request went out. Module state: one gate per tab. */
let lastNominatimAt: number | null = null;

/** Test seam — resets the rate gate so suites stay order-independent. */
export function __resetNominatimRateGate(): void {
  lastNominatimAt = null;
}

const isFiniteNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function validBias(bias?: GeoBias): GeoBias | undefined {
  if (!bias || !isFiniteNum(bias.lat) || !isFiniteNum(bias.lng)) return undefined;
  if (Math.abs(bias.lat) > 90 || Math.abs(bias.lng) > 180) return undefined;
  if (bias.lat === 0 && bias.lng === 0) return undefined; // the unplaced sentinel
  return bias;
}

/**
 * Split a Nominatim `display_name` into a headline and an administrative tail.
 *
 * The raw string is up to eight comma-separated parts ending in a postcode and
 * the country, which on a phone wraps to three unreadable lines. The first two
 * parts identify the place ("3, משעול מורן"); the next two locate it
 * ("רמות ב, ירושלים"); the rest is filing. Numeric-only parts (postcodes) are
 * dropped wherever they sit.
 */
export function splitPlaceLabel(displayName: string): { label: string; detail: string } {
  const parts = String(displayName ?? '')
    .split(',')
    .map((p) => p.trim())
    // Drop postcodes (5+ digits), never house numbers: "3" is the FIRST part of
    // "3, משעול מורן, …" and dropping it silently answered a different address.
    .filter((p) => p !== '' && !/^\d{5,}$/.test(p.replace(/[\s-]/g, '')));
  if (parts.length === 0) return { label: String(displayName ?? '').trim(), detail: '' };
  return {
    label: parts.slice(0, 2).join(', '),
    detail: parts.slice(2, 4).join(', '),
  };
}

/** The Nominatim search URL: IL-biased, Hebrew, and biased to the current view. */
export function nominatimUrl(query: string, bias?: GeoBias, limit = 6): string {
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query.trim(),
    limit: String(limit),
    'accept-language': 'he',
    countrycodes: 'il',
  });
  const b = validBias(bias);
  if (b) {
    // left,top,right,bottom. Deliberately NOT `bounded=1`: this ranks nearby hits
    // up, it must never hide a match outside the current view (a creator often
    // searches for the place BEFORE moving the map anywhere near it).
    params.set(
      'viewbox',
      [b.lng - BIAS_DEG, b.lat + BIAS_DEG, b.lng + BIAS_DEG, b.lat - BIAS_DEG]
        .map((n) => n.toFixed(4))
        .join(','),
    );
  }
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

/** The MapTiler geocoding URL (fallback provider). */
export function maptilerUrl(query: string, key: string, limit = 6): string {
  const params = new URLSearchParams({
    key: key.trim(),
    language: 'he',
    country: 'il',
    limit: String(limit),
  });
  return `https://api.maptiler.com/geocoding/${encodeURIComponent(query.trim())}.json?${params.toString()}`;
}

/** Parse a Nominatim `jsonv2` payload, keeping only rows with usable coordinates. */
export function parseNominatim(raw: unknown): GeoResult[] {
  if (!Array.isArray(raw)) return [];
  const out: GeoResult[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as { display_name?: unknown; lat?: unknown; lon?: unknown; name?: unknown };
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (!isFiniteNum(lat) || !isFiniteNum(lng)) continue;
    const name = typeof r.display_name === 'string' ? r.display_name
      : typeof r.name === 'string' ? r.name : '';
    const { label, detail } = splitPlaceLabel(name);
    if (!label) continue;
    out.push({ label, detail, lat, lng });
  }
  return dedupe(out);
}

/** Parse a MapTiler geocoding payload. */
export function parseMapTiler(raw: unknown): GeoResult[] {
  const features = (raw as { features?: unknown } | null | undefined)?.features;
  if (!Array.isArray(features)) return [];
  const out: GeoResult[] = [];
  for (const f of features) {
    if (!f || typeof f !== 'object') continue;
    const feat = f as { place_name?: unknown; text?: unknown; center?: unknown };
    const center = feat.center;
    if (!Array.isArray(center) || center.length < 2) continue;
    const lng = Number(center[0]);
    const lat = Number(center[1]);
    if (!isFiniteNum(lat) || !isFiniteNum(lng)) continue;
    const name = typeof feat.place_name === 'string' ? feat.place_name
      : typeof feat.text === 'string' ? feat.text : '';
    const { label, detail } = splitPlaceLabel(name);
    if (!label) continue;
    out.push({ label, detail, lat, lng });
  }
  return dedupe(out);
}

/**
 * Drop rows that name the same spot. Nominatim happily returns a node, a way and
 * a relation for one landmark (the Kotel comes back three times), which spends
 * the whole visible list on a single answer.
 */
function dedupe(results: GeoResult[]): GeoResult[] {
  const seen = new Set<string>();
  const out: GeoResult[] = [];
  for (const r of results) {
    const key = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}|${r.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * Search for a place. Nominatim first, MapTiler only if Nominatim gave nothing.
 *
 * Throws only when EVERY provider that could answer failed — an empty array
 * means "no such place", which the caller words differently from "search is
 * down". Getting that distinction wrong is what makes a search box feel broken.
 */
export async function geocodePlaces(
  query: string,
  opts: {
    key?: string;
    bias?: GeoBias;
    fetchImpl?: FetchLike;
    /** Injectable clock + sleep, so the rate gate is testable without waiting. */
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<GeoResult[]> {
  const q = query.trim();
  if (!q) return [];
  const doFetch: FetchLike = opts.fetchImpl
    ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
  const key = opts.key?.trim();
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));

  let primaryFailed = false;
  try {
    // Respect the published one-request-per-second cap before every call. Waiting
    // rather than dropping: the request came from a creator pressing Search, and
    // silently doing nothing would read as a broken button.
    const wait = nominatimDelayMs(lastNominatimAt, now());
    if (wait > 0) await sleep(wait);
    lastNominatimAt = now();
    const r = await doFetch(nominatimUrl(q, opts.bias), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('nominatim failed');
    const hits = parseNominatim(await r.json());
    if (hits.length > 0) return hits;
  } catch {
    primaryFailed = true;
  }

  if (!key) {
    if (primaryFailed) throw new Error('geocode failed');
    return [];
  }

  try {
    const r = await doFetch(maptilerUrl(q, key), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('maptiler failed');
    return parseMapTiler(await r.json());
  } catch {
    if (primaryFailed) throw new Error('geocode failed');
    return [];
  }
}
