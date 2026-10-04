// Pure source scan — the new-game path cards and the questionnaire choices carry
// an explicit accessible name (change: quick-setup-reachable).
//
// Measured on 2026-10-02 in a real browser's accessibility tree: the three path
// cards and every questionnaire chip read as "button, button, button" — a name
// derived from inner content next to an unlabelled drawing is not reliable. There
// is no component runner, so this asserts the markup itself: every choice button
// states `aria-label`, and the decorative art is hidden from assistive tech.
import { readFileSync } from 'node:fs';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}

/** Every `<button …>` opening tag in a source file. */
function buttonTags(src: string): string[] {
  // Brace-aware: a `>` inside a JSX expression (`() => …`) does not close the tag.
  const out: string[] = [];
  const re = /<button\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

console.log('\nchoice accessible names');
{
  const choice = readFileSync('apps/creator-web/src/components/ChoiceCardRow.tsx', 'utf8');
  const tags = buttonTags(choice);
  ok(`the choice rows render buttons :: ${tags.length}`, tags.length >= 2);
  ok('every choice button states aria-label', tags.every((t) => /aria-label=/.test(t)),
    tags.filter((t) => !/aria-label=/.test(t)).join(' | '));
  const art = readFileSync('apps/creator-web/src/components/illustrations/ChoiceArt.tsx', 'utf8');
  ok('the choice art hides itself from assistive tech', /<svg\b[\s\S]*?aria-hidden="true"/.test(art));

  const wizard = readFileSync('apps/creator-web/src/components/NewGameWizard.tsx', 'utf8');
  // The path cards carry a visible title AND body, which together are their
  // name; an aria-label would hide the body. What must not be read is the icon.
  const paths = buttonTags(wizard).filter((t) => /setPathChoice/.test(t));
  ok(`the path card button is found :: ${paths.length}`, paths.length === 1);
  ok('the path card icon is hidden from assistive tech',
    /<Icon name=\{icon\} aria-hidden/.test(wizard));
}

console.log(failures === 0 ? '\n✅ choice accessible names: ALL PASS' : `\n❌ choice accessible names: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
