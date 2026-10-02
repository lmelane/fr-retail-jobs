# R-143 §1 — fraîcheur de la découverte : mesure, coût par cadence, premier pas

> **Remplacé par D-517 (02/10/2026)** : [`../fraicheur-d517/`](../fraicheur-d517/README.md). La liste figée de 40 sources
> choisies par coût, la lecture complète, le budget de 45 minutes et les passes de 04, 10 et 22 UTC décrits ci-dessous ne
> sont plus le code : la passe lit toute source qui a du neuf sur 7 jours, en lecture incrémentale, cinq fois par jour.
> Les mesures de ce dossier restent valables pour leur date.

Production en lecture seule (`db.py readonly`), le 02/10/2026 entre 11:08 et 11:17 UTC, hors fenêtre du RUN. Tout se
rejoue depuis ce dossier :

| Fichier | Contenu |
|---|---|
| `mesure-sources.sql` → `.out` | M0 durée des 7 RUN ; M1 par source ACTIVE (7 RUN) : durée, collecte, écriture, requêtes, offres lues, créées ; M2 dernier RUN : requêtes capturées, octets, JSON/HTML ; M3 nouvelles offres/jour et délai par source ; M4 dénominateur |
| `mesure-stockage.sql` → `.out` | S0 taille de la base ; S1 ce qu'une collecte écrit (lignes, octets gzip nouveaux) |
| `projection-donnees.sql` → `offres.csv`, `collectes.csv` | 11 301 nouvelles offres (25/09 → 02/10, sources présentes avant le 24/09) et les collectes achevées par source |
| `projection.py` → `projection.out` | sélection des sources, coût par cadence, découverte projetée (modèle en tête du fichier, graine fixe) |
| `mutations.sh` → `.out` | les témoins de la passe passés au rouge en réintroduisant chaque défaut |
| `lvmh-sourcerun.sql` → `.out` | pourquoi LVMH est DEGRADED : une annonce de test retenue sur preuve de l'éditeur, énumération non déclarée |

## 1. Ce que coûte une collecte (mesuré)

- **Le RUN** : 91 à 253 min (médiane 127), fini entre 17:41 et **20:15 UTC** : la fenêtre 15:30-18:30 ne couvre pas
  sa fin, d'où le verrou sur `PipelineRun`. Somme des médianes par source : 111 186 requêtes, 81 338 offres réécrites,
  126 min d'écriture cumulée.
- **Deux familles de sources.** 242 sources (requêtes > offres lues / 2, `projection.out`) lisent environ une page par offre (Workday, SmartRecruiters,
  SuccessFactors, Phenom, WTTJ…) : H&M 3 815 requêtes par collecte, Tapestry 5 115, Knitwell 4 200. Une quarantaine lit
  toute sa liste en 3 à 128 requêtes d'API JSON (Teamtailor, Greenhouse, Lever, Recruitee, Algolia LVMH, Rituals).
