// The layout audit (2026-10-27): what a screenshot shows a person and a source scan cannot, measured
// in the browser. Ahiya kept finding the same three defects by eye: a box that scrolls INSIDE a screen
// that already scrolls, content cut off by its own frame, and a map too small to use. Each is a fact
// about rendered geometry, so this asks the layout engine instead of guessing from class strings.
//
// `auditLayoutInPage` is serialised into the page by Playwright's `page.evaluate`, so it must stay
// self-contained (no imports, no closures over module scope). It returns plain data; the caller
// decides what is a failure. Used by scripts/audit-layout.mjs.

/**
 * @param {{ root?: string, minMapShare?: number, tolerancePx?: number }} opts
 * @returns {{ viewport: {w:number,h:number}, scrollers: object[], clipped: object[], maps: object[], contentWidthShare: number|null }}
 */
export function auditLayoutInPage(opts) {
  const root = (opts && opts.root && document.querySelector(opts.root)) || document.body;
  const tol = (opts && opts.tolerancePx) || 4;
  const vw = window.innerWidth; const vh = window.innerHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const text = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 6).join(' ') : '';
    return { tag: el.tagName.toLowerCase(), cls, text, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const all = [root, ...root.querySelectorAll('*')].filter((el) => !el.closest('.maplibregl-map') || el.classList.contains('maplibregl-map'));

  // 1. Scroll containers that actually scroll. The outermost one is the screen's own scroll and is
  //    reported separately; every one INSIDE another is a nested scroll.
  const scrolling = all.filter((el) => {
    const cs = getComputedStyle(el);
    const y = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + tol;
    const x = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + tol;
    return (y || x) && visible(el);
  });
  const scrollers = scrolling.map((el) => ({
    ...describe(el),
    nested: scrolling.some((o) => o !== el && o.contains(el)),
    overflowBy: Math.max(el.scrollHeight - el.clientHeight, el.scrollWidth - el.clientWidth),
  }));

  // 2. Clipped: a visible element that sticks out of an ancestor which hides (or scrolls) its
  //    overflow, by more than the tolerance, in a direction that ancestor clips.
  const clipped = [];
  for (const el of all) {
    if (!visible(el) || el === root) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    let p = el.parentElement;
    while (p && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      const clipY = cs.overflowY !== 'visible'; const clipX = cs.overflowX !== 'visible';
      if (clipX || clipY) {
        const pr = p.getBoundingClientRect();
        // A scroller that scrolls is case 1, not a clip.
        const scrollsY = /(auto|scroll)/.test(cs.overflowY); const scrollsX = /(auto|scroll)/.test(cs.overflowX);
        const outY = clipY && !scrollsY && (r.bottom > pr.bottom + tol || r.top < pr.top - tol);
        const outX = clipX && !scrollsX && (r.right > pr.right + tol || r.left < pr.left - tol);
        if (outY || outX) {
          clipped.push({ ...describe(el), by: describe(p), outBy: Math.round(Math.max(r.bottom - pr.bottom, pr.top - r.top, r.right - pr.right, pr.left - r.left)) });
        }
        break;
      }
      p = p.parentElement;
    }
  }
  // Report the outermost clipped element of each chain only (its children are clipped with it).
  const outer = clipped.filter((c, i) => !clipped.some((o, j) => j !== i && o.by.x === c.by.x && o.by.y === c.by.y && o.w >= c.w && o.h >= c.h && o.y <= c.y && o.x <= c.x && (o.w > c.w || o.h > c.h)));

  // 2b. A box that hides its overflow can still be scrolled by focus; one already shifted is the
  //     "whole screen slid sideways" defect (27.10).
  for (const el of all) {
    const cs = getComputedStyle(el);
    if ((cs.overflowX === 'hidden' || cs.overflowY === 'hidden') && (Math.abs(el.scrollLeft) > tol || el.scrollTop > tol)) {
      outer.push({ ...describe(el), by: describe(el), outBy: Math.round(Math.max(Math.abs(el.scrollLeft), el.scrollTop)), shifted: true });
    }
  }

  // 3. Maps: their size against the viewport, and whether the whole map is on screen.
  // On a computer the screen should not need scrolling to reach the map: one under the footer is cut.
  const footerTop = (() => { const f = root.querySelector('footer'); return f ? f.getBoundingClientRect().top : vh; })();
  const maps = [...root.querySelectorAll('.maplibregl-map')].filter(visible).map((m) => {
    const r = m.getBoundingClientRect();
    const underFooter = vw >= 1024 && r.bottom > footerTop + tol;
    // Off screen = it cannot be seen whole even after scrolling to it: taller than the space a
    // fixed header and footer leave (~78% of the window), or clipped sideways.
    return { w: Math.round(r.width), h: Math.round(r.height), share: +(r.width * r.height / (vw * vh)).toFixed(2), heightShare: +(r.height / vh).toFixed(2), offscreen: underFooter || r.height > vh * 0.78 || r.right > vw + tol || r.left < -tol };
  });

  // 4. How much of the width the content uses (dead space on wide screens).
  const main = root.querySelector('[data-audit="content"]');
  const contentWidthShare = main ? +(main.getBoundingClientRect().width / vw).toFixed(2) : null;

  return { viewport: { w: vw, h: vh }, scrollers, clipped: outer.slice(0, 12), maps, contentWidthShare };
}

/** The sizes every screen is judged at: a short and a tall phone, a tablet, three desktops. */
export const AUDIT_VIEWPORTS = [
  { name: 'phone-short', width: 375, height: 667 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop-short', width: 1366, height: 657 },
  // The founder's own browser window on 27.10 (the screenshot that started this tool).
  { name: 'laptop-small', width: 1137, height: 588 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
];

/**
 * The verdict for one screen at one size. Pure, so the thresholds are written down once.
 * `allowRootScroll` lets the screen's single outer scroller scroll (that is one scroll, not a nest).
 */
export function judgeLayout(report, { mapMinHeightShare = 0.42, allowRootScroll = true } = {}) {
  const problems = [];
  for (const s of report.scrollers) {
    if (s.nested) problems.push(`nested scroll (${s.overflowBy}px) in ${s.tag}.${s.cls.split(' ')[0] || ''} "${s.text.slice(0, 30)}"`);
    else if (!allowRootScroll) problems.push(`screen scrolls by ${s.overflowBy}px`);
  }
  for (const c of report.clipped) problems.push(`clipped by ${c.outBy}px: ${c.tag} "${c.text.slice(0, 30)}" inside ${c.by.tag}.${c.by.cls.split(' ')[0] || ''}`);
  for (const m of report.maps) {
    if (m.offscreen) problems.push(`map runs off the screen (${m.w}x${m.h})`);
    if (m.heightShare < mapMinHeightShare) problems.push(`map is ${Math.round(m.heightShare * 100)}% of the screen height (${m.w}x${m.h}), wants ${Math.round(mapMinHeightShare * 100)}%`);
  }
  return problems;
}
