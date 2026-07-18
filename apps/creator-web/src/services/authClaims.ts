// Pure helper (no Firebase SDK, no Vite env) so it's unit-testable in the node lane.
// Builds the claims used as the Auth-emulator Google `id_token` when bridging a real
// Google identity into the emulated `auth` (unify-email-google-login). Passing these as a
// GoogleAuthProvider credential lets the emulator link google.com onto an existing
// password account (same uid) instead of failing on a synthetic-password mismatch.

export interface GoogleIdentity {
  uid: string;
  email: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}

export interface EmulatorGoogleClaims {
  sub: string;
  email: string;
  email_verified: true;
  name?: string;
  picture?: string;
}

export function buildEmulatorGoogleClaims(id: GoogleIdentity): EmulatorGoogleClaims {
  const claims: EmulatorGoogleClaims = {
    sub: id.uid,
    email: id.email ?? '',
    email_verified: true,
  };
  if (id.displayName) claims.name = id.displayName;
  if (id.photoURL) claims.picture = id.photoURL;
  return claims;
}
