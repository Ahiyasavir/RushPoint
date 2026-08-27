// Choice-card artwork — one flat illustration per questionnaire option
// (change: smart-build-delight).
//
// ═══════════════════════════════════════════════════════════════════════════
// The rules these drawings live by
// ═══════════════════════════════════════════════════════════════════════════
//
// 1. NO TEXT INSIDE THE ARTWORK, ever. A <text> element here would be a user-
//    facing string that bypasses `t.*` entirely — invisible to the i18n gate,
//    and frozen in one language on a Hebrew-first console. The label beside the
//    card is the only words a card has.
// 2. `currentColor` ONLY. No hex, no gradient, no theme-conditional fill. The
//    card sets a colour and the drawing inherits it, so light and dark need one
//    drawing rather than two that can drift apart.
// 3. `aria-hidden`. The card's own label is its accessible name; announcing the
//    drawing too would read every option twice.
// 4. Inline components, not `.svg` files or raster assets — no network request,
//    no asset-pipeline step, and they tree-shake with the card that uses them.
// 5. GEOMETRIC AND FLAT. These render at 28-32px inside a card. Detail is lost
//    at that size and only costs bytes.
//
// An unknown id renders the neutral mark rather than nothing, so a new option
// added to a registry shows up as plain-but-present instead of as an invisible
// card.
import type { ReactElement } from 'react';

/** Stroke defaults shared by every drawing, so they read as one set. */
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** A muted companion tone — same colour, lighter, for fills behind the line. */
const SOFT = { fill: 'currentColor', opacity: 0.15 } as const;

