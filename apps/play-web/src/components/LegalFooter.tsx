import { useT } from '../i18nContext';
import { creatorUrl } from '../lib/creatorUrl';

// The legal documents are React Router routes on the CREATOR hosting target
// (/privacy, /terms) — play-web has no router, so it links out. The origin comes
// from lib/creatorUrl (shared with the finish-screen referral link) and resolves
// at render time, so this file never reads the browser URL at module scope — see
// the P9 regression guard in scripts/test-i18n-parity.ts.

/**
 * In-app link to the Terms and the Privacy Policy. Google Play requires the
 * privacy policy to be reachable in-app, and its UGC policy requires the content
 * policy governing the live photo feed to be reachable by the participants who
 * post to it — which is exactly this app's audience (change: feed-ugc-safety).
 *
 * Rendered on the Join screen (the entry point, before any data is collected)
 * and on the Final screen (the exit point, reachable without re-joining).
 */
export default function LegalFooter() {
  const { t } = useT();
  const base = creatorUrl();
  const linkClass = 'underline underline-offset-2 hover:text-zinc-300 transition-colors';
  return (
    <p className="text-center text-[11px] text-zinc-500 mt-4">
      <a href={`${base}/terms`} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {t.join.legalTerms}
      </a>
      <span className="mx-1.5" aria-hidden>·</span>
      <a href={`${base}/privacy`} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {t.join.legalPrivacy}
      </a>
    </p>
  );
}
