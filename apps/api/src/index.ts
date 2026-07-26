// ─── Entry point: the only file that binds a socket ──────────────────────────
//
// DEPLOYMENT.md §2/§4.5: one Node process on 127.0.0.1:8080, behind Caddy, under
// systemd with `Restart=always`. It listens on LOOPBACK by default on purpose —
// the reverse proxy terminates TLS and is the only thing that should reach it.
//
// Config is env-only. There is no config file, because the host-local `.env`
// (never committed — DEPLOYMENT.md cutover step D2) is the control that keeps an
// accidental production flip from being one `git push` away.

import { createServer } from './server.js';
import { createFirebaseAdminVerifier } from './auth.js';
import type { ApiRepository } from './deps.js';

interface Config {
  host: string;
  port: number;
  projectId?: string;
  allowedOrigins: string[];
  datastore: 'postgres' | 'firestore';
  logLevel: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production' && allowedOrigins.length === 0) {
    // Refuse to boot rather than reflect any origin in production. A wildcard
    // CORS policy in front of an `Authorization`-bearing API is not a warning.
    throw new Error('ALLOWED_ORIGINS must be set in production (comma-separated Hosting origins)');
  }

  return {
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 8080),
    projectId: env.FIREBASE_PROJECT_ID ?? env.GCLOUD_PROJECT,
    allowedOrigins,
    datastore: (env.RUSHPOINT_DATASTORE as Config['datastore']) ?? 'postgres',
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}

/**
 * Build the repository the process will run against.
 *
 * ⚠️ NOT YET WIRED. `packages/data/src/postgres/` is another agent's deliverable
 * and its factory name is not frozen yet, so this throws loudly rather than
 * pretending. Everything above it is finished and tested: `createServer` takes
 * the repository by injection, so wiring this is one import when that lands.
 */
async function createRepository(cfg: Config): Promise<ApiRepository> {
  if (cfg.datastore !== 'postgres') {
    throw new Error(
      `RUSHPOINT_DATASTORE=${cfg.datastore} is not servable by this process — ` +
        'the Firestore implementation runs in Cloud Functions, not here.',
    );
  }
  throw new Error(
    'No repository wired yet: import the Postgres repository factory from ' +
      '@rushpoint/data once packages/data/src/postgres exports one, and return it here.',
  );
}

async function main(): Promise<void> {
  const cfg = readConfig();
  const app = await createServer({
    deps: { repo: await createRepository(cfg) },
    verifyIdToken: await createFirebaseAdminVerifier({ projectId: cfg.projectId }),
    allowedOrigins: cfg.allowedOrigins,
    logger: { level: cfg.logLevel },
  });

  // Graceful shutdown so systemd's restart, and the client's transient retry
  // (DEPLOYMENT.md §4.2), hide a redeploy from players mid-run.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      app.log.info({ sig }, 'shutting down');
      void app.close().then(() => process.exit(0));
    });
  }

  await app.listen({ host: cfg.host, port: cfg.port });
}

// Only run when executed directly — importing this module must stay side-effect
// free so a test can read `readConfig` without starting anything.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (invokedDirectly) {
  main().catch((err) => {
    console.error('[api] failed to start:', err);
    process.exit(1);
  });
}
