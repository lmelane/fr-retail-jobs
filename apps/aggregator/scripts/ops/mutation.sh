#!/bin/sh
# The COMMON procedure for any production data mutation, versioned in the repository.
#
# Why it lives here: 53 execution chains sat in backups/ (gitignored). Each lot copied the previous one, so the
# procedure drifted, and a chain could not be reviewed, diffed or replayed from the repository. This script is the
# single entry point; a lot supplies only its own mutation script.
#
#   0. GUARDS        no deploy in flight, no production run in flight, local HEAD == origin/main
#   1. PERIMETER     the mutation lists the FULL set of identifiers it will touch, BEFORE touching anything
#                    (10 September: a run archived 5 of 172 ids and the perimeter became unrecoverable)
#   2. BACKUP        a fresh dump taken before the first write
#   3. RESTORE       a clone restored from THAT dump — the restore IS the proof the backup exists and is usable
#   4. REHEARSAL     the mutation applied to the clone, then REPLAYED: the replay must change nothing
#   5. BEFORE        the state measured in production, with the same script as after
#   6. APPLY         the mutation in production
#   7. AFTER+REPLAY  the state measured again, and the replay must change nothing
#   8. ARCHIVE       script, sha256, perimeter and before/after results copied next to the audit trail
#
# A business inconsistency seen at step 4 must be fixed, isolated or arbitrated BEFORE step 6. Declaring it
# afterwards is not validation (rule adopted 2026-09-11).
#
# usage: mutation.sh <name> <mutation.mts> <state.mts>
#   <mutation.mts>  accepts <clone|production> [--apply] and writes a perimeter manifest listing every identifier
#   <state.mts>     read-only, prints the measurable state; run identically before and after
set -eu
cd "$(git rev-parse --show-toplevel)"
NAME="$1"; MUTATION="$2"; STATE="$3"
OPS=backups/lot4-20260909                     # host-local runners and dumps (never versioned: they hold production data)
PROD="python3 backups/remediation-20260908/run.py prod"
RO="python3 backups/remediation-20260908/run.py readonly"
CLONE="python3 $OPS/run-local-d.py"
LOG="$OPS/mutation-$NAME"; mkdir -p "$LOG"
PROOF="audits/2026-09-09/lot4-world-coverage/p2-repairs-proof"
START=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "$START mutation $NAME"

step() {
  name="$1"; shift
  if [ "${RESUME:-0}" = "1" ] && [ -f "$LOG/$name.ok" ]; then
    echo "$(date -u +%H:%M:%SZ) skip $name (proven earlier: $(cat "$LOG/$name.ok"))"; return 0
  fi
  # No pipe ever masks an exit code here: the output goes to a file and the status is the command's own.
  if "$@" > "$LOG/$name.log" 2>&1; then
    echo "$(date -u +%H:%M:%SZ) ok   $name"; date -u +%H:%M:%SZ > "$LOG/$name.ok"
  else
    rc=$?; echo "$(date -u +%H:%M:%SZ) FAIL $name (exit $rc)"; grep -vE '^\s+at ' "$LOG/$name.log" | tail -12; exit 10
  fi
}

# 0. Guards.
g=0
while ! python3 apps/aggregator/scripts/ops/deploy-guard.py > "$LOG/guard.log" 2>&1; do
  g=$((g + 1)); [ $g -gt 40 ] && { echo "deploy guard refusing for 20 min"; cat "$LOG/guard.log"; exit 3; }; sleep 30
done
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "local HEAD is not origin/main — merge and deploy first, never during a mutation"; exit 4; }

# 1. Perimeter + 5. before-state, measured with the production-facing read-only runner.
step perimeter $RO npx tsx "$MUTATION" production
step before $RO npx tsx "$STATE"

# 2. Fresh backup, 3. clone restored from it (the restore proves the backup).
STAMP=$(date -u +%H%M%S); DUMP="before-$NAME-$STAMP-production.dump"; BPROOF="$NAME-$STAMP-backup-proof.json"
sed "s/before-0910-qualification-production.dump/$DUMP/; s/qualification-0910-backup-proof.json/$BPROOF/" \
  $OPS/backup-0910.py > "$OPS/backup-$NAME.py"
step backup $PROD python3 "$OPS/backup-$NAME.py"
step restore-clone python3 $OPS/restore-clone-from-dump.py "$OPS/$DUMP" "$OPS/$BPROOF"

# 4. Rehearsal on the clone, then replay: the replay must change nothing.
step clone-apply $CLONE npx tsx "$MUTATION" clone --apply
step clone-replay $CLONE npx tsx "$MUTATION" clone --apply
step clone-state $CLONE npx tsx "$STATE"

# 6. Production, 7. after + replay.
step prod-apply $PROD npx tsx "$MUTATION" production --apply
step prod-replay $PROD npx tsx "$MUTATION" production --apply
step after $RO npx tsx "$STATE"

# 8. Archive: the exact script, its fingerprint, the perimeter and the before/after results.
mkdir -p "$PROOF"
cp "$MUTATION" "$PROOF/$(basename "$MUTATION").txt"
shasum -a 256 "$MUTATION" "$STATE" >> "$PROOF/scripts.sha256"
for f in perimeter before clone-apply clone-replay clone-state prod-apply prod-replay after; do
  [ -f "$LOG/$f.log" ] && cp "$LOG/$f.log" "$PROOF/$NAME-$f.log"
done
echo "$(date -u +%H:%M:%SZ) mutation $NAME done — before/after in $PROOF/$NAME-{before,after}.log"
