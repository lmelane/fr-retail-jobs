#!/bin/sh
# LANCER UN RUNNER BORNÉ SANS JAMAIS PERDRE SON CODE DE SORTIE.
#
# Le défaut, mesuré le 2026-09-13 : un préflight avait rendu `verdict: REFUS`, et l'appel extérieur terminait
# par `exited with code 0`. La garde avait parfaitement fonctionné — c'est l'INVOCATION qui a menti, parce
# qu'elle passait la sortie du runner dans `| tail -25` : le code d'un tube est celui de sa DERNIÈRE commande,
# et `tail` réussit toujours.
#
# Un refus qui se présente comme un succès est pire qu'une absence de garde : on croit avoir mesuré, on
# enchaîne sur l'étape suivante, et la mesure suivante porte sur un état qu'on n'a pas vérifié.
#
# Ce programme rend l'invocation dangereuse IMPOSSIBLE, au lieu de demander qu'on y pense :
#   · la sortie va dans un FICHIER, jamais dans un tube ;
#   · le code du runner est capturé immédiatement, avant toute commande de présentation ;
#   · l'affichage lit le fichier APRÈS coup — il ne peut donc plus masquer le code ;
#   · le code du runner est ré-émis tel quel.
#
# usage: run-bounded.sh <journal.log> <runner.sh> [args…]
# sortie: le code EXACT du runner. 0 = sain, non nul = refus ou échec.
set -eu

LOG="${1:-}"; shift 2>/dev/null || true
RUNNER="${1:-}"; shift 2>/dev/null || true
if [ -z "$LOG" ] || [ -z "$RUNNER" ]; then
  echo "usage: run-bounded.sh <journal.log> <runner.sh> [args…]" >&2
  exit 2
fi

mkdir -p "$(dirname "$LOG")"

# `set -e` ferait sortir le script AVANT qu'on ait pu lire le code : on le suspend le temps de l'appel, et on
# capture `$?` immédiatement. Aucune commande ne s'intercale entre le runner et la capture.
set +e
sh "$RUNNER" "$@" > "$LOG" 2>&1
STATUS=$?
set -e

# L'affichage vient APRÈS la capture : il ne peut plus remplacer le code de sortie.
if [ -r "$LOG" ]; then
  tail -30 "$LOG"
else
  echo "ATTENTION : journal illisible ($LOG) — le code du runner reste $STATUS" >&2
fi

if [ "$STATUS" -ne 0 ]; then
  echo "ÉCHEC : le runner a rendu $STATUS — journal complet dans $LOG" >&2
fi
exit "$STATUS"
