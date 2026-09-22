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
# PIPELINE_PAUSED est autoritaire aussi pour les commandes bornées. Ce script ne la désactive pas ;
# le dégel du seul service de canari exige une autorisation distincte et un calendrier toujours gelé.
#
# usage: bounded-ingest.sh <commit-sha40> <keys,comma> [--concurrency=<n>] [--skip-backup --dump=<path>]
#
# `--stop-on-first-429` arme l'arrêt franc DANS LE CONTENEUR. Une variable exportée dans le shell local
# n'y arrive jamais : le 2026-09-13, trois passages ont été conduits en croyant la garde armée alors
# qu'elle ne l'était pas, et T2 a encaissé 82 réponses 429 sans s'arrêter.
#
# `--concurrency=<n>` sert le passage A/B de P8. Elle est portée par la COMMANDE déployée (donc visible dans
# le manifeste, donc attribuable au run, donc retirée avec la restauration), jamais par une variable de
# service — qui survivrait au passage et s'appliquerait en silence aux runs suivants.
set -eu

cd "$(dirname "$0")/../../../.."
OPS=apps/aggregator/scripts/ops
R=backups/lot4-20260909
COMMIT="${1:-}"; KEYS="${2:-}"; shift 2 || true
[ -n "$COMMIT" ] && [ -n "$KEYS" ] || { echo "usage: bounded-ingest.sh <commit-sha40> <keys,comma>"; exit 2; }

# La concurrence est extraite AVANT le préflight : le reste des arguments lui est transmis inchangé.
CONCURRENCY=""
STOP429=""
REST=""
for arg in "$@"; do
  case "$arg" in
    --concurrency=*) CONCURRENCY="${arg#--concurrency=}" ;;
    --stop-on-first-429) STOP429="--stop-on-first-429" ;;
    *) REST="$REST $arg" ;;
  esac
done
# shellcheck disable=SC2086
set -- $REST

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG="$R/p7-run-$STAMP"
mkdir -p "$LOG"
RUN_NAME="p7-bounded-ingest-$STAMP"

# L'empreinte du runner lui-même : ce qui a été exécuté doit être identifiable, pas seulement nommé.
RUNNER_SHA=$(cat "$OPS/bounded-ingest.sh" "$OPS/ingest-preflight.py" "$OPS/railway-service.py" | shasum -a 256 | cut -d' ' -f1)
echo "$STAMP runner=$RUNNER_SHA commit=$COMMIT keys=$KEYS concurrency=${CONCURRENCY:-défaut} stop429=${STOP429:-non}"

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
BOUNDED=$(python3 "$OPS/bounded-command.py" "$RUN_NAME" "$KEYS" $CONCURRENCY $STOP429)

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
# L'IDENTIFIANT EXACT du run qu'on vient de déclencher, capturé pendant qu'on l'observe. Le chercher plus tard
# « par nom » marcherait tant que rien ne se chevauche — et cesserait de marcher précisément quand ça compte.
RUN_ID=$(echo "$out" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo '')
echo "$RUN_ID" > "$LOG/pipeline-run-id.txt"
[ "$terminal" = "1" ] || { echo "run non terminal après 60 min : la commande N'EST PAS restaurée (un redéploiement le tuerait)"; exit 6; }
echo "$(date -u +%H:%M:%S) run terminal"

# ── 11 : restaurer la commande normale (donc retirer l'allowlist) ────────────────────────────────────────
restore_command

# ── état APRÈS + 12 : contrôles finaux ───────────────────────────────────────────────────────────────────
python3 "$OPS/db.py" readonly npx tsx "$OPS/ingest-facts.mts" --keys="$KEYS" --phase=after \
  --before="$LOG/before.json" --since="$STARTED" --command="$RUN_NAME" \
  --out="$LOG/after.json" > "$LOG/after.log" 2>&1
