#!/bin/bash
# R-143 §4 — contre-épreuve native des fusions « réquisition SAP » : pour chaque fusion, la redirection de l'éditeur
# https://jobs.sephora.com/job-invite/<réquisition>/ doit mener à la publication RMK fusionnée. Une requête par fusion,
# espacée ; aucune écriture. Entrée : le fichier --fusions= de mesure-dedoublonnage.mts. Sortie : une ligne par fusion.
#   OK|<réquisition>|<id RMK>   ou   KO|<réquisition>|<id RMK attendu>|<redirection obtenue>
set -u
grep '"réquisition SAP' "$1" | python3 -c '
import json,sys
for line in sys.stdin:
    m=json.loads(line); l=[p for p in m["publications"] if p["sourceKey"]=="lvmh"]; r=[p for p in m["publications"] if p["sourceKey"]=="sephora-france"]
    if len(l)==1 and len(r)==1: print(l[0]["externalId"], r[0]["externalId"])
    else: print("MULTI", json.dumps(m["publications"]))' | while read req rmk; do
  if [ "$req" = MULTI ]; then echo "MULTI|$rmk"; continue; fi
  loc=$(curl -s -m 20 -A "Mozilla/5.0 (compatible; CatwalksBot/1.0; +https://catwalks.io)" -o /dev/null -w "%{redirect_url}" "https://jobs.sephora.com/job-invite/$req/")
  got=$(printf '%s' "$loc" | sed -E 's#.*/([0-9]+)/?$#\1#')
  if [ "$got" = "$rmk" ]; then echo "OK|$req|$rmk"; else echo "KO|$req|$rmk|$loc"; fi
  sleep 0.25
done
