// The mission's own sentence with blanks to fill (change: composer-v2-sentence-setup).
//
// Renders the text players will read, each "[הוראות ליוצר: ...]" bracket as an underlined blank with
// the bracket's words as its example. Typing writes straight back into the description, so the
// creator never edits around a bracket again. The decisions live in lib/sentenceForm.ts; this only
// draws them.
import { useT } from './LanguageContext';
import { parseSentence } from '../lib/sentenceForm';

export default function SentenceFill({ template, values, onChange, anchor }: {
  /** The description as it was with its brackets. */
  template: string;
  /** One value per blank, '' for an unfilled one (`extractSlotValues`). */
  values: readonly string[];
  onChange: (values: string[]) => void;
  /** Quick Setup's focus anchor, put on the first blank. */
  anchor?: string;
}) {
  const b = useT().builder;
  const parts = parseSentence(template);
  return (
    <div className="rounded-xl border border-rp-fire/40 bg-[--surface-1] px-3 py-2.5">
      <p className="text-[12px] font-semibold text-[--ink-3] mb-1">{b.sentenceFillLead}</p>
      <p className="text-[15px] leading-[2.2] text-[--ink-1]" dir="auto">
        {parts.map((p, i) => {
          if (p.kind === 'text') return <span key={i}>{p.text}</span>;
          const value = values[p.index] ?? '';
          return (
            <input
              key={i}
              {...(anchor && p.index === 0 ? { 'data-qs-field': anchor } : {})}
              value={value}
              placeholder={p.hint}
              aria-label={p.hint}
              dir="auto"
              size={Math.max(8, Math.min(40, (value || p.hint).length + 1))}
              onChange={(e) => {
                const next = [...values];
                next[p.index] = e.target.value;
                onChange(next);
              }}
              className="inline-block mx-1 px-1 min-h-[32px] max-w-full align-baseline bg-[--surface-2] rounded-t border-0 border-b-2 border-rp-fire/60 text-[15px] text-[--ink-1] placeholder:text-[--ink-3] focus:outline-none focus:border-rp-fire focus:bg-[--surface-0]"
            />
          );
        })}
      </p>
    </div>
  );
}
