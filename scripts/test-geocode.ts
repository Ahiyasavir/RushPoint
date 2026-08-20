// Pure-logic test for the Builder's place search (change: builder-map-search-fix).
//
// The reported failure: a creator typed a real Jerusalem street and got four
// other towns back, in a result list so low-contrast it read as disabled. Two
// distinct defects, one screen:
//
//  1. PROVIDER. The geocoder was picked by the same switch as the tiles ("is a
//     MapTiler key set?"), so configuring the key silently moved address search
//     off Nominatim, whose Hebrew/Israeli coverage is far better. Nominatim is
//     the primary again, MapTiler the fallback — assert that ORDER, since it is
//     the whole fix and nothing else in the app records it.
//  2. LABELS. `display_name` is up to eight comma-separated parts ending in a
//     postcode and "ישראל"; the head/tail split is what makes a row readable on
//     a phone.
//
// No network: every provider call goes through an injected fetch.
//   npx tsx scripts/test-geocode.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  splitPlaceLabel,
  nominatimUrl,
  maptilerUrl,
  parseNominatim,
  parseMapTiler,
  geocodePlaces,
  nominatimDelayMs,
  NOMINATIM_MIN_INTERVAL_MS,
  __resetNominatimRateGate,
} from '../apps/creator-web/src/lib/geocode';

// ─── This suite must NEVER touch the network ─────────────────────────────────
// Nominatim is a donated public service with a published rate limit, so a test
// run — let alone CI, which runs this on every push — must not send it traffic.
// Every provider call in this file goes through an injected fetch; this stub is
// the proof rather than the intention: if any assertion below ever reaches the
// real `fetch`, the suite fails loudly instead of quietly spamming OSM.
let realFetchCalls = 0;
(globalThis as { fetch?: unknown }).fetch = (url: unknown) => {
  realFetchCalls++;
  throw new Error(`test-geocode must not hit the network (attempted: ${String(url)})`);
};

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── splitPlaceLabel ──────────────────────────────────────────────────────────
console.log('\n── splitPlaceLabel ──');

const real = '3, משעול מורן, רמות ב, ירושלים, נפת ירושלים, מחוז ירושלים, 9754901, ישראל';
const split = splitPlaceLabel(real);
check('headline is the house number + street', split.label === '3, משעול מורן', split.label);
check('detail is the neighbourhood + city', split.detail === 'רמות ב, ירושלים', split.detail);
check('the postcode never reaches the screen', !`${split.label}${split.detail}`.includes('9754901'));

const short = splitPlaceLabel('הכותל המערבי, ישראל');
check('a two-part name keeps both parts', short.label === 'הכותל המערבי, ישראל', short.label);
check('a two-part name has no detail line', short.detail === '');

// Total on junk: no throw, no undefined.
for (const junk of ['', '   ', ',,,', '12345', undefined as unknown as string, null as unknown as string]) {
  const r = splitPlaceLabel(junk);
  check(`total on ${JSON.stringify(junk)}`, typeof r.label === 'string' && typeof r.detail === 'string');
}

// ── nominatimUrl ─────────────────────────────────────────────────────────────
console.log('\n── nominatimUrl ──');

const plain = new URL(nominatimUrl('משעול מורן'));
check('hits Nominatim', plain.host === 'nominatim.openstreetmap.org');
check('asks for Hebrew names', plain.searchParams.get('accept-language') === 'he');
check('restricted to the launch market', plain.searchParams.get('countrycodes') === 'il');
check('no viewbox without a bias', plain.searchParams.get('viewbox') === null);

const biased = new URL(nominatimUrl('הכותל המערבי', { lat: 31.78, lng: 35.21 }));
const box = (biased.searchParams.get('viewbox') ?? '').split(',').map(Number);
check('a bias becomes a viewbox', box.length === 4 && box.every(Number.isFinite), String(box));
check('the viewbox surrounds the bias point',
  box[0] < 35.21 && box[2] > 35.21 && box[3] < 31.78 && box[1] > 31.78, String(box));
// NOT bounded: a creator searches for the place before moving the map to it.
check('the bias never HIDES far-away matches', biased.searchParams.get('bounded') === null);

