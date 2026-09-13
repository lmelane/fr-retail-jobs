#!/bin/sh
# FUSIONNER SANS PERDRE LE CODE DE SORTIE — même modèle que run-bounded.sh.
#
# Première utilisation réelle de safe-merge.sh : `sh safe-merge.sh … | tail -3` puis `echo "code=$?"`. Le code
# lu était celui de `tail`. La fusion a réussi ce jour-là, mais l'invocation restait capable de présenter un
# refus comme un succès — exactement le défaut que la garde était censée éliminer.
#
# usage: run-merge.sh <journal.log> <numéro-de-PR> [args gh pr merge…]
set -eu
LOG="${1:-}"; shift 2>/dev/null || true
PR="${1:-}"; shift 2>/dev/null || true
[ -n "$LOG" ] && [ -n "$PR" ] || { echo "usage: run-merge.sh <journal.log> <PR> [args…]" >&2; exit 2; }
mkdir -p "$(dirname "$LOG")"
OPS="$(dirname "$0")"
set +e
sh "$OPS/safe-merge.sh" "$PR" "$@" > "$LOG" 2>&1
STATUS=$?
set -e
if [ -r "$LOG" ]; then tail -20 "$LOG"; else echo "journal illisible ($LOG) — code inchangé : $STATUS" >&2; fi
[ "$STATUS" -eq 0 ] || echo "ÉCHEC FUSION : code $STATUS — journal $LOG" >&2
exit "$STATUS"
