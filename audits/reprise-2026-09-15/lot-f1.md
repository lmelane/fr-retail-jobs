# Lot F1 — audit du schéma et retrait effectif du legacy

Bilan daté du **16 septembre 2026**. Instruction §3.5 : passer en revue chaque colonne héritée, retirer ce qui n’a plus de lecteur, sortir le vocabulaire de matching du runtime sans toucher au matching. Le détail objet par objet, avec mesures et preuves, est dans [schema-inventaire-2026-09-16.md](schema-inventaire-2026-09-16.md).

## Mesuré avant d’agir

- Clone de répétition (77 migrations) inventorié par un outil rejouable (`scripts/schema-inventaire.mts`) : 43 tables, 518 colonnes, 153 index, 55 déclencheurs, 83 fonctions, comptes exacts par table et usage de chaque colonne dans le code par classe (runtime, scripts, témoins, migrations, documentation).
- Production (44 migrations) lue en transaction lecture seule, URL jamais imprimée : 28 tables, 105 index, dont sept jamais parcourus depuis le 1er septembre (`Job_fingerprint_idx` 12 Mo, `GeoCache_resolved_idx`, `OccupationObservation_jobId_createdAt_idx` 17 Mo…) ; `MarketSnapshot` encore écrite chaque nuit (20 470 insertions) et jamais lue.
- Lecteurs réels de chaque colonne cherchés dans le code, pas dans les commentaires : `isFrance` n’avait plus que trois lecteurs internes (géocodage, statistiques, invariant de réparation) quand l’API filtre sur `countryCode` depuis le lot 6 ; `fingerprint` n’avait aucun lecteur mais quatre écrivains (publication et trois chemins de réparation d’employeur) ; `isAiRelated`, `skills`, `taxonomyVersion`, `isRetail`, `occupationGroup`, `occupationSpecializations`, `adminArea2`, `inseeCode` (sur `Job`) : écrits, jamais relus.

## Fait

| Objet | Décision | Où |
|---|---|---|
| Dix colonnes de `Job` (`isFrance`, `adminArea2`, `inseeCode`, `occupationGroup`, `occupationSpecializations`, `isRetail`, `isAiRelated`, `skills`, `taxonomyVersion`, `fingerprint`), trois de `Company` (`atsConfig`, `lastAtsDiscoveryAt`, `lastJobSyncAt`), quatre index, extension `pg_trgm` | **retirés** | migration `20260916230000_f1_legacy_effectif` ; `validate_job_occupation` et son déclencheur réécrits sans le groupe |
| Heuristique IA, garde IA par société, dictionnaire de compétences, `TAXONOMY_VERSION`, photographie de marché (`pipeline/snapshot.ts`, commande `snapshot`, bloc nocturne du `refresh`), invariant `france-filter` | **supprimés du code** avec leurs témoins (isAiRelated, extractSkills, snapshot, france-filter) | `normalize/taxonomy.ts`, `pipeline/classifyJobs.ts`, `cli.ts`, `lib/cliArguments.ts`, `remediation/plan.ts` |
| Décision métier persistée | `persistedOccupationDecision()` dans `@catwalks/db/occupations` : le moteur calcule toujours groupe et spécialisations depuis le manifeste, la persistance (`classifyJob`, `OCCUPATION_FIELDS`, SQL de `batch.ts`, sélections de `release.ts` et `classifyJobs.ts`) ne les écrit plus | `packages/db/occupation-engine.ts`, `occupation/*` |
| Géocodage, statistiques, scripts d’exploitation en SQL brut (`public-chain`, `snapshot` de couverture, `verif-couverture-registre`, `fashionjobs-exposure`) | `countryCode = 'FR'` à la place du drapeau | `pipeline/geocodeJobs.ts`, `pipeline/stats.ts`, `scripts/` |
| Chemins de réparation d’employeur | la correction d’identité porte `clusterKey, companyId` seuls (chemin rapide de `plan.ts` compris) | `remediation/owners.ts`, `portalOwner.ts`, `smcp.ts`, `identity/repair.ts` |
| Projection de présentation | quatre champs retirés de `PRESENTATION_FIELDS`, version inchangée : les caches existants restent valides (clés en trop jamais lues ni étalées), aucun recalcul des présentations | `packages/db/publication-presentation.ts` |
| Vocabulaire de matching D-421 | **déplacé par Git** (historique conservé) vers `docs/specs/matching/`, en-tête explicite, hors typecheck et hors suites ; matching et onboarding inchangés | `docs/specs/matching/vocabulaire.ts`, témoin à côté |
| `MarketSnapshot` (17 670 lignes) | **données conservées**, écrivain retiré ; carte de décision pour la suppression (lignes `live` non reconstructibles) | schéma commenté, dossier de décisions F8 |
| `fashionjobsSlug`, `fashionjobsOfferCount`, circuit de découverte FashionJobs | **conservés** : décision propriétaire du 2026-09-11 (source de découverte d’acteurs) et témoin de conservation d’identité ; à trancher avec la stratégie de découverte (F3/F4) | inchangés |
| `Job.raw`, `canonical*`, `seniority`, `jobFunction`, `OccupationObservation`, `DataCorrection`, `SourceRun.canAttestAbsence`, colonnes tenues par SQL, `unaccent` | **conservés**, raisons dans l’audit ; règle à inscrire en F4 : les plans de groupe de `DataCorrection` (2 451 Mo pour 3 645 lignes) référenceront leurs images au lieu de les recopier | audit du schéma |

