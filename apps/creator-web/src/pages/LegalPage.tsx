import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
// The document TEXT and the markdown rules are shared with apps/play-web, which
// serves the same two documents at /terms and /privacy on the participant origin
// (change: legal-pages-participant-origin). Deep imports, not the barrel: the
// prose must never reach a participant entry chunk. This page's own markup and
// class strings are unchanged — rushpoint-creator.web.app/privacy is a live,
// externally referenced URL.
import { LEGAL_DOCS, type LegalDocType } from '@rushpoint/shared/legalContent';
import { parseLegalMarkdown, type LegalBlock } from '@rushpoint/shared/legalMarkdown';

type DocType = LegalDocType;

// ---------------------------------------------------------------------------
// Markdown renderer — supports ## h2, ### h3, > blockquote, **bold**, - list.
// Parsing lives in parseLegalMarkdown (shared); this maps blocks to creator-web
// markup, emitting exactly the elements and classes it emitted before the move.
// ---------------------------------------------------------------------------
function renderBlock(block: LegalBlock, i: number) {
  switch (block.kind) {
    case 'h2':
      return (
        <h2 key={i} className="text-lg font-bold text-[--ink-1] mt-8 mb-2 pb-1 border-b border-[--rp-border] first:mt-0">
          {block.text}
        </h2>
      );
    case 'h3':
      return (
        <h3 key={i} className="text-base font-semibold text-[--ink-1] mt-5 mb-1">
          {block.text}
        </h3>
      );
    case 'quote':
      return (
        <div
          key={i}
          className="border-s-4 border-rp-fire bg-rp-fire/10 px-4 py-2 my-3 rounded-e-lg text-sm text-[--ink-1] font-medium"
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      );
    case 'strong':
      return (
        <p key={i} className="font-semibold text-[--ink-1] mt-3">
          {block.text}
        </p>
      );
    case 'li':
      return (
        <li
          key={i}
          className="text-[--ink-2] text-sm leading-relaxed ms-4 list-disc"
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      );
    case 'blank':
      return <div key={i} className="h-1.5" />;
    default:
      return (
        <p
          key={i}
          className="text-[--ink-2] text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      );
  }
}

function renderMarkdown(text: string) {
  return parseLegalMarkdown(text).map(renderBlock);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface LegalPageProps {
  type: DocType;
  lang?: 'he' | 'en';
  standalone?: boolean;
}

export default function LegalPage({ type, lang = 'he', standalone = false }: LegalPageProps) {
  const [activeLang, setActiveLang] = useState<'he' | 'en'>(lang);
  const nav = useNavigate();
  const doc = LEGAL_DOCS[type][activeLang];

  const content = (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
        <div>
          {!standalone && (
            <button
              onClick={() => nav(-1)}
              className="text-sm text-[--ink-3] hover:text-[--ink-1] transition-colors mb-3 flex items-center gap-1.5"
            >
              {activeLang === 'he' ? '← חזרה' : '← Back'}
            </button>
          )}
          <h1 className="font-brand text-3xl font-extrabold text-[--ink-1]">{doc.title}</h1>
          <p className="text-xs text-[--ink-3] mt-1">{doc.updated}</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-[--surface-2] p-0.5 self-start">
          {(['he', 'en'] as const).map((l) => (
            <button
              key={l}
              onClick={() => setActiveLang(l)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                activeLang === l
                  ? 'bg-[--surface-0] text-[--ink-1] shadow-sm'
                  : 'text-[--ink-3] hover:text-[--ink-1]'
              }`}
            >
              {l === 'he' ? 'עברית' : 'English'}
            </button>
          ))}
        </div>
      </div>

      <div
        dir={activeLang === 'he' ? 'rtl' : 'ltr'}
        className="prose-sm space-y-1 border border-[--rp-border] rounded-2xl p-6 bg-[--surface-0]/60"
      >
        {renderMarkdown(doc.body)}
      </div>
    </div>
  );

  if (standalone) {
    return (
      <div className="min-h-screen bg-[--surface-1] text-[--ink-1]">
        <div className="h-14 border-b border-[--rp-border] flex items-center px-5">
          <span className="font-brand text-lg font-extrabold bg-gradient-to-r from-rp-fire to-rp-amber bg-clip-text text-transparent">
            RushPoint
          </span>
        </div>
        {content}
      </div>
    );
  }

  return content;
}
