#!/usr/bin/env bash
# Abort a production load simulation before it eats the day's Firestore quota.
#
#   scripts/prod-sim-watchdog.sh <sim-pid> <max-reads> <max-writes> [poll-seconds]
#
# WHY THIS IS A SEPARATE PROCESS. The simulator cannot measure its own quota spend: the
# authoritative count is what the SERVER performed, and that lives in the API container's
# `fsops` log records. Asking the sim to SSH into the VPS on a timer would tangle the
# measurement into the thing being measured, and a hang in the check would stall every team.
# A watchdog beside it can be killed, ignored, or run against a sim someone else started.
#
# It measures reads/writes accumulated SINCE THE WATCHDOG STARTED, not since midnight —
# the Spark day's remaining budget is not observable from here. So the thresholds passed in
# should be a deliberate fraction of the ceiling, leaving room for whatever the day already
# spent. Reported honestly: "we stopped at N" is a result, not a failure.
set -u

SIM_PID="${1:?usage: prod-sim-watchdog.sh <sim-pid> <max-reads> <max-writes> [poll-seconds]}"
MAX_READS="${2:?}"
MAX_WRITES="${3:?}"
POLL="${4:-30}"
VPS="${RUSHPOINT_VPS:-root@31.70.107.184}"

echo "[watchdog] guarding pid $SIM_PID — abort above ${MAX_READS} reads or ${MAX_WRITES} writes"

# Everything logged from this moment on belongs to the run being guarded.
START_EPOCH=$(date -u +%s)

while kill -0 "$SIM_PID" 2>/dev/null; do
  sleep "$POLL"
  SINCE=$(( $(date -u +%s) - START_EPOCH ))
  # `docker logs --since <n>s` is relative, so a clock difference between this machine and
  # the VPS cannot skew the window.
  TOTALS=$(ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no "$VPS" \
    "docker logs rushpoint-api-1 --since ${SINCE}s 2>&1 | grep fsops" 2>/dev/null \
    | python -c '
import sys, json
r = w = n = 0
for line in sys.stdin:
    i = line.find("{")
    if i < 0: continue
    try: rec = json.loads(line[i:])
    except Exception: continue
    if rec.get("message") != "fsops": continue
    n += 1
    r += rec.get("reads") or 0
    w += rec.get("writes") or 0
print(f"{r} {w} {n}")
' 2>/dev/null)

  [ -z "$TOTALS" ] && { echo "[watchdog] could not read totals; continuing"; continue; }
  READS=$(echo "$TOTALS" | cut -d' ' -f1)
  WRITES=$(echo "$TOTALS" | cut -d' ' -f2)
  CALLS=$(echo "$TOTALS" | cut -d' ' -f3)
  echo "[watchdog] +${SINCE}s  reads=${READS}/${MAX_READS}  writes=${WRITES}/${MAX_WRITES}  calls=${CALLS}"

  if [ "${READS:-0}" -ge "$MAX_READS" ] || [ "${WRITES:-0}" -ge "$MAX_WRITES" ]; then
    echo "[watchdog] 🛑 BUDGET REACHED (reads=${READS} writes=${WRITES}) — stopping the simulation"
    kill -TERM "$SIM_PID" 2>/dev/null
    sleep 5
    kill -KILL "$SIM_PID" 2>/dev/null
    exit 10
  fi
done

echo "[watchdog] simulation ended on its own; no budget abort"
exit 0
