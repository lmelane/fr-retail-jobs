# R-143 §2, §3 et garde du zéro annoncé — mesures à blanc (02/10/2026)

Décision : D-513 (backend `docs/governance/DECISIONS.md`), règle R-143. Production lue en **lecture seule**
(`db.py readonly`, psql), le 02/10/2026 entre 08:40 et 09:55 UTC, hors fenêtre du RUN. Aucune écriture.

| Fichier | Ce qu'il mesure |
|---|---|
| `disponibilite-a-blanc.sql` / `.out` | §2 : offres servies avant et après trois règles (A plafond 72 h, C relatif, B = C + A construite), par source, pays, Maison |
| `autorite-a-blanc.sql` / `.out` | §3 : offres que l'autorité de la source officielle fermerait, et les jumeaux WTTJ hors regroupement |
| `sonde-cibles.sql` | §2 : cibles de la sonde des liens « Postuler », témoins et périmètres d'accès (sortie JSON) |
| `sonde-a-blanc.mts` / `.json` | §2 : le code réel de la sonde sur un échantillon de ces cibles, sans écriture |

Rejouer : depuis le checkout qui porte les accès, `python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F" | " -f <fichier.sql>'`,
puis `npx tsx audits/2026-10-02/r143-disponibilite/sonde-a-blanc.mts <cibles.json>`.

## §2 Disponibilité

Servies avant : **86 547**. Après la règle construite (B) : **76 241**, soit **10 306 masquées** (11,9 %), dont 4 470 que
le plafond seul aurait laissées 1 à 3 jours de plus et 106 que seul le plafond masque (sources en pause : Marc O'Polo 35,
Swatch 26, Sioux 19, Fastrack 13, Miu Miu 7 ; Gemmyo 5, Chrome 1). Plafond seul (A, 72 h) : 5 836 masquées.
Relatif seul (C) : 10 200.

Les masquées par le relatif sont des offres que leur source, lue en entier, ne liste plus : H&M annonce et lit 1 935
offres et en garde 2 839 en stock ; Primark 909 pour 1 499 ; Ulta 9 926 pour 11 146 ; LVMH 5 986 pour 7 501. Une seule
source dépasse la garde de la moitié du stock (Gemmyo, 6 sur 11) : rien n'y est masqué par le relatif.

**Trous de couverture (R-143 §0, seuil 30 %)** :
- marchés : **Afrique du Sud 38,7 %** (70 sur 181 : Lovisa 28 sur 54, adidas 24 sur 42), **Hongrie 30,3 %** (40 sur 132 :
  H&M 37 sur 73) ; sous le seuil, la Slovaquie (60 %) et la Bulgarie (53 %) ne sont pas des marchés ouverts ;
- Maisons entièrement masquées : **Sioux 19, Fastrack 13, Miu Miu 7** (sources en pause, plafond), **PICARD 6** (source
  active qui ne les liste plus) ; **Marc O'Polo 70 %** (pause) ; Primark 39 %, H&M 32 %, On 36 %, Salomon 38 % (offres
  que la source ne liste plus). Liste complète : `.out`, D6.

## §3 Autorité

**16 offres** fermées au premier refresh après la migration (Richemont : `richemont-workday` GROUP_OFFICIAL a prouvé
leur fin, `richemont` ATS_OFFICIAL les montre encore). 0 par échéance seule. Les **14 offres WTTJ** dont le « jumeau »
officiel (autre offre, même Maison, intitulé et ville) est fermé ne partagent aucune identité avec lui : la règle ne les
touche pas (2 601 offres WTTJ servies).

## Sonde des liens « Postuler »

658 représentations seraient sondées (confirmées, non revues depuis 24 h) : Swatch 346, Diptyque 186, Browns 58,
Versace 49, Marc O'Polo 15. Échantillon de 64 : 22 ouvertes, 3 mortes (Swatch, 404, témoin ouvert), 39 non concluantes,
toutes hors du périmètre d'accès revu (Workday et Teamtailor : le périmètre couvre l'API, pas la page de l'offre).
Témoins des pages réelles du 02/10 : `apps/aggregator/src/pipeline/__fixtures__/apply-pages/`.