const ART: Record<string, ReactElement> = {
  // ── Occasions ──────────────────────────────────────────────────────────────
  birthday: (
    <>
      <path d="M5 14h14v6H5z" {...SOFT} />
      <path d="M5 14h14v6H5zM5 14c2-3 12-3 14 0" {...S} />
      <path d="M12 5v4M9.5 7l2.5 2 2.5-2" {...S} />
    </>
  ),
  mitzvah: (
    <>
      <path d="M12 4l7 4v8l-7 4-7-4V8z" {...SOFT} />
      <path d="M12 4l7 4v8l-7 4-7-4V8z" {...S} />
      <path d="M9 10h6M9 13h6M10.5 16h3" {...S} />
    </>
  ),
  wedding: (
    <>
      <circle cx="9.5" cy="14" r="4.5" {...SOFT} />
      <circle cx="9.5" cy="14" r="4.5" {...S} />
      <circle cx="14.5" cy="14" r="4.5" {...S} />
      <path d="M12 4.5l1.2 2.4 2.6.3-1.9 1.8.5 2.6L12 10.4 9.6 11.6l.5-2.6-1.9-1.8 2.6-.3z" {...S} />
    </>
  ),
  teamBuilding: (
    <>
      <circle cx="8" cy="9" r="2.5" {...SOFT} />
      <circle cx="8" cy="9" r="2.5" {...S} />
      <circle cx="16" cy="9" r="2.5" {...S} />
      <path d="M4 19c0-2.8 1.8-4.5 4-4.5s4 1.7 4 4.5M12 19c0-2.8 1.8-4.5 4-4.5s4 1.7 4 4.5" {...S} />
    </>
  ),
  youthGroup: (
    <>
      <path d="M4 18l8-12 8 12z" {...SOFT} />
      <path d="M4 18l8-12 8 12z" {...S} />
      <path d="M12 6v12M8 18l4-4 4 4" {...S} />
    </>
  ),
  other: (
    <>
      <circle cx="12" cy="12" r="8" {...SOFT} />
      <circle cx="12" cy="12" r="8" {...S} />
      <path d="M9.5 9.5a2.5 2.5 0 113.2 2.4c-.5.2-.7.6-.7 1.1v.5" {...S} />
      <circle cx="12" cy="16.5" r=".9" fill="currentColor" />
    </>
  ),

  // ── Who is playing ─────────────────────────────────────────────────────────
  kids: (
    <>
      <circle cx="12" cy="8" r="3.5" {...SOFT} />
      <circle cx="12" cy="8" r="3.5" {...S} />
      <path d="M6 20c0-3.6 2.7-6 6-6s6 2.4 6 6" {...S} />
      <path d="M10.5 7.5h.01M13.5 7.5h.01" {...S} />
    </>
  ),
  preteens: (
    <>
      <circle cx="9" cy="8.5" r="3" {...SOFT} />
      <circle cx="9" cy="8.5" r="3" {...S} />
      <circle cx="16.5" cy="10" r="2.4" {...S} />
      <path d="M4 20c0-3.2 2.2-5.4 5-5.4s5 2.2 5 5.4M14.5 20c0-2.6 1.5-4.4 3.5-4.4s3 1.8 3 4.4" {...S} />
    </>
  ),
  teens: (
    <>
      <circle cx="12" cy="7.5" r="3.2" {...SOFT} />
      <circle cx="12" cy="7.5" r="3.2" {...S} />
      <path d="M5.5 20c0-3.9 2.9-6.5 6.5-6.5s6.5 2.6 6.5 6.5" {...S} />
      <path d="M8.8 5.5c1.6 1.4 4.8 1.4 6.4 0" {...S} />
    </>
  ),
  adults: (
    <>
      <circle cx="12" cy="7.5" r="3.2" {...SOFT} />
      <circle cx="12" cy="7.5" r="3.2" {...S} />
      <path d="M5.5 20c0-3.9 2.9-6.5 6.5-6.5s6.5 2.6 6.5 6.5" {...S} />
    </>
  ),
  corporate: (
    <>
      <path d="M4 20V9h7v11zM13 20V13h7v7z" {...SOFT} />
      <path d="M4 20V9h7v11zM13 20V13h7v7z" {...S} />
      <path d="M6.5 12h2M6.5 15.5h2M15.5 16h2" {...S} />
    </>
  ),
  mixed: (
    <>
      <circle cx="7.5" cy="9" r="2.3" {...SOFT} />
      <circle cx="7.5" cy="9" r="2.3" {...S} />
      <circle cx="16.5" cy="9" r="2.3" {...S} />
      <circle cx="12" cy="13.5" r="2.3" {...S} />
      <path d="M3.5 19c0-2.3 1.8-3.8 4-3.8M16.5 15.2c2.2 0 4 1.5 4 3.8M8 21c0-2.3 1.8-3.6 4-3.6s4 1.3 4 3.6" {...S} />
    </>
  ),

  // ── Where it happens ───────────────────────────────────────────────────────
  forest: (
    <>
      <path d="M12 3l5 8h-10z" {...SOFT} />
      <path d="M12 3l5 8h-10zM12 8l6 8H6z" {...S} />
      <path d="M12 16v5" {...S} />
    </>
  ),
  beach: (
    <>
      <circle cx="16.5" cy="7.5" r="3" {...SOFT} />
      <circle cx="16.5" cy="7.5" r="3" {...S} />
      <path d="M3 17c1.8-1.6 3.6-1.6 5.4 0s3.6 1.6 5.4 0 3.6-1.6 5.2 0" {...S} />
      <path d="M3 20.5c1.8-1.6 3.6-1.6 5.4 0s3.6 1.6 5.4 0 3.6-1.6 5.2 0" {...S} />
    </>
  ),
  park: (
    <>
      <circle cx="12" cy="9" r="5" {...SOFT} />
      <circle cx="12" cy="9" r="5" {...S} />
      <path d="M12 14v7M8.5 18h7" {...S} />
    </>
  ),
  neighborhood: (
    <>
      <path d="M4 20v-7l4-3 4 3v7z" {...SOFT} />
      <path d="M4 20v-7l4-3 4 3v7zM12 20v-9l4-3 4 3v9z" {...S} />
      <path d="M7 16h2M15 15h2" {...S} />
    </>
  ),
  cityCenter: (
    <>
      <path d="M4 21V8h5v13zM11 21V4h4v17zM17 21v-9h3v9z" {...SOFT} />
      <path d="M4 21V8h5v13zM11 21V4h4v17zM17 21v-9h3v9z" {...S} />
    </>
  ),
  home: (
    <>
      <path d="M4 11l8-6 8 6v9H4z" {...SOFT} />
      <path d="M4 11l8-6 8 6v9H4z" {...S} />
      <path d="M10 20v-5h4v5" {...S} />
    </>
  ),
  mall: (
    <>
      <path d="M4 9h16v11H4z" {...SOFT} />
      <path d="M4 9h16v11H4z" {...S} />
      <path d="M8 9V6.5a4 4 0 018 0V9" {...S} />
    </>
  ),
  office: (
    <>
      <path d="M6 21V4h12v17z" {...SOFT} />
      <path d="M6 21V4h12v17z" {...S} />
      <path d="M9 8h2M13 8h2M9 12h2M13 12h2M11 21v-4h2v4" {...S} />
    </>
  ),
  school: (
    <>
      <path d="M3 9l9-4 9 4-9 4z" {...SOFT} />
      <path d="M3 9l9-4 9 4-9 4z" {...S} />
      <path d="M7 11v5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-5" {...S} />
    </>
  ),
  crowded: (
    <>
      <circle cx="6" cy="9" r="2" {...SOFT} />
      <circle cx="6" cy="9" r="2" {...S} />
      <circle cx="12" cy="8" r="2" {...S} />
      <circle cx="18" cy="9" r="2" {...S} />
      <path d="M2.5 19c0-2.2 1.6-3.6 3.5-3.6s3.5 1.4 3.5 3.6M8.5 19c0-2.4 1.6-4 3.5-4s3.5 1.6 3.5 4M14.5 19c0-2.2 1.6-3.6 3.5-3.6s3.5 1.4 3.5 3.6" {...S} />
    </>
  ),
  historic: (
    <>
      <path d="M5 20v-9h14v9z" {...SOFT} />
      <path d="M5 20v-9h14v9zM3 11l9-7 9 7" {...S} />
      <path d="M9 20v-5h6v5" {...S} />
    </>
  ),

  // ── Kinds of mission ───────────────────────────────────────────────────────
  action: (
    <>
      <path d="M13 3l-7 10h5l-1 8 7-10h-5z" {...SOFT} />
      <path d="M13 3l-7 10h5l-1 8 7-10h-5z" {...S} />
    </>
  ),
  camera: (
    <>
      <path d="M3 8h4l1.5-2h7L17 8h4v12H3z" {...SOFT} />
      <path d="M3 8h4l1.5-2h7L17 8h4v12H3z" {...S} />
      <circle cx="12" cy="13.5" r="3.5" {...S} />
    </>
  ),
  thinking: (
    <>
      <path d="M12 3a6 6 0 013.5 10.9V17h-7v-3.1A6 6 0 0112 3z" {...SOFT} />
      <path d="M12 3a6 6 0 013.5 10.9V17h-7v-3.1A6 6 0 0112 3z" {...S} />
      <path d="M9.5 20h5" {...S} />
    </>
  ),
  teamwork: (
    <>
      <circle cx="12" cy="6.5" r="2.5" {...SOFT} />
      <circle cx="12" cy="6.5" r="2.5" {...S} />
      <circle cx="5.5" cy="16" r="2.5" {...S} />
      <circle cx="18.5" cy="16" r="2.5" {...S} />
      <path d="M10.5 8.8L7 13.8M13.5 8.8l3.5 5M8 16.5h8" {...S} />
    </>
  ),
  creative: (
    <>
      <path d="M4 20l1-4L16 5l3 3L8 19z" {...SOFT} />
      <path d="M4 20l1-4L16 5l3 3L8 19z" {...S} />
      <path d="M14.5 6.5l3 3" {...S} />
    </>
  ),
  educational: (
    <>
      <path d="M5 4h11a2 2 0 012 2v14H7a2 2 0 01-2-2z" {...SOFT} />
      <path d="M5 4h11a2 2 0 012 2v14H7a2 2 0 01-2-2zM5 18a2 2 0 012-2h11" {...S} />
      <path d="M9 8h6" {...S} />
    </>
  ),

  // ── How hard ───────────────────────────────────────────────────────────────
  easy: (
    <>
      <circle cx="12" cy="12" r="8" {...SOFT} />
      <circle cx="12" cy="12" r="8" {...S} />
      <path d="M8.5 13.5c1.8 2 5.2 2 7 0" {...S} />
      <path d="M9.5 9.5h.01M14.5 9.5h.01" {...S} />
    </>
  ),
  balanced: (
    <>
      <path d="M12 3v18" {...S} />
      <path d="M5 8h14" {...S} />
      <path d="M5 8l-2.5 5h5zM19 8l-2.5 5h5z" {...SOFT} />
      <path d="M5 8l-2.5 5h5zM19 8l-2.5 5h5z" {...S} />
      <path d="M8.5 21h7" {...S} />
    </>
  ),
  hard: (
    <>
      <path d="M12 3l6 4v6c0 4-2.6 6.6-6 8-3.4-1.4-6-4-6-8V7z" {...SOFT} />
      <path d="M12 3l6 4v6c0 4-2.6 6.6-6 8-3.4-1.4-6-4-6-8V7z" {...S} />
      <path d="M12 8v4M12 15h.01" {...S} />
    </>
  ),
};

/** The mark an unrecognised id gets — plain, but present. */
const FALLBACK: ReactElement = (
  <>
    <circle cx="12" cy="12" r="7.5" {...SOFT} />
    <circle cx="12" cy="12" r="7.5" {...S} />
  </>
);

export interface ChoiceArtProps {
  /** The option's own id — occasion, who, area, activity or difficulty. */
  id: string;
  className?: string;
}

/** Is there a real drawing for this id? Lets a caller lay out accordingly. */
export function hasChoiceArt(id: string): boolean {
  return typeof id === 'string' && id in ART;
}

export default function ChoiceArt({ id, className }: ChoiceArtProps) {
  const art = (typeof id === 'string' && ART[id]) || FALLBACK;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      // Decorative: the card's label is the accessible name. Announcing this too
      // would read every option twice.
      aria-hidden="true"
      focusable="false"
    >
      {art}
    </svg>
  );
}
