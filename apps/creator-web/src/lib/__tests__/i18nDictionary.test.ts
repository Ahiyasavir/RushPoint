import { describe, expect, it } from 'vitest';
import { translations } from '../../i18n';

// ─────────────────────────────────────────────────────────────────────────────
// Creator-console dictionary invariants (change: creator-console-i18n-cleanup).
//
// creator-web is HEBREW-FIRST: it boots in `he` and English is the opt-in. Two
// defects have repeatedly reached users — a leaf written in the wrong language,
// and a key present in one dictionary but not the other (silent fallback).
//
// `scripts/check-i18n.ts` catches both, but it is a lint-style script: PART B
// only fails under `--strict`, which no gate runs. The pure-logic lane
// (`scripts/test-i18n-parity.ts`) mirrors only two of its four dictionary rules,
// and its `leafStrings()` returns [] for a function — so every FUNCTION-VALUED
// entry (`w.proMonthly(n)`, `liveRuns.participants({n})`, …), roughly a fifth of
// this dictionary, is invisible to it. This suite closes that gap inside a real
// test, so a regression goes RED in `npm test` instead of printing a warning:
//
//   A1  identical recursive key sets HE↔EN
//   A2  identical leaf TYPE per key (string-in-both or function-in-both)
//   A3  no English word in any HE leaf — INCLUDING function output
//   A4  no Hebrew letter in any EN leaf — INCLUDING function output
//   +   no empty leaf, whitelist stays load-bearing, brand vocabulary is current
//
// The helpers below are re-derived rather than imported from check-i18n.ts on
// purpose (design D2): that script is a top-level program that runs its whole
// scan and calls process.exit() at import time, it is owned elsewhere, and a
// test that imports its subject only proves the subject agrees with itself. The
// cost is a duplicated whitelist — accepted because duplication makes this test
// the STRICTER of the two, which fails safe (a red asking a human to look).
// ─────────────────────────────────────────────────────────────────────────────

const HEBREW = /[֐-׿]/;

// Brand names / units / acronyms that may legitimately stay Latin inside Hebrew
// copy, the language-toggle label, and the structural direction values.
// Kept in sync with scripts/check-i18n.ts (the authoritative gate).
const LATIN_WHITELIST = [
  'RushPoint', 'Creator Pro', 'Pro', 'QR', 'SOS', 'GPS', 'Google', 'YouTube', 'PWA',
  // A file format acronym, same class as QR/GPS: Hebrew speakers read and write "CSV",
  // and translating it would make the export button less clear, not more.
  'CSV',
  'English', 'rtl', 'ltr', '₪',
];
// Hebrew allowed inside English copy: a language's own name in the toggle.
const HEBREW_WHITELIST = ['עברית'];

// The pre-rebrand wording for the product. The brand is now a "field game" /
// "משחק שדה". Only the COMPLETE retired phrase is banned — the bare noun
// "הרפתקה" is an ordinary Hebrew word and legitimate copy uses it.
const RETIRED_BRAND = 'מירוץ הרפתקה';

function stripAll(s: string, words: string[]): string {
  let out = s;
  for (const w of words) out = out.split(w).join('');
  return out;
}

// A "Latin English word" = 2+ consecutive ASCII letters left after whitelisting.
// Tokens containing a digit (sample codes/ids like "FOX42") are not copy.
function hasEnglishWord(s: string): boolean {
  const noCodes = stripAll(s, LATIN_WHITELIST).replace(/[A-Za-z]*\d[A-Za-z\d]*/g, '');
  return /[A-Za-z]{2,}/.test(noCodes);
}
function hasHebrew(s: string): boolean {
  return HEBREW.test(stripAll(s, HEBREW_WHITELIST));
}

// Entries take either positional primitives — (n: number), (name: string) — or a
// single destructured object — ({ done, total }). One Proxy satisfies every
// shape: it coerces to a language-neutral token and answers any property access
// with 0. `Symbol.iterator` is left undefined so an array-expecting entry throws
// loudly (a real Hebrew-mode crash) instead of hanging.
function sampleArg(): unknown {
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return (hint: string) => (hint === 'string' ? '0' : 0);
      if (prop === 'toString') return () => '0';
      if (prop === 'valueOf') return () => 0;
      if (prop === Symbol.iterator) return undefined;
      return 0;
    },
  });
}

