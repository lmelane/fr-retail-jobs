#!/bin/sh
# The COMMON procedure for any production data mutation, versioned in the repository.
#
# Why it exists: 53 execution chains sat in backups/ (gitignored). Each lot copied the previous one, so the
# procedure drifted and no chain could be reviewed, diffed or replayed. This is the single entry point; a dossier
# supplies only its own mutation and state scripts.
#
#   0. GUARDS        no deploy in flight, no production run in flight, local HEAD == origin/main
#   1. PERIMETER     the mutation writes the FULL set of identifiers it will touch, BEFORE touching anything
#   2. BACKUP        a fresh dump taken before the first write
#   3. RESTORE       a clone restored from THAT dump — the restore IS the proof the backup is usable
#   4. REHEARSAL     the mutation applied to the clone, then REPLAYED: the replay must change nothing
#   5. GATE          replay-is-empty, perimeter conformity and business invariants CHECKED — failure stops here
#   6. BEFORE        production state, measured with the same script as the after
#   7. APPLY         the mutation in production
#   8. AFTER+REPLAY  state re-measured, replay must change nothing
#   9. ARCHIVE       script, fingerprints, perimeter and before/after results, kept even on failure
#
# THREE GUARANTEES THIS SCRIPT ENFORCES, rather than documents:
#
#  (a) RESUME IS FINGERPRINT-BASED, NOT MARKER-BASED. A step is reused only when the sha256 of its inputs — the
#      mutation script, the state script, this procedure, and the step's own command line — matches what was
#      recorded when it last succeeded. Editing any of them invalidates that step and every later one. A bare
#      `.ok` marker would let an edited script reuse a proof that no longer applies.
#
#  (b) A GATE THAT ACTUALLY BLOCKS. `gate.mts` is run between the rehearsal and production. It exits non-zero
#      when the replay changed anything, when the perimeter is not what was announced, or when a business
#      invariant fails — and a non-zero exit stops the chain. A script that prints a problem and exits 0 must
#      never let the chain continue, which is exactly what happened before.
#
#  (c) EVIDENCE SURVIVES FAILURE. The archive step runs through an EXIT trap, so a stop at any step still leaves
#      the logs, the fingerprints and the perimeter next to the audit trail.
#
# A business inconsistency seen at the rehearsal must be fixed, isolated or arbitrated BEFORE production.
# Declaring it afterwards is not validation (rule adopted 2026-09-11).
#
# usage: mutation.sh <name> <mutation.mts> <state.mts> [--dry-run]
#   <mutation.mts>  accepts <clone|production> [--apply]; writes a perimeter manifest listing every identifier
#   <state.mts>     read-only; prints the measurable state; run identically before and after
#   --dry-run       stops after the gate: everything is rehearsed and checked, production is never written
set -eu
# Every step runs in the pipeline's timezone: a date without a zone suffix is parsed in the process's local time,
# so a replay on another host silently produces different instants (measured: 2 hours off on WordPress dates).
export TZ="${CATWALKS_PIPELINE_TZ:-Europe/Paris}"
cd "$(git rev-parse --show-toplevel)"
NAME="$1"; MUTATION="$2"; STATE="$3"; shift 3
DRY_RUN=0
for a in "$@"; do [ "$a" = "--dry-run" ] && DRY_RUN=1; done

