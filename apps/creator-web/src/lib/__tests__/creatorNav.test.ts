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

  it('hides the admin dashboard from an ordinary creator', () => {
    for (const paymentsEnabled of [true, false]) {
      const ids = buildNavDestinations({ paymentsEnabled, isAdmin: false }).map((d) => d.id);
      expect(ids).not.toContain('admin');
    }
  });

  it('defaults to hiding the admin destination when adminness is not stated', () => {
    // Fail CLOSED. A caller that forgets to pass the flag must not leak an admin entry
    // into every creator's menu; the omission has to read as "not an admin".
    expect(buildNavDestinations({ paymentsEnabled: true }).map((d) => d.id)).not.toContain('admin');
  });

  it('offers the admin dashboard to an admin, pointing at a REGISTERED route', () => {
    const dests = buildNavDestinations({ paymentsEnabled: true, isAdmin: true });
    const adminDest = dests.find((d) => d.id === 'admin');
    expect(adminDest).toBeDefined();
    expect(adminDest!.to).toBe('/admin/users');
    // The whole point of reading App.tsx above: a menu entry to a route that does not
    // exist is a dead link shipped to the one person who would use it.
    expect(REGISTERED_ROUTES).toContain(adminDest!.to);
  });

  it('offers the admin templates console to an admin, pointing at a REGISTERED route', () => {
    const dests = buildNavDestinations({ paymentsEnabled: true, isAdmin: true });
    const templatesDest = dests.find((d) => d.id === 'adminTemplates');
    expect(templatesDest).toBeDefined();
    expect(templatesDest!.to).toBe('/admin/templates');
    expect(REGISTERED_ROUTES).toContain(templatesDest!.to);
  });

  it('hides the admin templates console from an ordinary creator, and by default', () => {
    // Same fail-closed rule as the users dashboard: forgetting the flag must not
    // leak an admin-only entry into every creator's menu.
    for (const opts of [{ paymentsEnabled: true, isAdmin: false }, { paymentsEnabled: true }]) {
      expect(buildNavDestinations(opts).map((d) => d.id)).not.toContain('adminTemplates');
    }
  });

  it('keeps EVERY admin entry at the tail, so none displaces an everyday destination', () => {
    // Generalised from "the admin entry is last" when a second admin destination
    // (game templates) was added: the guarantee was never about one specific id,
    // it was that admin-only entries sit behind the destinations every creator uses.
    const ADMIN_IDS = ['admin', 'adminTemplates'];
    const ids = buildNavDestinations({ paymentsEnabled: true, isAdmin: true }).map((d) => d.id);
    const firstAdminAt = ids.findIndex((id) => ADMIN_IDS.includes(id));
    expect(firstAdminAt).toBeGreaterThan(-1);
    // Nothing after the first admin entry may be an everyday destination.
    expect(ids.slice(firstAdminAt).every((id) => ADMIN_IDS.includes(id))).toBe(true);
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
