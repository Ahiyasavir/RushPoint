// ─── Google Play TWA packaging helpers ────────────────────────────────────────
//
// The participant PWA (play-web) reaches Google Play as a Trusted Web Activity
// (TWA): a thin Android wrapper Google verifies against the web origin via a
// Digital Asset Links file served at /.well-known/assetlinks.json. If that file
// is missing/empty or malformed, the app fails origin verification and renders
// with a browser URL bar instead of full-screen. Separately, Play's install
// criteria require the web manifest to declare specific fields (name, standalone
// display, a 512 icon in both `any` and `maskable` purposes, …).
//
// These helpers build + validate both artifacts DETERMINISTICALLY (no I/O), so a
// broken assetlinks payload or a regressed manifest is caught by a unit test and
// by `npm run play:store:check` before anything reaches a Play upload. Pure logic
// on purpose — fully testable without an emulator or the Android toolchain.

/** Canonical Android application id for the play-web TWA — pinned to the package name the Play Console listing was created with. */
export const PLAY_PACKAGE_NAME = 'com.rushpoint.app';

/**
 * Lowest Android API level Google Play accepts for a new app or an update.
 * Play raises this every year and REJECTS uploads below it. Bubblewrap picks the
 * level when it generates the Android project, so nothing in this repo would
 * otherwise notice a stale value — `validateAndroidTargetSdk` +
 * `npm run play:store:check` close that gap.
 *
 * API 36 = Android 16, the newest stable level and the highest we can target
 * (there is no released 37). Play's rule is "within one year of the latest
 * release", so targeting the newest — rather than merely the current floor —
 * buys the longest possible runway before another forced bump: the floor rises
 * to 36 on 31 Aug 2026, and an app already on 36 needs no action then.
 * Must stay <= compileSdkVersion in app/build.gradle (currently 36).
 */
export const PLAY_MIN_TARGET_SDK = 36;

/** One Digital Asset Links statement — grants a package permission to handle the origin's URLs. */
export interface AssetLinkStatement {
  relation: string[];
  target: {
    namespace: 'android_app';
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}

/** Result of validating an assetlinks payload. */
export interface AssetLinksValidation {
  ok: boolean;
  problems: string[];
}

/** Result of validating a web manifest against Play/TWA install criteria. */
export interface ManifestValidation {
  ok: boolean;
  missing: string[];
}

const HANDLE_ALL_URLS = 'delegate_permission/common.handle_all_urls';

/**
 * Canonicalize a SHA-256 signing-certificate fingerprint to the uppercase,
 * colon-separated hex form Google expects (e.g. `AA:BB:...:99`). Accepts input
 * with or without colons, any case, surrounding whitespace. Throws if the value
 * does not decode to exactly 32 bytes (64 hex chars) — a fingerprint that is not
 * a real SHA-256 digest would silently break verification.
 */
export function normalizeFingerprint(raw: string): string {
  const hex = (raw ?? '').trim().replace(/:/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) {
    throw new Error(
      `Invalid SHA-256 fingerprint: expected 32 hex-encoded bytes (64 chars), got ${hex.length} char(s)`,
    );
  }
  return (hex.match(/.{2}/g) as string[]).join(':');
}

/**
 * Whether `pkg` is a syntactically valid Android application id: two or more
 * dot-separated segments, each starting with a letter and containing only
 * letters, digits, or underscores.
 */
export function isValidAndroidPackageName(pkg: string): boolean {
  if (typeof pkg !== 'string' || pkg.length === 0) return false;
  const segments = pkg.split('.');
  if (segments.length < 2) return false;
  return segments.every((s) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s));
}

/**
 * Build the Digital Asset Links payload: a single statement granting the given
 * package permission to handle all of the origin's URLs, verified by the given
 * SHA-256 fingerprint(s). Multiple fingerprints (e.g. a local upload key + the
 * Play-managed app-signing key) are normalized and deduped into one statement.
 * Throws on an invalid package name, an empty fingerprint list, or a malformed
 * fingerprint.
 */
export function buildAssetLinks(packageName: string, fingerprints: string[]): AssetLinkStatement[] {
  if (!isValidAndroidPackageName(packageName)) {
    throw new Error(`Invalid Android package name: ${JSON.stringify(packageName)}`);
  }
  if (!Array.isArray(fingerprints) || fingerprints.length === 0) {
    throw new Error('At least one SHA-256 fingerprint is required');
  }
  const normalized = fingerprints.map(normalizeFingerprint);
  const deduped = Array.from(new Set(normalized));
  return [
    {
      relation: [HANDLE_ALL_URLS],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: deduped,
      },
    },
  ];
}

/**
 * Validate a parsed assetlinks.json value. Reports whether it is a well-formed,
 * non-empty Asset Links payload usable for TWA verification, naming every
 * problem found. The current committed state (`[]`) is reported as not-ready.
 */
export function validateAssetLinks(value: unknown): AssetLinksValidation {
  const problems: string[] = [];
  if (!Array.isArray(value)) {
    return { ok: false, problems: ['assetlinks payload must be a JSON array of statements'] };
  }
  if (value.length === 0) {
    return { ok: false, problems: ['assetlinks payload has no statements (empty array) — generate it with the signing fingerprint'] };
  }
  value.forEach((stmt, i) => {
    const s = stmt as Partial<AssetLinkStatement> | null;
    const label = `statement[${i}]`;
    if (!s || typeof s !== 'object') {
      problems.push(`${label} is not an object`);
      return;
    }
    if (!Array.isArray(s.relation) || !s.relation.includes(HANDLE_ALL_URLS)) {
      problems.push(`${label} missing relation "${HANDLE_ALL_URLS}"`);
    }
    const t = s.target;
    if (!t || typeof t !== 'object') {
      problems.push(`${label} missing target`);
      return;
    }
    if (t.namespace !== 'android_app') {
      problems.push(`${label}.target.namespace must be "android_app"`);
    }
    if (!isValidAndroidPackageName(t.package_name as string)) {
      problems.push(`${label}.target.package_name is not a valid Android package name`);
    }
    if (!Array.isArray(t.sha256_cert_fingerprints) || t.sha256_cert_fingerprints.length === 0) {
      problems.push(`${label}.target.sha256_cert_fingerprints must list at least one fingerprint`);
    }
  });
  return { ok: problems.length === 0, problems };
}

