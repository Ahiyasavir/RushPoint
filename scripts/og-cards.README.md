# Open Graph share images (`apps/*/public/og.jpg`)

`og.jpg` is the 1200×630 branded card that WhatsApp / Telegram / Twitter / Facebook
show when someone shares a RushPoint link. It is referenced from each app's
`index.html` (`og:image` / `twitter:image`) as an **absolute** URL — scrapers
require absolute image URLs.

There is no server-side renderer and no raster image lib in the toolchain, so the
cards are drawn **client-side on a `<canvas>`** (same technique as
`apps/play-web/src/lib/storyCard.ts`) and exported once to a static JPEG.

## Regenerating

With a dev server running, paste the draw routine into the browser console for the
relevant app, then save the result:

```js
// returns a data: URL — copy it, then: atob → bytes → write to apps/<app>/public/og.jpg
copy(canvas.toDataURL('image/jpeg', 0.85));
```

- **play-web** — warm "Trail" orange gradient, 🏁, headline "Join the field game".
- **creator-web** — dark theme + orange glow, 🗺️, headline "Build your own field game".

Keep the size at 1200×630 and update the `og:image:width/height` tags if that changes.
