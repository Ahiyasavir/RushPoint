// The game's explainer video, from YouTube (issue 48, Ahiya 2026-10-06: "והם ממש יוכלו לצפות בסרטון
// לפני ההזנקה"). Shown wherever the instructions are: the waiting screen before the start, the "how to
// play" sheet during the game, and the public game page. The server stores only a canonical embed URL
// (cleanGameInstructions); this re-checks it, so a stored value that is somehow not one shows nothing.
// youtube-nocookie: the privacy-enhanced player, so watching the rules sets no YouTube cookie.
import { instructionsVideoUrl, type GameInstructions } from '@rushpoint/shared';
import { useT } from '../i18nContext';

export function instructionsEmbedSrc(ins?: Pick<GameInstructions, 'videoUrl'> | null): string | null {
  const embed = instructionsVideoUrl(ins);
  return embed ? embed.replace('https://www.youtube.com/embed/', 'https://www.youtube-nocookie.com/embed/') + '?rel=0' : null;
}

export function InstructionsVideo({ instructions, className = '' }: { instructions?: GameInstructions | null; className?: string }) {
  const { t } = useT();
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
