#!/bin/sh
# Certification of sources ALREADY ACTIVE (catalogued before the identity contract), under the same protocol as an activation lot but without
# register / promote / run: guard → FRESH backup → clone d restored from it → clone: validate (real adapter, explicit robots, native labels;
# no --write on an ACTIVE row) + certify (board exact + perimeter vs proof) → production: the same → read-only volumes. Crons stay frozen.
# usage: b6-certify-existing.sh <name> <keys,comma>
set -eu; cd /Users/lmelane/Downloads/catwalks-job-aggregator; R="${CERTIFICATION_EVIDENCE_DIR:-backups/lot4-20260909}"; C_OPS=apps/aggregator/scripts/ops/certification; NAME="$1"; KEYS="$2"
P="python3 backups/remediation-20260908/run.py prod"; RO="python3 backups/remediation-20260908/run.py readonly"; C="python3 $C_OPS/run-local-d.py"
LOG="$R/certify-$NAME"; mkdir -p "$LOG"; START=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "$START certify-existing $NAME keys $KEYS"
step() { name="$1"; shift; if "$@" > "$LOG/$name.log" 2>&1; then echo "$(date -u +%H:%M:%SZ) ok   $name"; else rc=$?; echo "$(date -u +%H:%M:%SZ) FAIL $name (exit $rc)"; grep -vE '^\s+at ' "$LOG/$name.log" | tail -8; exit 10; fi; }
validate() { env="$1"; runner="$2"; for k in $(echo "$KEYS" | tr ',' ' '); do
  step "validate-$env-$k" $runner npx tsx apps/aggregator/scripts/coverage/validate-candidate.mts "$k" --deadline-ms=300000 --proof="$R/b6-validate-$env-$k.json"
  python3 - "$R/b6-validate-$env-$k.json" <<'PY' || exit 11
import json,sys; d=json.load(open(sys.argv[1])); r=d['robots']; s=d['scopeEvidence']
print('   ', f"{d['key']}: robots {d['robotsVerdict']} (HTTP {r['httpStatus']}) parsed {d['parsed']}/{d['fetched']} complete={d['complete']} declared={d['declaredTotal']} country {d['withCountry']}/{d['fetched']} labels {s['verdict']} {s['other']}")
# D62 : robots OBSERVÉ ne décide plus seul. Une surface publique d'offres reste collectable sous
# l'autorisation sectorielle du propriétaire ; le fait observé est conservé tel quel et affiché.
ok = d['robotsVerdict'] in ('ALLOWED', 'DISALLOWED', 'NO_ROBOTS', 'UNREACHABLE')
if d['robotsVerdict'] != 'ALLOWED':
    print('    ', f"  robots {d['robotsVerdict']} observé — surface publique d'offres, autorisation propriétaire D62 : collecte maintenue")
sys.exit(0 if ok and d['parsed']>=1 and not d['truncated'] else 1)
PY
done; }
g=0; while ! python3 $C_OPS/deploy-guard.py > "$LOG/guard.log" 2>&1; do g=$((g+1)); [ $g -gt 40 ] && { echo "deploy guard refusing for 20 min"; cat "$LOG/guard.log"; exit 3; }; sleep 30; done
STAMP=$(date -u +%H%M%S); DUMP="before-certify-$NAME-$STAMP-production.dump"; PROOF="certify-$NAME-$STAMP-backup-proof.json"
sed "s/before-0910-qualification-production.dump/$DUMP/; s/qualification-0910-backup-proof.json/$PROOF/" $C_OPS/backup-0910.py > $R/backup-certify-$NAME.py
step backup $P python3 $R/backup-certify-$NAME.py
step restore-clone python3 $C_OPS/restore-clone-from-dump.py "$R/$DUMP" "$R/$PROOF"
validate clone "$C"
step clone-aliases $C npx tsx $C_OPS/aliases.mts clone "$KEYS"
step clone-certify $C npx tsx $C_OPS/integrate.mts clone certify "$KEYS"
grep -o '"boardReference":"[^"]*","scopeVerdict":"[^"]*"' "$LOG/clone-certify.log" | sed 's/^/    /'
validate production "$P"
step prod-aliases $P npx tsx $C_OPS/aliases.mts production "$KEYS"
step prod-certify $P npx tsx $C_OPS/integrate.mts production certify "$KEYS"
grep -o '"boardReference":"[^"]*","scopeVerdict":"[^"]*"' "$LOG/prod-certify.log" | sed 's/^/    /'
step verify $RO npx tsx $C_OPS/lot-volumes.mts "$KEYS" "2026-09-01T00:00:00Z" "certify-$NAME" --api
grep -v '^{' "$LOG/verify.log" | sed 's/^/    /'
echo "$(date -u +%H:%M:%SZ) certify-existing $NAME chain exit=0"
