# Play release — versionCode 2

Artifact: `app-release-bundle.aab` (repo root, gitignored — upload it, do not commit it)

| | |
|---|---|
| Package | `com.rushpoint.app` |
| versionCode | **2** |
| versionName | **2** |
| targetSdkVersion | **36** (Play's minimum from 31 Aug 2026) |
| minSdkVersion | 21 |
| Signed by | `CN=RushPoint` — SHA-256 `22:88:A9:...:47:45`, the Upload key in Play Console |

All four verified by decoding the AAB's own manifest and running `jarsigner -verify`,
not by reading `app/build.gradle`.

---

## Release notes (paste into Play Console)

### English (en-US) — under 500 chars

```
Fixes and polish:
• Fixed a crash that could interrupt a game after completing a task. Your progress was always saved, but the screen could stop responding.
• Photo and voice missions now upload reliably.
• Fixed voice recording not starting on some phones.
• Clearer join screen: your access code is easier to find, and staff sign in is no longer mistaken for team sign in.
```

### Hebrew (he-IL) — under 500 chars

```
תיקונים ושיפורים:
• תוקנה תקלה שיכלה לעצור את המשחק אחרי סיום משימה. ההתקדמות תמיד נשמרה, אבל המסך היה נתקע.
• העלאת תמונות והקלטות קול עובדת עכשיו באופן אמין.
• תוקנה בעיה שבה הקלטת קול לא נפתחה בחלק מהמכשירים.
• מסך ההצטרפות ברור יותר: קל יותר למצוא איפה מזינים את הקוד, וכניסת המארגנים כבר לא מתבלבלת עם כניסת שחקנים.
```

> Written for players, not for us: no internal terms (hooks, ErrorBoundary, VPS,
> MediaRecorder) and no blame-shifting. The crash line says progress was safe,
> because that is the thing a player who hit it actually worried about.

---

## Upload steps

1. Play Console → **RushPoint** → **Test and release** → choose the track
   (**Internal testing** first — see below).
2. **Create new release**.
3. Upload `app-release-bundle.aab`.
4. Paste the release notes above into both `en-US` and `he-IL`.
5. **Review release** → **Start rollout**.

### Do an internal-testing round first

versionCode 1 was never exercised by real installs, and this bundle changes both
the package identity path and the target SDK. An internal track install proves
three things a green build cannot:

- **The URL bar is hidden.** If Digital Asset Links fails to verify, the app opens
  in a visible Chrome tab and looks like a browser, not an app. It is the single
  most common TWA launch failure.
- **The app opens on `rush-point.com`** (not a `.web.app` host).
- **A photo mission uploads** from a real device on mobile data.

If the URL bar shows: the fingerprints in
`apps/play-web/public/.well-known/assetlinks.json` must match Play Console →
**App signing**. Both must be listed — the upload key *and* Google's app signing
key — because with Play App Signing enabled the certificate that reaches phones is
Google's, not yours.

---

## Before every future release

```bash
npm run play:store:check   # manifest + assetlinks + targetSdk gate
npm run upload:check       # photo upload works end to end in production
```

Then bump and build:

```bash
npx @bubblewrap/cli update --manifest ./twa-manifest.json   # bumps versionCode
npm run play:twa:build                                      # re-applies targetSdk 36
```

`bubblewrap update` regenerates `app/build.gradle` and resets `targetSdkVersion`
to whatever bubblewrap's template says (35 as of CLI 1.24.1, the newest published
version). `scripts/patch-twa-target-sdk.mjs` runs automatically on
`postplay:twa:init` and `preplay:twa:build` and puts it back. The level lives in
`PLAY_MIN_TARGET_SDK` (`packages/shared/src/playStore.ts`) — when Play requires 37,
change that one number.

### Signing

The keystore password lives in the password manager, not in this repo
(`android.keystore` and `*.keystore` are gitignored, which is why it was never
committed). To build without an interactive prompt:

```bash
export BUBBLEWRAP_KEYSTORE_PASSWORD='…'
export BUBBLEWRAP_KEY_PASSWORD='…'
```

Both are the same value for this keystore.

> **Windows gotcha:** bubblewrap shells out to a bare `gradlew.bat`, which Windows
> will not resolve from the current directory. Put the repo root on `PATH` for the
> build (`$env:PATH = "C:\Users\savir\Projects\Rushpoint;$env:PATH"`) or it fails
> with *"'gradlew.bat' is not recognized"* even though Gradle is installed and working.
