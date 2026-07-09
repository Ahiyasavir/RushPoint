import { loadFont as loadRubik } from '@remotion/google-fonts/Rubik';
import { loadFont as loadHeebo } from '@remotion/google-fonts/Heebo';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

// Load Hebrew + Latin subsets so RTL captions render correctly.
export const rubik = loadRubik('normal', {
  weights: ['400', '500', '600', '700', '800', '900'],
  subsets: ['hebrew', 'latin'],
});
export const heebo = loadHeebo('normal', {
  weights: ['400', '500', '700', '800'],
  subsets: ['hebrew', 'latin'],
});
export const mono = loadMono('normal', {
  weights: ['500', '700'],
  subsets: ['latin'],
});

export const waitForFonts = () =>
  Promise.all([rubik.waitUntilDone(), heebo.waitUntilDone(), mono.waitUntilDone()]);