python3 "$OPS/read-crons.py" > "$LOG/crons-after.json" 2>&1 || true
# LE VERDICT TERMINAL du travail piloté — sans lui, un PipelineRun INTERRUPTED passait pour un succès
# (2026-09-13 : `problems: []` et `CODE_SORTIE=0` sur un run tué à 88,8 s par un déploiement concurrent).
VERDICT_ID_ARG=""
[ -n "$RUN_ID" ] && VERDICT_ID_ARG="--run-id=$RUN_ID"
python3 "$OPS/db.py" readonly npx tsx "$OPS/run-verdict.mts" $VERDICT_ID_ARG --command="$RUN_NAME" \
  --expect-command="$RUN_NAME" --expect-commit="$COMMIT" --expect-sources="$KEYS" \
  --out="$LOG/verdict.json" > "$LOG/verdict.log" 2>&1 || true
python3 "$OPS/railway-service.py" variables aggregator > "$LOG/variables-after.json" 2>&1 || true

python3 - "$LOG" "$COMMIT" "$KEYS" "$RUNNER_SHA" "$STARTED" "$FINISHED" "$STAMP" "${CONCURRENCY:-}" "${STOP429:-}" <<'PY'
import json, pathlib, sys
log, commit, keys, runner, started, finished, stamp, concurrency, stop429 = sys.argv[1:10]
d = pathlib.Path(log)
record = {
    'runName': f'p7-bounded-ingest-{stamp}',
    'commit': commit, 'keys': keys.split(','), 'runnerSha256': runner,
    # `null` = le défaut du CODE s'applique. On ne recopie pas « 4 » ici : le jour où le défaut change, un
    # enregistrement qui l'aurait figé mentirait sur ce qui a réellement tourné.
    'sourceConcurrency': int(concurrency) if concurrency else None,
    # La POSTURE 429 du run, enregistrée : un passage qu'on relit doit dire lui-même s'il se serait arrêté
    # au premier 429 ou s'il les a encaissés. Trois passages ont été décrits à tort comme « garde armée ».
    'stopOnFirst429': bool(stop429),
    'startedAt': started, 'finishedAt': finished,
    'preflight': json.loads((d / 'preflight.json').read_text()) if (d / 'preflight.json').exists() else None,
    'after': json.loads((d / 'after.json').read_text()) if (d / 'after.json').exists() else None,
    'cronsAfter': json.loads((d / 'crons-after.json').read_text()) if (d / 'crons-after.json').exists() else None,
    'variablesAfter': json.loads((d / 'variables-after.json').read_text()) if (d / 'variables-after.json').exists() else None,
}
v = record.get('variablesAfter') or {}
problems = []
# Le verdict terminal PRIME : la chaîne peut s'être parfaitement déroulée sur un run qui, lui, a été
# interrompu ou a échoué. Le succès du wrapper n'est pas celui du travail.
verdict_file = d / 'verdict.json'
verdict = json.loads(verdict_file.read_text()) if verdict_file.exists() else None
record['verdict'] = verdict
record['validForCapacity'] = bool(verdict and verdict.get('validForCapacity'))
record['pipelineRunStatus'] = (verdict or {}).get('pipelineRunStatus')
record['pipelineRunId'] = (verdict or {}).get('pipelineRunId')
record['sourceRuns'] = (verdict or {}).get('sourceRuns')
record['exitCode'] = (verdict or {}).get('exitCode')
record['invalidatedReason'] = (verdict or {}).get('invalidatedReason')
if verdict is None:
    problems.append('PIPELINE_RUN_NOT_FOUND : verdict terminal illisible')
else:
    problems.extend(verdict.get('problems') or [])
if v.get('INGEST_ONLY_KEYS'): problems.append(f"INGEST_ONLY_KEYS résiduel : {v['INGEST_ONLY_KEYS']}")
if v.get('REFRESH_ONLY_KEYS'): problems.append(f"REFRESH_ONLY_KEYS présent : {v['REFRESH_ONLY_KEYS']}")
for name, s in ((record.get('cronsAfter') or {}).get('services') or {}).items():
    if isinstance(s, dict) and s.get('cronSchedule') != '0 0 29 2 *':
        problems.append(f"cron dégelé sur {name} : {s.get('cronSchedule')}")
(d / 'record.json').write_text(json.dumps(record, indent=2))
print(json.dumps({'record': str(d / 'record.json'), 'validForCapacity': record['validForCapacity'],
                  'pipelineRunStatus': record['pipelineRunStatus'], 'problems': problems}, indent=1))
sys.exit(1 if problems else 0)
PY

echo "$(date -u +%H:%M:%S) terminé — journal $LOG"