/** Result of validating the generated Android project's target API level. */
export interface TargetSdkValidation {
  ok: boolean;
  /** The parsed level, or null when nothing could be read. */
  targetSdk: number | null;
  /** True when the Android project does not exist yet — nothing to assert. */
  skipped: boolean;
  problems: string[];
}

/**
 * Validate the target API level of the Bubblewrap-generated Android project
 * against Play's current floor.
 *
 * `buildGradle` is the raw text of the generated `app/build.gradle` (Groovy) —
 * pass `null`/`''` when the file does not exist. That case **skips** (ok, with
 * `skipped: true`): the Android project is only created by `npm run play:twa:init`
 * and is gitignored, so a fresh checkout has nothing to check and must not fail.
 * Once the file exists, a missing or too-low declaration is a hard failure — that
 * is precisely the state Play rejects at upload.
 *
 * Accepts both the legacy `targetSdkVersion N` and the modern `targetSdk = N`
 * spellings, with or without `=`. Line comments are stripped first so a
 * commented-out declaration never counts as a real one. Pure — no I/O.
 */
export function validateAndroidTargetSdk(
  buildGradle: string | null | undefined,
  minRequired: number = PLAY_MIN_TARGET_SDK,
): TargetSdkValidation {
  if (typeof buildGradle !== 'string' || buildGradle.trim().length === 0) {
    return { ok: true, targetSdk: null, skipped: true, problems: [] };
  }
  // Strip `//` line comments so a commented-out declaration is not mistaken for
  // the live one (Bubblewrap's template ships several commented examples).
  const source = buildGradle.replace(/\/\/.*$/gm, '');
  const match = /\btargetSdk(?:Version)?\s*=?\s*(\d+)/.exec(source);
  if (!match) {
    return {
      ok: false,
      targetSdk: null,
      skipped: false,
      problems: [
        `no targetSdkVersion declaration found in the generated Android project (Play requires >= ${minRequired})`,
      ],
    };
  }
  const targetSdk = Number(match[1]);
  if (targetSdk < minRequired) {
    return {
      ok: false,
      targetSdk,
      skipped: false,
      problems: [
        `targetSdkVersion is ${targetSdk} but Google Play requires >= ${minRequired} — Play will reject this upload. Update @bubblewrap/cli and re-run "npm run play:twa:init".`,
      ],
    };
  }
  return { ok: true, targetSdk, skipped: false, problems: [] };
}

interface ManifestIcon {
  src?: string;
  sizes?: string;
  purpose?: string;
}

/** Whether an icon entry declares the given square pixel size (e.g. 512) among its sizes tokens. */
function iconHasSize(icon: ManifestIcon, px: number): boolean {
  const tokens = (icon.sizes ?? '').split(/\s+/).filter(Boolean);
  return tokens.includes(`${px}x${px}`);
}

/** An icon's purposes — the manifest spec defaults to `any` when `purpose` is absent. */
function iconPurposes(icon: ManifestIcon): string[] {
  const raw = (icon.purpose ?? 'any').split(/\s+/).filter(Boolean);
  return raw.length > 0 ? raw : ['any'];
}

/**
 * Validate a web app manifest against Google Play's TWA/PWA install criteria.
 * Requires a non-empty `name` + `short_name`, a `standalone` (or `fullscreen`)
 * display, a `start_url`, theme + background colors, a 512×512 `any` icon, and a
 * 512×512 `maskable` icon (Play penalizes installs without a maskable icon).
 * Returns pass/fail plus the list of missing/non-conforming fields.
 */
export function validateWebManifestForPlay(manifest: unknown): ManifestValidation {
  const missing: string[] = [];
  const m = (manifest ?? {}) as {
    name?: unknown;
    short_name?: unknown;
    display?: unknown;
    start_url?: unknown;
    theme_color?: unknown;
    background_color?: unknown;
    icons?: unknown;
  };

  const nonEmptyString = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

  if (!nonEmptyString(m.name)) missing.push('name (non-empty)');
  if (!nonEmptyString(m.short_name)) missing.push('short_name (non-empty)');
  if (m.display !== 'standalone' && m.display !== 'fullscreen') {
    missing.push('display must be "standalone" or "fullscreen" (a TWA cannot launch in the browser)');
  }
  if (!nonEmptyString(m.start_url)) missing.push('start_url');
  if (!nonEmptyString(m.theme_color)) missing.push('theme_color');
  if (!nonEmptyString(m.background_color)) missing.push('background_color');

  const icons: ManifestIcon[] = Array.isArray(m.icons) ? (m.icons as ManifestIcon[]) : [];
  const has512Any = icons.some((i) => iconHasSize(i, 512) && iconPurposes(i).includes('any'));
  const has512Maskable = icons.some((i) => iconHasSize(i, 512) && iconPurposes(i).includes('maskable'));
  if (!has512Any) missing.push('a 512x512 icon with purpose "any"');
  if (!has512Maskable) missing.push('a 512x512 icon with purpose "maskable"');

  return { ok: missing.length === 0, missing };
}