type Leaf = { path: string; value: string };
type ThrowingLeaf = { path: string; error: string };

// Every rendered message, with function entries CALLED. `threw` collects the
// entries that failed — a formatter that explodes on plausible arguments is a
// defect, not something to skip.
function walkLeaves(obj: unknown, prefix = '', threw: ThrowingLeaf[] = []): { leaves: Leaf[]; threw: ThrowingLeaf[] } {
  const leaves: Leaf[] = [];
  const visit = (node: unknown, path: string): void => {
    if (typeof node === 'string') { leaves.push({ path, value: node }); return; }
    if (typeof node === 'function') {
      try {
        const out = (node as (...a: unknown[]) => unknown)(sampleArg(), sampleArg(), sampleArg());
        if (typeof out === 'string') leaves.push({ path, value: out });
      } catch (e) {
        threw.push({ path, error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      visit(v, path ? `${path}.${k}` : k);
    }
  };
  visit(obj, prefix);
  return { leaves, threw };
}

// A function is a LEAF, not a namespace: its own properties (length, name) are
// not dictionary keys. Matches check-i18n.ts exactly (design D5).
function keysDeep(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || typeof obj === 'function') return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.push(...keysDeep(v, prefix ? `${prefix}.${k}` : k));
  }
  return out.sort();
}

function leafTypes(obj: unknown, prefix = '', acc: Record<string, string> = {}): Record<string, string> {
  if (obj === null || typeof obj !== 'object' || typeof obj === 'function') {
    acc[prefix] = typeof obj;
    return acc;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    leafTypes(v, prefix ? `${prefix}.${k}` : k, acc);
  }
  return acc;
}

const he = translations.he;
const en = translations.en;

describe('creator-web i18n — structural parity (A1/A2)', () => {
  it('exposes an identical recursive key set in both languages', () => {
    const heKeys = keysDeep(he);
    const enKeys = keysDeep(en);
    const heSet = new Set(heKeys);
    const enSet = new Set(enKeys);
    // Named diffs, not a count: "which key is missing" is the actionable part.
    expect(heKeys.filter((k) => !enSet.has(k))).toEqual([]);
    expect(enKeys.filter((k) => !heSet.has(k))).toEqual([]);
    expect(heKeys.length).toBeGreaterThan(0);
  });

  it('gives every key the same leaf type in both languages', () => {
    const heTypes = leafTypes(he);
    const enTypes = leafTypes(en);
    // Type drift renders "function (n) { … }" on screen, or throws when the UI
    // calls a plain string. Both are user-visible breakage in one language only.
    const drift = Object.keys(heTypes)
      .filter((k) => k in enTypes && heTypes[k] !== enTypes[k])
      .map((k) => `${k}: he=${heTypes[k]} en=${enTypes[k]}`);
    expect(drift).toEqual([]);
  });

  it('has no empty or whitespace-only message in either language', () => {
    for (const [lang, dict] of [['he', he], ['en', en]] as const) {
      const { leaves } = walkLeaves(dict);
      const empty = leaves.filter((l) => l.value.trim() === '').map((l) => `${lang}.${l.path}`);
      expect(empty).toEqual([]);
    }
  });
});

describe('creator-web i18n — language purity over strings AND functions (A3/A4)', () => {
  it('keeps the Hebrew dictionary free of English words', () => {
    const { leaves } = walkLeaves(he);
    const leaks = leaves.filter((l) => hasEnglishWord(l.value)).map((l) => `${l.path}="${l.value}"`);
    expect(leaks).toEqual([]);
  });

  it('keeps the English dictionary free of Hebrew letters', () => {
    // No pure-logic coverage of this rule existed before this suite.
    const { leaves } = walkLeaves(en);
    const leaks = leaves.filter((l) => hasHebrew(l.value)).map((l) => `${l.path}="${l.value}"`);
    expect(leaks).toEqual([]);
  });

  it('evaluates function-valued entries rather than skipping them', () => {
    // Guards the exact blind spot in scripts/test-i18n-parity.ts: if this ever
    // reaches 0, the two purity assertions above have quietly stopped covering
    // every formatter in the dictionary.
    const heFns = Object.values(leafTypes(he)).filter((t) => t === 'function').length;
    expect(heFns).toBeGreaterThan(0);
    const { leaves } = walkLeaves(he);
    expect(leaves.length).toBeGreaterThanOrEqual(heFns);
  });

  it('can call every function entry with plausible arguments without throwing', () => {
    for (const [lang, dict] of [['he', he], ['en', en]] as const) {
      const { threw } = walkLeaves(dict);
      expect(threw.map((t) => `${lang}.${t.path}: ${t.error}`)).toEqual([]);
    }
  });
});

describe('creator-web i18n — whitelist integrity', () => {
  it('keeps the Latin whitelist load-bearing rather than a rubber stamp', () => {
    // If no Hebrew copy actually relies on a whitelisted term, the whitelist is
    // dead weight that only weakens the purity check — narrow it instead.
    const { leaves } = walkLeaves(he);
    const used = LATIN_WHITELIST.filter((w) => leaves.some((l) => l.value.includes(w)));
    expect(used.length).toBeGreaterThan(0);
  });
});

describe('creator-web i18n — brand vocabulary', () => {
  it('never reintroduces the retired pre-rebrand wording in Hebrew copy', () => {
    const { leaves } = walkLeaves(he);
    const stale = leaves.filter((l) => l.value.includes(RETIRED_BRAND)).map((l) => l.path);
    expect(stale).toEqual([]);
  });

  it('still allows the everyday words the retired phrase was built from', () => {
    // "הרפתקה" alone is ordinary Hebrew (the Builder's sample chapter title uses
    // it correctly). Only the complete retired brand phrase is banned.
    expect('פרק 1: ההרפתקה מתחילה'.includes(RETIRED_BRAND)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Detector self-check.
//
// Every assertion above passes today, which on its own proves nothing: a broken
// detector also reports "no problems". These cases feed each rule a dictionary
// that is deliberately defective and require it to notice. If a future refactor
// guts a helper, these go red even while the real dictionary stays clean.
// ─────────────────────────────────────────────────────────────────────────────
describe('creator-web i18n — the detectors actually detect', () => {
  it('catches a key present in only one language (A1)', () => {
    const a = { nav: { games: 'משחקים', wallet: 'ארנק' } };
    const b = { nav: { games: 'Games' } };
    const bSet = new Set(keysDeep(b));
    expect(keysDeep(a).filter((k) => !bSet.has(k))).toEqual(['nav.wallet']);
  });

  it('catches leaf-type drift between languages (A2)', () => {
    const a = { runs: { count: (n: number) => `${n} ריצות` } };
    const b = { runs: { count: '0 runs' } };
    const at = leafTypes(a);
    const bt = leafTypes(b);
    const drift = Object.keys(at).filter((k) => k in bt && at[k] !== bt[k]);
    expect(drift).toEqual(['runs.count']);
  });

  it('catches an empty message', () => {
    const { leaves } = walkLeaves({ nav: { games: 'משחקים', wallet: '   ' } });
    expect(leaves.filter((l) => l.value.trim() === '').map((l) => l.path)).toEqual(['nav.wallet']);
  });

  it('catches English inside a Hebrew FUNCTION entry (A3, the parity-script blind spot)', () => {
    const { leaves } = walkLeaves({
      wallet: { credits: ({ n }: { n: number }) => `You have ${n} credits` },
    });
    expect(leaves.filter((l) => hasEnglishWord(l.value)).map((l) => l.path)).toEqual(['wallet.credits']);
  });

  it('catches Hebrew inside an English entry (A4)', () => {
    const { leaves } = walkLeaves({ nav: { wallet: 'ארנק' } });
    expect(leaves.filter((l) => hasHebrew(l.value)).map((l) => l.path)).toEqual(['nav.wallet']);
  });

  it('does not mistake brand terms, sample codes or the toggle label for a leak', () => {
    expect(hasEnglishWord('פתחו את RushPoint וסרקו את קוד ה־QR')).toBe(false);
    expect(hasEnglishWord('קוד הגישה: FOX42')).toBe(false);
    expect(hasHebrew('Switch to עברית')).toBe(false);
  });

  it('records a function entry that throws instead of silently dropping it', () => {
    const { leaves, threw } = walkLeaves({
      board: { names: (rows: string[]) => rows.join(', ') },
    });
    expect(leaves).toEqual([]);
    expect(threw.map((t) => t.path)).toEqual(['board.names']);
  });
});
