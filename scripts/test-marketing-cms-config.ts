// The CMS's field list vs. the collection schema it writes into.
//
// apps/marketing/public/admin/config.yml describes a form; apps/marketing/
// src/content.config.ts describes what the build will ACCEPT. When those two
// drift, nothing fails until an author has already pressed publish: the commit
// lands, the build then rejects the document, and the person who wrote the post
// has no way to tell what went wrong. So the two sets are compared here, in both
// directions — a field the form offers but the schema rejects, and a required
// field the schema demands but the form never asks for.
//
// The config.yml header has claimed this file exists since the CMS was added. It
// did not. A promised check that does not run is worse than an absent one,
// because the promise is what stops anyone looking.
//   npx tsx scripts/test-marketing-cms-config.ts
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { load } from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = 'apps/marketing/public/admin/config.yml';
const SCHEMA_PATH = 'apps/marketing/src/content.config.ts';
const INDEX_PATH = 'apps/marketing/public/admin/index.html';

let failures = 0;
// `detail` is shown either way (it usually carries the value under test);
// `hint` is what to DO about it, and is noise on a passing row.
function check(label: string, cond: boolean, detail = '', hint = ''): void {
  const suffix = [detail, cond ? '' : hint].filter(Boolean).join(' — ');
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${suffix ? ' :: ' + suffix : ''}`);
  if (!cond) failures++;
}

const configSource = readFileSync(path.join(root, CONFIG_PATH), 'utf8');
const schemaSource = readFileSync(path.join(root, SCHEMA_PATH), 'utf8');
const adminHtml = readFileSync(path.join(root, INDEX_PATH), 'utf8');

// ── The editor has to actually mount ─────────────────────────────────────────
// Decap appends itself to document.body the moment it runs. Loaded from <head>
// that body does not exist yet, and the editor dies on load with
// "Cannot read properties of null (reading 'appendChild')" — a blank page whose
// only symptom is one line in the browser console. It shipped that way from the
// day the CMS was added, so /admin/ had never rendered once; every gate was
// green throughout, because nothing here had ever opened the page.
{
  const scriptAt = adminHtml.indexOf('decap-cms.js');
  const bodyAt = adminHtml.indexOf('<body');
  check('the admin page loads the Decap script', scriptAt !== -1, '',
    `no decap-cms.js <script> in ${INDEX_PATH}`);
  check('the Decap script runs after <body> exists',
    scriptAt !== -1 && bodyAt !== -1 && scriptAt > bodyAt,
    '', 'move the <script> to the end of <body> (or give it defer) — from <head> it mounts onto a null body');
}

// ── The schema's top-level keys, read from source ────────────────────────────
// The schema cannot simply be imported: it depends on `astro:content`, a virtual
// module that only exists inside an Astro build. So the `z.object({...})` body is
// scanned by brace depth and its DEPTH-1 keys collected — nested shapes (the
// metadata object) are deliberately not descended into, because the CMS does not
// offer them either.
//
// Comments are stripped FIRST. The schema file is heavily commented and those
// comments contain both colons and commas, which is exactly what the scan splits
// on — leaving them in produced field names like 'becauselanguage', and the check
// still reported PASS for most rows, which is the failure mode that makes a
// checker worth distrusting.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      // No `//` appears inside a string or regex literal in this file; if one
      // ever does, this check goes loud rather than quiet, which is the right
      // direction to fail in.
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}

