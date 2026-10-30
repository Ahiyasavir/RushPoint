// The email that reminds a creator of their own event date (change: creator-stays-to-the-end). It should
// read as a short note from someone who knows about the game, not as a campaign: warm paper, a wordmark in
// type, one sentence, one button, why it arrived, how to stop. No image: nothing to load, nothing to block,
// and a mail that is mostly picture is what spam filters and people both learn to skip.
import { CANONICAL_CREATOR_URL } from './canonicalHosts';
import type { EventCountdown } from './creatorNotifications';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const COPY = {
  he: {
    d3: { subject: (t: string) => `עוד שלושה ימים: ${t}`, head: 'עוד שלושה ימים משחקים', body: 'זה זמן טוב לעבור פעם אחת על המשימות ולשלוח לחברים שעוזרים לכם.' },
    d1: { subject: (t: string) => `מחר משחקים: ${t}`, head: 'מחר זה קורה', body: 'כדאי להכין היום את מה שצריך לקחת איתכם, ואז נשאר רק ליהנות.' },
    d0: { subject: (t: string) => `היום זה קורה: ${t}`, head: 'היום משחקים', body: 'כשכולם מגיעים, משגרים את המשחק ומחלקים את הקוד. בהצלחה, זה הולך להיות טוב.' },
    cta: 'לפתוח את המשחק',
    why: 'קיבלתם את המייל כי קבעתם תאריך למשחק הזה.',
    stop: 'להפסיק תזכורות במייל',
  },
  en: {
    d3: { subject: (t: string) => `Three days to go: ${t}`, head: 'Three days to go', body: 'A good moment to read through the missions once and send them to whoever is helping you.' },
    d1: { subject: (t: string) => `Tomorrow: ${t}`, head: 'It is tomorrow', body: 'Get together what you need to bring today, and all that is left is to enjoy it.' },
    d0: { subject: (t: string) => `Today: ${t}`, head: 'It is today', body: 'When everyone is there, launch the game and hand out the code. Good luck, it will be great.' },
    cta: 'Open the game',
    why: 'You got this because you set a date for this game.',
    stop: 'Stop email reminders',
  },
};

export function formatEventReminderEmail(input: { title: string; when: EventCountdown; gameId: string }): { subject: string; text: string; html: string } {
  const title = input.title.trim();
  const lang = /[֐-׿]/.test(title) || !title ? 'he' : 'en';
  const c = COPY[lang];
  const w = c[input.when];
  const game = `${CANONICAL_CREATOR_URL}/build/${encodeURIComponent(input.gameId)}`;
  const settings = `${CANONICAL_CREATOR_URL}/settings`;
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const align = lang === 'he' ? 'right' : 'left';
  const font = `-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif`;
  const html = `<!doctype html><html dir="${dir}" lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#faf6ef;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(w.body)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;"><tr><td align="center" style="padding:28px 16px;">
<table role="presentation" dir="${dir}" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#ffffff;border-radius:18px;border:1px solid #efe6d8;">
<tr><td dir="${dir}" style="padding:28px 28px 26px;font-family:${font};color:#2b2622;text-align:${align};">
<div style="font-size:15px;font-weight:800;color:#e64a19;" dir="ltr">RushPoint</div>
<div style="margin-top:18px;font-size:26px;line-height:1.25;font-weight:800;">${esc(w.head)}</div>
<div style="margin-top:6px;font-size:17px;font-weight:700;color:#e64a19;">${esc(title)}</div>
<div style="margin-top:14px;font-size:16px;line-height:1.55;color:#57504a;">${esc(w.body)}</div>
<div style="margin-top:22px;"><a href="${esc(game)}" style="display:inline-block;background:#ff5722;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:12px;">${esc(c.cta)}</a></div>
</td></tr></table>
<table role="presentation" dir="${dir}" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;"><tr><td dir="${dir}" style="padding:14px 28px 0;font-family:${font};font-size:13px;line-height:1.5;color:#8a8178;text-align:${align};">
${esc(c.why)} <a href="${esc(settings)}" style="color:#8a8178;">${esc(c.stop)}</a>
</td></tr></table>
</td></tr></table></body></html>`;
  const text = `${w.head}\n${title}\n\n${w.body}\n\n${c.cta}: ${game}\n\n${c.why}\n${c.stop}: ${settings}\n`;
  return { subject: w.subject(title), text, html };
}
