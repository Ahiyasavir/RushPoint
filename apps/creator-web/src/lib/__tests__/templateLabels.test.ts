import { describe, expect, it } from 'vitest';
import type { GameMode, ScoringPreset } from '@rushpoint/shared';
import { translations } from '../../i18n';
import { TEMPLATES } from '../../templates';
import {
  CREATE_GAME_TARGET,
  QUICK_CARD_IDS,
  describeGameSettings,
  quickCardTarget,
  templateDescription,
  templateLabel,
} from '../templateLabels';

const LANGS = ['he', 'en'] as const;
const MODES: GameMode[] = ['individual', 'team'];
const PRESETS: ScoringPreset[] = ['time_only', 'fixed_points_speed', 'smart_weighted'];

describe('templateLabels — names and descriptions', () => {
  it('resolves every TEMPLATES key to non-empty text in both dictionaries', () => {
    for (const lang of LANGS) {
      const dict = translations[lang];
      for (const tpl of TEMPLATES) {
        expect(templateLabel(tpl.key, dict), `${lang}/${tpl.key} name`).toBeTruthy();
        expect(templateDescription(tpl.key, dict), `${lang}/${tpl.key} description`).toBeTruthy();
      }
    }
  });

  it('gives Hebrew and English creators different text (nothing is a shared literal)', () => {
    for (const tpl of TEMPLATES) {
      expect(templateLabel(tpl.key, translations.he)).not.toBe(templateLabel(tpl.key, translations.en));
    }
  });

  it('returns the defined fallback for an unknown key rather than undefined', () => {
    for (const lang of LANGS) {
      const dict = translations[lang];
      expect(templateLabel('no-such-template', dict)).toBe(dict.dashboard.untitledGame);
      expect(typeof templateDescription('no-such-template', dict)).toBe('string');
    }
  });
});

describe('templateLabels — settings disclosure', () => {
  it('is total over every GameMode x ScoringPreset pair, in both languages', () => {
    for (const lang of LANGS) {
      const dict = translations[lang];
      for (const mode of MODES) {
        for (const preset of PRESETS) {
          const d = describeGameSettings(mode, preset, dict);
          expect(d.mode, `${lang}/${mode}`).toBeTruthy();
          expect(d.scoring, `${lang}/${preset}`).toBeTruthy();
          expect(d.summary, `${lang}/${mode}/${preset}`).toContain(d.mode);
          expect(d.summary).toContain(d.scoring);
        }
      }
    }
  });

  it('describes the three scoring styles distinctly', () => {
    const seen = PRESETS.map((p) => describeGameSettings('team', p, translations.en).scoring);
    expect(new Set(seen).size).toBe(PRESETS.length);
  });
});

describe('templateLabels — quick-card targets', () => {
  const games = [
    { id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'recent', updatedAt: '2026-07-01T00:00:00.000Z' },
  ];

  it('never sends the builder card to the dashboard the creator is already on', () => {
    expect(quickCardTarget('builder', games)).not.toBe('/');
    expect(quickCardTarget('builder', [])).not.toBe('/');
  });

  it('opens the most recently edited game builder when there are games', () => {
    expect(quickCardTarget('builder', games)).toBe('/build/recent');
    expect(quickCardTarget('builder', [...games].reverse())).toBe('/build/recent');
  });

  it('points at the create path when the account has no game', () => {
    expect(quickCardTarget('builder', [])).toBe(CREATE_GAME_TARGET);
  });

  it('keeps the other cards on their own destinations', () => {
    expect(quickCardTarget('gallery', games)).toBe('/gallery');
    expect(quickCardTarget('wallet', games)).toBe('/wallet');
  });

  it('has one id per translated quick card, in both dictionaries', () => {
    // The ids live outside i18n on purpose (an id is not user-facing text, and a
    // Hebrew dictionary must not carry English literals), so this is what keeps
    // the two lists lined up.
    for (const lang of LANGS) {
      expect(translations[lang].dashboard.quickCards).toHaveLength(QUICK_CARD_IDS.length);
    }
  });
});
