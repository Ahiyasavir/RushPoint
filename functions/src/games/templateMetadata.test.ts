import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATE_ONLY_FIELDS, withoutTemplateMetadata } from './templateMetadata';

const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('withoutTemplateMetadata', () => {
  it('removes every template-only field and keeps everything else', () => {
    const src = Object.fromEntries(TEMPLATE_ONLY_FIELDS.map((k) => [k, k === 'isTemplate' ? true : 'x']));
    const out = withoutTemplateMetadata({ ...src, title: 'T', stages: [] } as never) as Record<string, unknown>;
    for (const k of TEMPLATE_ONLY_FIELDS) expect(out).not.toHaveProperty(k);
    expect(out.title).toBe('T');
    expect(out.stages).toEqual([]);
  });

  it('does not mutate its input', () => {
    const src = { isTemplate: true, title: 'T' };
    withoutTemplateMetadata(src as never);
    expect(src.isTemplate).toBe(true);
  });

  it('covers every isTemplate/template* field declared on the Game type', () => {
    const types = read('packages/shared/src/types/index.ts');
    const declared = [...types.matchAll(/^\s+(isTemplate|template[A-Z]\w*)\?:/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0); // the scan is looking at real fields
    for (const f of declared) expect(TEMPLATE_ONLY_FIELDS as readonly string[]).toContain(f);
  });

  it('is applied on every path that spreads an existing game into a new one', () => {
    const games = read('functions/src/games/index.ts');
    const share = read('functions/src/games/share.ts');
    // duplicateGame + translateGame, and the share-link launch copy.
    expect(games.match(/withoutTemplateMetadata\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(share).toContain('withoutTemplateMetadata(');
  });
});
