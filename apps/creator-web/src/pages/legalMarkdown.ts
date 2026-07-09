// Pure inline-markdown helpers for LegalPage (change: prelaunch-polish, P6).
// Kept React-free so the tsx unit lane can import it (scripts/test-legal-page-polish.ts)
// and so escaping is a single source of truth — never inlined in the component.

/** Escape the four HTML-significant characters so policy text can't inject markup. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render one inline line for dangerouslySetInnerHTML: escape FIRST, then substitute
 * `**bold**` → `<strong>` so our own injected tags survive but any HTML in the source
 * text is neutralized.
 */
export function renderInline(line: string): string {
  return escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
