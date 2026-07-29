// Run summary email (change: run-summary-report). ONE well-defined send seam
// behind an env-gated provider. It works the moment a provider credential is
// present in functions/.env, and is a graceful, observable no-op otherwise. It
// NEVER throws (best-effort side effect of finalizeRun) and NEVER hardcodes a
// secret — the credential lives only in the environment.
//
// Provider: Resend's HTTP API (https://resend.com) — a single fetch, no npm
// dependency, no SMTP socket. When RESEND_API_KEY is unset (the emulator / e2e
// env), the send branch is never entered: we log a breadcrumb and return, so no
// network socket is ever opened under test.
import type { RunSummary } from '@rushpoint/shared';
import { formatRunSummaryEmail } from '@rushpoint/shared';
import { logBestEffort } from '../obs/log';

/**
 * Master switch for outbound run-summary email. Defaults ON — a run only actually
 * sends when a provider key AND a recipient are both present, so "on" is safe even
 * with no provider configured (it degrades to a logged no-op). Set
 * RUN_SUMMARY_EMAIL_ENABLED=false to hard-disable.
 */
export const RUN_SUMMARY_EMAIL_ENABLED = process.env.RUN_SUMMARY_EMAIL_ENABLED !== 'false';

/** Default sender for the Resend sandbox domain (overridable via env). */
const DEFAULT_FROM = 'onboarding@resend.dev';

/**
 * The single email seam. Best-effort; NEVER throws. Sends the composed summary via
 * Resend when a provider key and recipient are present; otherwise logs a breadcrumb
 * (so the wiring is observable even without a provider) and returns without opening
 * any socket.
 */
export async function sendRunSummaryEmail(
  summary: RunSummary,
  recipient: string | null | undefined,
): Promise<void> {
  try {
    await deliver(formatRunSummaryEmail(summary), recipient);
  } catch (e) {
    logBestEffort('runSummary.email.failed', { title: summary.title }, e);
  }
}

/**
 * The daily digest send (change: run-email-scope-and-digest). Deliberately routed
 * through the SAME `deliver` seam as the per-run email so the enabled flag, the
 * no-credential no-op and the provider error handling cannot drift between the
 * two. The caller composes the body; this only delivers it.
 */
export async function sendDigestEmail(
  composed: { subject: string; text: string; html: string },
  recipient: string | null | undefined,
): Promise<void> {
  try {
    await deliver(composed, recipient);
  } catch (e) {
    logBestEffort('runSummary.email.failed', { subject: composed.subject }, e);
  }
}

/**
 * The one place an email actually leaves the process. Best-effort and never
 * throws to its caller. Emits a breadcrumb on EVERY path — including the disabled
 * and no-credential paths — which is what makes "did this code even run?"
 * answerable from the log. (That property is exactly how the VPS outage was
 * diagnosed: a finalizeRun with zero breadcrumbs proved the seam was never
 * reached, rather than reached and declining to send.)
 */
async function deliver(
  { subject, text, html }: { subject: string; text: string; html: string },
  recipient: string | null | undefined,
): Promise<void> {
  if (!RUN_SUMMARY_EMAIL_ENABLED || !recipient) {
    // Disabled or no recipient resolved — nothing to send.
    logBestEffort('runSummary.email.skipped', { subject }, 'disabled or no recipient');
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // No provider credential (the emulator / e2e env): a pure log-and-return. No
    // socket is opened, so tests never hit the network.
    logBestEffort('runSummary.email.noProvider', { subject }, 'no RESEND_API_KEY');
    return;
  }

  const from = process.env.RUN_SUMMARY_EMAIL_FROM ?? DEFAULT_FROM;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [recipient], subject, text, html }),
  });

  if (!res.ok) {
    logBestEffort('runSummary.email.failed', { subject, status: res.status }, `provider ${res.status}`);
    return;
  }
  logBestEffort('runSummary.email.sent', { subject }, 'delivered');
}
