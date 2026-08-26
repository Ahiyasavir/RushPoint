// Illustrated choice cards — the questionnaire's options as pictures, not chips
// (change: smart-build-delight).
//
// A sibling of ui.tsx's ChipRow / MultiChipRow rather than a `variant` flag on
// them, for the same reason those two are siblings of each other: the chip rows
// are used all over the console for compact, text-only choices, and a card grid
// is a different thing with different layout rules. Bolting a mode onto ChipRow
// would make every other caller carry the cards' concerns.
//
// ─── Selected state is not colour alone ──────────────────────────────────────
// A selected card changes its border WIDTH and shows a filled check, not just
// its hue. Roughly 1 in 12 men has a colour-vision deficiency, and the app's
// selected tone (rp-fire) against the unselected border is exactly the sort of
// pair that collapses — so the state has to survive being read in greyscale.
//
// Copy-free: every string arrives through props.
import ChoiceArt from './illustrations/ChoiceArt';

/** Shared card chrome, so single- and multi-select cannot drift apart visually. */
function cardClass(on: boolean): string {
  return [
    'group relative flex flex-col items-center gap-1.5 rounded-xl px-2 py-3',
    'min-h-[84px] text-center transition-all duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60',
    'focus-visible:ring-offset-2 focus-visible:ring-offset-[--surface-1]',
    on
      // border-2 + the check mark are the non-colour half of the signal.
      ? 'border-2 border-rp-fire bg-rp-fire/10 text-rp-fire font-medium'
      : 'border border-[--rp-border] text-[--ink-2] hover:bg-[--surface-2] hover:border-[--ink-3]/40',
  ].join(' ');
}

/** The tick that makes selection legible without colour. */
function Check() {
  return (
    <span
      aria-hidden="true"
      className="absolute top-1 end-1 grid h-4 w-4 place-items-center rounded-full bg-rp-fire text-white"
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.5"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}

const GRID = 'grid grid-cols-3 gap-2 sm:grid-cols-4';

export function ChoiceCardRow<T extends string>({ label, options, value, onChange, render }: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render: (v: T) => string;
}) {
  return (
    <div>
      <div className="text-[12px] font-medium text-[--ink-2] mb-1.5">{label}</div>
      <div className={GRID} role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = o === value;
          return (
            <button
              key={String(o)}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o)}
              className={cardClass(on)}
            >
              {on && <Check />}
              <ChoiceArt id={String(o)} className="h-7 w-7" />
              <span className="text-[12px] leading-tight">{render(o)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The same cards, multi-select.
 *
 * `aria-pressed` toggles rather than `role="radio"`: these are independent
 * on/off choices, and announcing them as a radio group would tell a screen-reader
 * user that picking one clears the others — which is exactly wrong here.
 */
export function MultiChoiceCardRow<T extends string>({ label, options, values, onToggle, render, hint }: {
  label: string;
  options: readonly T[];
  values: readonly T[];
  onToggle: (v: T) => void;
  render: (v: T) => string;
  hint?: string;
}) {
  const selected = Array.isArray(values) ? values : [];
  return (
    <div>
      <div className="text-[12px] font-medium text-[--ink-2] mb-1.5">{label}</div>
      <div className={GRID}>
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={String(o)}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(o)}
              className={cardClass(on)}
            >
              {on && <Check />}
              <ChoiceArt id={String(o)} className="h-7 w-7" />
              <span className="text-[12px] leading-tight">{render(o)}</span>
            </button>
          );
        })}
      </div>
      {hint && <p className="text-[11px] text-[--ink-3] mt-1.5">{hint}</p>}
    </div>
  );
}
