import { useT } from '../i18nContext';

// The legal documents are now served by THIS app at /terms and /privacy
// (change: legal-pages-participant-origin), so these are same-origin links.
// They used to point at the creator hosting target, because play-web had no
// path handling at all; a participant who tapped them left the PWA for a
// creator-oriented console. Still `target="_blank"`, so a player reading the
// policy mid-run keeps their game on the tab they came from. Relative hrefs —
// this file never reads the browser URL, see the P9 regression guard in
// scripts/test-i18n-parity.ts.

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
  const linkClass = 'underline underline-offset-2 hover:text-zinc-300 transition-colors';
  return (
    <p className="text-center text-[13px] text-zinc-500 mt-4">
      <a href="/terms" target="_blank" rel="noopener noreferrer" className={linkClass}>
        {t.join.legalTerms}
      </a>
      <span className="mx-1.5" aria-hidden>·</span>
      <a href="/privacy" target="_blank" rel="noopener noreferrer" className={linkClass}>
        {t.join.legalPrivacy}
      </a>
    </p>
  );
}
