// ───────────────────────────────────────────────────────────────────────────
// v2.1 RED-PHASE BLUEPRINT — Local playtest with shareable real links
// ───────────────────────────────────────────────────────────────────────────
// Each test.todo becomes a real failing test when implemented via /opsx:apply.
// OpenSpec change: openspec/changes/playtest-shareable-links/
// One command runs the full v2 stack locally + a tunnel, printing a creator link + a join link.
// Lane tags: [pure] · [manual] (runbook — not automatable)
import { describe, test } from 'vitest';

describe('playtest-shareable-links — run on my computer, real creator + join links', () => {
  // resolveEmulatorHost
  test.todo('[pure] resolveEmulatorHost(no override) → "127.0.0.1" (normal dev:all unchanged)');
  test.todo('[pure] resolveEmulatorHost(explicit host) → that host');
  test.todo('[pure] resolveEmulatorHost(playtest, origin) → the origin hostname (remote clients via tunnel)');

  // resolveProxyTarget
  test.todo('[pure] resolveProxyTarget(firestore path) → emulator 8080');
  test.todo('[pure] resolveProxyTarget(identitytoolkit/securetoken path) → emulator 9099');
  test.todo('[pure] resolveProxyTarget(functions path) → emulator 5001');
  test.todo('[pure] resolveProxyTarget(storage /v0/b/ path) → emulator 9199');
  test.todo('[pure] resolveProxyTarget("/creator/...") → creator-web 5180');
  test.todo('[pure] resolveProxyTarget(any other path) → play-web 5181 (no stale v1 :8081 fallback)');

  // buildPlaytestLinks
  test.todo('[pure] buildPlaytestLinks(base, code) → { creatorUrl: base+"/creator", joinUrl: base+"/?code="+code }');
  test.todo('[pure] buildPlaytestLinks(base) with no code → joinUrl is just the base play URL');

  // Runbook (manual — documented in PLAYTEST.md, not automatable)
  test.todo('[manual] npm run playtest prints a creator link and a join link once the tunnel is up');
  test.todo('[manual] a phone on a different network opens the join link and plays the seeded run');
  test.todo('[manual] the creator link opens the creator console and a creator can sign up against emulator auth');
  test.todo('[manual] paired with free-mode (#63): the test group launches/plays with no payment wall');
});
