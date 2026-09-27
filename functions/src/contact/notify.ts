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

// ── RushPoint Live team applications (change: rushpoint-live-signup) ─────────
//
// Same seam, same best-effort contract, same escaping. Deliberately a second
// FUNCTION rather than a second delivery path: the reasoning at the top of this
// file about not standing up a parallel mailer applies unchanged.
//
// The photo is NOT attached. It is stored, it is listed, and it is fetched by a
// named operator through an audited callable — mailing a photograph of identifiable
// people out to whatever inbox CONTACT_NOTIFY_TO happens to point at today would
// quietly undo that.

export interface LiveApplicationNotification {
  teamName: string;
  teamSize: number;
  sectors: string[];
  location: string;
  howTheyMet: string;
  ageRange: string;
  motivation: string;
  cameraComfort: number;
  phone: string;
  language: 'he' | 'en' | null;
}

export async function sendLiveApplicationNotification(entry: LiveApplicationNotification): Promise<void> {
  try {
    const subject = `RushPoint Live application: ${entry.teamName} (${entry.teamSize})`;
    const rows: Array<[string, string]> = [
      ['Team', entry.teamName],
      ['Size', String(entry.teamSize)],
      ['Sectors', entry.sectors.join(', ')],
      ['Lives in', entry.location],
      ['How they met', entry.howTheyMet],
      ['Ages', entry.ageRange],
      ['On camera', `${entry.cameraComfort}/5`],
      ['Phone', entry.phone],
      ['Why them', entry.motivation],
    ];

    const text = rows.map(([label, value]) => `${label}: ${value}`).join('\n');
    const html = [
      '<table style="border-collapse:collapse">',
      ...rows.map(
        ([label, value]) =>
          `<tr><td style="padding:4px 12px 4px 0;vertical-align:top"><strong>${esc(label)}</strong></td>`
          + `<td style="padding:4px 0;white-space:pre-wrap">${esc(value)}</td></tr>`,
      ),
      '</table>',
      '<p style="color:#666">The group photo is in the admin console, not in this mail.</p>',
    ].join('');

    await sendDigestEmail({ subject, text, html }, CONTACT_RECIPIENT);
  } catch (e) {
    // Never rethrow. The application is stored; this is an announcement about it.
    logBestEffort('liveApplication.notify.failed', { teamName: entry.teamName }, e);
  }
}