# Executables come from the repository (scripts/ops/db.py); only dumps and credentials stay host-local.
OPS=backups/lot4-20260909                     # dumps and access files: never versioned, they hold production data
DB=apps/aggregator/scripts/ops/db.py
PROD="python3 $DB production"
RO="python3 $DB readonly"
CLONE="python3 $DB clone"
LOG="$OPS/mutation-$NAME"; mkdir -p "$LOG"
PROOF="audits/2026-09-09/lot4-world-coverage/p2-repairs-proof"
GATE=apps/aggregator/scripts/ops/gate.mts
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# (c) Evidence survives failure: whatever happens below, the logs and fingerprints are archived on the way out.
archive() {
  rc=$?
  mkdir -p "$PROOF"
  cp "$MUTATION" "$PROOF/$(basename "$MUTATION").txt" 2>/dev/null || true
  for f in "$LOG"/*.log "$LOG"/*.fp; do [ -f "$f" ] && cp "$f" "$PROOF/$NAME-$(basename "$f")" 2>/dev/null || true; done
  echo "$(date -u +%H:%M:%SZ) mutation $NAME exit=$rc — evidence in $PROOF/$NAME-*"
  exit $rc
}
trap archive EXIT

# (a) A step's identity = its inputs, and THE VALIDATOR IS ONE OF THEM. The fingerprint covered the mutation,
# the state script and this procedure but NOT gate.mts, so editing the validator left every earlier proof
# "valid" — exactly the scenario the reception asks to exercise. Editing any of the four now invalidates.
fingerprint() { shasum -a 256 "$MUTATION" "$STATE" "$0" "$GATE" 2>/dev/null | shasum -a 256 | cut -d' ' -f1; }
BASE_FP=$(fingerprint)

step() {
  name="$1"; shift
  fp="$BASE_FP $*"
  if [ "${RESUME:-0}" = "1" ] && [ -f "$LOG/$name.fp" ] && [ "$(cat "$LOG/$name.fp")" = "$fp" ]; then
    echo "$(date -u +%H:%M:%SZ) skip $name (same inputs, proven at $(date -u -r "$LOG/$name.fp" +%H:%M:%SZ 2>/dev/null || echo '?'))"
    return 0
  fi
  [ -f "$LOG/$name.fp" ] && [ "$(cat "$LOG/$name.fp")" != "$fp" ] && echo "$(date -u +%H:%M:%SZ) redo $name (inputs changed since its last proof)"
  # No pipe ever masks an exit code: output goes to a file, the status is the command's own.
  if "$@" > "$LOG/$name.log" 2>&1; then
    echo "$(date -u +%H:%M:%SZ) ok   $name"; printf '%s' "$fp" > "$LOG/$name.fp"
  else
    rc=$?; echo "$(date -u +%H:%M:%SZ) FAIL $name (exit $rc)"; grep -vE '^\s+at ' "$LOG/$name.log" | tail -12; exit 10
  fi
}

echo "$START mutation $NAME (dry-run=$DRY_RUN)"

# 0. Guards.
g=0
while ! python3 apps/aggregator/scripts/ops/deploy-guard.py > "$LOG/guard.log" 2>&1; do
  g=$((g + 1)); [ $g -gt 40 ] && { echo "deploy guard refusing for 20 min"; cat "$LOG/guard.log"; exit 3; }; sleep 30
done
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "local HEAD is not origin/main — merge and deploy first, never during a mutation"; exit 4; }

# 1. Perimeter and 6. before-state, both read-only against production.
step perimeter $RO npx tsx "$MUTATION" production
step before $RO npx tsx "$STATE"

# 2. Fresh backup, 3. clone restored from it.
#
# The dump NAME is remembered, not recomputed. A timestamp regenerated on every invocation made `restore-clone`
# see different arguments on a resume, so it was re-run against a dump that did not exist — the resume scenario
# failed on its first real rehearsal. The name is written next to the step proofs and reused while RESUME=1;
# a fresh run (or an invalidated backup step) mints a new one, so the backup still precedes every write.
# The name is reused ONLY while the backup step is still valid for these exact inputs. If the backup was
# invalidated (edited scripts, edited procedure) a new dump must be taken: backup-0910.py refuses to overwrite an
# existing dump — correctly, since silently reusing an older dump would break "the backup precedes every write".
BACKUP_FP="$BASE_FP $PROD python3 $OPS/backup-$NAME.py"
if [ "${RESUME:-0}" = "1" ] && [ -f "$LOG/dump.name" ] && [ -f "$LOG/backup.fp" ] && [ "$(cat "$LOG/backup.fp")" = "$BACKUP_FP" ]; then
  DUMP=$(cat "$LOG/dump.name"); BPROOF=$(cat "$LOG/dump.proof")
else
  STAMP=$(date -u +%H%M%S); DUMP="before-$NAME-$STAMP-production.dump"; BPROOF="$NAME-$STAMP-backup-proof.json"
  printf '%s' "$DUMP" > "$LOG/dump.name"; printf '%s' "$BPROOF" > "$LOG/dump.proof"
fi
sed "s/before-0910-qualification-production.dump/$DUMP/; s/qualification-0910-backup-proof.json/$BPROOF/" \
  $OPS/backup-0910.py > "$OPS/backup-$NAME.py"
step backup $PROD python3 "$OPS/backup-$NAME.py"
step restore-clone python3 $OPS/restore-clone-from-dump.py "$OPS/$DUMP" "$OPS/$BPROOF"

# 4. Rehearsal, then replay.
step clone-apply $CLONE npx tsx "$MUTATION" clone --apply
step clone-replay $CLONE npx tsx "$MUTATION" clone --apply
step clone-state $CLONE npx tsx "$STATE"

# 5. (b) The blocking gate. It reads the logs just produced and refuses to let the chain reach production.
step gate npx tsx "$GATE" "$LOG" --name="$NAME"

[ "$DRY_RUN" = "1" ] && { echo "$(date -u +%H:%M:%SZ) dry-run: gate passed, production deliberately not written"; exit 0; }

# 7. Production, 8. after + replay.
step prod-apply $PROD npx tsx "$MUTATION" production --apply
step prod-replay $PROD npx tsx "$MUTATION" production --apply
step after $RO npx tsx "$STATE"
step gate-after npx tsx "$GATE" "$LOG" --name="$NAME" --phase=production
