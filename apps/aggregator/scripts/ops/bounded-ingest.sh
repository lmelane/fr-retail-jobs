#!/bin/sh
# UNE ingestion de production bornée, depuis l'egress réel du service aggregator.
#
# Ce programme IMPOSE l'ordre du brief P7 ; il ne le documente pas. Chaque étape est une commande dont l'échec
# arrête la chaîne (`set -e`), et aucune étape n'est enchaînée par un tube — le code de sortie d'un tube est
# celui de sa DERNIÈRE commande, ce qui a déjà masqué un échec réel.
#
#   préflight (commit figé, arbre propre, 2 services, allowlist, sauvegarde restaurée, alertes testées)
#     → pose INGEST_ONLY_KEYS + commande bornée + déploiement du commit
#     → attente du SUCCESS sur CE commit
#     → exécution
#     → attente d'un statut TERMINAL du run
#     → restauration de la commande normale (donc retrait de l'allowlist)
#     → contrôle final : crons gelés, aucune variable de périmètre résiduelle
#
# Ce qui n'est JAMAIS fait ici : aucun refresh, aucun dégel de cron, aucune pose de REFRESH_ONLY_KEYS.
# `PIPELINE_PAUSED` n'est pas touché : la commande bornée n'est pas le point d'entrée du cron, elle appelle
# directement l'orchestrateur — la pause ne la concerne pas et reste donc en place pour les crons.
#
# usage: bounded-ingest.sh <commit-sha40> <keys,comma> [--skip-backup --dump=<path>]
set -eu

cd "$(dirname "$0")/../../../.."
OPS=apps/aggregator/scripts/ops
R=backups/lot4-20260909
COMMIT="${1:-}"; KEYS="${2:-}"; shift 2 || true
[ -n "$COMMIT" ] && [ -n "$KEYS" ] || { echo "usage: bounded-ingest.sh <commit-sha40> <keys,comma>"; exit 2; }

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG="$R/p7-run-$STAMP"
mkdir -p "$LOG"
RUN_NAME="p7-bounded-ingest-$STAMP"

# L'empreinte du runner lui-même : ce qui a été exécuté doit être identifiable, pas seulement nommé.
RUNNER_SHA=$(cat "$OPS/bounded-ingest.sh" "$OPS/ingest-preflight.py" "$OPS/railway-service.py" | shasum -a 256 | cut -d' ' -f1)
echo "$STAMP runner=$RUNNER_SHA commit=$COMMIT keys=$KEYS"

export DEPLOY_COMMIT="$COMMIT"
export INGEST_KEYS="$KEYS"

# ── 1 à 8 : le préflight, bloquant ───────────────────────────────────────────────────────────────────────
echo "$(date -u +%H:%M:%S) préflight"
python3 "$OPS/ingest-preflight.py" --commit="$COMMIT" --keys="$KEYS" --expect-keys="$KEYS" \
  --out="$LOG/preflight.json" "$@" > "$LOG/preflight.log" 2>&1 || {
  echo "PRÉFLIGHT REFUSÉ — rien n'a été lancé"; tail -30 "$LOG/preflight.log"; exit 3; }
echo "$(date -u +%H:%M:%S) préflight OK"

# ── état AVANT, par source ───────────────────────────────────────────────────────────────────────────────
STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
python3 "$OPS/db.py" readonly npx tsx "$OPS/ingest-facts.mts" --keys="$KEYS" --phase=before \
  --out="$LOG/before.json" > "$LOG/before.log" 2>&1
echo "$(date -u +%H:%M:%S) état avant capturé"

# ── 9 + 10 : commande bornée, déploiement, attente, exécution ────────────────────────────────────────────
# La commande est assemblée par `bounded-command.py` : elle contient du JavaScript avec guillemets et `$`, que
# le shell casserait en silence. Les canaux d'alerte y sont retirés de l'exécution — testés au préflight, un
# digest émis par un run de 9 sources annoncerait faussement l'état des 431 autres.
BOUNDED=$(python3 "$OPS/bounded-command.py" "$RUN_NAME" "$KEYS")

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
[ "$deployed" = "1" ] || { echo "déploiement borné non SUCCESS sur $COMMIT"; restore_command; exit 4; }
echo "$(date -u +%H:%M:%S) déploiement borné SUCCESS"

