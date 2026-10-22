// tl;dv transcript extractor. Paste into the browser console (F12) on a tl;dv meeting page you are
// signed in to, with the Transcript tab open. It scrolls the transcript, collects every paragraph the
// page renders for your plan, and puts "[mm:ss] Speaker: text" lines on your clipboard (and in
// window.__tldvTranscript). Free plan: tl;dv's own "Copy text" button is a PRO feature; this reads
// only what the page itself already shows you. No network calls, no tokens, nothing leaves the page.
// Then save the clipboard as a .txt into the Udi meetings inbox (see wa-watch/meeting-notes.mjs).
(async () => {
  const box = [...document.querySelectorAll('div')].find(e => /max-w-\[630px\]/.test(String(e.className)) && e.scrollHeight > e.clientHeight);
  if (!box) { console.error('transcript box not found: open the Transcript tab first'); return; }
  const seen = new Map();
  const words = p => [...p.querySelectorAll('span[data-word]')].filter(s => s.dataset.speaker !== 'true').map(s => s.textContent).join('').replace(/\s+/g, ' ').trim();
  const grab = () => box.querySelectorAll('p[data-index]').forEach(p => {
    const t = words(p);
    if (t.length > 2) seen.set(+p.dataset.index, { tm: +p.dataset.time, sp: (p.querySelector('button') || {}).innerText || '', t });
  });
  const step = Math.max(40, Math.floor(box.clientHeight * 0.5));
  for (let y = 0; y <= box.scrollHeight + step; y += step) { box.scrollTop = y; await new Promise(r => setTimeout(r, 120)); grab(); }
  const mmss = ms => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  let last = '';
  const out = [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => {
    const head = v.sp && v.sp !== last ? '[' + mmss(v.tm) + '] ' + v.sp + ': ' : '[' + mmss(v.tm) + '] ';
    if (v.sp) last = v.sp;
    return head + v.t;
  }).join('\n');
  window.__tldvTranscript = out;
  try { await navigator.clipboard.writeText(out); } catch { console.warn('clipboard blocked; use copy(window.__tldvTranscript)'); }
  console.log('paragraphs: ' + seen.size + ', chars: ' + out.length);
})();
