// The places a creator named for a game (change: place-setup-named-spots). Ahiya, 3.11: ask once for
// every place, with several forests or parks, each with a name, and "remember these locations, so when
// the app is used a lot it already knows where there is a forest or a mall". Pure and total.

export interface PlaceSpot {
  id: string;
  /** A place kind of the composer (park, forest, branch...). */
  kind: string;
  /** What the creator calls it ("פארק הירקון"); '' when unnamed. */
  name: string;
  lat: number;
  lng: number;
}

export const MAX_PLACE_SPOTS = 40;
export const MAX_PLACE_SPOT_NAME = 60;

/** A clean copy, or null when anything in it is malformed. `[]` is valid and clears the list. */
export function normalizePlaceSpots(v: unknown): PlaceSpot[] | null {
  if (!Array.isArray(v) || v.length > MAX_PLACE_SPOTS) return null;
  const out: PlaceSpot[] = [];
  for (const s of v) {
    if (!s || typeof s !== 'object') return null;
    const { id, kind, name, lat, lng } = s as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return null;
    if (typeof kind !== 'string' || !/^[A-Za-z]{1,20}$/.test(kind)) return null;
    const n = typeof name === 'string' ? name.trim() : name === undefined ? '' : null;
    if (n === null || n.length > MAX_PLACE_SPOT_NAME) return null;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
    if (typeof lng !== 'number' || !Number.isFinite(lng) || Math.abs(lng) > 180) return null;
    out.push({ id, kind, name: n, lat, lng });
  }
  return out;
}

/** The spots that may teach the platform where places are: never a home, which is someone's address. */
export function memorablePlaceSpots(spots: readonly PlaceSpot[] | null | undefined): PlaceSpot[] {
  return (spots ?? []).filter((s) => s && s.kind !== 'home');
}
