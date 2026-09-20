#!/bin/sh
# LA QUALIFICATION MASSIVE, VAGUE PAR VAGUE, DEPUIS RAILWAY.
#
# ── POURQUOI CE SCRIPT EXISTE, ET PAS `collecte-massive.sh` ────────────────────────────────────
#
# `collecte-massive.sh` decide quune vague est terminee quand le CATALOGUE cesse de bouger deux
# releves de suite. Cest correct pour une COLLECTE : elle ecrit des offres en continu, donc son
# immobilite signifie quelle a fini.
#
# Cest FAUX pour une QUALIFICATION. Une campagne passe lessentiel de son temps a capturer des
# preuves (robots.txt, page officielle, portail) sans ecrire une seule offre. Le catalogue reste
# donc immobile pendant toute cette phase, et le pilote conclut « terminee » au bout de 90 s.
# Il pose alors la vague suivante, ce qui REDEPLOIE le conteneur et TUE la campagne en cours.
#
# Mesure du 19/09/2026 : les vagues 5, 6 et 7 (dont LVMH, LOreal, Kering) ont ete tuees avant
# leur premier verdict. Les compteurs sont restes figes a 251 sources qualifiees pendant que
# quatre vagues consecutives semblaient « passer ».
#
# ── LA CONDITION DARRET CORRECTE ──────────────────────────────────────────────────────────────
#
# Une vague est terminee quand la campagne a rendu SES VERDICTS, cest-a-dire quand le journal du
# conteneur porte autant de lignes de verdict quil y avait de cles. On lit donc le journal, pas
# le catalogue. Si le compte nest pas atteint avant la limite, on le DIT et on passe : une vague
# incomplete est un fait a consigner, pas un silence.
#
# Les verdicts sont archives au fil de leau, parce que le journal dun deploiement disparait des
# que le suivant demarre.
#
# NOTE : pas dapostrophe typographique dans ce fichier, elle casse le shell.
#
# ── USAGE ──────────────────────────────────────────────────────────────────────────────────────
#
#   DEPLOY_COMMIT=<sha40> VAGUES=<vagues.json> SORTIE=<dossier> \
#     sh apps/aggregator/scripts/ops/qualification-massive.sh [<premiere vague>]
set -eu

: "${DEPLOY_COMMIT:?DEPLOY_COMMIT (SHA de 40 caracteres) requis}"
: "${VAGUES:?VAGUES (chemin du vagues.json) requis}"
: "${SORTIE:?SORTIE (dossier de journal) requis}"
DEPART="${1:-1}"
RACINE="$(cd "$(dirname "$0")/../../../.." && pwd)"
mkdir -p "$SORTIE"
VERDICTS="$SORTIE/verdicts.txt"
touch "$VERDICTS"
MOTIFS="QUALIFIEE|REFUSEE|INACCESSIBLE|NON_VALIDEE|NON_PROUVEE|DIVERGENT|MANQUANT|BLOCAGE|HORS_PARCOURS|RETIREE"

TOTAL=$(python3 -c "import json;print(len(json.load(open('$VAGUES'))))")
echo "qualification massive — $TOTAL vague(s), depart a la vague $DEPART"

# Combien de verdicts sont DEJA archives : le compteur est cumulatif dun bout a lautre de la
# campagne, et une reprise (`$DEPART` > 1) doit repartir du compte reel, pas de zero.
: > "$VERDICTS.brut"
RENDUS_AVANT=0

