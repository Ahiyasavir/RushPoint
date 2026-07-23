// The legal-document markdown helpers now live in packages/shared, because the
// participant app renders the same documents at /terms and /privacy
// (change: legal-pages-participant-origin). This module is kept as a re-export so
// scripts/test-legal-page-polish.ts — which owns the escape-then-bold guard and
// runs under tsx, where '@rushpoint/shared' resolves to the BUILT dist rather
// than src — keeps importing the exact functions creator-web renders with.
//
// Relative path on purpose: it must resolve identically under Vite, tsc and tsx.
export {
  escapeHtml,
  renderInline,
  parseLegalMarkdown,
  type LegalBlock,
} from '../../../../packages/shared/src/legalMarkdown';
