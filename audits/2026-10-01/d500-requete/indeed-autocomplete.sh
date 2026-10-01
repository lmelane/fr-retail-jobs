#!/bin/sh
# D-500 — Observation directe de l'autocomplétion publique d'Indeed (sans cookie, donc sans personnalisation).
# Usage : sh audits/2026-10-01/d500-requete/indeed-autocomplete.sh > audits/2026-10-01/d500-requete/resultats/indeed-autocomplete.txt
# `formatted=1` rend, pour chaque suggestion, la plage de caractères qui correspond à la frappe (`matches`).
quoi() { echo "== quoi $1 « $2 »"; curl -s -m 15 "https://autocomplete.indeed.com/api/v0/suggestions/what?country=$1&language=$3&count=10&formatted=1&query=$(printf %s "$2" | jq -sRr @uri)"; echo; }
lieu() { echo "== lieu $1 « $2 »"; curl -s -m 15 "https://autocomplete.indeed.com/api/v0/suggestions/location?country=$1&language=$3&count=10&formatted=1&query=$(printf %s "$2" | jq -sRr @uri)"; echo; }
date -u
for q in conseill conseillère conseillere CONSEILL conseillers vendeu "store man" "responsable bout" visual "make up" "sales ad" assistant directeur; do quoi FR "$q" fr; done
for q in "sales ad" "store man" "make up" visual assistant; do quoi GB "$q" en; done
for q in paris 75008 neuill; do lieu FR "$q" fr; done
