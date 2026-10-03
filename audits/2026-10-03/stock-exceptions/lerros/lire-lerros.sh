#!/bin/sh
# D-522 §6 — lerros : ce que publie le portail Personio (flux XML lu par l'adaptateur, page publique) et la page carrières
# officielle de la Maison. Identité unique du robot, 1 s entre deux requêtes.
set -eu
UA='CatwalksBot/1.0 (+https://catwalks.io/bot)'; T=$(mktemp -d)
echo "== $(date -u +%FT%TZ)"
echo "-- robots lerros.jobs.personio.de :"; curl -s -A "$UA" --max-time 20 https://lerros.jobs.personio.de/robots.txt; sleep 1
for l in de en; do curl -s -A "$UA" --max-time 20 "https://lerros.jobs.personio.de/xml?language=$l" -o "$T/x.xml"
  echo "-- xml?language=$l : $(grep -c '<position>' "$T/x.xml") position(s) ; intitulés : $(grep -oE '<name>[^<]*</name>' "$T/x.xml" | head -1)"; sleep 1; done
curl -sL -A "$UA" --max-time 20 https://lerros.jobs.personio.de/ -o "$T/p.html"
echo "-- page publique : liens d'offre $(grep -oE 'href="/job/[0-9]+' "$T/p.html" | sort -u | tr '\n' ' ')"; sleep 1
echo "-- robots company.lerros.com (Disallow) :"; curl -s -A "$UA" --max-time 20 https://company.lerros.com/robots.txt | grep -E '^Disallow' | head -5; sleep 1
curl -sL -A "$UA" --max-time 20 https://company.lerros.com/de/karriere/jobs -o "$T/c.html"
echo "-- page carrières officielle : liens vers un ATS $(grep -oE 'href="https://[^"]*personio[^"]*"' "$T/c.html" | sort -u | tr '\n' ' ')"
rm -rf "$T"
