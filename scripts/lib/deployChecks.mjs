// The deploy checklist (Ahiya, 2026-10-05): every production deploy ships with ONE designed PDF
// of what to check, always in the same shape: checks on a computer, checks on a phone, special
// checks (several phones, walking outside, airplane mode, printing), and at the end a short report
// of what changed. The source is a plain markdown file in docs/deploy-checks/<date>.md; this module
// turns it into the HTML the PDF is printed from. Pure: no file system, no browser, so
// scripts/test-deploy-checks.ts can pin the format.
//
// Source format (anything else is a paragraph):
//   ---                         front matter: title, deploy, commit, since
//   # במחשב | # בטלפון | # בדיקות מיוחדות | # מה השתנה     the four PARTS, in this order
//   ## heading                  a section inside a part
//   - [ ] item / - [x] item     a check (indent two spaces per level for sub items)
//   - item                      a bullet
//   | a | b |                   a table (first row is the header, the |---| row is skipped)
//   **bold** and `code`         inline

/** The four parts, in the fixed order of the template. `match` is how a `# ` heading is recognised. */
export const PARTS = [
  { id: 'computer', title: 'בדיקות במחשב', match: /מחשב/ },
  { id: 'phone', title: 'בדיקות בטלפון', match: /טלפון|פלאפון/ },
  { id: 'special', title: 'בדיקות מיוחדות', match: /מיוחד/ },
  { id: 'changes', title: 'מה השתנה', match: /השתנה|שינויים/ },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Inline markdown: escape first, then **bold** and `code`. */
export function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** Split `---` front matter off the top. */
export function frontMatter(src) {
  const text = src.replace(/\r/g, '');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

/**
 * Parse the body into parts → sections → blocks. Throws on a `# ` heading that names no part,
 * because a check filed under an unknown part would silently vanish from the template.
 */
export function parseChecks(body) {
  const parts = [];
  let part = null;
  let section = null;
  const lines = body.replace(/\r/g, '').split('\n');
  const ensureSection = () => {
    if (!part) throw new Error('content before the first "# " part heading');
    if (!section) { section = { title: '', blocks: [] }; part.sections.push(section); }
    return section;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^# /.test(line)) {
      const name = line.slice(2).trim();
      const def = PARTS.find((p) => p.match.test(name));
      if (!def) throw new Error(`unknown part "${name}" (expected one of: ${PARTS.map((p) => p.title).join(', ')})`);
      part = { id: def.id, title: def.title, sections: [] };
      parts.push(part);
      section = null;
      continue;
    }
    if (/^## /.test(line)) {
      if (!part) throw new Error('a "## " section before the first "# " part heading');
      section = { title: line.slice(3).trim(), blocks: [] };
      part.sections.push(section);
      continue;
    }
    const item = line.match(/^(\s*)- (\[( |x|X)\] )?(.*)$/);
    if (item) {
      const s = ensureSection();
      let list = s.blocks[s.blocks.length - 1];
      if (!list || list.kind !== 'list') { list = { kind: 'list', items: [] }; s.blocks.push(list); }
      list.items.push({ depth: Math.floor(item[1].length / 2), check: !!item[2], done: !!item[3] && item[3] !== ' ', text: item[4] });
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const s = ensureSection();
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // the |---| row
      let table = s.blocks[s.blocks.length - 1];
      if (!table || table.kind !== 'table') { table = { kind: 'table', head: cells, rows: [] }; s.blocks.push(table); continue; }
      table.rows.push(cells);
      continue;
    }
    if (line.trim() === '') continue;
    const s = ensureSection();
    const last = s.blocks[s.blocks.length - 1];
    if (last && last.kind === 'p' && lines[i - 1]?.trim() !== '') last.text += ` ${line.trim()}`;
    else s.blocks.push({ kind: 'p', text: line.trim() });
  }
  parts.sort((a, b) => PARTS.findIndex((p) => p.id === a.id) - PARTS.findIndex((p) => p.id === b.id));
  return parts;
}

/** How many open checks each part holds (shown on the cover). */
export function countChecks(parts) {
  const out = {};
  for (const p of parts) {
    let n = 0;
    for (const s of p.sections) for (const b of s.blocks) if (b.kind === 'list') n += b.items.filter((it) => it.check && !it.done).length;
    for (const s of p.sections) for (const b of s.blocks) if (b.kind === 'table') n += b.rows.length;
    out[p.id] = n;
  }
  return out;
}

function renderBlock(b) {
  if (b.kind === 'p') return `<p>${inline(b.text)}</p>`;
  if (b.kind === 'table') {
    return `<table><thead><tr><th class="box"></th>${b.head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${
      b.rows.map((r) => `<tr><td class="box"><span class="sq"></span></td>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
    }</tbody></table>`;
  }
  return `<ul class="list">${b.items.map((it) => `<li class="d${Math.min(it.depth, 3)}${it.check ? ' check' : ''}${it.done ? ' done' : ''}">${
    it.check ? `<span class="sq">${it.done ? '✓' : ''}</span>` : '<span class="dot"></span>'
  }<span class="txt">${inline(it.text)}</span></li>`).join('')}</ul>`;
}

/** The whole document. One fixed template: cover, then each part on its own page. */
export function renderHtml(src) {
  const { meta, body } = frontMatter(src);
  const parts = parseChecks(body);
  const counts = countChecks(parts);
  const title = meta.title || 'בדיקות אחרי דיפלויי';
  const coverRows = parts.filter((p) => p.id !== 'changes')
    .map((p) => `<div class="tile ${p.id}"><div class="n">${counts[p.id]}</div><div class="l">${esc(p.title)}</div></div>`).join('');
  const sections = parts.map((p) => `
    <section class="part ${p.id}">
      <h1><span class="tag"></span>${esc(p.title)}</h1>
      ${p.sections.map((s) => `${s.title ? `<h2>${inline(s.title)}</h2>` : ''}${s.blocks.map(renderBlock).join('')}`).join('')}
    </section>`).join('');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  :root { --ink:#1c1917; --ink2:#57534e; --line:#e7e5e4; --fire:#c2410c; --computer:#1d4ed8; --phone:#047857; --special:#7c3aed; --changes:#57534e; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: var(--ink); font-size: 10.5pt; line-height: 1.5; margin: 0; }
  .cover { border-bottom: 3px solid var(--fire); padding-bottom: 10mm; margin-bottom: 4mm; }
  .brand { color: var(--fire); font-weight: 800; letter-spacing: .5px; font-size: 11pt; }
  .cover h0, .cover .t { font-size: 24pt; font-weight: 800; margin: 3mm 0 1mm; }
  .meta { color: var(--ink2); font-size: 10pt; }
  .meta b { color: var(--ink); }
  .tiles { display: flex; gap: 4mm; margin-top: 7mm; }
  .tile { flex: 1; border-radius: 4mm; padding: 4mm 5mm; color: #fff; }
  .tile .n { font-size: 22pt; font-weight: 800; line-height: 1; }
  .tile .l { font-size: 10pt; margin-top: 1mm; }
  .tile.computer { background: var(--computer); } .tile.phone { background: var(--phone); } .tile.special { background: var(--special); }
  .how { margin-top: 6mm; color: var(--ink2); font-size: 9.5pt; }
  .part { break-before: page; }
  .part:first-of-type { break-before: auto; }
  h1 { font-size: 17pt; margin: 0 0 4mm; display: flex; align-items: center; gap: 3mm; }
  h1 .tag { width: 4mm; height: 9mm; border-radius: 1mm; display: inline-block; }
  .computer h1 .tag { background: var(--computer); } .phone h1 .tag { background: var(--phone); }
  .special h1 .tag { background: var(--special); } .changes h1 .tag { background: var(--changes); }
  h2 { font-size: 12pt; margin: 6mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid var(--line); break-after: avoid; }
  p { margin: 1.5mm 0; }
  code { font-family: Consolas, monospace; font-size: 9pt; background: #f5f5f4; padding: 0 1mm; border-radius: 1mm; direction: ltr; unicode-bidi: embed; }
  ul.list { list-style: none; margin: 1mm 0; padding: 0; }
  ul.list li { display: flex; gap: 2.5mm; align-items: flex-start; margin: 1.2mm 0; break-inside: avoid; }
  ul.list li.d1 { margin-inline-start: 7mm; } ul.list li.d2 { margin-inline-start: 14mm; } ul.list li.d3 { margin-inline-start: 21mm; }
  .sq { flex: none; width: 4mm; height: 4mm; border: 1.4px solid var(--ink); border-radius: .8mm; margin-top: .9mm; display: inline-flex; align-items: center; justify-content: center; font-size: 8pt; }
  li.done .txt { color: var(--ink2); text-decoration: line-through; }
  .dot { flex: none; width: 1.6mm; height: 1.6mm; border-radius: 50%; background: var(--ink2); margin-top: 2.2mm; margin-inline: 1.2mm; }
  table { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 9.5pt; }
  th { text-align: start; background: #f5f5f4; font-weight: 700; }
  th, td { border: 1px solid var(--line); padding: 1.6mm 2mm; vertical-align: top; }
  tr { break-inside: avoid; }
  td.box, th.box { width: 7mm; text-align: center; }
  .changes { font-size: 9.5pt; }
  .changes ul.list li { margin: .8mm 0; }
</style></head><body>
  <header class="cover">
    <div class="brand">RushPoint</div>
    <div class="t">${esc(title)}</div>
    <div class="meta">${meta.deploy ? `דיפלויי: <b>${esc(meta.deploy)}</b>` : ''}${meta.commit ? ` · קומיט <b>${esc(meta.commit)}</b>` : ''}${meta.since ? ` · שינויים מאז <b>${esc(meta.since)}</b>` : ''}</div>
    <div class="tiles">${coverRows}</div>
    <div class="how">מסמנים ✓ בריבוע כשהבדיקה עברה. בדיקה שנכשלה: רושמים מה קרה בפועל, ושולחים צילום מסך.</div>
  </header>
  ${sections}
</body></html>`;
}
