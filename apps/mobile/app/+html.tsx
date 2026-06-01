import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Web-only root HTML shell for Expo Router (used for `expo start --web` and the
 * static export). This is where PWA install + iOS metadata live — the native
 * apps never see this file.
 *
 * The service worker itself is registered client-side in app/_layout.tsx
 * (production web only). Icons/manifest/sw.js are served from apps/mobile/public.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover so the matte-dark UI extends under the notch */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <title>RushPoint — Race to Tzion</title>

        {/* PWA install + theming */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0B0F17" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />

        {/* iOS home-screen / standalone */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="RushPoint" />
        <link rel="apple-touch-icon" href="/icon.svg" />

        {/* Expo Router requires this reset so ScrollView/body sizing matches native */}
        <ScrollViewStyleReset />

        {/* Lock the document background to the app's matte obsidian (no white flash) */}
        <style dangerouslySetInnerHTML={{ __html: `
          html, body, #root { background-color: #0B0F17; }
          body { overscroll-behavior: none; }
        ` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
