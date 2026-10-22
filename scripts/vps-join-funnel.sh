#!/usr/bin/env bash
# The join funnel of a live event, read from the API's own log on the VPS. READ ONLY.
#   bash scripts/vps-join-funnel.sh            # the last 60 minutes
#   bash scripts/vps-join-funnel.sh 20m        # any `docker logs --since` value
#
# Why it exists: on 14.10 a third of the phones could not get in, and nobody saw a number until the
# post-mortem the next night. These are the numbers that would have shown it in the first ten minutes:
# code checks against joins (a gap means phones see the code but do not get in), every join refusal by
# its code, and every sign-in loss the phones reported with whether the app recovered it.
set -euo pipefail
SINCE="${1:-60m}"
HOST="${RUSHPOINT_VPS:-root@31.70.107.184}"
ssh -o ConnectTimeout=8 -o BatchMode=yes "$HOST" "docker logs --since '$SINCE' rushpoint-api-1 2>&1" | awk '
  /"message":"callable.ok"/ {
    if (match($0, /"callable":"(getJoinInfo|joinRun|joinTeamAsDevice|staffSignIn)"/)) { c = substr($0, RSTART + 12, RLENGTH - 13); ok[c]++ }
  }
  /"message":"callable.error"/ {
    if (match($0, /"callable":"(getJoinInfo|joinRun|joinTeamAsDevice|staffSignIn)"/)) {
      c = substr($0, RSTART + 12, RLENGTH - 13)
      e = "?"; if (match($0, /"errorCode":"[a-z-]+"/)) e = substr($0, RSTART + 13, RLENGTH - 14)
      err[c "  " e]++
    }
  }
  /"kind":"authLost"/ {
    o = "?"; if (match($0, /"outcome":"[a-zA-Z]+"/)) o = substr($0, RSTART + 11, RLENGTH - 12)
    p = "?"; if (match($0, /"phase":"[a-z]+"/)) p = substr($0, RSTART + 9, RLENGTH - 10)
    lost[p "  " o]++
  }
  /rateLimit.tripped/ { if (match($0, /"bucket":"[a-zA-Z]+"/)) rl[substr($0, RSTART + 10, RLENGTH - 11)]++ }
  END {
    printf "\nJOIN FUNNEL (since %s)\n", "'"$SINCE"'"
    printf "  code checks ok       %5d\n", ok["getJoinInfo"]
    printf "  teams founded ok     %5d\n", ok["joinRun"]
    printf "  phones attached ok   %5d\n", ok["joinTeamAsDevice"]
    printf "  staff sign-ins ok    %5d\n", ok["staffSignIn"]
    n = 0; for (k in err) n++
    printf "\nREFUSED (%s)\n", (n ? "" : "none")
    for (k in err) printf "  %-40s %5d\n", k, err[k]
    n = 0; for (k in lost) n++
    printf "\nSIGN-IN LOSSES THE PHONES REPORTED (%s)\n", (n ? "reinstated/freshSignIn = recovered, failed = not" : "none")
    for (k in lost) printf "  %-40s %5d\n", k, lost[k]
    n = 0; for (k in rl) n++
    if (n) { printf "\nRATE LIMIT TRIPS\n"; for (k in rl) printf "  %-40s %5d\n", k, rl[k] }
    print ""
  }'