- **Le coût dominant d'une source légère est l'écriture, pas le réseau** : chaque collecte réécrit chaque offre lue
  (lvmh : 43 s de collecte, 543 s d'écriture pour 6 240 offres ; 70 à 90 ms par offre).
- **Stockage** : base 29 Go, dont 15 Go de corps bruts (rétention chaude 14 jours). Une collecte légère dépose
  0,1 à 8,6 Mio gzip de corps nouveaux (lvmh 8,6), et une ligne `SourceExtraction` (~590 octets) par offre lue.

## 2. Coût par cadence et découverte projetée

Population : 1 514 nouvelles offres par jour. Lot retenu : la règle (≤ 200 requêtes et ≤ 1 requête pour 5 offres,
collecte toujours complète sur 7 RUN, statut OK, ≤ 10 min médianes, ≥ 1 nouvelle offre/jour) → 39 sources, plus LVMH
(128 requêtes, 97 nouvelles offres/jour, DEGRADED par une annonce de test retenue, `NATIVE_TEST_PUBLICATION=1`, et une
énumération non déclarée : `lvmh-sourcerun.out`). 40 sources, 326 nouvelles
offres/jour (22 %) ; une passe : 390 requêtes, 13 606 offres réécrites, 23 min en série, ~15 Mio gzip.

| Cadence (RUN à 16:00 UTC en plus) | Requêtes / jour | Offres réécrites / jour | Worker / jour | Médiane / p90, définition Indeed* | Médiane / p90, heure exacte** |
|---|---|---|---|---|---|
| RUN seul (aujourd'hui) | — | — | — | 17,3 h / 42,0 h | 7,8 h / 20,9 h |
| 2 fois par jour (00, 08) | +780 (+1 %) | +27 212 (+33 %) | 46 min | 17,0 h / 41,9 h | 6,5 h / 19,7 h |
| **toutes les 6 h (04, 10, 22)** | **+1 170 (+1 %)** | **+40 818 (+50 %)** | **69 min** | **17,0 h / 41,9 h** | **5,7 h / 19,7 h** |
| toutes les 4 h (00, 04, 08, 12, 20) | +1 950 (+2 %) | +68 030 (+84 %) | 116 min | 17,0 h / 41,9 h | 5,2 h / 19,7 h |
| option D : lot + 6 Maisons de luxe, toutes les 6 h | +7 827 (+7 %) | +44 064 (+54 %) | 93 min | 17,0 h / 41,9 h | 5,6 h / 19,6 h |
| *borne* : toutes les sources toutes les 4 h | +555 930 (+500 %) | +406 690 (+500 %) | 43 h | 5,3 h / 37,9 h | 2,0 h / 3,9 h |

\* `firstSeenAt − postedAt` sur toutes les offres datées, comme `comparaison-indeed/fraicheur-metriques.sql` (17,3 h /
41,9 h ; rejouée ici à 17,3 h / 42,0 h, population sans filtre `isActive`).
\*\* les 5 251 offres dont l'heure de publication est connue et postérieure à la collecte précédente : le seul délai
mesuré qui soit le délai de découverte. **Population biaisée** : les sources de la passe y pèsent 29 % contre 22 % de
l'ensemble, et Workday et SuccessFactors (Chanel, Richemont, Prada, Tapestry) n'y figurent pas, faute d'heure de
publication. Le chiffre qui vaut pour tout le catalogue est celui de la colonne précédente : 17,3 → 17,0 h, et 74,9 →
75,6 % d'offres vues en 24 h ou moins.

**Lecture.**
1. **La médiane de 17,3 h n'est pas d'abord un problème de cadence.** 40 % des dates de publication n'ont pas d'heure
   (minuit, ou minuit de Paris écrit 22:00 UTC) : publiée à 14:00 et vue à 16:00, l'offre compte 16 h. Le p90 de 42 h
   tient à des dates relatives converties en jour sans heure (Workday « Posted 3 Days Ago » : l'amas de 30 à 42 h) et à
   des dates antérieures à l'apparition (republications, Rituals 849 h médianes) : même la borne (toutes les sources
   toutes les 4 h) le laisse à 38 h. La définition Indeed ne peut pas descendre sous ~12 h tant que
   les dates restent sans heure.
2. **Sur tout le catalogue, la passe ne gagne presque rien** (17,3 → 17,0 h, +0,7 point d'offres vues en 24 h). Sur le
   délai réel (heure exacte, population biaisée ci-dessus), la passe de 6 h fait 7,8 → 5,7 h de médiane pour +1 % de requêtes, +50 %
   d'écritures d'offres et 69 min de worker par jour. Passer à 4 h ne gagne que 0,5 h pour 67 % de coût en plus.
3. **Le vrai levier est ailleurs** (`projection.out`, dernier bloc) : pour couvrir la moitié des nouvelles offres, il
   faut ajouter six sources, H&M, Ulta, Knitwell, Nordstrom, WTTJ et Tapestry (466 nouvelles offres par jour). Collectées
   en entier toutes les 6 h : 20 491 requêtes et 19 669 offres réécrites par passe, 83 min en série (+55 % de requêtes
   et +73 % d'écritures du RUN par jour). Avec une lecture incrémentale (la liste, puis le détail des seules offres
   inconnues) : ~1 100 requêtes par passe (estimation : une page de liste pour 20 offres). Délai projeté à 6 h : heure
   exacte 4,1 h de médiane, 13,2 h de p90 ; définition Indeed 14,2 h (les dates sans heure la plafonnent). C'est le lot suivant, plus lourd : une collecte qui ne relit pas
   tout ne doit jamais attester une absence ni réécrire une offre qu'elle n'a pas lue (une disposition « vue en liste
   seulement » dans le rapport scellé, adaptateur par adaptateur).

**Où est la valeur candidat.** Le catalogue agrégé n'est pas encore servi sur catwalks.io : l'effet direct est nul
aujourd'hui. La valeur passera par les alertes (D-498 : mardi et vendredi, ou jeudi selon le marché, 07:30 heure locale,
offres entrées depuis le dernier envoi) : une offre trouvée par la passe de 22:00 ou de 04:00 UTC part dans l'alerte du matin au lieu de la suivante,
soit 3 à 4 jours de gain. C'est l'indicateur à mesurer à l'activation, par Maison.

## 3. Cadence retenue et premier pas construit

**La cadence (toutes les 6 h, 04, 10, 22 UTC)** est fixée par l'assistant (D-513 la lui délègue). **Le périmètre ne
l'est pas** : la règle choisit les sources par leur coût, pas par l'importance de leurs offres. Les Maisons phares à
la collecte petite en absolu (Prada 547 requêtes, Rolex 459, Burberry 297, Valentino 162, Clarins 204, Swatch 550) en
sont exclues par le ratio requêtes/offres ; Lovisa et Rituals font un tiers du gain. Quelles Maisons méritent la
fraîcheur est une question du CEO, à poser avec l'activation (option D ci-dessus : +7 % de requêtes, ~32 nouvelles
offres de luxe par jour). Le lot construit le mécanisme avec les 40 sources de la règle ; la liste est une constante.

Cadence : toutes les 6 h sur les sources de la passe, plus le RUN : chaque source légère est observée toutes
les 6 h, la passe la plus proche du RUN finit avant 10:45, celle de 22:00 démarre après la fin la plus tardive mesurée
du RUN (20:15). Construit sur `development` (`src/pipeline/lightPass.ts`, `packages/runtime`), **inerte** : le cron du
worker reste `0 16,17 * * *`. L'activer, c'est le passer à `0 4,10,16,17,22 * * *` dans Railway, geste de production
sous GO (aucun nouveau service : Railway n'accepte qu'un cron par service, le même `scheduled` choisit RUN, passe ou rien).

Ce que fait la passe : l'étape exacte du RUN par source (`ingestOne` : accès, collecte scellée, écriture
dédoublonnée, `SourceRun`), rien après la boucle : le géocodage (carte, jusqu'à 2 000 appels) et la soumission à
Google (quota d'environ 200 par jour partagé avec le RUN, inactive en production faute de domaine configuré) restent au
RUN. Rien hors de sa propre lecture : ni refresh, ni revue de disponibilité, ni sonde, ni garde de masse, ni
Healthchecks, ni alerte e-mail ; sur les offres qu'elle lit, une fin déclarée par la source et les retraits natifs
s'appliquent, comme au RUN. Aucune de ses collectes ne sert de référence aux gardes du RUN (effondrement, droit
d'attester, crédibilité : `referenceRuns.ts`) : sinon une source tombée à 40 sur 100 à la passe, puis à 40 au RUN,
ne s'effondrerait plus. Refus dans la fenêtre 15:30-18:30 UTC, pendant un RUN ou une autre passe (`PipelineRun` sans
fin depuis moins de 12 h, revérifié avant chaque source) ; aucune source commencée à moins de 2 min de l'échéance
(45 min, jamais après 15:30 UTC), chacune bornée par ce qui reste (Railway saute un cron dont l'exécution précédente
tourne encore : une passe qui déborderait ferait sauter le RUN). Une nouvelle offre est servie à la fin de sa source et mise en file de la recherche
par les déclencheurs existants.

Témoins (`lightPass.test.ts`, `packages/runtime/test.mjs`) et preuve qu'ils échouent (`mutations.out`) : revue et
refresh ajoutés dans la passe → 1 rouge ; verrou du RUN retiré → 3 rouges ; revérification avant chaque source retirée →
1 rouge ; collecte de passe prise pour référence → 1 rouge ; une heure de passe à 16 UTC → 6 rouges. Un témoin couvre
aussi la collecte tronquée (non attestante, rien retenu, incident sans alerte e-mail).

## 4. Activer la cadence (geste de production, sous GO)

Le code est inerte : le worker garde `0 16,17 * * *`, et le mode `normal` de la release
(`~/.catwalks/release-agregateur-20261002-r5/release.py`, lignes 167-171) remet le cron sauvegardé avant la release,
donc `16,17`. Activer demande, dans cet ordre :
1. un commit sur `development` : `docs/operations/railway/runtime-target.json` (`dailySchedule.cronSchedule` →
   `0 4,10,16,17,22 * * *`, `executionModes.scheduled` et `concurrencyPolicy` qui décrivent les passes),
   `packages/runtime/test.mjs` (le témoin « inertes sous 0 16,17 » devient « passes à 4, 10, 22 sous le nouveau
   cron »), et les textes qui deviendraient faux : `apps/aggregator/README.md` (« ne lance le pipeline qu'à 18 h »),
   `docs/architecture/canary-operations.md` (« le mode normal utilise scheduled, à 18 h »), le `CLAUDE.md` du dépôt
   (« Le CRON chargé est 18 h, une fois par jour ») et l'événement `worker.schedule_skipped` (`requiredHour: 18`) ;
2. la CI verte, puis des images construites au nouveau contrat (`[runtime-images]`, le contrat est embarqué) ;
3. la release : images, puis le cron du worker réglé à `0 4,10,16,17,22 * * *` dans Railway (et le `check` de la
   release qui l'attend), jamais pendant le RUN ;
4. après la première passe : `PipelineRun` `ingest-light` COMPLETED, ses `SourceRun`, aucune retenue ni fermeture
   posée par elle, et le RUN suivant à l'heure.

**Lancement manuel** : dès que ce code est déployé, un `sh apps/aggregator/start.sh scheduled` lancé à la main à 04, 10
ou 22 h UTC déclenche une passe (avant, il sortait sans rien faire).

## 5. Écarts connus

- La passe réécrit chaque offre de ses sources (+50 % d'écritures d'offres par jour) : un écrivain qui saute l'offre
  inchangée diviserait ce coût, il n'existe pas.
- Les offres créées par une passe hors de la fenêtre de 6 h du RUN ne sont pas soumises à Google (inactive aujourd'hui) ;
  le rapport de santé (`healthReport.ts`) et la lecture de couverture en construction (`coverage/coverageReading.ts`,
  D-515 §5) lisent le DERNIER `SourceRun` d'une source, qui pourra être celui d'une passe.
- La liste des 40 sources est figée au 02/10 ; une source qui grossit ou passe en échec y reste jusqu'à relecture
  (le budget de 45 min et l'arrêt avant la fenêtre bornent le risque).
- Une passe en échec n'envoie pas d'alerte : elle reste visible dans `SourceRun` et `PipelineRun`, et le RUN suivant
  recollecte la source.
- Les dates sans heure et antérieures à l'apparition plafonnent la mesure Indeed ; l'indicateur de santé R-143 §9
  devrait lire l'écart entre deux collectes, par Maison (les offres « à heure exacte » ignorent Workday et
  SuccessFactors, donc les Maisons phares).
- Stockage : une ligne `SourceExtraction` (~590 octets) par offre lue, sans purge : ~24 Mo par jour à 6 h
  (13 606 × 3), en plus des ~15 Mio gzip de corps par passe (rétention chaude 14 jours).
- R-143 §1 reste **partiel** : environ 78 % des nouvelles offres (toutes les Maisons sur Workday, SuccessFactors,
  SmartRecruiters, Phenom) n'y gagnent rien sans la lecture incrémentale.
