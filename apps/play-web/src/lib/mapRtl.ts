// Right-to-left map labels (change: satellite-hebrew-labels).
//
// ─── The bug this file exists to prevent ─────────────────────────────────────
// MapLibre GL renders glyphs in the order the vector tile stores them and does
// NO bidi reordering of its own. That is invisible on the `outdoor` style, whose
// labels are `{name:latin}` — but the `hybrid` (satellite) style falls back to
// the LOCAL name (`["coalesce", ["get","name:en"], ["get","name"]]`), so in
// Israel every unnamed-in-English place draws its Hebrew backwards: "תל שבע"
// rendered as "עבש לת". Flipping to satellite looked like the app had switched
// language and scrambled the letters.
//
// The fix is MapLibre's documented RTL hook: `setRTLTextPlugin`. We serve the
// plugin from our OWN bundle (Vite `?url`, hashed asset) instead of the unpkg
// URL in MapLibre's docs — a map must not depend on a third-party CDN being
// reachable, and the participant app is offline-hardened on purpose.
//
// `lazy: true` means the ~200 KB asm.js is fetched only once RTL text is
// actually encountered, so a Latin-only map never pays for it.
//
// Deliberately duplicated in apps/creator-web/src/lib/mapRtl.ts rather than shared:
// packages/shared is framework-free and holds no map-engine dependency.
import rtlPluginUrl from '@mapbox/mapbox-gl-rtl-text/mapbox-gl-rtl-text.min.js?url';

/** The slice of maplibre-gl this needs — passed in, so this file imports no engine. */
interface RtlCapableGl {
  getRTLTextPluginStatus?: () => string;
  setRTLTextPlugin: (url: string, lazy: boolean) => unknown;
}

let requested = false;

/**
 * Register the RTL text plugin exactly once per page.
 *
 * Total by construction: MapLibre throws if the plugin is set twice, and a
 * failed download rejects — neither may take a map down, because a map with
 * mis-ordered labels is still a usable map and a crashed one is not.
 */
export function ensureRtlTextPlugin(gl: RtlCapableGl): void {
  if (requested) return;
  requested = true;
  try {
    const status = gl.getRTLTextPluginStatus?.();
    // 'unavailable' is MapLibre's "nothing registered yet"; anything else means
    // some other module already claimed the single global slot.
    if (status && status !== 'unavailable') return;
    const result = gl.setRTLTextPlugin(rtlPluginUrl, true);
    void Promise.resolve(result).catch(() => {});
  } catch {
    /* labels stay mis-ordered; the map still renders */
  }
}
