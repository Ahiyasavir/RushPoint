#!/usr/bin/env bash
# One command for a PRODUCTION load rehearsal end to end.
#
#   scripts/run-prod-sim.sh 120 [source-game.json]
#
# Does the whole sequence that otherwise has to be remembered: mints an owner token and N
# reusable participant identities with the Admin SDK on the VPS, copies the source game into
# the operator's OWN account through the product's importGameFile, runs the simulation with a
# quota watchdog beside it, and prints the per callable Firestore cost the API actually paid.
#
# ⚠️ THIS SPENDS REAL FIRESTORE QUOTA AND WRITES REAL PRODUCTION DATA. The Spark day allows
# 50,000 reads and 20,000 writes and resets at 07:00 UTC (10:00 Israel). A 120 team rehearsal
# costs roughly 34,000 reads, so it fits in a fresh day and does NOT fit alongside another one.
# Run it early in the quota day, and never on the day of a real event.
#
# The watchdog stops the run at a fraction of the ceiling and says so. "We stopped at N" is a
# result, not a failure of the harness.
set -uo pipefail

TEAMS="${1:-120}"
SOURCE="${2:-}"
VPS="${RUSHPOINT_VPS:-root@31.70.107.184}"
PROJECT="rushpoint-pwa-7daaa"
# The operator account the copy is made in. Never the source creator's account: the source is
# only ever read.
OWNER_UID="${RUSHPOINT_SIM_OWNER:-wTYDwnEZP6MhGyaGINbumaYqKem1}"

WORK="${TMPDIR:-/tmp}/rushpoint-prod-sim"
mkdir -p "$WORK"
echo "── working directory: $WORK"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

say "1/6  checking the API is up"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST \
  https://api.rush-point.com/getWalletStatus -H 'Content-Type: application/json' -d '{"data":{}}')
[ "$code" = "401" ] || die "api.rush-point.com answered $code, expected 401 (unauthenticated). Aborting."
echo "     ok (401 unauthenticated, which is the healthy answer)"

say "2/6  minting an owner token"
ssh -o ConnectTimeout=25 "$VPS" "docker exec rushpoint-api-1 node /app/mint.cjs" 2>/dev/null \
  | grep '^TOKEN:' | sed 's/^TOKEN://' > "$WORK/owner.token"
[ -s "$WORK/owner.token" ] || die "could not mint an owner token. Is /app/mint.cjs present in the container?"
echo "     ok ($(wc -c < "$WORK/owner.token") bytes)"

say "3/6  minting $TEAMS participant identities"
# Admin minted, because anonymous sign up is throttled PER IP and one machine cannot create
# this many. They are reused across runs; the uids are prefixed simteam- so they are obvious.
ssh -o ConnectTimeout=180 "$VPS" "docker exec rushpoint-api-1 node /app/mint-teams.cjs $TEAMS" \
  2>/dev/null > "$WORK/custom-tokens.json"
grep -q simteam "$WORK/custom-tokens.json" || die "identity minting produced nothing usable."
echo "     ok"

if [ -n "$SOURCE" ]; then
  say "4/6  copying the source game into the operator account"
  node scripts/prod-sim-prepare.mjs --source="$SOURCE" --owner-token="$(cat "$WORK/owner.token")" \
    --confirm-project="$PROJECT" --out="$WORK/plan.json" || die "the game copy failed."
else
  [ -f "$WORK/plan.json" ] || die "no plan.json yet: pass a source game JSON the first time."
  say "4/6  reusing the copied game from $WORK/plan.json"
fi

say "5/6  running $TEAMS teams against production"
MARK=$(date -u +%s)
node scripts/simulate-prod.mjs --teams="$TEAMS" --confirm-project="$PROJECT" \
  --plan="$WORK/plan.json" --owner-token="$(cat "$WORK/owner.token")" \
  --custom-tokens="$WORK/custom-tokens.json" --ping-ms=20000 --max-turns=60 \
  --play-concurrency=24 --join-concurrency=25 > "$WORK/sim.log" 2>&1 &
SIM_PID=$!
bash scripts/prod-sim-watchdog.sh "$SIM_PID" 35000 15000 45 > "$WORK/watchdog.log" 2>&1 &
WATCH_PID=$!
wait "$SIM_PID"; SIM_EXIT=$?
kill "$WATCH_PID" 2>/dev/null

sed -n '/RESULT/,$p' "$WORK/sim.log"
echo
echo "watchdog tail:"; tail -3 "$WORK/watchdog.log"

say "6/6  what the API actually paid, per callable"
SINCE=$(( $(date -u +%s) - MARK + 60 ))
ssh -o ConnectTimeout=30 "$VPS" "docker logs rushpoint-api-1 --since ${SINCE}s 2>&1 | grep fsops" \
  > "$WORK/fsops.log" 2>/dev/null
node scripts/fs-ops-report.mjs "$WORK/fsops.log"

echo
echo "full logs: $WORK/sim.log   $WORK/watchdog.log   $WORK/fsops.log"
echo "the simulated game and its runs stay in the operator account; delete them when finished."
exit "$SIM_EXIT"
