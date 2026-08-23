// Pure-logic tests for the Builder "Game features" badge count
// (change: builder-settings-grouping).
//
// The Settings panel groups its four feature toggles into ONE collapsed
// "Game features" section whose header carries an "N on" badge. The only
// non-obvious rule is the photo-feed default inversion: `photoFeedEnabled`
// counts as ON when absent, the other three count as OFF when absent. That is
// exactly the rule the live checkboxes apply, so the badge can never disagree
// with the controls it summarizes.
//
// Three properties are asserted:
//   1. EFFECTIVE DEFAULTS — the resolved state matches each checkbox's own
//      `checked` expression, photo feed included.
//   2. TOTAL — it runs every render before `game` is guaranteed well-formed, so
//      null / non-object / number / array input yields count 0 and never throws.
//   3. WIRED — i18n.ts defines the section title + badge keys in BOTH languages,
//      because a pure count nobody renders fixes nothing.
//
//   npx tsx scripts/test-game-feature-toggles.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  gameFeatureToggleState,
  enabledGameFeatureCount,
  type GameFeatureToggleState,
} from '../apps/creator-web/src/lib/gameFeatureToggles';
import type { Game } from '@rushpoint/shared';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const here = dirname(fileURLToPath(import.meta.url));

// ─── 1. The four mandated count cases ─────────────────────────────────────────
check('empty game counts 1 (photo feed default on)', enabledGameFeatureCount({}) === 1,
  String(enabledGameFeatureCount({})));

check('photoFeedEnabled:false alone counts 0',
  enabledGameFeatureCount({ photoFeedEnabled: false } as Partial<Game>) === 0,
  String(enabledGameFeatureCount({ photoFeedEnabled: false } as Partial<Game>)));

check('all four explicitly on counts 4',
  enabledGameFeatureCount({
    allowInstantPlay: true,
    photoFeedEnabled: true,
    powerUpsEnabled: true,
    manualLeaderboardReveal: true,
  } as Partial<Game>) === 4);

check('mixed (instant+powerups on, photo off, manual absent) counts 2',
  enabledGameFeatureCount({
    allowInstantPlay: true,
    powerUpsEnabled: true,
    photoFeedEnabled: false,
  } as Partial<Game>) === 2,
  String(enabledGameFeatureCount({
    allowInstantPlay: true,
    powerUpsEnabled: true,
    photoFeedEnabled: false,
  } as Partial<Game>)));

// ─── 2. gameFeatureToggleState resolves each field to the effective boolean ───
{
  const empty = gameFeatureToggleState({});
  check('empty: allowInstantPlay resolves false', empty.allowInstantPlay === false);
  check('empty: photoFeedEnabled resolves true (default on)', empty.photoFeedEnabled === true);
  check('empty: powerUpsEnabled resolves false', empty.powerUpsEnabled === false);
  check('empty: manualLeaderboardReveal resolves false', empty.manualLeaderboardReveal === false);

  const on: Partial<Game> = {
    allowInstantPlay: true,
    photoFeedEnabled: true,
    powerUpsEnabled: true,
    manualLeaderboardReveal: true,
  } as Partial<Game>;
  const s = gameFeatureToggleState(on);
  check('all-on: every field resolves true',
    s.allowInstantPlay && s.photoFeedEnabled && s.powerUpsEnabled && s.manualLeaderboardReveal);

  const photoOff = gameFeatureToggleState({ photoFeedEnabled: false } as Partial<Game>);
  check('photoFeedEnabled:false resolves photoFeedEnabled false', photoOff.photoFeedEnabled === false);
}

// ─── 3. Totality: garbage never throws and yields count 0 ─────────────────────
for (const junk of [null, undefined, 42, 'x', []] as unknown[]) {
  let count = -1;
  let state: GameFeatureToggleState | null = null;
  let threw = false;
  try {
    count = enabledGameFeatureCount(junk as Partial<Game>);
    state = gameFeatureToggleState(junk as Partial<Game>);
  } catch { threw = true; }
  check(`junk ${JSON.stringify(junk) ?? String(junk)} does not throw`, !threw);
  check(`junk ${JSON.stringify(junk) ?? String(junk)} counts 0`, count === 0, String(count));
  check(`junk ${JSON.stringify(junk) ?? String(junk)} resolves all false`,
    !!state && !state.allowInstantPlay && !state.photoFeedEnabled &&
    !state.powerUpsEnabled && !state.manualLeaderboardReveal);
}

// ─── 4. Wiring guard — the new i18n keys exist in BOTH language maps ──────────
function read(...parts: string[]): string {
  return readFileSync(join(here, '..', ...parts), 'utf8');
}
const creatorI18n = read('apps', 'creator-web', 'src', 'i18n.ts');
for (const key of ['featuresSection', 'featuresOnBadge']) {
  const hits = creatorI18n.split(`${key}:`).length - 1;
  check(`creator-web i18n defines ${key} in BOTH languages`, hits >= 2, `${hits} occurrence(s)`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
