// The game's explainer video (issue 48, Ahiya 2026-10-06: "והם ממש יוכלו לצפות בסרטון
// לפני ההזנקה"). Shown wherever the instructions are: the waiting screen before the start, the "how to
// play" sheet during the game, and the public game page.
//
// Two sources, a file first:
//   - a FILE on our own upload origin (2026-10-13, the vertical opening film of "המירוץ לציון"): a
//     plain <video> in the film's own shape. See lib/instructionsVideoFile.ts for where it travels.
//   - a YouTube link: the server stores only a canonical embed URL (cleanGameInstructions); this
//     re-checks it, so a stored value that is somehow not one shows nothing. youtube-nocookie: the
//     privacy-enhanced player, so watching the rules sets no YouTube cookie.
import { instructionsVideoUrl, type GameInstructions } from '@rushpoint/shared';
import { useT } from '../i18nContext';
import { instructionsVideoFile, instructionsPosterUrl } from '../lib/instructionsVideoFile';

export function instructionsEmbedSrc(ins?: Pick<GameInstructions, 'videoUrl'> | null): string | null {
  const embed = instructionsVideoUrl(ins);
  return embed ? embed.replace('https://www.youtube.com/embed/', 'https://www.youtube-nocookie.com/embed/') + '?rel=0' : null;
}

/** Is there a video to lead with, of either kind? */
export function instructionsHasVideo(ins?: GameInstructions | null): boolean {
  return instructionsVideoFile(ins) !== null || instructionsEmbedSrc(ins) !== null;
}

export function InstructionsVideo({ instructions, className = '' }: { instructions?: GameInstructions | null; className?: string }) {
  const { t } = useT();
  const file = instructionsVideoFile(instructions);
  if (file) {
    // The film decides its own shape (it is vertical); the height is capped so the card's title and
    // the button under it stay on the screen. `playsInline`: iOS would otherwise jump to fullscreen
    // on play. `preload="metadata"`: hundreds of phones on one cell tower must not each pull the
    // whole film just by opening the waiting screen. No autoplay: with sound it is blocked anyway.
    return (
      <div className={`w-full flex justify-center bg-white ${className}`} data-testid="instructions-video-file">
        <video src={file} poster={instructionsPosterUrl(file)} controls playsInline preload="metadata"
          aria-label={t.play.howToPlayVideo} className="block w-auto max-w-full max-h-[62dvh]" />
      </div>
    );
  }
  const src = instructionsEmbedSrc(instructions);
  if (!src) return null;
  return (
    <div className={`relative w-full overflow-hidden bg-black ${className}`} style={{ aspectRatio: '16 / 9' }} data-testid="instructions-video">
      <iframe src={src} title={t.play.howToPlayVideo} loading="lazy"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen className="absolute inset-0 h-full w-full" />
    </div>
  );
}