Témoins réécrits plutôt que supprimés quand la règle survit : `taxonomy.test.ts` vérifie que `classifyJob` n’écrit plus les dérivés et que le groupe se relit depuis le manifeste ; `engine.test.ts` lit `occupationGroup` là où il lisait `isRetail` ; 29 fichiers de témoins ont perdu leurs semis `fingerprint` / `isFrance` (regex à motif fermé, diff relu ligne à ligne : uniquement des semis de `Job`).

## Correction du lot F0, trouvée par l’intégration

La reprise de la PR #160 (manifeste `catwalks-occupations-20260914-v2`) n’avait été validée que par les témoins purs. `pipeline/occupation.test.ts` exige la version embarquée comme ligne `OccupationRelease` de la base (seule la v1 y est insérée par migration ; la PR ne portait aucune migration, et l’activation crée elle-même la ligne, donc une migration d’insertion la casserait) et prenait « Optical Assistant » comme exemple d’ajout, désormais classé par la v2. Le témoin publie la version embarquée quand elle manque, exactement comme `activateOccupationRelease` (manifeste compilé, hash de ce manifeste), et prend « Gemstone Sorter » comme exemple en affirmant d’abord sa prémisse (`NO_RULE` sous la version active, clé absente du manifeste). Bilan F0 corrigé.

## Preuves

- Base jetable, migrée depuis son état 77 : 78 migrations, aucune des colonnes retirées, `Company` garde ses colonnes FashionJobs, extensions `plpgsql` + `unaccent`, index retirés absents, déclencheur recréé sur trois colonnes, `MarketSnapshot` présente.
- Clone de répétition, migré 77 → 78 le 16/09 : comptes identiques avant et après (`Job` 87 607, `MarketSnapshot` 17 670, `DataCorrection` 28 907, `OccupationObservation` 228 539, `Company` 1 622, `Job.raw` non nul 86 208), colonnes et index partis, extensions `plpgsql` + `unaccent`, `Job` à 2 211 Mo.
- Suite complète sur le checkout de vérification synchronisé (`lot6-full f1`, fichiers identiques au commit) : API **251 / 251**, unitaires **2 609 / 2 609**, intégration **762 / 762**, build de l’API vert. Typecheck vert.
- Premier passage rouge et corrigé, pour mémoire : un témoin API étalait la décision brute du moteur dans Prisma (`occupationGroup` inconnu) ; sept témoins d’occupation tombaient sur la version embarquée absente (correction F0 ci-dessus).

## Limites

- La migration est destructrice pour la révision Railway `dd3e24d` (elle lit `isFrance`, `fingerprint`, `isAiRelated` et écrit `MarketSnapshot`) : elle s’ajoute aux dix migrations déjà identifiées et s’applique par la stratégie de base parallèle du [dossier de release](release-2026-09-16.md), répétée en F6 ; rien n’est déployé.
- `DROP COLUMN` ne rend l’espace qu’au prochain `VACUUM` ; la taille de `Job` (2 351 → 2 211 Mo) reflète surtout les index retirés.
- Les cartes ouvertes par ce lot (suppression de `MarketSnapshot`, sort du circuit de découverte FashionJobs, bornage des images de `DataCorrection`) sont consignées pour le dossier F8 ; aucune donnée n’a été détruite en attendant.
