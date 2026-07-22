import { Link } from 'react-router-dom';
import { useT } from './LanguageContext';

/**
 * Persistent app-chrome footer carrying the legal documents.
 *
 * The /privacy and /terms routes already existed but had no entry point once a
 * creator was signed in: the logged-out landing page (AuthGate) linked to them,
 * so the only way back was to sign out or type the URL. App-store and GDPR
 * reviews expect the policy to be reachable from inside the product, not just
 * from the marketing page.
 *
 * Uses <Link>, not <a>: these are real routes in this SPA, so an anchor would
 * force a full document reload and drop the session state.
 */
export default function AppFooter() {
  const t = useT();
  const linkClass = 'hover:text-[--ink-1] hover:underline transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60';
  return (
    <footer className="relative z-10 border-t border-[--rp-border] mt-8">
      <div className="max-w-6xl mx-auto px-4 py-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[--ink-3]">
        <Link to="/privacy" className={linkClass}>{t.common.privacyLink}</Link>
        <span aria-hidden="true">·</span>
        <Link to="/terms" className={linkClass}>{t.common.termsLink}</Link>
      </div>
    </footer>
  );
}
