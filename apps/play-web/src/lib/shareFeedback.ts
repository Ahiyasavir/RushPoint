// Pure outcome→feedback mapping for the share ladder (change:
// share-surface-failure-feedback). The share libs (recapCollage.ts /
// challengeCard.ts) are total and return a ShareOutcome; a call site should not
// re-implement "which of these means it worked". This collapses the five-member
// outcome union into the three things a caller actually does:
//
//   'confirm'  — show a positive confirmation (a genuine delivery)
//   'fallback' — copy the link + show a "couldn't share, link copied" notice
//   'silent'   — do nothing (the user cancelled the OS share sheet)
//
// Pure + total: any value maps, nothing throws, no DOM.

export type ShareOutcome = 'shared' | 'downloaded' | 'copied' | 'failed' | 'cancelled';
export type ShareFeedback = 'confirm' | 'fallback' | 'silent';

export function shareOutcomeFeedback(result: ShareOutcome): ShareFeedback {
  switch (result) {
    case 'shared':
    case 'downloaded':
    case 'copied':
      return 'confirm';
    case 'cancelled':
      return 'silent';
    case 'failed':
    default:
      return 'fallback';
  }
}
