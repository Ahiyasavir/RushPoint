// The canonical public origins for the two apps — the ONE place they are named.
//
// Every cross-app link resolves as `import.meta.env.VITE_*_URL ?? <fallback>`.
// That fallback used to be the Firebase default host (`rushpoint-play.web.app` /
// `rushpoint-creator.web.app`), copied into eight separate files. So any build
// where the env var was missing or misspelled silently shipped links to the old
// Firebase hosts instead of the real domain — and nothing failed, because a
// wrong-but-live URL looks exactly like a right one.
//
// The project has a real domain. These constants are the fallback now, and
// `scripts/test-canonical-hosts.ts` fails if a `.web.app` literal reappears in
// app source, so the duplication cannot silently return.
//
// Framework-free on purpose (packages/shared has no React/Vite dependency):
// these are plain strings, and each app still prefers its own env var.

/** Participant app (play-web). */
export const CANONICAL_PLAY_URL = 'https://rush-point.com';

/** Creator console (creator-web). */
export const CANONICAL_CREATOR_URL = 'https://creator.rush-point.com';

/**
 * Firebase default hosts, kept ONLY so the guard test and the hosting redirect
 * have a single list to check against. Never link to these.
 */
export const LEGACY_FIREBASE_HOSTS = [
  'rushpoint-play.web.app',
  'rushpoint-creator.web.app',
  'rushpoint-pwa-7daaa.web.app',
  'rushpoint.web.app',
] as const;
