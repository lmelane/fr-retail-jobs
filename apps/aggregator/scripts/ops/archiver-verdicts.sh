#!/bin/sh
# ARCHIVE LES VERDICTS DE CHAQUE VAGUE, AU FIL DE LEAU.
#
# `lire-logs-deploiement.py` ne voit que le deploiement COURANT : des que la vague suivante pose
# sa commande, les verdicts de la precedente deviennent illisibles. Une campagne de 10 vagues ne
# laisserait donc, a la fin, que les verdicts de la derniere, et le bilan serait impossible.
#
# Ce script interroge en boucle et accumule les lignes jamais vues. Lhorodatage varie dun appel a
# lautre pour une meme ligne : on le retire avant de dedoublonner, sinon chaque sondage rajouterait
# les memes verdicts sous un nouveau timestamp.
#
# NOTE : pas dapostrophe dans ce fichier. Une apostrophe typographique dans un commentaire a fait
# echouer le shell avec « unexpected EOF while looking for matching » a deux reprises.
#
#   SORTIE=<fichier> sh apps/aggregator/scripts/ops/archiver-verdicts.sh
: "${SORTIE:?SORTIE (fichier darchive) requis}"
RACINE="$(cd "$(dirname "$0")/../../../.." && pwd)"
MOTIFS="QUALIFIEE|REFUSEE|INACCESSIBLE|NON_VALIDEE|NON_PROUVEE|DIVERGENT|MANQUANT|BLOCAGE|HORS_PARCOURS|RETIREE"
: > "$SORTIE.brut"

while true; do
  python3 "$RACINE/apps/aggregator/scripts/ops/lire-logs-deploiement.py" "" 400 2>/dev/null \
    | grep -E "$MOTIFS" \
    | cut -c12- >> "$SORTIE.brut"
  sort -u "$SORTIE.brut" -o "$SORTIE.brut"
  cp "$SORTIE.brut" "$SORTIE"
  sleep 20
done
