// Build the site's ready-made templates into Firestore documents
// (change: site-templates, 2026-09-02).
//
// ─── Two halves, on purpose ──────────────────────────────────────────────────
//
// This script COMPUTES the documents and writes them to a JSON file. It never
// touches Firestore. The write is a separate step run where the credentials
// live (the VPS), fed the file this produces.
//
// That split is the point: the content comes from the repo, where the bank, the
// forty-plus authoring rules and scripts/test-site-templates.ts all apply to it,
// and the production step is a dumb writer with nothing to decide. A seeder that
// both invented content and wrote it would be a place where a template could
// exist that no test had ever seen — which is exactly how the live collection
// ended up holding missions the bank had deleted.
//
// ─── Idempotent by construction ──────────────────────────────────────────────
//
// The document id IS the template key, so re-running updates the same five
// documents rather than minting parallel copies. `createdAt` and `playCount` are
// only set when absent, so a re-seed does not reset a template's history.
//
// Usage:
//   node --import tsx scripts/seed-site-templates.ts                 (dry run)
//   node --import tsx scripts/seed-site-templates.ts --out docs.json
import { writeFileSync } from 'node:fs';
import { SITE_TEMPLATES, buildSiteTemplate } from './lib/siteTemplates';

/** The admin account every existing template already lives under. */
const OWNER_UID = 'wTYDwnEZP6MhGyaGINbumaYqKem1';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

const docs = SITE_TEMPLATES.map((decl) => {
  const built = buildSiteTemplate(decl);
  const taskCount = built.stages.reduce((n, s) => n + s.tasks.length, 0);
  return {
    path: `users/${OWNER_UID}/games/${decl.key}`,
    // Only ever MERGED, so a field absent here keeps whatever the document has.
    data: {
      id: decl.key,
      ownerUid: OWNER_UID,
      title: decl.title,
      description: decl.description,
      mode: decl.mode,
      scoringPreset: decl.scoringPreset,
      stages: built.stages,
      wizardSteps: built.wizardSteps,
      isTemplate: true,
      templateEmoji: decl.emoji,
      templateGenre: decl.genre,
      templateOrder: decl.order,
      templateStageCount: built.stages.length,
      templateTaskCount: taskCount,
      visibility: 'private',
      allowInstantPlay: true,
      powerUpsEnabled: true,
      tags: [],
      ...(decl.requiresGuardianConsent ? { requiresGuardianConsent: true } : {}),
      // Only ever written when the declaration asks for it. Seeding
      // `templateHidden: false` onto every template would be a migration nobody
      // needs — absent already means visible.
      ...(decl.hidden ? { templateHidden: true } : {}),
      updatedAt: new Date().toISOString(),
    },
    /** Written only when the document does not already have them. */
    ifAbsent: { createdAt: new Date().toISOString(), playCount: 0 },
  };
});

console.log(`\n${docs.length} site templates\n`);
for (const d of docs) {
  const g = d.data;
  const stages = (g.stages as { title: string; tasks: unknown[] }[]);
  console.log(`${g.templateEmoji}  ${String(g.title).padEnd(22)} ${g.templateGenre}  `
    + `${g.templateStageCount} stages / ${g.templateTaskCount} missions  `
    + `consent=${'requiresGuardianConsent' in g ? 'yes' : 'no'}  steps=${(g.wizardSteps as unknown[]).length}`
    + `${'templateHidden' in g ? '  PARKED' : ''}`);
  for (const s of stages) console.log(`      ${s.title} (${s.tasks.length})`);
  console.log(`      → ${d.path}`);
}

if (outPath) {
  writeFileSync(outPath, JSON.stringify(docs, null, 1));
  console.log(`\nwrote ${docs.length} documents to ${outPath}`);
  console.log('This file is INPUT to the production writer. Nothing was written to Firestore.');
} else {
  console.log('\nDRY RUN — nothing written. Pass --out <file> to produce the payload.');
}
