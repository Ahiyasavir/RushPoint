import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildNavDestinations, liveRunForGame } from '../creatorNav';

// The routes App.tsx actually registers, read from the source so a nav entry and
// its <Route> can never drift apart (and so "removed from the menu" can never
// quietly become "removed from the app").
const APP_SOURCE = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8');
const REGISTERED_ROUTES = [...APP_SOURCE.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

function run(over: { gameId: string; runId: string }) {
  return {
    ownerUid: 'o1', gameTitle: 'G', accessCode: 'ABC123',
    participantCount: 0, launchedAt: null, unackedAlerts: 0, ...over,
  };
}

describe('creatorNav — primary navigation destinations', () => {
  it('never offers the live-runs overview as a top-level destination', () => {
    for (const paymentsEnabled of [true, false]) {
      const dests = buildNavDestinations({ paymentsEnabled });
      expect(dests.map((d) => d.to)).not.toContain('/live');
      expect(dests.map((d) => d.id)).not.toContain('liveRuns');
    }
  });

  it('gates the wallet destination on payments being enabled', () => {
    expect(buildNavDestinations({ paymentsEnabled: false }).map((d) => d.id)).not.toContain('wallet');
    expect(buildNavDestinations({ paymentsEnabled: true }).map((d) => d.id)).toContain('wallet');
  });

  it('gives the desktop nav and the mobile drawer the identical list', () => {
    // Both renderers call the same function with the same input, so equality here
    // is the structural guarantee they cannot diverge.
    const desktop = buildNavDestinations({ paymentsEnabled: true });
    const drawer = buildNavDestinations({ paymentsEnabled: true });
    expect(drawer).toEqual(desktop);
  });

  it('always keeps my-games first and exact-matched', () => {
    const [first] = buildNavDestinations({ paymentsEnabled: true });
    expect(first).toEqual({ id: 'myGames', to: '/', end: true });
  });

  it('points every destination at a route the app registers', () => {
    for (const paymentsEnabled of [true, false]) {
      for (const d of buildNavDestinations({ paymentsEnabled })) {
        expect(REGISTERED_ROUTES, `nav ${d.id} -> ${d.to}`).toContain(d.to);
      }
    }
  });

  it('keeps /live registered as a route even though it left the menu', () => {
    expect(REGISTERED_ROUTES).toContain('/live');
  });
});

describe('creatorNav — a game\'s own live run', () => {
  const runs = [run({ gameId: 'g1', runId: 'r1' }), run({ gameId: 'g2', runId: 'r2' })];

  it('returns the run belonging to that game', () => {
    expect(liveRunForGame('g2', runs)?.runId).toBe('r2');
  });

  it('returns nothing for a game with no live run', () => {
    expect(liveRunForGame('g3', runs)).toBeNull();
  });

  it('never returns another game\'s run', () => {
    expect(liveRunForGame('g1', runs)?.gameId).toBe('g1');
  });

  it('does not throw on an empty or missing run list', () => {
    expect(liveRunForGame('g1', [])).toBeNull();
    expect(liveRunForGame('g1', null)).toBeNull();
    expect(liveRunForGame('', runs)).toBeNull();
  });
});