I="$DEPART"
while [ "$I" -le "$TOTAL" ]; do
  KEYS=$(python3 -c "import json;v=json.load(open('$VAGUES'))[$I-1];print(','.join(v['keys']))")
  N=$(python3 -c "import json;v=json.load(open('$VAGUES'))[$I-1];print(len(v['keys']))")
  echo ""
  echo "════ vague $I/$TOTAL · $N source(s) · $(date +%H:%M:%S)"

  CMD="env -u BREVO_API_KEY -u GOOGLE_INDEXING_CREDENTIALS -u HEALTHCHECK_PING_URL EGRESS_PROBE=0 INGEST_ONLY_KEYS=$KEYS CAMPAGNE_INGEST=1 sh apps/aggregator/scripts/ops/campagne-railway.sh"
  T=0
  while [ "$T" -lt 3 ]; do
    if DEPLOY_COMMIT="$DEPLOY_COMMIT" python3 "$RACINE/apps/aggregator/scripts/ops/railway-service.py" \
      set-command aggregator "$CMD" > "$SORTIE/vague-$I-deploy.json" 2>&1; then break; fi
    T=$((T+1)); echo "  set-command a echoue ($T/3)"; sleep 30
  done
  [ "$T" -lt 3 ] || { echo "  ⚠ set-command a echoue 3 fois — arret"; exit 1; }

  J=0
  while [ "$J" -lt 20 ]; do
    S=$(python3 "$RACINE/apps/aggregator/scripts/ops/railway-service.py" status aggregator 2>/dev/null \
      | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "?")
    [ "$S" = "SUCCESS" ] && break
    J=$((J+1)); sleep 30
  done
  [ "$S" = "SUCCESS" ] || { echo "  ⚠ deploiement $S — arret"; exit 1; }

  T=0
  while [ "$T" -lt 3 ]; do
    if DEPLOY_COMMIT="$DEPLOY_COMMIT" INGEST_KEYS="$KEYS" \
      python3 "$RACINE/apps/aggregator/scripts/ops/railway-service.py" execute aggregator \
      > "$SORTIE/vague-$I-exec.json" 2>&1; then break; fi
    T=$((T+1)); echo "  execute a echoue ($T/3)"; sleep 30
  done
  [ "$T" -lt 3 ] || { echo "  ⚠ execute a echoue 3 fois — arret"; exit 1; }
  echo "  lancee"

  # ATTENDRE LES VERDICTS, PAS LE CATALOGUE. Limite haute : 40 releves de 30 s, soit 20 minutes —
  # une campagne de 15 sources a pris 10 min au plus lors des vagues qui ont abouti.
  RENDUS=0; K=0
  while [ "$K" -lt 40 ]; do
    sleep 30
    python3 "$RACINE/apps/aggregator/scripts/ops/lire-logs-deploiement.py" "" 400 2>/dev/null \
      | grep -E "$MOTIFS" | cut -c12- >> "$VERDICTS.brut" || true
    sort -u "$VERDICTS.brut" -o "$VERDICTS.brut" 2>/dev/null || true
    # `grep -c` rend « 0 » ET sort en code 1 quand il ne trouve rien : un `|| echo 0` ajoute alors
    # un SECOND zero, et `[ "0\n0" -ge ... ]` echoue avec « integer expression expected ».
    # `wc -l` sur le flux filtre ne peut rendre qu un seul nombre, quel que soit le resultat.
    RENDUS=$(grep -E "$MOTIFS" "$VERDICTS.brut" 2>/dev/null | wc -l | tr -d ' ')
    ATTENDUS=$((RENDUS_AVANT + N))
    [ "$RENDUS" -ge "$ATTENDUS" ] && break
    K=$((K+1))
  done
  cp "$VERDICTS.brut" "$VERDICTS" 2>/dev/null || true
  NOUVEAUX=$((RENDUS - RENDUS_AVANT))
  if [ "$NOUVEAUX" -lt "$N" ]; then
    echo "  ⚠ vague INCOMPLETE : $NOUVEAUX verdict(s) sur $N attendus apres $((K * 30)) s"
  else
    echo "  $NOUVEAUX verdict(s) rendus"
  fi
  RENDUS_AVANT="$RENDUS"

  if ! python3 "$RACINE/apps/aggregator/scripts/ops/db.py" readonly npx tsx \
      "$RACINE/apps/aggregator/scripts/ops/invariants-collecte.mts" > "$SORTIE/vague-$I-invariants.txt" 2>&1; then
    echo "  ⚠ STOP — invariant viole, defaut systemique :"
    tail -14 "$SORTIE/vague-$I-invariants.txt"
    exit 1
  fi
  grep -oE "catalogue : [0-9]+ offre" "$SORTIE/vague-$I-invariants.txt" | head -1 || true
  echo "  invariants ✓"
  I=$((I+1))
done

echo ""
echo "qualification terminee — $TOTAL vague(s), verdicts dans $VERDICTS"