// The {0,0} sentinel is "unplaced", not the Gulf of Guinea.
check('the unplaced sentinel is not used as a bias',
  new URL(nominatimUrl('x', { lat: 0, lng: 0 })).searchParams.get('viewbox') === null);
for (const bad of [{ lat: NaN, lng: 3 }, { lat: 91, lng: 3 }, { lat: 3, lng: 200 }]) {
  check(`a malformed bias is dropped, not sent (${JSON.stringify(bad)})`,
    new URL(nominatimUrl('x', bad)).searchParams.get('viewbox') === null);
}

// ── maptilerUrl ──────────────────────────────────────────────────────────────
console.log('\n── maptilerUrl ──');
const mt = new URL(maptilerUrl('רחוב יפו 1', ' KEY123 '));
check('hits MapTiler', mt.host === 'api.maptiler.com');
check('the key is trimmed', mt.searchParams.get('key') === 'KEY123');
check('the query is path-encoded', mt.pathname.includes(encodeURIComponent('רחוב יפו 1')));

// ── parsers ──────────────────────────────────────────────────────────────────
console.log('\n── parsers ──');

const nomPayload = [
  { display_name: real, lat: '31.8095263', lon: '35.1925878' },
  { display_name: real, lat: '31.8095263', lon: '35.1925878' }, // node + way for one spot
  { display_name: 'no coords here', lat: 'abc', lon: '35' },
  null,
  'garbage',
];
const nom = parseNominatim(nomPayload);
check('one usable row survives the junk', nom.length === 1, JSON.stringify(nom));
check('coordinates are numbers', typeof nom[0]?.lat === 'number' && typeof nom[0]?.lng === 'number');
check('the duplicate spot is dropped', nom.filter((r) => r.label === '3, משעול מורן').length === 1);
check('a non-array payload yields []', parseNominatim({ error: 'rate limited' }).length === 0);

const mtPayload = {
  features: [
    { place_name: 'מורן, רחובות, ישראל', center: [34.77, 31.89] },
    { place_name: 'broken', center: [34.77] },
    { text: 'fallback name', center: ['x', 'y'] },
  ],
};
const mtHits = parseMapTiler(mtPayload);
check('MapTiler: only the well-formed feature survives', mtHits.length === 1, JSON.stringify(mtHits));
check('MapTiler centers are [lng, lat]', mtHits[0]?.lng === 34.77 && mtHits[0]?.lat === 31.89);
check('MapTiler: a payload with no features yields []', parseMapTiler({}).length === 0);
check('MapTiler: null yields []', parseMapTiler(null).length === 0);

