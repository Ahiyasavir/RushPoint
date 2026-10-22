# Handoff 22.10: deploy of the release (composer v2 + bank + merge with production)

The founder asked: commit everything, merge `topographic-maps` (production), run verify and e2e on the
merge, and **deploy when everything is green**. Never commit or deploy anything beyond that without asking.

## Where it stands
- Branch `field-report-2026-09-27`, merge commit **`8bfbc5c`** (not pushed). Commits before it:
  `98287f5` bank, `2fd9d74` composer v2, `336dcef` security/in-tree work, `71181ec` reels/events.
- **`npm run verify` on the merge: GREEN** (all nine gates).
- **`npm run verify:emulator` (e2e, rules, 8-team sim, adversarial sim): RUNNING** in the background,
  started ~19:30. Results:
  - Log: `C:\Users\savir\AppData\Local\Temp\vem.log` (Git Bash: `/tmp/vem.log`).
    The last line is `VEM=<exit code>` when it is done (0 = green).
  - Read it: `grep -E "FAIL|❌|✅|VEM=|VIOLATION|CONSISTENT|passed" /tmp/vem.log | tail -30`
  - If it got killed before `VEM=` appears (10-minute tool limit), rerun the phases separately:
    `FUNCTIONS_DISCOVERY_TIMEOUT=120 node scripts/emulator-exec.mjs "node scripts/e2e-verify.mjs"`, then
    `node scripts/emulator-exec.mjs --only=firestore,storage "node scripts/run-rules-suites.mjs"`.
  - An INTERNAL in the load sim: count `Your function timed out` vs INTERNAL first (CLAUDE.md), it is
    usually the emulator.
- Left out of git on purpose: `docs/meetings` (private transcript), `docs/study`, `downloads/` (1.4 GB),
  `firebase-export-*`, `__pycache__`, `.claude/settings.local.json`. The repo is PUBLIC.

## The merge (12 conflicts), for review
See the merge commit message. Production's race fixes (pause, rejoin, slowDown/networkBusy, live-run
guard on launch) were kept everywhere; Dashboard/Builder took this branch's file plus production's
live-run guard.

## To deploy once e2e is green (memory: vps-api-deploy-procedure, deploy-checklist-pdf)
1. `git push origin HEAD:topographic-maps` (the VPS pulls that branch). Check fast-forward first:
   `git merge-base --is-ancestor origin/topographic-maps HEAD`.
2. API on the VPS: `ssh root@31.70.107.184`, `cd /root/RushPoint && git pull --ff-only &&
   docker compose -f docker-compose.api.yml up -d --build`. Check `git status` there first (local
   compose delta: stash that one file, pull, pop). ~40 s of 503 is normal.
   Smoke: `curl -X POST https://api.rush-point.com/listGames -H 'Content-Type: application/json' -d '{"data":{}}'` → 401.
3. Rules (new `missionStats` rule): `npx firebase deploy --only firestore:rules,firestore:indexes --non-interactive < /dev/null`
   (not storage: see memory deploy-rules-storage-blocker).
4. Hosting FROM THIS MAIN CHECKOUT (has the .env files): `npm run deploy:hosting` (append
   `--non-interactive < /dev/null` to the firebase step if it hangs). Check for a LIVE run before
   deploying (memory vps-api-deploy-procedure).
5. `npm run deploy:test-game -- --uid wTYDwnEZP6MhGyaGINbumaYqKem1`
6. Checks PDF: `npm run checks:pdf -- docs/deploy-checks/2026-10-22.md` (already written; update the
   `commit:` line to the pushed hash), commit it, send the PDF to the founder.
7. Production admin overrides `the-hidden-key` and `trade-up` still hold old text: re-save them on
   the admin page (noted in memory mission-studio-skill).

## Context
- Plan: `docs/composer-v2-plan-2026-10-22.md`; six changes in `openspec/changes/composer-v2-*`
  (not archived yet). Memory: `composer-v2-2026-10-22.md`.
- Browser check done 22.10 on local dev: dice + spin + undo, sentence form, area offer (desktop and
  375 px). It found and fixed: undo toast too short (now 8 s), area offer before all pins were in,
  two-area games collapsing into two stages (now split into consecutive stages), "4 areas" counting
  stages. A local test game "בדיקת מחולל 2" exists only in the local emulator.
