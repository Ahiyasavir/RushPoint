// The funnel, from the first answer to the launch press (changes: first-visit-instant-build,
// creator-stays-to-the-end), sent to the Google tag the page already loads. Never throws and never waits:
// measuring must not be able to touch the thing it measures.
export const FUNNEL_EVENTS = [
  'occasion_chosen', 'build_started', 'game_composed', 'feed_opened', 'feed_card', 'feed_rest', 'feed_swap',
  'feed_finished', 'feed_shared', 'walk_started', 'walk_step', 'walk_finished', 'walk_ready', 'walk_left',
  'launch_pressed', 'test_drive_pressed', 'calendar_added', 'guest_saved', 'screen_left',
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export function track(event: FunnelEvent, params?: Record<string, string | number>): void {
  try {
    (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag?.('event', event, params ?? {});
  } catch { /* measurement never breaks the app */ }
}

/**
 * Report where a person was when the page went away: the number that says which screen loses them.
 * A beacon, because a normal request dies with the page. Returns the cleanup for an effect.
 */
export function trackLeaving(where: () => Record<string, string | number>): () => void {
  const onHide = () => track('screen_left', { ...where(), transport_type: 'beacon' });
  window.addEventListener('pagehide', onHide);
  return () => window.removeEventListener('pagehide', onHide);
}
