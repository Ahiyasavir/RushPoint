/**
 * Telling the owner a contact message arrived (change: marketing-site).
 *
 * Routed through the EXISTING send seam in runs/runSummaryEmail.ts rather than a
 * second one. A second path would be a second thing to configure, a second thing
 * to hold a credential, and a second thing to be quietly broken; the existing one
 * is already env gated and already degrades to a logged no-op with no provider
 * key, which is exactly the behaviour wanted here.
 *
 * Best effort by construction: the message is already stored before this runs, so
 * a delivery failure must never reach the sender. Telling someone their message
 * failed when it did not invites them to send it again.
 */
import { sendDigestEmail } from '../runs/runSummaryEmail';
import { logBestEffort } from '../obs/log';

/** Where contact messages are announced. Absent means notification is a no-op. */
const CONTACT_RECIPIENT = process.env.CONTACT_NOTIFY_TO ?? process.env.RUN_SUMMARY_EMAIL_TO ?? null;

export interface ContactNotification {
  name: string;
  email: string;
  message: string;
  language: 'he' | 'en' | null;
}

/** Escape for the HTML body. Message text is a stranger's input, never markup. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendContactNotification(entry: ContactNotification): Promise<void> {
  try {
    const subject = `Contact message from ${entry.name}`;
    const text = [
      `From: ${entry.name} <${entry.email}>`,
      entry.language ? `Language: ${entry.language}` : null,
      '',
      entry.message,
    ]
      .filter((line) => line !== null)
      .join('\n');

    const html = [
      `<p><strong>From:</strong> ${esc(entry.name)} &lt;${esc(entry.email)}&gt;</p>`,
      entry.language ? `<p><strong>Language:</strong> ${esc(entry.language)}</p>` : '',
      `<p style="white-space:pre-wrap">${esc(entry.message)}</p>`,
    ].join('');

    await sendDigestEmail({ subject, text, html }, CONTACT_RECIPIENT);
  } catch (e) {
    // Never rethrow. The message is stored; this is an announcement about it.
    logBestEffort('contact.notify.failed', { name: entry.name }, e);
  }
}
