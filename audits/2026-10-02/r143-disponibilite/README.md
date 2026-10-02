# R-143 §2, §3 et garde du zéro annoncé — mesures à blanc (02/10/2026)

Décision : D-513 (backend `docs/governance/DECISIONS.md`), règle R-143. Production lue en **lecture seule**
(`db.py readonly`, psql), le 02/10/2026 entre 08:40 et 10:12 UTC, hors fenêtre du RUN. Aucune écriture.

| Fichier | Ce qu'il mesure |
|---|---|
| `disponibilite-a-blanc.sql` / `.out` | §2 : offres servies avant et après trois règles (A plafond 72 h, C relatif, B = C + A construite), par source, pays, Maison |
| `autorite-a-blanc.sql` / `.out` | §3 : offres que l'autorité de la source officielle fermerait, et les jumeaux WTTJ hors regroupement |
| `sonde-cibles.sql` | §2 : cibles de la sonde des liens « Postuler », témoins et périmètres d'accès (sortie JSON) |
| `sonde-a-blanc.mts` / `.json` | §2 : le code réel de la sonde sur un échantillon de ces cibles, sans écriture |
| `garde-zero.sql` / `.out` | garde du zéro annoncé : zéros annoncés historiques, stock par source |

Rejouer : depuis le checkout qui porte les accès, `python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F" | " -f <fichier.sql>'`,
puis `npx tsx audits/2026-10-02/r143-disponibilite/sonde-a-blanc.mts <cibles.json>`.

## §2 Disponibilité

Servies avant : **86 547**. Après la règle construite (B) : **76 684**, soit **9 863 masquées** (11,4 %), dont 4 127
que le plafond seul aurait laissées 1 à 3 jours de plus, et 224 que seul le plafond masque (Tapestry 186, dont la
collecte se déclare incomplète ; Nocibé 22, PICARD 6, Gemmyo 5, Kastner & Öhler 4, Chrome 1). Plafond seul (A) :
5 736 ; relatif seul (C) : 9 639. Les sources en **pause** (Swatch, Marc O'Polo, Versace, Sioux, Fastrack, Miu Miu…)
gardent leurs offres servies (D-485, D-493, D-506) ; aucun délai n'est lu à la requête : un RUN arrêté ne retire rien.

Les masquées par le relatif sont des offres que leur source, lue en entier, ne liste plus : H&M annonce et lit 1 935
offres et en garde 2 839 en stock ; Primark 909 pour 1 499 ; Ulta 9 926 pour 11 146 ; LVMH 5 986 pour 7 501
(`SourceRun` du 01/10, requêtes M2-M3 de la session, reprises en D4). Une seule source dépasse la garde de la moitié
du stock (Gemmyo, 6 sur 11) : rien n'y est masqué par le relatif.

**Trous de couverture (R-143 §0, seuil 30 %)** :
- marchés ouverts : **Afrique du Sud 38,7 %** (70 sur 181 : Lovisa 28 sur 54, adidas 24 sur 42), **Hongrie 30,3 %**
  (40 sur 132 : H&M 37 sur 73). Slovaquie (60 %), Bulgarie (53 %), Lituanie (39 %) ne sont pas des marchés ouverts ;
- Maisons : **PICARD 100 %** (6, source active qui ne les liste plus), Marni 71 %, Brilliant Earth 42 %, Primark 39 %,
  Salomon 38 %, On 38 %, H&M 32 %… 42 Maisons d'au moins 5 offres au-delà de 30 % (D6), toutes par des offres que
  leur source ne liste plus ou n'a plus revues depuis 72 h ;
- à venir : Diptyque (186) et Browns (58), sources actives en échec depuis le 30/09, passeront sous le plafond si
  leurs collectes ne reprennent pas.

## §3 Autorité

**16 offres** Richemont ont une fin prouvée par `richemont-workday` (GROUP_OFFICIAL, site « Richemont ») et restent
publiées par `richemont` (ATS_OFFICIAL, site « broadbean_external » du **même tenant Workday**) : deux canaux
officiels qui se contredisent. La règle construite ne les ferme pas (A1b : **0 fermeture aujourd'hui**) : elle ne fait
foi que contre un job board ou un agrégateur. Les **14 offres WTTJ** dont le « jumeau » officiel est fermé ne partagent
aucune identité avec lui (autre offre, même Maison, intitulé et ville) : hors de la règle (2 601 offres WTTJ servies).

## Garde du zéro annoncé

`garde-zero.sql` / `.out` : sur l'historique `SourceRun`, chaque zéro annoncé après un passé productif vient d'une
source de 1 ou 2 offres ; 232 sources ont au moins 20 représentations actives.

## Sonde des liens « Postuler »

658 représentations étaient sondables avant la reprise des seuils (confirmées, non revues depuis 24 h ; les sources en pause en font désormais partie) : Swatch 346, Diptyque 186, Browns 58,
Versace 49, Marc O'Polo 15. Échantillon de 64 : 22 ouvertes, 3 mortes (Swatch, 404, témoin ouvert), 39 non concluantes,
toutes hors du périmètre d'accès revu (Workday et Teamtailor : le périmètre couvre l'API, pas la page de l'offre).
Témoins des pages réelles du 02/10 : `apps/aggregator/src/pipeline/__fixtures__/apply-pages/`.
