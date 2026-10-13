# Delivering a reel

## Where it goes
`docs/marketing/videos/<drafts|published>/<NN>-<slug>/` by the rules in
`docs/marketing/README.md`, enforced by `npx tsx scripts/test-marketing-structure.ts`
(must print 0 failed):

- Next free number: read `docs/marketing/videos/README.md` (12 after 2026-10-02). Never reuse.
- Files: `<NN>-<slug>-v<N>.mp4` (master, opening A) + `<NN>-<slug>-v<N>-small.mp4` (< 15 MB,
  `-b:v 2600k`) + variants after the version (`-open-b`, `-open-c`) + `-cover.png`.
- README with the five headings `סטטוס · התסריט · למה זה בנוי ככה · מה נמדד · פתוח`, plus
  `## כיתוב לפוסט` holding the caption.
- Update the table in `docs/marketing/videos/README.md`.
- Publishing = move the folder to `published/` (`git mv` if tracked) and edit the status
  line. Never rename files. Record WHICH version went up; ask if unknown.
- mp4s are gitignored: no backup. A video to keep forever goes to `apps/marketing/public/uploads/`.
- A shelved reel stays in `drafts/` with a status line saying shelved and why.

## The post caption (his rule)
ONE caption for Instagram, TikTok, Shorts and Facebook, written with the `video-script`
skill (his voice: stacked verbs, clock and numbers, invite not sell, `אתם`), checked with
`python .claude/skills/video-script/scripts/check_script.py`, ending in exactly 5 hashtags,
two of them always `#RushPoint` and `#רשפוינט`, no hyphen anywhere. No claim that is not
true (a mocked quiz is not "a game in the app").

## Sending
Nothing leaves the machine without his explicit OK. When he asks, captions go to him through
the "אודי" Claude session (`SendMessage` to `bridge:session_015YRf8HZseCTdGPVKDq2jtA`, the
address may change: `ListAgents`). Files go to him with `SendUserFile` (render).

## A film that plays INSIDE the app (reel 16, the race opening, 2026-10-13)
- No post caption, no loop, no hook. The README's `## כיתוב לפוסט` says so.
- Deliver three files: the master (`-v<N>.mp4`, `build.py --final`), the chat preview (`-small`), and
  the phone file: 720x1280, crf 25, maxrate 1400k, `-movflags +faststart`, plus a poster jpg of a
  frame with his face.
- It goes to the game's own media folder on the VPS and into the game's instructions. Files there are
  served immutable for a year: a new version gets a new file name.
- **Look for the path that needs nothing from him before proposing one that does** (he had no time
  for a YouTube upload). State of that integration, what is owed and the rollback: the
  `race-opening-video-live-2026-10-13` memory.
- Never join the real run to test. Verify on the emulator with the identical stored value.
