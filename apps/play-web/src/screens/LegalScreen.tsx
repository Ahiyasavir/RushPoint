import { useState } from 'react';
// Deep imports (NOT the '@rushpoint/shared' barrel): the policy text is tens of
// kilobytes of prose and this screen is the only module that touches it, so it
// lands in this lazy chunk and never in the participant entry chunk enforced by
// scripts/check-bundle-budget.mjs.
import { LEGAL_DOCS, type LegalDocType, type LegalLang } from '@rushpoint/shared/legalContent';
import { parseLegalMarkdown, type LegalBlock } from '@rushpoint/shared/legalMarkdown';
import { useT } from '../i18nContext';

/**
 * The Terms of Service and the Privacy Policy, served at `/terms` and `/privacy`
 * on the PARTICIPANT origin (change: legal-pages-participant-origin).
 *
 * Participants are the people these documents are written for — the location,
 * photo-feed and minor-consent sections all describe what happens on their phone
 * — and they never open the creator console. Before this screen existed, both
 * paths fell through play-web's query-param routing and rendered the game.
 *
 * The text is the same shared source the creator console renders; only the
 * presentation is local, because the two apps have disjoint design tokens.
 */
export default function LegalScreen({ doc: type }: { doc: LegalDocType }) {
  const { t, lang } = useT();
  const [activeLang, setActiveLang] = useState<LegalLang>(lang === 'en' ? 'en' : 'he');
  const document = LEGAL_DOCS[type][activeLang];
  const rtl = activeLang === 'he';

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="max-w-2xl mx-auto px-5 py-8 rp-safe-b">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div>
            <button
              type="button"
              onClick={() => { window.location.href = '/'; }}
              aria-label={t.legal.backAria}
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-3 flex items-center gap-1.5"
            >
              <span aria-hidden>←</span>
              {t.legal.back}
            </button>
            <h1 className="font-brand text-2xl font-extrabold text-zinc-100" dir={rtl ? 'rtl' : 'ltr'}>
              {document.title}
            </h1>
            <p className="text-xs text-zinc-500 mt-1" dir={rtl ? 'rtl' : 'ltr'}>{document.updated}</p>
          </div>
          <div className="flex gap-1 rounded-lg bg-white/60 border border-glass-border p-0.5" role="group" aria-label={t.legal.langAria}>
            {(['he', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setActiveLang(l)}
                aria-pressed={activeLang === l}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  activeLang === l ? 'bg-white text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                {/* Language names, deliberately shown in their own language and never
                    translated — the whole point is to be readable to someone who does
                    not read the current one. */}
                {l === 'he' ? 'עברית' : 'English'} {/* i18n-ignore: endonym language name */}
              </button>
            ))}
          </div>
        </div>

        <div
          dir={rtl ? 'rtl' : 'ltr'}
          className="space-y-1 border border-glass-border rounded-2xl p-5 bg-white"
        >
          {parseLegalMarkdown(document.body).map(renderBlock)}
        </div>
      </div>
    </div>
  );
}

/** One parsed line → play-web markup. Mirrors creator-web's mapping, own tokens. */
function renderBlock(block: LegalBlock, i: number) {
  switch (block.kind) {
    case 'h2':
      return (
        <h2 key={i} className="text-base font-bold text-zinc-100 mt-7 mb-2 pb-1 border-b border-glass-border first:mt-0">
          {block.text}
        </h2>
      );
    case 'h3':
      return <h3 key={i} className="text-sm font-semibold text-zinc-100 mt-4 mb-1">{block.text}</h3>;
    case 'quote':
      return (
        <div
          key={i}
          className="border-s-4 border-accent bg-accent/10 px-3 py-2 my-3 rounded-e-lg text-sm text-zinc-100 font-medium"
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      );
    case 'strong':
      return <p key={i} className="font-semibold text-zinc-100 mt-3 text-sm">{block.text}</p>;
    case 'li':
      return (
        <li
          key={i}
          className="text-zinc-300 text-sm leading-relaxed ms-4 list-disc"
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      );
    case 'blank':
      return <div key={i} className="h-1.5" />;
    default:
      return (
        <p
          key={i}
          className="text-zinc-300 text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      );
  }
}