function parseSchemaFields(rawSource: string): Map<string, { optional: boolean }> {
  const source = stripComments(rawSource);
  const start = source.indexOf('schema: z.object({');
  if (start === -1) throw new Error(`no 'schema: z.object({' in ${SCHEMA_PATH}`);
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error(`unbalanced braces after 'schema: z.object({' in ${SCHEMA_PATH}`);

  const body = source.slice(source.indexOf('{', start) + 1, end);
  const fields = new Map<string, { optional: boolean }>();
  depth = 0;
  let name = '';
  let value = '';
  let inName = true;
  const commit = () => {
    if (name.trim()) {
      // A field the build will accept without one being supplied. A value that
      // is just a call to a helper (`metadata: metadataDefinition()`) is resolved
      // against that helper's own definition, or it reads as required when it is
      // not — which would demand a CMS field for something optional.
      const helper = value.trim().match(/^([A-Za-z_$][\w$]*)\(\)$/);
      const subject = helper
        ? (source.match(new RegExp(`${helper[1]}\\s*=[\\s\\S]*?;`))?.[0] ?? value)
        : value;
      fields.set(name.trim(), { optional: /\.optional\(\)|\.default\(/.test(subject) });
    }
    name = ''; value = ''; inName = true;
  };
  for (const ch of body) {
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    if (depth === 0 && ch === ':' && inName) { inName = false; continue; }
    if (depth === 0 && ch === ',') { commit(); continue; }
    if (inName) name += ch; else value += ch;
  }
  commit();

  // Comments and blank lines land in `name`; keep only real identifiers.
  const clean = new Map<string, { optional: boolean }>();
  for (const [rawName, meta] of fields) {
    const identifier = rawName.split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
      .join('');
    if (/^[A-Za-z_$][\w$]*$/.test(identifier)) clean.set(identifier, meta);
  }
  return clean;
}

const schemaFields = parseSchemaFields(schemaSource);
check('the schema parse found the real fields', schemaFields.has('title') && schemaFields.has('language')
  && schemaFields.has('publishDate') && schemaFields.has('slug'),
  `${schemaFields.size} fields: ${[...schemaFields.keys()].join(', ')}`);

// ── The CMS's fields ─────────────────────────────────────────────────────────
interface CmsField { name: string; required?: boolean; widget?: string }
interface CmsCollection { name: string; folder?: string; fields?: CmsField[] }
interface CmsConfig {
  backend?: { name?: string; repo?: string; branch?: string; base_url?: string; auth_endpoint?: string; auth_scope?: string };
  media_folder?: string;
  public_folder?: string;
  collections?: CmsCollection[];
}
const config = load(configSource) as CmsConfig;

const post = (config.collections || []).find((c) => c.name === 'post');
check('the CMS defines the post collection', !!post);
const cmsFields = (post?.fields || []);
const cmsNames = new Set(cmsFields.map((f) => f.name));

// `body` is Decap's name for the markdown that follows the frontmatter. It is
// not a schema key, and never should be one.
const BODY_FIELD = 'body';
check('the CMS edits the post body', cmsNames.has(BODY_FIELD));

// ── Direction 1: nothing offered that the build would reject ────────────────
for (const field of cmsFields) {
  if (field.name === BODY_FIELD) continue;
  check(`CMS field '${field.name}' exists in the schema`, schemaFields.has(field.name), '',
    `add it to ${SCHEMA_PATH} or remove it from ${CONFIG_PATH}`);
}

// ── Direction 2: nothing REQUIRED that the form never asks for ──────────────
for (const [name, meta] of schemaFields) {
  if (meta.optional) continue;
  check(`required schema field '${name}' is asked for by the CMS`, cmsNames.has(name), '',
    'a post created in the CMS would fail the build');
}

// A required schema field must not be an optional form field either — that is
// the same failure with an extra step.
for (const field of cmsFields) {
  const meta = schemaFields.get(field.name);
  if (!meta || meta.optional) continue;
  check(`'${field.name}' is required in the CMS too`, field.required !== false, '',
    'the schema demands it, so the form must not let it through empty');
}

// ── The backend: where a published post actually goes ───────────────────────
const backend = config.backend || {};
check('backend is github', backend.name === 'github');
check('backend names this repository', backend.repo === 'Ahiyasavir/RushPoint');
// The one setting that fails invisibly: content committed to a branch nobody
// deploys is content nobody sees. The site is built and deployed from this
// branch (see DEPLOY.md §12); if that changes, change it here in the same commit.
check('backend commits to the deployed branch', backend.branch === 'topographic-maps', String(backend.branch));
// Must match the routes functions/server.js mounts, and the callback URL
// registered on the GitHub OAuth application.
check('backend points at the API for its token exchange', backend.base_url === 'https://api.rush-point.com');
check('backend auth endpoint matches the mounted route', backend.auth_endpoint === 'oauth');
// The repository is public, so the smaller scope suffices. functions/oauthRoute.js
// defaults to the same value and refuses to widen beyond these two.
check('backend requests no more scope than it needs',
  backend.auth_scope === undefined || backend.auth_scope === 'public_repo' || backend.auth_scope === 'repo',
  String(backend.auth_scope));

// ── Paths are repository-relative, because Decap commits through git ────────
check('the post folder is repository-relative', post?.folder === 'apps/marketing/src/data/post');
check('uploads land inside the built site', config.media_folder === 'apps/marketing/public/uploads');
check('an upload is addressed from the site root', config.public_folder === '/uploads');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
