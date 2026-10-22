// Dump the mission bank exactly as players see it (mission-studio, lessons L18).
//
//   npx tsx .claude/skills/mission-studio/scripts/dump_bank.ts <out.json>
//
// Run from the repo root. Review documents are generated from this file, never
// hand-copied: a hand-copied text goes stale the moment the next fix lands, and a
// stale document makes an applied fix look ignored.
import { writeFileSync } from 'node:fs';
import { TASK_BANK } from '../../../../apps/creator-web/src/taskBank';

const out = TASK_BANK.map((e) => {
  const t = e.build() as unknown as Record<string, unknown> & {
    steps?: { prompt: string }[];
    smart?: { captureKind?: string };
  };
  return {
    key: e.key,
    sourceTemplateKey: e.sourceTemplateKey,
    family: e.family,
    tags: e.tags,
    d: e.difficulty,
    occ: e.occasions,
    setup: (e.setup ?? []).map((s) => ({ field: s.field, required: !!s.required, prompt: s.prompt })),
    type: t.type,
    title: t.title,
    desc: t.description,
    timeLimitMinutes: t.timeLimitMinutes,
    steps: t.steps?.map((s) => s.prompt),
    cap: t.smart?.captureKind,
  };
});
writeFileSync(process.argv[2], JSON.stringify(out, null, 1), 'utf8');
console.log(`${out.length} entries`);
