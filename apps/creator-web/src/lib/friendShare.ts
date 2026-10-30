// "Send it to whoever plays with you": a read-only link to the game, from the feed and the ready screen.
import type { Game } from '@rushpoint/shared';
import { createGameShareLink } from '../services/calls';
import { shareLinkUrl } from '../components/ShareLinkDialog';

export type FriendShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/** The address of the link, minted once per screen: `token` holds it between presses. */
export async function friendLink(game: Game, token: { current: string | null }): Promise<string> {
  if (!token.current) {
    const { link } = await createGameShareLink({ gameId: game.id, allowCopy: false, revealAnswers: false, allowLaunch: false });
    token.current = link.token;
  }
  return shareLinkUrl(token.current);
}

export async function shareWithFriends(game: Game, text: string, token: { current: string | null }): Promise<FriendShareResult> {
  try {
    const url = await friendLink(game, token);
    const nav = navigator as Navigator & { share?: unknown };
    if (typeof nav.share === 'function') {
      await (nav.share as (d: { title: string; text: string; url: string }) => Promise<void>)({ title: game.title, text, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch (e) {
    // Closing the share sheet is a choice, not a failure.
    return (e as { name?: string } | null)?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
