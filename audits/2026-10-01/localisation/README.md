# D-496, D-499 : la recherche de proximité (mesures du 01/10/2026)

*Statut : construit sur `development`, non livré. Code et procédure : `apps/aggregator/scripts/geo/README.md`.*

Toutes les lectures de production sont des `SELECT` par `psql`, cible `readonly` de `db.py` ; aucune écriture en
production. Les bases locales sont jetables (conteneurs Postgres de l'image de la CI), supprimées après la mesure.

| Mesure | Script | Résultat |
|---|---|---|
| Le défaut (mesure d'origine) | `mesure-coordonnees.sql` | Chennevières-sur-Marne : 1 offre à son nom, 166 à moins de 10 km ; coordonnées : FR 97,3 %, US 37,6 %, GB 9,3 % |
| Couverture obtenue et justesse du rattachement : lieux des 93 288 offres de production (`export-offres-geo.sql`, lecture seule), rattachés sur base jetable avec la base de villes complète | `couverture-rattrapage.sql` | offres actives avec un point : 38,9 % → 89,9 % ; distance médiane entre coordonnées natives et ville rattachée : 0,6 km (FR), 3,6 km (US) ; `resultats/couverture-rattrapage-production-2026-10-01.txt` |
| Répétition du rattrapage (fonctions et scripts réels, mêmes lieux importés comme offres) | `apps/aggregator/scripts/geo/rattrapage-*.sql` | 83 431 offres écrites, 67 noms appris, second passage vide ; point écrit = point du déclencheur sur 5 000 offres (`resultats/coherence-declencheur-repetition-2026-10-01.txt`) ; `resultats/rattrapage-a-blanc-repetition-2026-10-01.txt` |
| Latence de la requête servie, avant (code de `development` avant le lot) et après, 15 recherches, 7 tours alternés, rejouée en production | `capture-proximite.mts`, `bilan-rejeu.py` | sans lieu : même requête, mêmes temps ; avec un lieu : égale ou plus rapide, sauf « conseiller de vente » à Chennevières-sur-Marne 220 → 250 ms (129 offres au lieu de 0) et le code postal 40 → 72 ms ; `resultats/latences-avant-apres-production-2026-10-01.txt` |
| Ce que les cercles retiennent après le rattrapage, par marché (même répétition) | `comptes-cercles.sql` | London : 8 offres au mot près → 1 579 à 15 km ; München 3 → 251 ; Milano 2 → 698 ; New York 2 696 (tout l'État) → 2 337 à 15 km ; `resultats/comptes-cercles-repetition-2026-10-01.txt` |
| D-499 : lieux, quartiers et codes postaux de GeoNames par pays des marchés | `couverture-lieux.py` | 40 pays sur 44 ont des codes postaux (sans : TW, GR, VN, SA ; HK n'en a pas) ; `resultats/couverture-lieux-par-marche-2026-10-01.txt` |
| Coût des déclencheurs du point pour le RUN (90 000 offres synthétiques, base de villes complète, déclencheurs désactivés puis actifs, tours alternés) | `cout-declencheur-preparer.sql`, `cout-declencheur-tour.sql` | 0,27 ms par offre nouvelle, rien pour une offre observée inchangée, 0,23 ms par offre déplacée ; `resultats/cout-declencheur-2026-10-01.txt` |
| Rattrapage en tranches et verrous (même base, 90 000 offres sans point, sonde d'écriture concurrente) | `apps/aggregator/scripts/geo/rattrapage-ecriture.sql` | écriture 104 s, attente concurrente 63 ms au plus ; chargement des villes 164 s sans verrou sur les offres ; `resultats/rattrapage-tranches-verrous-2026-10-01.txt` |
| Résolution d'une ville et suggestions (base de villes complète, base jetable) | `latence-villes.mts` | 2 à 14 ms, 38 ms au pire (« Bev » aux États-Unis) ; `resultats/latence-villes-base-jetable-2026-10-01.txt` |

## Limites

- La production n'a pas encore les colonnes `geo*` : la requête « après » y lit le point natif (`latitude`,
  `longitude`) et ne dispose pas de l'index de la boîte ; la France (97 % de points) est représentative, les autres
  marchés y comptent moins d'offres dans les cercles qu'après le rattrapage.
- Le rejeu par `psql` envoie un texte littéral (plan personnalisé) ; en production, Prisma prépare la requête, et le
  rôle de l'API force le plan personnalisé (`plan_cache_mode = force_custom_plan`, relu le 01/10/2026).
- La fonction `catwalks_lieu_cle`, absente de la production, est remplacée au rejeu par `catwalks_normaliser_texte` :
  elle ne s'y évalue que pour les offres sans point d'un filtre `ville`.
