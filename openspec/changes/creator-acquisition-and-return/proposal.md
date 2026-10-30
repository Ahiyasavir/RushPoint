## Why

Ahiya, 30.10: many people arrive, build half a game, leave and never come back; too few sign up;
too few create a game on arrival; hosts do not end their runs. The sign-up wall came before any value
(opened on "welcome back", four fields), and nothing could bring a half-builder back.

## What changes

- **Guest building.** "Start building" (landing and the marketing `?start=game` CTA) signs the
  visitor in as an anonymous user and opens the new-game wizard. No form first.
- **When a guest is asked to save** (`lib/guestCreator.ts`): softly once when the composed game first
  opens (skippable, "later"); required after 3 saved edits (cannot be dismissed); always before launch
  or publish; the browser's leave-page prompt while a guest is in the Builder. Saving LINKS an email or
  Google credential onto the anonymous user, so the uid and the game stay put.
- **Sign-up form.** A stranger opens on sign up (a browser that signed in before opens on sign in);
  no "confirm password" field.
- **End-run call** (`lib/endRunCall.ts`): when every started team has finished, a loud hero at the top
  of the run console ("time to find out who won"); at 60% a quieter banner. After ending, the moments
  feed opens when there are photos.
- **Swipe generator.** The game generator is an Embla carousel (`embla-carousel-react` + auto height, RTL
  aware): every question is a slide, a single choice answers and slides on after 280 ms, a swipe moves
  either way, and "next" is left only on multi-choice questions. Approved by Ahiya, 30.10.
- **Youth template:** `code-names` replaced by `three-feet`; `code-names` loses its `youth` tag
  (Ahiya: childish for teens).

## Not in this change

- No server gate on launch/publish for anonymous users: anonymous users could already do both before
  (every player is one), and every test and load script drives the API as an anonymous creator.
- A guest whose Google account already has a RushPoint account cannot merge the guest game into it;
  they are told to save with another email.
- Draft reminder emails and push (next).
