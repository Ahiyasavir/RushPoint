// Pure tests for the self hosted intro video of a game (2026-10-13, the opening video of
// "המירוץ לציון": a vertical film that explains the race, shown to every player on entry).
//
// The instructions already carry a YouTube link (issue 48), but a YouTube player is a 16:9 box and
// needs an upload to someone's channel. A video file on OUR upload origin plays in a plain <video>,
// in its own shape. Tonight it travels in `instructions.imageUrl`, the one field the server already
// passes through for any https URL, so no server deploy is needed the night before a 500 student
// event; the verdicts below are what keeps that safe:
//   - only a file under /uploads/ on a RushPoint upload origin is ever played (never a stranger's URL),
//   - anything else is still an image, exactly as before,
//   - the intro opens by itself once per team and device, and a storage failure means it does NOT
//     open (a blocking flag fails open: the game is never covered by something we cannot dismiss).
//   npx tsx scripts/test-instructions-video-file.ts
import {
  instructionsVideoFile, instructionsPosterUrl, instructionsImageUrl, introSeenKey, shouldAutoOpenIntro,
} from '../apps/play-web/src/lib/instructionsVideoFile';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const OK = 'https://api.rush-point.com/uploads/gameMedia/owner1/games/game1/race-opening.mp4';

check('an mp4 under /uploads/ on our origin is a video file', instructionsVideoFile({ imageUrl: OK }) === OK);
check('webm too', instructionsVideoFile({ imageUrl: OK.replace('.mp4', '.webm') }) === OK.replace('.mp4', '.webm'));
check('a query string does not hide the extension', instructionsVideoFile({ imageUrl: OK + '?v=2' }) === OK + '?v=2');
check('surrounding spaces are ignored', instructionsVideoFile({ imageUrl: '  ' + OK + ' ' }) === OK);
check('upper case extension', instructionsVideoFile({ imageUrl: OK.replace('.mp4', '.MP4') }) !== null);

check('a jpg on our origin is NOT a video', instructionsVideoFile({ imageUrl: OK.replace('.mp4', '.jpg') }) === null);
check('an mp4 on another host is NOT played', instructionsVideoFile({ imageUrl: 'https://evil.example/uploads/x.mp4' }) === null);
check('a look alike host is NOT played', instructionsVideoFile({ imageUrl: 'https://api.rush-point.com.evil.example/uploads/x.mp4' }) === null);
check('http is NOT played', instructionsVideoFile({ imageUrl: OK.replace('https://', 'http://') }) === null);
check('our origin outside /uploads/ is NOT played', instructionsVideoFile({ imageUrl: 'https://api.rush-point.com/other/x.mp4' }) === null);
check('a path that climbs out is NOT played', instructionsVideoFile({ imageUrl: 'https://api.rush-point.com/uploads/../x.mp4' }) === null);
check('mp4 only in the query is NOT a video', instructionsVideoFile({ imageUrl: 'https://api.rush-point.com/uploads/a.jpg?f=x.mp4' }) === null);
check('no instructions, no field, garbage: null, never a throw',
  instructionsVideoFile(undefined) === null && instructionsVideoFile(null) === null && instructionsVideoFile({}) === null
  && instructionsVideoFile({ imageUrl: 'not a url' }) === null && instructionsVideoFile({ imageUrl: 42 as unknown as string }) === null);

check('the poster sits beside the film', instructionsPosterUrl(OK) === OK.replace('.mp4', '.jpg'));
check('the poster drops the query', instructionsPosterUrl(OK + '?v=2') === OK.replace('.mp4', '.jpg'));

check('a video file is never also drawn as an image', instructionsImageUrl({ imageUrl: OK }) === null);
check('a real image still is', instructionsImageUrl({ imageUrl: 'https://example.com/a.png' }) === 'https://example.com/a.png');
check('no image: null', instructionsImageUrl({}) === null && instructionsImageUrl(null) === null);

check('the seen key is per run and team', introSeenKey('r1', 't1') === 'rp-intro-seen:r1:t1' && introSeenKey('r1', 't2') !== introSeenKey('r1', 't1'));

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
};
const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };

check('first entry with a video: opens', shouldAutoOpenIntro({ hasVideo: true, key: 'k', storage: mem() }) === true);
check('already seen: stays closed', shouldAutoOpenIntro({ hasVideo: true, key: 'k', storage: mem({ k: '1' }) }) === false);
check('no video: never opens', shouldAutoOpenIntro({ hasVideo: false, key: 'k', storage: mem() }) === false);
check('no key (no team yet): never opens', shouldAutoOpenIntro({ hasVideo: true, key: null, storage: mem() }) === false);
check('storage throws: does NOT open (cannot remember, so cannot promise "once")', shouldAutoOpenIntro({ hasVideo: true, key: 'k', storage: broken }) === false);
check('storage missing: does NOT open', shouldAutoOpenIntro({ hasVideo: true, key: 'k', storage: null }) === false);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
