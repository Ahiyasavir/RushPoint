# RushPoint — Marketing / Explainer Video Plan

Research-backed production plan for a Hebrew (RTL) marketing video explaining RushPoint.
Built as an animated **Remotion** project (kinetic typography + faithful animated UI mockups,
no live screen-recording), rendered to MP4. Two masters:

- **Hero Cut** — 1920×1080, ~72.6s / 2178f (`HeroCut`) — landing page hero + YouTube/LinkedIn.
  (9 scenes × their durations minus 8 × 9-frame fade overlaps.)
- **Social Cut** — 1080×1920 vertical, 20s / 600f (`SocialCut`) — Reels / TikTok / App-Store-style.

Scenes are joined with short (9-frame) cross-fade transitions (`@remotion/transitions`) so there is
never an empty frame at a cut. Delivered MP4s are silent (add a music bed in any editor).

Language: **Hebrew, RTL**. Brand wordmark stays Latin ("RushPoint"). Tagline: **המשחק יוצא החוצה**.

---

## Research findings (adversarially verified)

Sources fanned out across 6 angles, 24 sources fetched, 25 claims verified with 3-vote
adversarial checking. **8 survived; 17 plausible-but-unsourced stats were killed** (e.g. the
"87% skip in 3s" and "340% engagement" numbers — do not cite them).

**Confirmed principles used in this plan:**
1. **Length** — 60–90s is the SaaS/landing-page sweet spot, brisk ~130–150 wpm pacing. → We use 75s.
   (puppydog.io, yansmedia, mawmotionstudios)
2. **Hook timing** — land the hook in ~1.5–5s (as fast as 1.5–2s for vertical/social); open on
   *pain or payoff*, never a logo or slow fade. → S1 opens on the "clipboard" pain question.
   (Wistia engagement data, splitmetrics/App-Store guidance, TikTok/Reels retention)
3. **Narrative frameworks** — PAS (Problem → Agitate → Solve) and AIDA (Attention → Interest →
   Desire → Action, ending on one CTA) are the established structures. → We use PAS→AIDA.
   (motionvillee, storyprompt, CFI/MindTools for AIDA)
4. **App Store previews** — must be 15–30s, authentic in-app footage, designed to work **muted**
   with on-screen text (autoplay is silent). → drives the muted-first, caption-carries-everything
   design and the 20s vertical cut. (Apple developer docs — authoritative; splitmetrics et al.)

**No-voiceover consequence:** captions/kinetic typography carry 100% of the narrative load;
text timing is the pacing clock. Every clip gets a 2–6 word caption synced to the action.

**Where voiceover would upgrade it (if a Hebrew VO is recorded later):**
- The S1 hook line (highest leverage).
- A warm closing line over the CTA card (e.g. "האירוע הבא שלכם — אוטומטי לגמרי").

---

## Hero Cut — scene-by-scene (30fps, frames in brackets)

| # | Time | Frames | Scene | On-screen Hebrew | Visual |
|---|------|--------|-------|------------------|--------|
| 1 | 0:00–0:03 | 0–90 | Hook | עדיין מנהלים אירוע עם **דף ועט?** | Dark; floating desaturated "old way" chips (רשימה על נייר / מפה מודפסת / שיפוט ידני / ווקי-טוקי); red pulse |
| 2 | 0:03–0:08 | 90–240 | Problem (agitate) | ניקוד ידני. קבוצות אבודות. → שעות הכנה. שיפוט סובייקטיבי. | Scattered problem chips; sequential caption swap |
| 3 | 0:08–0:14 | 240–420 | Reveal | (logo) → בונים **משחק שדה** אמיתי — תוך דקות. | Logo mark spins in with glow; wordmark |
| 4 | 0:14–0:26 | 420–780 | Build | מוסיפים שלבים. → משבצים משימות על המפה. → תמונות · חידונים · קודים סודיים · סריקות | Browser chrome (rushpoint.app/build): dark Builder — stages rail, map + pins, task-type chips, Launch button, cursor |
| 5 | 0:26–0:32 | 780–960 | Launch + Join | משתפים קוד אחד. → הקבוצות מצטרפות מיד. | Big RUSH42 code card + phone typing the code → success |
| 6 | 0:32–0:46 | 960–1380 | Play (core) | GPS מנתב כל קבוצה. → מצלמים תמונה. סורקים. עונים. → צופים בטבלה משתנה — בשידור חי. | Phone: live map + route + moving marker + next-task card; then live leaderboard panel slides in, hero team climbs to #1 |
| 7 | 0:46–0:56 | 1380–1680 | Proof (no judges) | בלי סטופר. **בלי שופטים.** → ניקוד אוטומטי. בכל פעם. | Struck-through סטופר/שופטים/חישובים chips; spinning gear |
| 8 | 0:56–1:03 | 1680–1890 | Audience | מושלם עבור: תנועות נוער · גיבוש לחברות · בר וברת מצווה · כל אירוע, בכל מקום | 4 fire-tile cards popping in |
| 9 | 1:03–1:15 | 1890–2250 | CTA | בנו את משחק השדה הראשון שלכם — **חינם** · המשחק יוצא החוצה. · rushpoint.app → | Logo, confetti, glowing CTA button (hold on end card) |

Hard cuts on beat with a quick white flash at each boundary.

## Social Cut (20s, vertical)
Brand burst → phone Join → phone Play+map → phone Final(🏆) → CTA. Opens on payoff (per App
Store convention: no slow build), all phone-framed for vertical, big top captions.

---

## Music / pacing (to add — not in the silent master)
One instrumental bed, ~120–128 BPM, no lyrics: low-pass intro (0:00–0:04) → drums in at the
reveal (0:05) → energetic groove through demo → brief drop on "בלי שופטים" (~0:48) → swell into
CTA with a hard stop on the end card. Land every hard cut on a beat; layer whoosh/UI-tap SFX.
The delivered MP4 is **silent** (no licensed track available) — drop a track over it in any editor.

---

## Files

- `docs/marketing/rushpoint-hero.mp4` — the 72.6s landing/YouTube master.
- `docs/marketing/rushpoint-social.mp4` — the 20s vertical Reels/TikTok master.
- `docs/marketing/video-remotion/` — the full Remotion source (edit + re-render).

## The Remotion project

Source lives at `docs/marketing/video-remotion/` (a standalone project, NOT in the npm
workspaces — it won't affect repo gates). Brand tokens mirror `apps/*/tailwind.config.js` +
`index.css`.

```
cd docs/marketing/video-remotion
npm install
npx remotion studio src/index.ts          # live preview/editor
npx remotion render src/index.ts HeroCut   out/rushpoint-hero.mp4   --concurrency=4
npx remotion render src/index.ts SocialCut out/rushpoint-social.mp4 --concurrency=4
```

Fonts: Rubik (Hebrew display) + Heebo + JetBrains Mono (codes), via `@remotion/google-fonts`
with `subsets: ['hebrew','latin']`. To edit copy, see `src/scenes/AllScenes.tsx` (`*word*` marks
a fire-gradient accent span). All UI mockups are in `src/ui/mocks/`.
