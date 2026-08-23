// Pure markdown helpers for the legal documents (change: legal-pages-participant-origin).
//
// These moved here from apps/creator-web/src/pages/legalMarkdown.ts when the
// participant app gained /terms and /privacy: two apps render the same policy
// text, so exactly ONE module decides what a line means and how it is escaped.
// React-free and DOM-free, so both apps and the tsx unit lane can import it.
//
// NOTE: deliberately NOT re-exported from src/index.ts. Its companion
// `legalContent.ts` is ~60 KB of prose that must never reach the participant
// entry chunk (scripts/check-bundle-budget.mjs), so both are imported by the
// explicit deep path `@rushpoint/shared/legalMarkdown` instead of through the
// barrel that play-web's entry graph already pulls in.

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

/**
 * One parsed line of a legal document.
 *
 * `html` is pre-escaped inline markup for the blocks that carry emphasis and is
 * meant for `dangerouslySetInnerHTML`. `text` is plain and is meant to be
 * rendered as a React child — headings and whole-line bold paragraphs have never
 * gone through innerHTML and must not start to.
 */
export type LegalBlock =
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'quote'; html: string }
  | { kind: 'li'; html: string }
  | { kind: 'p'; html: string }
  | { kind: 'blank' };

/**
 * Tokenize a document body into one block per source line. Supports exactly the
 * constructs the documents use: `## h2`, `### h3`, `> quote`, a whole-line
 * `**bold**` paragraph, `- list item`, a blank spacer, and a plain paragraph.
 *
 * Total by construction: every line maps to exactly one block, so a renderer can
 * key by index and can never drop a sentence of a policy document.
 */
export function parseLegalMarkdown(text: string): LegalBlock[] {
  return text.trim().split('\n').map((line): LegalBlock => {
    if (line.startsWith('## ')) return { kind: 'h2', text: line.slice(3) };
    if (line.startsWith('### ')) return { kind: 'h3', text: line.slice(4) };
    if (line.startsWith('> ')) return { kind: 'quote', html: renderInline(line.slice(2)) };
    // A whole-line bold is its own emphasized paragraph; a line with an INNER
    // bold pair is an ordinary paragraph with inline emphasis.
    if (line.startsWith('**') && line.endsWith('**') && !line.slice(2, -2).includes('**')) {
      return { kind: 'strong', text: line.slice(2, -2) };
    }
    if (line.startsWith('- ')) return { kind: 'li', html: renderInline(line.slice(2)) };
    if (line === '') return { kind: 'blank' };
    return { kind: 'p', html: renderInline(line) };
  });
}
