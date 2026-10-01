# RushPoint Live — Gemini logo prompt

**איך משתמשים**
1. פותחים את Gemini (מומלץ מצב יצירת תמונות / Nano Banana, או Gemini 3 Pro Image).
2. מצרפים את `apps/play-web/public/icon-512.png` כתמונת ייחוס (או `icon.svg` אם מותר).
3. מדביקים את הפרומפט למטה. מייצרים 3–4 וריאציות ובוחרים.
4. לשיפורים — משתמשים בפרומפטי ההמשך בסוף הקובץ.

---

## הפרומפט הראשי (להדביק ב-Gemini)

```
I'm attaching the existing app icon of "RushPoint": an orange rounded-square
with a white circular track ring, a cyan (#22D3EE) speed arc on the ring's
upper-right, and a white forward-leaning compass needle in the middle.

Design a new logo for "RushPoint Live" — the live-operations edition of the
platform (real-time field games: live leaderboard, live map, live team tracking).

CONCEPT
Keep the attached icon's DNA recognizable (the ring + the tilted compass
needle + the cyan arc) and add the "LIVE" idea to it. Choose ONE of these
live cues and execute it cleanly:
  (a) a small solid red-orange "live" dot with a soft pulse ring, sitting on
      the tip of the needle or at the end of the cyan arc, like a
      broadcast "● LIVE" indicator;
  (b) two or three concentric broadcast/signal arcs radiating from the needle
      tip, as if the position is being transmitted in real time.
The result must read as "RushPoint, but live" at a glance.

LAYOUT
Horizontal lockup: icon mark on the left, wordmark on the right.
Wordmark: "RushPoint" in a bold, geometric, slightly italic sans-serif
(forward motion, sporty, friendly), with a small pill badge "LIVE" next to or
under it — rounded pill, solid red-orange fill, white bold uppercase text,
tiny pulsing dot before the letters.
Also provide a compact square version (mark only) for an app icon / favicon.

COLORS (exact brand palette)
- Fire orange #FF5722 (primary)
- Amber #FFB300 (secondary highlight)
- Plasma cyan #06B6D4 / #22D3EE (the speed arc and signal accents)
- Live red #EF4444 (only for the LIVE dot/badge)
- Off-white #FFFCF7 and near-black #0B0F17 for text and contrast

STYLE
Modern, flat vector logo with a hint of depth (one subtle gradient at most),
clean geometry, thick confident strokes, consistent corner radii, high energy,
sporty and adventurous, readable at 24 px. Not realistic, not 3D-rendered,
no photo textures.

DELIVERABLE
- Show the logo on a light background (#FFFCF7) AND on a dark background
  (#0B0F17), side by side.
- Plain flat backgrounds, centered, generous padding, no mockups, no hands,
  no scenery.
- Square 1:1 image.

AVOID
Extra text besides "RushPoint" and "LIVE", misspelled letters, gibberish text,
watermarks, clutter, tiny details, more than 4 colors, neon glow blur,
a generic location pin or generic play button, a camera/film-reel cliché,
gradients on the wordmark.
```

---

## פרומפטי המשך (לשיפור בצ'אט)

- **ליצור גרסה שלישית נקייה:** `Same logo, but single-color white on an orange #FF5722 background. Flat, no gradients.`
- **רק האייקון:** `Now only the square mark (no wordmark), full-bleed orange background, safe zone for a rounded app-icon mask, live cue still visible.`
- **פחות עמוס:** `Simplify: remove everything that disappears at 24px. Keep ring, needle, live dot only.`
- **תיקון טקסט:** `The wordmark must read exactly "RushPoint" and the badge exactly "LIVE". Fix the letters, keep everything else identical.`
- **רקע שקוף:** `Same logo on a pure solid white background so I can remove it easily, with no shadows.`
- **גרסה לעברית:** `Add a Hebrew version of the lockup: "ראשפוינט" with the same "LIVE" badge, right-to-left, matching weight and color.`

## טיפים
- Gemini לא תמיד מוציא PNG שקוף. מבקשים רקע לבן מלא ואז מסירים ב-remove.bg / Canva.
- אם הטקסט יוצא עקום, הכי טוב לקחת את האייקון מהתמונה ולהקליד את "RushPoint" בעצמך בפונט כמו **Poppins Bold Italic** / **Outfit** / **Sora**.
- בסוף כדאי לצייר מחדש כ-SVG (Figma / Illustrator / Vectorizer.ai) כדי שזה יעבוד בכל גודל.
