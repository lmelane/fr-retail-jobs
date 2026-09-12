#!/bin/sh
# UN refresh de production borné, consommant EXACTEMENT le manifeste figé par la prévisualisation.
#
# Le refresh ne cherche pas les lignes à fermer : il applique celles qui ont été revues. La prévisualisation
# produit le manifeste, le manifeste est haché, relu avant mutation, et la mutation refuse toute ligne qui n'y
# figure pas. Aucun second calcul indépendant.
#
#   préflight (commit figé, arbre propre, 2 services, allowlist, sauvegarde restaurée, alertes testées)
#     → prévisualisation → manifeste figé + empreinte
#     → répétition du manifeste sur CLONE, avec contrôle de parité
#     → pose REFRESH_ONLY_KEYS + commande bornée + déploiement
#     → exécution unique
#     → restauration de la commande normale, retrait de REFRESH_ONLY_KEYS
#     → contrôles : touchedIds = manifeste, invariants, crons gelés
#
# `INGEST_ONLY_KEYS` doit être ABSENT : un refresh ne collecte rien.
#
# usage: bounded-refresh.sh <commit-sha40> <keys,comma> [--skip-backup --dump=<path>]
set -eu

cd "$(dirname "$0")/../../../.."
OPS=apps/aggregator/scripts/ops
R=backups/lot4-20260909
COMMIT="${1:-}"; KEYS="${2:-}"; shift 2 || true
[ -n "$COMMIT" ] && [ -n "$KEYS" ] || { echo "usage: bounded-refresh.sh <commit-sha40> <keys,comma>"; exit 2; }

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG="$R/p7-refresh-$STAMP"
mkdir -p "$LOG"
RUN_NAME="p7-bounded-refresh-$STAMP"

RUNNER_SHA=$(cat "$OPS/bounded-refresh.sh" "$OPS/ingest-preflight.py" "$OPS/refresh-preview.mts" | shasum -a 256 | cut -d' ' -f1)
echo "$STAMP runner=$RUNNER_SHA commit=$COMMIT keys=$KEYS"

export DEPLOY_COMMIT="$COMMIT"
export INGEST_KEYS="$KEYS"

# ── 1 à 8 : le préflight, bloquant ───────────────────────────────────────────────────────────────────────
echo "$(date -u +%H:%M:%S) préflight"
python3 "$OPS/ingest-preflight.py" --commit="$COMMIT" --keys="$KEYS" --expect-keys="$KEYS" \
  --out="$LOG/preflight.json" "$@" > "$LOG/preflight.log" 2>&1 || {
  echo "PRÉFLIGHT REFUSÉ — rien n'a été lancé"; tail -30 "$LOG/preflight.log"; exit 3; }

# ── INGEST_ONLY_KEYS doit être ABSENT : un refresh ne collecte rien ──────────────────────────────────────
python3 "$OPS/railway-service.py" variables aggregator > "$LOG/variables-before.json" 2>&1
grep -q '"INGEST_ONLY_KEYS": null' "$LOG/variables-before.json" || {
  echo "REFUS : INGEST_ONLY_KEYS est posé — un refresh ne doit jamais collecter"; exit 4; }
echo "$(date -u +%H:%M:%S) préflight OK · INGEST_ONLY_KEYS absent"

# ── prévisualisation → manifeste figé ────────────────────────────────────────────────────────────────────
python3 "$OPS/db.py" readonly npx tsx "$OPS/refresh-preview.mts" --keys="$KEYS" \
  --out="$LOG/preview.json" > "$LOG/preview.log" 2>&1
python3 "$OPS/db.py" readonly npx tsx "$OPS/freeze-manifest.mts" --preview="$LOG/preview.json" \
  --out="$LOG/manifest.json" > "$LOG/manifest.log" 2>&1 || {
  echo "MANIFESTE REFUSÉ"; cat "$LOG/manifest.log"; exit 5; }
PLAN_HASH=$(python3 -c "import json;print(json.load(open('$LOG/manifest.json'))['planHash'])")
ENTRIES=$(python3 -c "import json;print(len(json.load(open('$LOG/manifest.json'))['entries']))")
echo "$(date -u +%H:%M:%S) manifeste figé : $ENTRIES ligne(s), empreinte ${PLAN_HASH}"

if [ "$ENTRIES" = "0" ]; then
  echo "$(date -u +%H:%M:%S) manifeste VIDE : rien à fermer, aucune mutation lancée"
  exit 0
fi

# ── état AVANT ───────────────────────────────────────────────────────────────────────────────────────────
STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
python3 "$OPS/db.py" readonly npx tsx "$OPS/ingest-facts.mts" --keys="$KEYS" --phase=before \
  --out="$LOG/before.json" > "$LOG/before.log" 2>&1

