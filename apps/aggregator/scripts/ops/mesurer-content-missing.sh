#!/bin/sh
# COMBIEN D'OFFRES ÉCHOUENT VRAIMENT, SOURCE PAR SOURCE — lecture seule.
#
#   sh apps/aggregator/scripts/ops/mesurer-content-missing.sh <fichier de sortie>
#
# ── LA QUESTION ────────────────────────────────────────────────────────────────────────────────
#
# 10 sources sont refusées sur CONTENT_MISSING, 5 401 offres en jeu. La validation exige que 100 %
# des offres d un lot soient relisibles : UNE seule annonce sans description fait echouer la
# source entiere.
#
# Mesure sur L Oreal : 1 692 relisibles sur 1 693 — une seule offre en cause. Si les neuf autres
# sont dans le meme cas, assouplir le seuil rend 5 401 offres. Si certaines echouent a 80 %, c est
# un defaut d adaptateur a corriger, pas un seuil a bouger. Les deux conclusions sont opposees, et
# seule la mesure les separe.
#
# NOTE : pas d apostrophe typographique dans ce fichier, elle casse le shell.
set -eu

SORTIE="${1:?fichier de sortie requis}"
RACINE="$(cd "$(dirname "$0")/../../../.." && pwd)"
SOURCES="hm-group bloomingdales-oracle douglas-sf kiabi dr-martens-tf burberry selfridges uniqlo-au-stores breitling-sf goyard-successfactors"

: > "$SORTIE"
for s in $SOURCES; do
  echo "══ $s" | tee -a "$SORTIE"
  python3 "$RACINE/apps/aggregator/scripts/ops/db.py" readonly npx tsx \
    "$RACINE/apps/aggregator/scripts/ops/rejouer-une-source.mts" "$s" 2>&1 \
    | grep -E "VERDICT|CONTENT_MISSING|READER_UNQUALIFIED|NATIVE_ID|IDENTITY|RAW_SCHEMA|DETAIL_|Error|absent" \
    | head -6 | tee -a "$SORTIE" || echo "   (echec de rejeu)" | tee -a "$SORTIE"
done
echo "" | tee -a "$SORTIE"
echo "mesure terminee" | tee -a "$SORTIE"
