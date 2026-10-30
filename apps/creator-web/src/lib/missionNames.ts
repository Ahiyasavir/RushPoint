import { missionBankNow } from './missionBank';

/** Real mission names for the dice and the building moment. Empty, never a throw, before the bank loads. */
export function rollNames(n: number): string[] {
  try {
    const bank = missionBankNow();
    const out: string[] = [];
    for (let i = 0; i < n * 3 && out.length < n && bank.length > 0; i++) {
      const title = bank[Math.floor(Math.random() * bank.length)].build().title;
      if (title && !out.includes(title)) out.push(title);
    }
    return out;
  } catch { return []; }
}
