// validate.mjs — run the project's own validation commands deterministically (no Claude involved).
import { exec } from 'node:child_process';

function run(cmd, cwd, timeoutMs) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, shell: true }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? err.code ?? 1 : 0,
        tail: (stdout + '\n' + stderr).slice(-2000)
      });
    });
  });
}

/**
 * Run all configured validation commands. A failing `required` command fails the whole run;
 * a failing non-required command is reported as a warning but does not block.
 * @returns {Promise<{ok:boolean, results:Array, summary:string}>}
 */
export async function runValidation(config, cwd) {
  const results = [];
  let ok = true;

  for (const c of config.validation.commands) {
    const r = await run(c.cmd, cwd, c.timeoutMs || 600000);
    results.push({ name: c.name, required: c.required, ok: r.ok, code: r.code, tail: r.tail });
    if (!r.ok && c.required) ok = false;
  }

  if (config.validation.e2e?.enabled) {
    const r = await run(config.validation.e2e.cmd, cwd, config.validation.e2e.timeoutMs || 600000);
    results.push({ name: 'e2e', required: true, ok: r.ok, code: r.code, tail: r.tail });
    if (!r.ok) ok = false;
  }

  const summary = results
    .map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.required ? '' : ' (non-blocking)'}`)
    .join(' · ');

  return { ok, results, summary };
}
