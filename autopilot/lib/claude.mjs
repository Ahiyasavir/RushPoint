// claude.mjs — run the Claude Code CLI headless (`claude -p`) for one role, parse the JSON result,
// and detect usage/rate limits. The prompt is piped via stdin to avoid argv length limits.
import { spawn } from 'node:child_process';

export class RateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs || null;
  }
}

const RATE_LIMIT_PATTERNS = [
  /usage limit reached/i,
  /rate limit/i,
  /too many requests/i,
  /429/,
  /overloaded/i,
  /quota/i
];

function looksRateLimited(text) {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text || ''));
}

// Some CLI messages include "try again at 3pm" / an epoch — best-effort parse for a retry hint.
function parseRetryMs(text) {
  const m = /resets?\s+at\s+(\d{10,13})/i.exec(text || '');
  if (m) {
    const ts = m[1].length === 13 ? Number(m[1]) : Number(m[1]) * 1000;
    const delta = ts - Date.now();
    if (delta > 0) return delta;
  }
  return null;
}

/**
 * Run one Claude invocation.
 * @returns {Promise<{ok:boolean, text:string, raw:object|null, rateLimited:boolean}>}
 */
export function runClaude({ prompt, cwd, config, label, model }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--model', model || config.model,
      '--output-format', config.cli.outputFormat,
      config.cli.permission,
      '--max-turns', String(config.cli.maxTurnsPerCall)
    ];

    const child = spawn(config.cli.bin, args, {
      cwd,
      shell: true, // Windows: resolves claude.cmd on PATH
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let killedForTimeout = false;

    const timer = setTimeout(() => {
      killedForTimeout = true;
      child.kill('SIGKILL');
    }, config.cli.timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`[${label}] failed to spawn claude: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const combined = stdout + '\n' + stderr;

      if (killedForTimeout) {
        return reject(new Error(`[${label}] claude timed out after ${config.cli.timeoutMs}ms`));
      }

      // Try to parse the structured JSON result.
      let raw = null;
      try {
        raw = JSON.parse(stdout.trim());
      } catch {
        // Fall back to scanning for the last JSON object on stdout.
        const start = stdout.lastIndexOf('{');
        if (start >= 0) {
          try { raw = JSON.parse(stdout.slice(start)); } catch { /* ignore */ }
        }
      }

      const resultText = raw?.result ?? stdout;
      const isErr = raw?.is_error === true || code !== 0;

      // Rate limit can show up in the result text, stderr, or as is_error with a quota message.
      if (looksRateLimited(combined)) {
        return reject(new RateLimitError(`[${label}] usage/rate limit hit`, parseRetryMs(combined)));
      }

      if (isErr && raw == null && code !== 0) {
        return reject(new Error(`[${label}] claude exited ${code}: ${stderr.slice(0, 500)}`));
      }

      resolve({
        ok: !isErr,
        text: typeof resultText === 'string' ? resultText : JSON.stringify(resultText),
        raw,
        rateLimited: false
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
