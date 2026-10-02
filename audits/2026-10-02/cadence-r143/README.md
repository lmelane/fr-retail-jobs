# R-143 §1 — fraîcheur de la découverte : mesure, coût par cadence, premier pas

Production en lecture seule (`db.py readonly`), le 02/10/2026 entre 11:08 et 11:17 UTC, hors fenêtre du RUN. Tout se
rejoue depuis ce dossier :

| Fichier | Contenu |
|---|---|
| `mesure-sources.sql` → `.out` | M0 durée des 7 RUN ; M1 par source ACTIVE (7 RUN) : durée, collecte, écriture, requêtes, offres lues, créées ; M2 dernier RUN : requêtes capturées, octets, JSON/HTML ; M3 nouvelles offres/jour et délai par source ; M4 dénominateur |
| `mesure-stockage.sql` → `.out` | S0 taille de la base ; S1 ce qu'une collecte écrit (lignes, octets gzip nouveaux) |
| `projection-donnees.sql` → `offres.csv`, `collectes.csv` | 11 301 nouvelles offres (25/09 → 02/10, sources présentes avant le 24/09) et les collectes achevées par source |
| `projection.py` → `projection.out` | sélection des sources, coût par cadence, découverte projetée (modèle en tête du fichier, graine fixe) |
| `mutations.out` | les témoins de la passe passés au rouge en réintroduisant chaque défaut |

## 1. Ce que coûte une collecte (mesuré)

- **Le RUN** : 91 à 253 min (médiane 127), fini entre 17:41 et **20:15 UTC** : la fenêtre 15:30-18:30 ne couvre pas
  sa fin, d'où le verrou sur `PipelineRun`. Somme des médianes par source : 111 186 requêtes, 81 338 offres réécrites,
  126 min d'écriture cumulée.
- **Deux familles de sources.** 242 sources lisent environ une page par offre (Workday, SmartRecruiters,
  SuccessFactors, Phenom, WTTJ…) : H&M 3 815 requêtes par collecte, Tapestry 5 115, Knitwell 4 200. Une quarantaine lit
  toute sa liste en 3 à 128 requêtes d'API JSON (Teamtailor, Greenhouse, Lever, Recruitee, Algolia LVMH, Rituals).
