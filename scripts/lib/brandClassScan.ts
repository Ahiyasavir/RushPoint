// Detect Tailwind utilities that name a BRAND colour token which does not exist
// (change: play-top-overlay-stack, follow-on).
//
// Tailwind resolves an unknown token to NOTHING. It does not warn, it does not
// fail the build, and the class stays in the markup looking entirely plausible.
// `bg-app` sat on both reorder buttons of the ordering task for as long as that
// task type has existed: the intended token is `app-card`, `app` is not a token
// at all, and so those two buttons rendered with no fill — a bordered ghost on a
// warm row, which reads as "disabled" rather than "tap me". Nothing could catch
// it: typecheck does not see class strings, eslint does not know the theme, the
// a11y scan checks contrast between tokens that ARE resolved, and a screenshot
// shows a button that looks deliberately subtle.
//
// Scope is deliberately narrow — only the project's OWN colour namespaces, never
// Tailwind's built-in palette. A general "unknown class" scanner has to model the
// whole default theme plus arbitrary values plus every non-colour utility that
// shares a prefix (`bg-gradient-to-r`, `border-2`, `text-center`, `ring-2`), and
// a scanner that cries wolf gets deleted. Restricting it to tokens we defined
// ourselves makes every finding certain.

/** Utility prefixes that take a colour value. Longest first so `ring-offset`
 *  is matched before `ring`. */
const COLOR_UTILITIES = [
  'ring-offset', 'divide', 'placeholder', 'decoration', 'outline', 'border',
  'shadow', 'stroke', 'accent', 'caret', 'text', 'from', 'fill', 'ring', 'via',
  'bg', 'to',
] as const;

/** The root words of every colour namespace this repo defines for itself. A
 *  utility naming one of these must resolve to a real token. */
const BRAND_ROOTS = ['app', 'rp', 'ink', 'glass', 'accent', 'danger'] as const;

export interface BrandClassFinding {
  file: string;
  line: number;
  /** The offending class exactly as written, e.g. "bg-app". */
  className: string;
  /** The colour token it tried to name, e.g. "app". */
  token: string;
}

/** Every class-like word in a source line. Deliberately crude: it reads any
 *  token-shaped run of characters, because class strings in this codebase are
 *  built by template literals and ternaries as often as by a plain attribute. */
function candidateClasses(line: string): string[] {
  return line.match(/[A-Za-z][A-Za-z0-9-]*(?:\/\d+)?/g) ?? [];
}

/**
 * Split a utility class into its prefix and colour token, or null when it is not
 * a brand-namespaced colour utility at all.
 *
 * `bg-app-card`      -> { utility: 'bg', token: 'app-card' }
 * `bg-accent/15`     -> { utility: 'bg', token: 'accent' }      (opacity stripped)
 * `hover:bg-app`     -> { utility: 'bg', token: 'app' }         (variants stripped)
 * `bg-gradient-to-r` -> null                                    (not a brand root)
 * `text-zinc-100`    -> null                                    (Tailwind's own)
 */
export function parseBrandColorClass(raw: string): { utility: string; token: string } | null {
  // Drop responsive/state variants (`sm:`, `hover:`, `disabled:`, `rtl:`) and any
  // important marker, then the opacity modifier.
  const bare = raw.split(':').pop()!.replace(/^!/, '').replace(/\/\d+$/, '');
  // An arbitrary value is explicit by construction and always valid.
  if (bare.includes('[')) return null;
  for (const utility of COLOR_UTILITIES) {
    if (!bare.startsWith(`${utility}-`)) continue;
    const token = bare.slice(utility.length + 1);
    if (!token) continue;
    const root = token.split('-')[0];
    if (!(BRAND_ROOTS as readonly string[]).includes(root)) return null;
    return { utility, token };
  }
  return null;
}

/**
 * Scan source text for brand colour utilities naming a token that is not in
 * `known`. `known` is the set of colour keys actually defined in the app's
 * tailwind config, read from the config rather than restated here — restating it
 * would let the guard and the theme drift apart, which is the same failure mode
 * the guard exists to catch.
 */
export function findUnknownBrandColorClasses(
  file: string,
  source: string,
  known: ReadonlySet<string>,
): BrandClassFinding[] {
  const findings: BrandClassFinding[] = [];
  source.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trimStart();
    // Comments in this repo discuss token names constantly ("bg-app-raised is
    // the warm row"), so scanning them would be nothing but false positives.
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    for (const candidate of candidateClasses(line)) {
      const parsed = parseBrandColorClass(candidate);
      if (!parsed) continue;
      if (known.has(parsed.token)) continue;
      findings.push({ file, line: i + 1, className: candidate, token: parsed.token });
    }
  });
  return findings;
}

/**
 * Flatten a Tailwind `theme.extend.colors` object into the token names a utility
 * can actually name. Tailwind joins nested keys with `-`, and a `DEFAULT` key is
 * reachable by the parent name alone.
 */
export function flattenColorTokens(colors: Record<string, unknown>, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(colors)) {
    const name = key === 'DEFAULT' ? prefix.replace(/-$/, '') : `${prefix}${key}`;
    if (value && typeof value === 'object') {
      for (const nested of flattenColorTokens(value as Record<string, unknown>, `${name}-`)) {
        out.add(nested);
      }
    } else if (name) {
      out.add(name);
    }
  }
  return out;
}
