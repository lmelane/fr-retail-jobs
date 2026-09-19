#!/bin/sh
# LA COLLECTE MASSIVE, VAGUE PAR VAGUE, DEPUIS RAILWAY.
#
# Ce script s'exécute DEPUIS UN POSTE : il pilote Railway, il ne collecte pas lui-même. La collecte
# tourne dans le conteneur, là où l'adresse de sortie est celle qui a déjà collecté le catalogue.
#
# ── CE QU'IL FAIT, DANS CET ORDRE, POUR CHAQUE VAGUE ───────────────────────────────────────────
#
#   1. pose la commande bornée de la vague (`set-command`) et attend le redéploiement ;
#   2. déclenche l'exécution (`execute`) ;
#   3. attend que le catalogue se stabilise ;
#   4. CONTRÔLE LES INVARIANTS — et S'ARRÊTE si l'un d'eux est violé.
#
# Le point 4 est la condition d'arrêt demandée par le CEO le 18/09/2026 : « Si un défaut systémique
# du pipeline apparaît, STOP. Si une source particulière échoue ou qu'une offre est légitimement
# refusée, isole/documente le cas et poursuis. »
#
# Les invariants ne mesurent QUE la chaîne : une source en échec ou une offre refusée par un
# garde-fou ne les viole pas. Rien n'est forcé pour améliorer un taux de publication.
#
# ── USAGE ──────────────────────────────────────────────────────────────────────────────────────
#
#   DEPLOY_COMMIT=<sha40> VAGUES=<vagues.json> SORTIE=<dossier> \
#     sh apps/aggregator/scripts/ops/collecte-massive.sh [<première vague>]
set -eu

: "${DEPLOY_COMMIT:?DEPLOY_COMMIT (SHA de 40 caractères) requis}"
: "${VAGUES:?VAGUES (chemin du vagues.json) requis}"
: "${SORTIE:?SORTIE (dossier de journal) requis}"
DEPART="${1:-1}"
RACINE="$(cd "$(dirname "$0")/../../../.." && pwd)"
mkdir -p "$SORTIE"

TOTAL=$(python3 -c "import json;print(len(json.load(open('$VAGUES'))))")
echo "collecte massive — $TOTAL vague(s), départ à la vague $DEPART"

I="$DEPART"
while [ "$I" -le "$TOTAL" ]; do
  KIND=$(python3 -c "import json;v=json.load(open('$VAGUES'))[$I-1];print(v['kind'])")
  KEYS=$(python3 -c "import json;v=json.load(open('$VAGUES'))[$I-1];print(','.join(v['keys']))")
  N=$(python3 -c "import json;v=json.load(open('$VAGUES'))[$I-1];print(len(v['keys']))")
  echo ""
  echo "════ vague $I/$TOTAL · $KIND · $N source(s) · $(date +%H:%M:%S)"

  CMD="env -u BREVO_API_KEY -u GOOGLE_INDEXING_CREDENTIALS -u HEALTHCHECK_PING_URL EGRESS_PROBE=0 INGEST_ONLY_KEYS=$KEYS CAMPAGNE_INGEST=1 sh apps/aggregator/scripts/ops/campagne-railway.sh"
  # L'API Railway coupe parfois une requête sans raison durable (« Railway response unavailable or
  # invalid », vague 5 du 18/09/2026 à 22:47). Une coupure réseau n'est pas un défaut de la chaîne :
  # on réessaie trois fois avant de conclure. Un échec persistant, lui, arrête bien la collecte.
  T=0
  while [ "$T" -lt 3 ]; do
    if DEPLOY_COMMIT="$DEPLOY_COMMIT" python3 "$RACINE/apps/aggregator/scripts/ops/railway-service.py" \
      set-command aggregator "$CMD" > "$SORTIE/vague-$I-deploy.json" 2>&1; then break; fi
    T=$((T+1))
    echo "  set-command a échoué (tentative $T/3), nouvelle tentative dans 30 s"
    sleep 30
  done
  [ "$T" -lt 3 ] || { echo "  ⚠ set-command a échoué 3 fois — arrêt"; exit 1; }

  # Le redéploiement doit être SUCCESS avant l'exécution : `execute` refuse sinon, et cette
  # garde est précisément ce qui empêche de lancer le pipeline complet par accident.
  J=0
  while [ "$J" -lt 20 ]; do
    S=$(python3 "$RACINE/apps/aggregator/scripts/ops/railway-service.py" status aggregator 2>/dev/null \
      | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "?")
    [ "$S" = "SUCCESS" ] && break
    J=$((J+1)); sleep 30
  done
  [ "$S" = "SUCCESS" ] || { echo "  ⚠ déploiement $S — arrêt"; exit 1; }

  # Même traitement pour l'exécution : une coupure réseau ne doit pas arrêter 17 vagues.
  T=0
  while [ "$T" -lt 3 ]; do
    if DEPLOY_COMMIT="$DEPLOY_COMMIT" INGEST_KEYS="$KEYS" \
      python3 "$RACINE/apps/aggregator/scripts/ops/railway-service.py" execute aggregator \
      > "$SORTIE/vague-$I-exec.json" 2>&1; then break; fi
    T=$((T+1))
    echo "  execute a échoué (tentative $T/3), nouvelle tentative dans 30 s"
    sleep 30
  done
  [ "$T" -lt 3 ] || { echo "  ⚠ execute a échoué 3 fois — arrêt"; exit 1; }
  echo "  lancée"

  # Stabilisation : on attend que le nombre d'offres cesse de bouger deux relevés de suite.
  PREC=-1; STABLE=0; K=0
  while [ "$K" -lt 40 ]; do
    sleep 45
    CUR=$(python3 "$RACINE/apps/aggregator/scripts/ops/db.py" readonly npx tsx \
      "$RACINE/apps/aggregator/scripts/ops/invariants-collecte.mts" 2>/dev/null \
      | grep -oE 'catalogue : [0-9]+' | grep -oE '[0-9]+' || echo "")
    [ -z "$CUR" ] && { K=$((K+1)); continue; }
    if [ "$CUR" = "$PREC" ]; then STABLE=$((STABLE+1)); else STABLE=0; fi
    PREC="$CUR"
    [ "$STABLE" -ge 2 ] && break
    K=$((K+1))
  done
  echo "  catalogue : $PREC offre(s)"

  if ! python3 "$RACINE/apps/aggregator/scripts/ops/db.py" readonly npx tsx \
      "$RACINE/apps/aggregator/scripts/ops/invariants-collecte.mts" > "$SORTIE/vague-$I-invariants.txt" 2>&1; then
    echo "  ⚠ STOP — invariant violé, défaut systémique :"
    tail -14 "$SORTIE/vague-$I-invariants.txt"
    exit 1
  fi
  echo "  invariants ✓"
  I=$((I+1))
done

echo ""
echo "collecte massive terminée — $TOTAL vague(s)"