# ── commande bornée : le refresh consomme le manifeste ───────────────────────────────────────────────────
BOUNDED=$(python3 "$OPS/bounded-refresh-command.py" "$RUN_NAME" "$KEYS" "$LOG/manifest.json")
echo "$(date -u +%H:%M:%S) pose de la commande bornée + déploiement"
python3 "$OPS/railway-service.py" set-command aggregator "$BOUNDED" > "$LOG/set-command.json" 2>&1

restore_command() {
  echo "$(date -u +%H:%M:%S) restauration de la commande normale"
  python3 "$OPS/railway-service.py" set-command aggregator 'sh apps/aggregator/start.sh' \
    > "$LOG/restore-command.json" 2>&1 || echo "ATTENTION : restauration échouée, à reprendre à la main"
}

i=0; deployed=0
while [ $i -lt 40 ]; do
  st=$(python3 "$OPS/railway-service.py" status aggregator 2>&1 || true)
  echo "$(date -u +%H:%M:%S) $(echo "$st" | tr -d '\n ' | cut -c1-160)" >> "$LOG/deploy-wait.log"
  case "$st" in
    *'"status": "SUCCESS"'*) case "$st" in *"$COMMIT"*) deployed=1; break;; esac;;
    *'"status": "FAILED"'*|*'"status": "CRASHED"'*) break;;
  esac
  i=$((i + 1)); sleep 30
done
[ "$deployed" = "1" ] || { echo "déploiement borné non SUCCESS"; restore_command; exit 6; }

echo "$(date -u +%H:%M:%S) exécution"
python3 "$OPS/railway-service.py" execute aggregator > "$LOG/execute.json" 2>&1 || {
  echo "exécution refusée"; cat "$LOG/execute.json"; restore_command; exit 7; }

j=0; terminal=0
while [ $j -lt 60 ]; do
  out=$(python3 "$OPS/db.py" readonly npx tsx "$OPS/run-status.mts" --command="$RUN_NAME" 2>&1 || true)
  echo "$(date -u +%H:%M:%S) $(echo "$out" | tr -d '\n' | cut -c1-200)" >> "$LOG/run-wait.log"
  case "$out" in *COMPLETED*|*FAILED*|*INTERRUPTED*) terminal=1; break;; esac
  j=$((j + 1)); sleep 30
done
FINISHED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
[ "$terminal" = "1" ] || { echo "run non terminal : la commande N'EST PAS restaurée (un redéploiement le tuerait)"; exit 8; }

restore_command

# ── contrôles : touchedIds = manifeste, invariants, variables, crons ─────────────────────────────────────
python3 "$OPS/db.py" readonly npx tsx "$OPS/refresh-audit.mts" --manifest="$LOG/manifest.json" \
  --keys="$KEYS" --since="$STARTED" --command="$RUN_NAME" --out="$LOG/audit.json" > "$LOG/audit.log" 2>&1
python3 "$OPS/read-crons.py" > "$LOG/crons-after.json" 2>&1 || true
python3 "$OPS/railway-service.py" variables aggregator > "$LOG/variables-after.json" 2>&1 || true

python3 - "$LOG" "$COMMIT" "$KEYS" "$RUNNER_SHA" "$STARTED" "$FINISHED" "$STAMP" "$PLAN_HASH" <<'PY'
import json, pathlib, sys
log, commit, keys, runner, started, finished, stamp, plan_hash = sys.argv[1:9]
d = pathlib.Path(log)
read = lambda n: json.loads((d / n).read_text()) if (d / n).exists() else None
record = {
    'runName': f'p7-bounded-refresh-{stamp}', 'commit': commit, 'keys': keys.split(','),
    'runnerSha256': runner, 'planHash': plan_hash, 'startedAt': started, 'finishedAt': finished,
    'preflight': read('preflight.json'), 'manifest': read('manifest.json'), 'audit': read('audit.json'),
    'cronsAfter': read('crons-after.json'), 'variablesAfter': read('variables-after.json'),
}
(d / 'record.json').write_text(json.dumps(record, indent=2))
problems = []
v = record.get('variablesAfter') or {}
if v.get('REFRESH_ONLY_KEYS'): problems.append(f"REFRESH_ONLY_KEYS résiduel : {v['REFRESH_ONLY_KEYS']}")
if v.get('INGEST_ONLY_KEYS'): problems.append(f"INGEST_ONLY_KEYS résiduel : {v['INGEST_ONLY_KEYS']}")
for name, s in ((record.get('cronsAfter') or {}).get('services') or {}).items():
    if isinstance(s, dict) and s.get('cronSchedule') != '0 0 29 2 *':
        problems.append(f"cron dégelé sur {name} : {s.get('cronSchedule')}")
audit = record.get('audit') or {}
problems += audit.get('problems', [])
print(json.dumps({'record': str(d / 'record.json'), 'problems': problems}, indent=1))
sys.exit(1 if problems else 0)
PY

echo "$(date -u +%H:%M:%S) terminé — journal $LOG"