// ── geocodePlaces: provider ORDER is the fix ─────────────────────────────────
// (wrapped in a function: tsx transforms these scripts to CJS, which has no
// top-level await.)
async function run(): Promise<void> {
  console.log('\n── geocodePlaces ──');

  type Call = string;
  function fakeFetch(routes: Record<'nominatim' | 'maptiler', { ok: boolean; body: unknown }>, calls: Call[]) {
    return async (url: string) => {
      const which = url.includes('nominatim') ? 'nominatim' : 'maptiler';
      calls.push(which);
      const r = routes[which];
      if (!r) throw new Error('network down');
      return { ok: r.ok, json: async () => r.body };
    };
  }

  const good = { ok: true, body: nomPayload };
  const mtGood = { ok: true, body: mtPayload };

  {
    const calls: Call[] = [];
    const hits = await geocodePlaces('משעול מורן', {
      key: 'K', fetchImpl: fakeFetch({ nominatim: good, maptiler: mtGood }, calls),
    });
    check('Nominatim is asked FIRST', calls[0] === 'nominatim', calls.join(','));
    check('MapTiler is not called when Nominatim answers', !calls.includes('maptiler'), calls.join(','));
    check('the Nominatim hit is returned', hits[0]?.label === '3, משעול מורן');
  }

  {
    const calls: Call[] = [];
    const hits = await geocodePlaces('x', {
      key: 'K', fetchImpl: fakeFetch({ nominatim: { ok: false, body: null }, maptiler: mtGood }, calls),
    });
    check('a failed Nominatim falls back to MapTiler', calls.join(',') === 'nominatim,maptiler', calls.join(','));
    check('the fallback result is returned', hits.length === 1);
  }

  {
    const calls: Call[] = [];
    const hits = await geocodePlaces('x', {
      key: 'K', fetchImpl: fakeFetch({ nominatim: { ok: true, body: [] }, maptiler: mtGood }, calls),
    });
    check('an EMPTY Nominatim also falls back', calls.join(',') === 'nominatim,maptiler');
    check('the fallback result is returned after an empty primary', hits.length === 1);
  }

  {
    // Both down ⇒ throw, so the UI says "search is down" and not "no such place".
    let threw = false;
    try {
      await geocodePlaces('x', {
        key: 'K',
        fetchImpl: fakeFetch({ nominatim: { ok: false, body: null }, maptiler: { ok: false, body: null } }, []),
      });
    } catch { threw = true; }
    check('both providers down throws', threw);
  }

  {
    // Nominatim simply has nothing and there is no key: that is "no such place".
    const hits = await geocodePlaces('zzzz', {
      fetchImpl: fakeFetch({ nominatim: { ok: true, body: [] }, maptiler: mtGood }, []),
    });
    check('no key + empty primary is an empty list, not an error', hits.length === 0);
  }

  check('a blank query never hits the network',
    (await geocodePlaces('   ', { fetchImpl: async () => { throw new Error('should not fetch'); } })).length === 0);

  // ── the component actually uses it ───────────────────────────────────────────
  console.log('\n── LocationPicker wiring ──');
  const picker = readFileSync(join(process.cwd(), 'apps/creator-web/src/components/LocationPicker.tsx'), 'utf8');
  check('the picker calls the shared geocoder', /geocodePlaces\(/.test(picker));
  check('no hand-rolled provider URL is left in the component',
    !picker.includes('nominatim.openstreetmap.org') && !picker.includes('api.maptiler.com/geocoding'));
  check('the search is biased to the map view', /bias/.test(picker));
  // The reversed zinc scale is why the result list read as disabled — see the
  // comment in LocationPicker. Never let `text-zinc-*` back into these rows.
  const listBlock = picker.slice(picker.indexOf('role="listbox"'), picker.indexOf('role="listbox"') + 1400);
  check('result rows use --ink tokens, not the reversed zinc scale',
    listBlock.includes('text-[--ink-1]') && !/text-zinc-\d/.test(listBlock));
  check('result rows are real tap targets', listBlock.includes('min-h-[44px]'));

  // ── the RTL label fix is wired into EVERY map ────────────────────────────────
  console.log('\n── RTL map labels ──');
  const maps = [
    'apps/creator-web/src/components/GalleryMap.tsx',
    'apps/creator-web/src/components/HeatmapMap.tsx',
    'apps/creator-web/src/components/LiveTeamMap.tsx',
    'apps/creator-web/src/components/LocationPicker.tsx',
    'apps/creator-web/src/components/RoutePreviewMap.tsx',
    'apps/play-web/src/components/NavMap.tsx',
    'apps/play-web/src/components/StaffTeamMap.tsx',
  ];
  for (const m of maps) {
    const src = readFileSync(join(process.cwd(), m), 'utf8');
    check(`${m} registers the RTL text plugin`, src.includes('ensureRtlTextPlugin(maplibregl)'));
  }
  for (const lib of ['apps/creator-web/src/lib/mapRtl.ts', 'apps/play-web/src/lib/mapRtl.ts']) {
    const src = readFileSync(join(process.cwd(), lib), 'utf8');
    // A map must not depend on a third-party CDN being reachable.
    check(`${lib} serves the plugin from our own bundle`, src.includes('?url') && !src.includes('unpkg.com'));
    check(`${lib} loads it lazily`, /setRTLTextPlugin\(rtlPluginUrl, true\)/.test(src));
  }

  console.log(`\n${failures === 0 ? 'ALL GEOCODE TESTS PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);

}

void run();