- **Le coût dominant d'une source légère est l'écriture, pas le réseau** : chaque collecte réécrit chaque offre lue
  (lvmh : 43 s de collecte, 543 s d'écriture pour 6 240 offres ; 70 à 90 ms par offre).
- **Stockage** : base 29 Go, dont 15 Go de corps bruts (rétention chaude 14 jours). Une collecte légère dépose
  0,1 à 8,6 Mio gzip de corps nouveaux (lvmh 8,6), et une ligne `SourceExtraction` (~590 octets) par offre lue.

## 2. Coût par cadence et découverte projetée

Population : 1 514 nouvelles offres par jour. Lot retenu : la règle (≤ 200 requêtes et ≤ 1 requête pour 5 offres,
collecte toujours complète sur 7 RUN, statut OK, ≤ 10 min médianes, ≥ 1 nouvelle offre/jour) → 39 sources, plus LVMH
(128 requêtes, 97 nouvelles offres/jour, DEGRADED par sa seule annonce de test retenue). 40 sources, 326 nouvelles
offres/jour (22 %) ; une passe : 390 requêtes, 13 606 offres réécrites, 23 min en série, ~15 Mio gzip.

| Cadence (RUN à 16:00 UTC en plus) | Requêtes / jour | Offres réécrites / jour | Worker / jour | Médiane / p90, définition Indeed* | Médiane / p90, heure exacte** |
|---|---|---|---|---|---|
| RUN seul (aujourd'hui) | — | — | — | 17,3 h / 42,0 h | 7,8 h / 20,9 h |
| 2 fois par jour (00, 08) | +780 (+1 %) | +27 212 (+33 %) | 46 min | 17,0 h / 41,9 h | 6,5 h / 19,7 h |
| **toutes les 6 h (04, 10, 22)** | **+1 170 (+1 %)** | **+40 818 (+50 %)** | **69 min** | **17,0 h / 41,9 h** | **5,7 h / 19,7 h** |
| toutes les 4 h (00, 04, 08, 12, 20) | +1 950 (+2 %) | +68 030 (+84 %) | 116 min | 17,0 h / 41,9 h | 5,2 h / 19,7 h |
| *borne* : toutes les sources toutes les 4 h | +555 930 (+500 %) | +406 690 (+500 %) | 43 h | 5,3 h / 37,9 h | 2,0 h / 3,9 h |

\* `firstSeenAt − postedAt` sur toutes les offres datées, comme `comparaison-indeed/fraicheur-metriques.sql` (17,3 h /
41,9 h ; rejouée ici à 17,3 h / 42,0 h, population sans filtre `isActive`).
\*\* les 5 251 offres dont l'heure de publication est connue et postérieure à la collecte précédente : le seul délai
mesuré qui soit le délai de découverte.

**Lecture.**
1. **La médiane de 17,3 h n'est pas d'abord un problème de cadence.** 40 % des dates de publication n'ont pas d'heure
   (minuit, ou minuit de Paris écrit 22:00 UTC) : publiée à 14:00 et vue à 16:00, l'offre compte 16 h. Le p90 de 42 h
   tient à des dates antérieures à l'apparition de l'offre (republications, Rituals 849 h médianes) : même la borne
   (toutes les sources toutes les 4 h) le laisse à 38 h. La définition Indeed ne peut pas descendre sous ~12 h tant que
   les dates restent sans heure.
2. **Sur le délai réel (heure exacte)**, la passe de 6 h fait 7,8 → 5,7 h de médiane pour +1 % de requêtes, +50 %
   d'écritures d'offres et 69 min de worker par jour. Passer à 4 h ne gagne que 0,5 h pour 67 % de coût en plus.
3. **Le vrai levier est ailleurs** : les 15 premières sources « une page par offre » font 46 % des nouvelles offres
   (696/jour). Une lecture incrémentale (la liste, puis le détail des seules offres inconnues) coûterait ~1 100 requêtes
   de liste et ~170 détails par passe au lieu de 47 036. C'est le lot suivant, plus lourd : une collecte qui ne relit pas
   tout ne doit jamais attester une absence ni réécrire une offre qu'elle n'a pas lue (une disposition « vue en liste
   seulement » dans le rapport scellé, adaptateur par adaptateur).

## 3. Cadence retenue et premier pas construit

**Toutes les 6 h (04, 10, 22 UTC) sur les 40 sources légères**, plus le RUN : chaque source légère est observée toutes
les 6 h, la passe la plus proche du RUN finit avant 10:45, celle de 22:00 démarre après la fin la plus tardive mesurée
du RUN (20:15). Construit sur `development` (`src/pipeline/lightPass.ts`, `packages/runtime`), **inerte** : le cron du
worker reste `0 16,17 * * *`. L'activer, c'est le passer à `0 4,10,16,17,22 * * *` dans Railway, geste de production
sous GO (aucun nouveau service : Railway n'accepte qu'un cron par service, le même `scheduled` choisit RUN, passe ou rien).

Ce que fait la passe : l'étape exacte du RUN par source (`ingestOne` : accès, collecte scellée, écriture
dédoublonnée, `SourceRun`), puis géocodage et soumission des créées à l'indexation. Ce qu'elle ne fait jamais :
refresh, revue de disponibilité, sonde, garde de masse, Healthchecks, alerte e-mail. Refus dans la fenêtre 15:30-18:30
UTC, pendant un RUN ou une autre passe (`PipelineRun` sans fin depuis moins de 12 h, revérifié avant chaque source) ;
arrêt à 45 min ou à 15:30 UTC (Railway saute un cron dont l'exécution précédente tourne encore : une passe qui
déborderait ferait sauter le RUN). Une nouvelle offre est servie à la fin de sa source et mise en file de la recherche
par les déclencheurs existants.

Témoins (`lightPass.test.ts`, `packages/runtime/test.mjs`) et preuve qu'ils échouent (`mutations.out`) : revue et
refresh ajoutés dans la passe → 1 rouge ; verrou du RUN retiré → 3 rouges ; revérification avant chaque source retirée →
1 rouge ; une heure de passe à 16 UTC → 6 rouges.

## 4. Écarts connus

- La passe réécrit chaque offre de ses sources (+50 % d'écritures d'offres par jour) : un écrivain qui saute l'offre
  inchangée diviserait ce coût, il n'existe pas.
- La liste des 40 sources est figée au 02/10 ; une source qui grossit ou passe en échec y reste jusqu'à relecture
  (le budget de 45 min et l'arrêt avant la fenêtre bornent le risque).
- Une passe en échec n'envoie pas d'alerte : elle reste visible dans `SourceRun` et `PipelineRun`, et le RUN suivant
  recollecte la source.
- Les dates sans heure et antérieures à l'apparition plafonnent la mesure Indeed ; l'indicateur de santé R-143 §9
  devrait lire le délai sur les offres à heure exacte, ou sur l'écart entre collectes.
