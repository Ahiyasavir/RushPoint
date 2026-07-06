// Pure-logic tests for task-media helpers (change: task-media-attachments).
// parseYouTubeId / isTaskMediaValid / normalizeTaskMedia are the trust boundary for
// creator-authored task media: uploaded image/video URLs must be Firebase Storage
// URLs, YouTube links must parse to a valid 11-char id and be canonicalized to the
// embed form, and everything else is dropped. No Firebase, no emulator.
//   npx tsx scripts/test-task-media.ts
import {
  parseYouTubeId,
  isTaskMediaValid,
  normalizeTaskMedia,
  FIREBASE_STORAGE_ORIGIN,
} from '../packages/shared/src/validation';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const ID = 'dQw4w9WgXcQ'; // canonical 11-char sample id
const STORAGE_IMG = `${FIREBASE_STORAGE_ORIGIN}o/gameMedia%2Fowner1%2Fgames%2Fg1%2Fabc.jpg?alt=media&token=xyz`;
const STORAGE_VID = `${FIREBASE_STORAGE_ORIGIN}o/gameMedia%2Fowner1%2Fgames%2Fg1%2Fclip.mp4?alt=media&token=xyz`;
const EMBED = `https://www.youtube.com/embed/${ID}`;

// ── parseYouTubeId ────────────────────────────────────────────────────────────
check('watch URL with extra params → id', parseYouTubeId(`https://www.youtube.com/watch?v=${ID}&t=42s`) === ID);
check('watch URL id-only', parseYouTubeId(`https://www.youtube.com/watch?v=${ID}`) === ID);
check('youtu.be short URL → id', parseYouTubeId(`https://youtu.be/${ID}`) === ID);
check('youtu.be with query → id', parseYouTubeId(`https://youtu.be/${ID}?si=abc`) === ID);
check('shorts URL → id', parseYouTubeId(`https://www.youtube.com/shorts/${ID}`) === ID);
check('embed URL → id', parseYouTubeId(EMBED) === ID);
check('http (no www) watch → id', parseYouTubeId(`http://youtube.com/watch?v=${ID}`) === ID);
check('vimeo → null', parseYouTubeId('https://vimeo.com/123456') === null);
check('empty string → null', parseYouTubeId('') === null);
check('null → null', parseYouTubeId(null) === null);
check('number → null', parseYouTubeId(42 as unknown) === null);
check('too-short id → null', parseYouTubeId('https://youtu.be/short') === null);

// ── isTaskMediaValid ──────────────────────────────────────────────────────────
check('valid storage image', isTaskMediaValid({ kind: 'image', url: STORAGE_IMG }) === true);
check('valid storage video', isTaskMediaValid({ kind: 'video', url: STORAGE_VID }) === true);
check('valid youtube (raw watch url)', isTaskMediaValid({ kind: 'youtube', url: `https://youtu.be/${ID}` }) === true);
check('external image → invalid', isTaskMediaValid({ kind: 'image', url: 'https://evil.example.com/x.jpg' }) === false);
check('unknown kind → invalid', isTaskMediaValid({ kind: 'gif', url: STORAGE_IMG }) === false);
check('missing url → invalid', isTaskMediaValid({ kind: 'image' }) === false);
check('non-object → invalid', isTaskMediaValid(null) === false);
check('youtube with non-yt url → invalid', isTaskMediaValid({ kind: 'youtube', url: 'https://vimeo.com/1' }) === false);

// ── normalizeTaskMedia ────────────────────────────────────────────────────────
check('non-array → []', Array.isArray(normalizeTaskMedia('nope')) && normalizeTaskMedia('nope').length === 0);
check('undefined → []', normalizeTaskMedia(undefined).length === 0);

const kept = normalizeTaskMedia([{ kind: 'image', url: STORAGE_IMG }]);
check('storage image kept', kept.length === 1 && kept[0].kind === 'image' && kept[0].url === STORAGE_IMG);

const dropped = normalizeTaskMedia([{ kind: 'image', url: 'https://evil.example.com/x.jpg' }]);
check('external image dropped', dropped.length === 0);

const yt = normalizeTaskMedia([{ kind: 'youtube', url: `https://youtu.be/${ID}` }]);
check('youtube canonicalized to embed', yt.length === 1 && yt[0].url === EMBED);

const mixed = normalizeTaskMedia([
  { kind: 'gif', url: 'x' },
  { kind: 'image', url: STORAGE_IMG },
  { kind: 'youtube', url: `https://www.youtube.com/watch?v=${ID}` },
]);
check('mixed: unknown dropped, valid kept', mixed.length === 2 && mixed[0].kind === 'image' && mixed[1].url === EMBED);

const cap = normalizeTaskMedia([{ kind: 'image', url: STORAGE_IMG, caption: '  hello  ' }]);
check('caption trimmed', cap[0].caption === 'hello');
const capEmpty = normalizeTaskMedia([{ kind: 'image', url: STORAGE_IMG, caption: '   ' }]);
check('empty caption dropped', capEmpty[0].caption === undefined);

const noId = normalizeTaskMedia([{ kind: 'image', url: STORAGE_IMG }]);
check('stable non-empty id assigned', typeof noId[0].id === 'string' && noId[0].id.length > 0);
const keepId = normalizeTaskMedia([{ id: 'fixed-1', kind: 'image', url: STORAGE_IMG }]);
check('existing id preserved', keepId[0].id === 'fixed-1');

console.log(failures === 0 ? '\nAll task-media tests passed.' : `\n${failures} task-media test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
