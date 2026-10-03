#!/bin/sh
# D-522 §6 — lecture polie d'un site carrières Teamtailor : robots.txt, flux jobs.json (celui que lit l'adaptateur),
# page publique /jobs (ce que voit un candidat), sitemap. Identité unique du robot, 1 s entre deux requêtes.
# Usage : sh lire-teamtailor.sh https://career.fjallraven.com
set -eu
O=${1%/}; UA='CatwalksBot/1.0 (+https://catwalks.io/bot)'; T=$(mktemp -d)
echo "== $O ($(date -u +%FT%TZ))"
echo "-- robots.txt (lignes Disallow pour * et Content-Signal)"
curl -sL -A "$UA" --max-time 20 "$O/robots.txt" | grep -iE '^(user-agent|disallow|content-signal)' || echo "(vide)"
sleep 1
curl -s -A "$UA" -H 'accept: application/json' --max-time 20 "$O/jobs.json?per_page=100" -o "$T/f.json"
python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print('-- jobs.json : feed_url', d.get('feed_url'), '| items', len(d['items']), '| next_url', d.get('next_url'))" "$T/f.json"
sleep 1
R=$(curl -sL -A "$UA" --max-time 20 -w '%{http_code} %{url_effective}' "$O/jobs" -o "$T/p.html"); echo "-- page /jobs : HTTP $R"
H=$(echo "$R" | sed -E 's#^[0-9]+ https://([^/]+)/.*#\1#')
echo "-- liens d'offre sur la page : $(grep -oE 'href="[^"]*/jobs/[0-9]+[^"]*"' "$T/p.html" | sort -u | wc -l | tr -d ' ')"
grep -oE 'No open positions right now|Inga lediga tjänster just nu|Ingen ledige stillinger|Keine offenen Stellen' "$T/p.html" | head -1 | sed 's/^/-- texte affiché : /'
sleep 1
echo "-- sitemap https://$H/sitemap.xml : $(curl -s -A "$UA" --max-time 20 "https://$H/sitemap.xml" | grep -oE '<loc>[^<]*/jobs/[0-9][^<]*</loc>' | wc -l | tr -d ' ') URL d'offre"
rm -rf "$T"
