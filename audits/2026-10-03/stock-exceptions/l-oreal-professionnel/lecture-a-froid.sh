#!/bin/sh
# D-522 §6 — UNE requête de liste, à froid, avec exactement les en-têtes du lecteur Avature (lib/http.ts : user-agent du robot,
# accept */*, accept-language *), après robots.txt. Exécutée une seule fois le 03/10/2026 à 06:25:38 UTC : ne pas la rejouer
# en boucle (politesse D-483 ; l'enquête D-516 montre que la 2e lecture rapprochée est refusée).
set -eu
UA='CatwalksBot/1.0 (+https://catwalks.io/bot)'
curl -s -A "$UA" --max-time 20 https://careers.loreal.com/robots.txt | grep -E '^(User-agent|Allow: /\*/jobs|Disallow: /\*/jobs)'
sleep 1
curl -s --max-time 20 -H "user-agent: $UA" -H 'accept: */*' -H 'accept-language: *' -D - -o /tmp/loreal-list.html \
  -w 'HTTP %{http_code} taille %{size_download}\n' 'https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=0' | grep -iE '^(HTTP|server|content-type)'
grep -oE "jobListRecordsTo'>[^<]*<[^>]*>[^<]*" /tmp/loreal-list.html | head -1