echo "$(date -u +%H:%M:%S) exécution"
python3 "$OPS/railway-service.py" execute aggregator > "$LOG/execute.json" 2>&1 || {
  echo "exécution refusée"; cat "$LOG/execute.json"; restore_command; exit 5; }

# ── attente d'un statut TERMINAL ─────────────────────────────────────────────────────────────────────────
# Une restauration de commande redéploie le service et TUERAIT un run encore en vol : on ne restaure jamais
# avant un statut terminal.
j=0; terminal=0
while [ $j -lt 120 ]; do
  out=$(python3 "$OPS/db.py" readonly npx tsx "$OPS/run-status.mts" --command="$RUN_NAME" 2>&1 || true)
  echo "$(date -u +%H:%M:%S) $(echo "$out" | tr -d '\n' | cut -c1-200)" >> "$LOG/run-wait.log"
  case "$out" in
    *COMPLETED*|*FAILED*|*INTERRUPTED*) terminal=1; break;;
  esac
  j=$((j + 1)); sleep 30
done
FINISHED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
[ "$terminal" = "1" ] || { echo "run non terminal après 60 min : la commande N'EST PAS restaurée (un redéploiement le tuerait)"; exit 6; }
echo "$(date -u +%H:%M:%S) run terminal"

# ── 11 : restaurer la commande normale (donc retirer l'allowlist) ────────────────────────────────────────
restore_command

# ── état APRÈS + 12 : contrôles finaux ───────────────────────────────────────────────────────────────────
python3 "$OPS/db.py" readonly npx tsx "$OPS/ingest-facts.mts" --keys="$KEYS" --phase=after \
  --before="$LOG/before.json" --since="$STARTED" --command="$RUN_NAME" \
  --out="$LOG/after.json" > "$LOG/after.log" 2>&1
python3 "$OPS/read-crons.py" > "$LOG/crons-after.json" 2>&1 || true
python3 "$OPS/railway-service.py" variables aggregator > "$LOG/variables-after.json" 2>&1 || true

python3 - "$LOG" "$COMMIT" "$KEYS" "$RUNNER_SHA" "$STARTED" "$FINISHED" "$STAMP" <<'PY'
import json, pathlib, sys
log, commit, keys, runner, started, finished, stamp = sys.argv[1:8]
d = pathlib.Path(log)
record = {
    'runName': f'p7-bounded-ingest-{stamp}',
    'commit': commit, 'keys': keys.split(','), 'runnerSha256': runner,
    'startedAt': started, 'finishedAt': finished,
    'preflight': json.loads((d / 'preflight.json').read_text()) if (d / 'preflight.json').exists() else None,
    'after': json.loads((d / 'after.json').read_text()) if (d / 'after.json').exists() else None,
    'cronsAfter': json.loads((d / 'crons-after.json').read_text()) if (d / 'crons-after.json').exists() else None,
    'variablesAfter': json.loads((d / 'variables-after.json').read_text()) if (d / 'variables-after.json').exists() else None,
}
(d / 'record.json').write_text(json.dumps(record, indent=2))
v = record.get('variablesAfter') or {}
problems = []
if v.get('INGEST_ONLY_KEYS'): problems.append(f"INGEST_ONLY_KEYS résiduel : {v['INGEST_ONLY_KEYS']}")
if v.get('REFRESH_ONLY_KEYS'): problems.append(f"REFRESH_ONLY_KEYS présent : {v['REFRESH_ONLY_KEYS']}")
for name, s in ((record.get('cronsAfter') or {}).get('services') or {}).items():
    if isinstance(s, dict) and s.get('cronSchedule') != '0 0 29 2 *':
        problems.append(f"cron dégelé sur {name} : {s.get('cronSchedule')}")
print(json.dumps({'record': str(d / 'record.json'), 'problems': problems}, indent=1))
sys.exit(1 if problems else 0)
PY

echo "$(date -u +%H:%M:%S) terminé — journal $LOG"
