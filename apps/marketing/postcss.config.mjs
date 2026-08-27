// Tailwind v4 is wired through PostCSS here, NOT through @tailwindcss/vite.
//
// Why: this is an npm workspace. The root pins Vite 5 for creator-web and
// play-web, Astro 7 carries its own nested Vite 8, and a hoisted
// @tailwindcss/vite resolves `vite` from the ROOT — so it loaded Vite 5's
// internals against Astro's Vite 8 and the build died with
// `M.createIdResolver is not a function`. Nothing in the marketing site was
// wrong; the plugin was simply handed the other apps' Vite.
//
// @tailwindcss/postcss does not import Vite at all, so the two versions stop
// being each other's problem. Do not "simplify" this back to the Vite plugin
// unless the whole repository moves to one Vite major.
import tailwindcss from '@tailwindcss/postcss';

export default {
  plugins: [tailwindcss()],
};
