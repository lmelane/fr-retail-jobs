#!/bin/sh
# FUSIONNER SANS TUER UN RUN EN COURS.
#
# L'incident du 2026-09-13 : `gh pr merge` lancé pendant que T2 collectait. La fusion déploie, le déploiement
# remplace le conteneur, le conteneur est tué — `SIGTERM`, `PipelineRun` INTERRUPTED à 88,8 s d'un run de
# quinze minutes, mesure perdue. Le même incident avait déjà coûté un run de validation en P7 (2026-09-09).
#
# Deux fois le même accident, deux fois la même cause : une règle de prudence qu'aucun mécanisme n'applique.
# « Faire attention » n'a pas fonctionné, et ne fonctionnera pas la troisième fois. Ce programme rend la
# fusion IMPOSSIBLE tant qu'un passage borné est en vol.
#
# usage: safe-merge.sh <numéro-de-PR> [args gh pr merge…]
# sortie: 0 si fusionné ; non nul si refusé (aucun déploiement déclenché).
set -eu

cd "$(dirname "$0")/../../../.."
OPS=apps/aggregator/scripts/ops
PR="${1:-}"; shift 2>/dev/null || true
[ -n "$PR" ] || { echo "usage: safe-merge.sh <numéro-de-PR> [args gh pr merge…]" >&2; exit 2; }

refuse() { echo "FUSION REFUSÉE : $1" >&2; echo "  aucun déploiement n'a été déclenché." >&2; exit 3; }

# 1. Un run que rien n'a terminé — le critère est `finishedAt IS NULL`, jamais le statut : un run tué net garde
#    un statut d'exécution et n'écrit jamais sa fin.
RUNNING=$(python3 "$OPS/db.py" readonly npx tsx "$OPS/running-pipeline-runs.mts" 2>/dev/null | grep -c '^RUNNING ' || true)
[ "$RUNNING" = "0" ] || refuse "$RUNNING run(s) de production en vol"

# 2. Une variable de périmètre encore posée = un passage borné en cours de préparation ou d'exécution.
VARS=$(python3 "$OPS/railway-service.py" variables aggregator 2>/dev/null || echo '{}')
echo "$VARS" | grep -q '"INGEST_ONLY_KEYS": null' || refuse "INGEST_ONLY_KEYS encore posé"
echo "$VARS" | grep -q '"REFRESH_ONLY_KEYS": null' || refuse "REFRESH_ONLY_KEYS encore posé"

# 3. La commande bornée encore déployée : le conteneur exécute autre chose que la commande normale.
CMD=$(python3 "$OPS/railway-service.py" status aggregator 2>/dev/null \
      | python3 -c "import sys,json;print(json.load(sys.stdin).get('startCommand',''))" 2>/dev/null || echo '')
case "$CMD" in
  *ONLY_KEYS*) refuse "commande bornée encore déployée sur l'aggregator" ;;
esac

# 4. Un runner local encore actif — le cas exact de l'incident : le run tournait depuis CE poste.
if ps ax | grep -qE '[b]ounded-ingest|[b]ounded-refresh|[i]ngest-preflight'; then
  refuse "un runner borné est encore actif localement"
fi

echo "aucun passage borné en vol — fusion autorisée"
gh pr merge "$PR" "$@"
