// Consolidated share surface (change: run-console-progressive-disclosure).
//
// A run has SEVEN shareable artifacts and they used to be spread over three
// components, two of them labelled with nothing but the emoji '🔗'. The URL
// formulas are moved here verbatim so "where do I get the link for X" has one
// answer, and so consolidating the cards cannot silently change a link a host
// already handed to players or to a projector.
//
// Pure: no React, no Firebase. The play origin is passed in.
import { TV_ROUTE_PARAM, RECAP_ROUTE_PARAM } from '@rushpoint/shared';
import type { RunStatus } from './runConsoleLayout';

export type ShareArtifactId =
  | 'accessCode' | 'joinLink' | 'boardLink' | 'ceremonyLink'
  | 'tvScreen' | 'recap' | 'staffLink';

export const SHARE_ARTIFACT_IDS: ShareArtifactId[] = [
  'accessCode', 'joinLink', 'boardLink', 'ceremonyLink', 'tvScreen', 'recap', 'staffLink',
];

export type ShareArtifact = {
  id: ShareArtifactId;
  /** null for the access code: there is nothing to open, only a code to read out. */
  url: string | null;
  /** What the copy action puts on the clipboard. */
  copyValue: string;
  available: boolean;
  /** Copying or opening this should publish the standings first (audience facing). */
  requiresPublish: boolean;
  /** Marked as "after the run" instead of vanishing from the surface. */
  unavailableUntilFinished: boolean;
  /** Marked as "while the run is open" instead of vanishing from the surface. */
  unavailableAfterFinish: boolean;
};

export type ShareArtifactInput = {
  playUrl: string;
  accessCode: string;
  ownerUid: string;
  gameId: string;
  runId: string;
  hasStaffPin: boolean;
  status: RunStatus;
};

export function buildShareArtifacts(input: ShareArtifactInput): ShareArtifact[] {
  const { playUrl, accessCode, ownerUid, gameId, runId, hasStaffPin, status } = input;
  const finished = status === 'finished';

  // Verbatim from the old JoinShare / PostRunLinks / StaffInviteCard components.
  const joinLink = `${playUrl}/?code=${accessCode}`;
  const boardLink = `${playUrl}/?board=${accessCode}`;
  const ceremonyLink = `${boardLink}&ceremony`;
  const tvUrl = `${playUrl}/?${TV_ROUTE_PARAM}=${accessCode}`;
  const recapUrl = `${playUrl}/?${RECAP_ROUTE_PARAM}=${accessCode}`;
  const staffLink = `${playUrl}/?staff=${encodeURIComponent(`${ownerUid}.${gameId}.${runId}`)}`;

  const entry = (
    id: ShareArtifactId,
    url: string | null,
    copyValue: string,
    opts: Partial<Omit<ShareArtifact, 'id' | 'url' | 'copyValue'>> = {},
  ): ShareArtifact => ({
    id,
    url,
    copyValue,
    available: opts.available ?? true,
    requiresPublish: opts.requiresPublish ?? false,
    unavailableUntilFinished: opts.unavailableUntilFinished ?? false,
    unavailableAfterFinish: opts.unavailableAfterFinish ?? false,
  });

  return [
    entry('accessCode', null, accessCode),
    // Nobody can join a run that has ended, so the join link is marked stale
    // rather than quietly disappearing from the surface.
    entry('joinLink', joinLink, joinLink, { available: !finished, unavailableAfterFinish: true }),
    entry('boardLink', boardLink, boardLink, { requiresPublish: true }),
    entry('ceremonyLink', ceremonyLink, ceremonyLink, { requiresPublish: true }),
    entry('tvScreen', tvUrl, tvUrl, { requiresPublish: true }),
    entry('recap', recapUrl, recapUrl, { available: finished, unavailableUntilFinished: true }),
    entry('staffLink', staffLink, staffLink, { available: hasStaffPin }),
  ];
}
