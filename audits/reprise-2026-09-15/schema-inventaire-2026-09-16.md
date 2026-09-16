# Audit du schéma — 16 septembre 2026 (lot F1)

Inventaire objet par objet du schéma agrégateur, avec pour chaque objet la **mesure** (volume, lecteurs, parcours d’index), la **décision** et la **preuve**. Outil rejouable : `audits/reprise-2026-09-15/scripts/schema-inventaire.mts` (`DATABASE_URL=<base> npx tsx … <sortie.json> [stats-prod.json]`), qui lit tables, colonnes, index, contraintes, déclencheurs, fonctions et rôles, compte chaque table exactement, joint `pg_stats` (taux de nul, distinct, largeur) et cherche chaque identifiant de colonne dans le code par classe (runtime, scripts, témoins, migrations, documentation), avec un drapeau « inconclusif » pour les noms génériques (`id`, `status`…).

## Bases lues

| Base | État | Lecture |
|---|---|---|
| Clone de répétition `catwalks_rehearsal_20260915` (copie de production, locale) | 77 migrations ; 43 tables, 518 colonnes, 153 index, 457 contraintes, 55 déclencheurs, 83 fonctions ; extensions `pg_trgm`, `plpgsql`, `unaccent` ; rôle `catwalks` en `plan_cache_mode = force_custom_plan` | 16/09 17 h 42 UTC, comptes exacts |
| Production Railway (base catalogue) | 44 migrations ; 28 tables, 105 index ; PostgreSQL 18.6 ; extensions `pg_trgm`, `plpgsql` ; statistiques depuis le 01/09 14 h 10 UTC | 16/09 17 h 40 UTC, transaction en lecture seule (`default_transaction_read_only`), URL jamais imprimée |

Volumes (clone, total avec index et TOAST) : `Job` 87 607 lignes / 2 351 Mo (dont `raw` 328 Mo, `description` 228 Mo, `searchText` 222 Mo) ; `DataCorrection` 28 907 / 2 882 Mo ; `JobSource` 90 764 / 847 Mo ; `MaintenancePlan` 4 205 / 715 Mo ; `SourceObservation` 141 933 / 653 Mo ; `OccupationObservation` 228 539 / 485 Mo ; `MarketSnapshot` 17 670 / 5 Mo. En production, sept index hors clés ne sont jamais parcourus depuis le 1er septembre : `OccupationObservation_jobId_createdAt_idx` (17 Mo), `Job_fingerprint_idx` (12 Mo), `GeoCache_resolved_idx`, `SourceFieldTrustObservation_trustId_recordedAt_idx`, `ObservationArchiveRef_archiveUri_idx`, `ObservationArchiveRef_observedAt_idx`, `ObservationArchiveManifest_createdAt_idx`.

Un premier passage de l’outil comptait les distincts de chaque colonne de `Job` par `count(DISTINCT …)` et a fait tomber le serveur du clone (fin de récupération propre, aucune écriture) ; la version conservée lit `pg_stats`.

## Décisions objet par objet

Convention : **retiré** = migration `20260916230000_f1_legacy_effectif` + code ; **conservé** = documenté ici avec sa raison ; **carte** = décision à trancher, rien n’est détruit.

### `Job`

| Colonne | Mesure | Décision |
|---|---|---|
| `isFrance` | écrite par `publication/content.ts` ; lecteurs : `geocodeJobs.ts`, `stats.ts`, invariant `france-filter` de `remediation/plan.ts`, projection de présentation ; l’API filtre sur `countryCode` ISO-2 depuis le lot 6 (100 % des offres publiables le portent) | **retirée** ; les trois lecteurs passent à `countryCode = 'FR'`, l’invariant `france-filter` (contradiction entre le drapeau et le code) n’a plus d’objet ; index `Job_isFrance_isActive_idx` et `Job_isFrance_isActive_latitude_longitude_idx` retirés |
| `adminArea2` | écrite `null` par `content.ts` et `dedup/repair.ts` ; aucune source ne la fournit (commentaire du schéma confirmé par `pg_stats`) | **retirée** (type `ResolvedGeography` et projection de présentation ajustés) |
| `inseeCode` | écrite `null` par `content.ts` ; seule écriture réelle par `geocodeJobs.ts` depuis `GeoCache.inseeCode` ; aucun lecteur | **retirée** de `Job` ; `GeoCache.inseeCode` conservé (clé du géocodage) |
| `occupationGroup` | dérivé du manifeste (`families[jobFunction].group`) ; écrit par `occupation/batch.ts` et `persist.ts` ; vérifié par le déclencheur `job_occupation_integrity` ; aucun lecteur hors persistance | **retirée** ; le moteur continue de le calculer (`OccupationDecision`), la persistance passe par `persistedOccupationDecision()` ; déclencheur et fonction `validate_job_occupation` réécrits sans le groupe |
| `occupationSpecializations` | dérivé des règles du manifeste (registre `specializations`, deux règles) ; aucun lecteur | **retirée** ; mécanisme conservé dans le manifeste et le moteur (contrat revu par `validateOccupationSuccessor`), consommateur futur = matching, hors phase |
| `isRetail` | `occupationGroup === "retail"` recopié ; aucun lecteur (le « Retail Hiring Index » n’a jamais eu de consommateur) | **retirée**, y compris du moteur |
| `isAiRelated` | heuristique IA (`normalize/taxonomy.ts`) + garde par société (`classifyJobs.ts`, appelée avant la photographie nocturne) ; aucun lecteur | **retirée** avec l’heuristique, la garde et leurs témoins |
| `skills` | `normalize/skills.ts` (dictionnaire fermé) via `classifyJob` ; aucun lecteur | **retirée**, module supprimé |
| `taxonomyVersion` | `TAXONOMY_VERSION = 4` écrit par `batch.ts` ; aucun lecteur (la version effective est `occupationReleaseId`) | **retirée** avec la constante |
| `fingerprint` | `cluster|titre` écrit par `content.ts` et par les trois chemins de réparation d’employeur (`owners.ts`, `portalOwner.ts`, `smcp.ts`), appliqué par le chemin rapide de `plan.ts` ; aucun lecteur ; index 12 Mo jamais parcouru en production | **retirée** ; le chemin rapide d’identité porte désormais `clusterKey, companyId` seuls |
| `seniority`, `jobFunction` | lus par l’API (facettes `metier`, filtre de séniorité), le moteur, les réparations | **conservées** (listées par l’instruction §3.5 ; lecteurs réels) |
| `raw` | 86 208 non nuls ; 7 594 offres sans aucune `SourceObservation` pour leur représentation canonique, dont 4 901 sans pointeur canonique | **conservée** comme preuve figée du stock historique : la retirer effacerait le seul RAW de ces offres (§4 : le RAW natif est la vérité) |
| `canonicalTier`, `canonicalSourceKey`, `canonicalExternalId` | lus par la présentation, la réparation de publication, l’API (origine) | **conservées** |
| `pipelineVersion` | génération de l’écrivain, sans valeur de fermeture (commentaire du schéma vérifié dans `refreshEvidence.ts`) | **conservée**, non incrémentée par ce lot (le contenu écrit ne change pas de sens, il perd des colonnes) |

### `Company`

| Colonne | Mesure | Décision |
|---|---|---|
| `atsConfig`, `lastAtsDiscoveryAt`, `lastJobSyncAt` | aucune occurrence dans le code | **retirées** |
| `fashionjobsSlug`, `fashionjobsOfferCount` | écrites seulement par `pipeline/discoverFashionJobs.ts` (`recordDiscoveredEmployer`), sans commande d’entrée aujourd’hui ; ce circuit est la **source de découverte d’acteurs réservée par décision propriétaire du 2026-09-11** (FashionJobs retiré comme source d’offres, gardé pour la découverte) et porte un témoin de conservation d’identité (`employer-identity.test.ts`) | **conservées** avec le circuit ; à trancher avec la stratégie de découverte des sources (F3/F4), pas par assimilation au vieux catalogue |
| `fashionjobsUrl` | clé naturelle unique de `Company` (valeurs `resolved:<clé>` pour les sociétés résolues) | **conservée** |

### Tables et objets

| Objet | Mesure | Décision |
|---|---|---|
| `MarketSnapshot` | 17 670 lignes (5 Mo) ; écrite chaque nuit par `refresh` en production (20 470 insertions, 2 800 suppressions depuis le 1er septembre) ; aucun lecteur (ni API, ni site, ni back-office) ; ses agrégats reposaient sur `isRetail` / `isAiRelated` | **écrivain retiré** (`pipeline/snapshot.ts`, commande `snapshot`, bloc post-refresh) ; **données conservées** ; carte : les lignes `live` sont « la vérité du moment, immuable », non reconstructibles → suppression de la table sur décision, en une ligne de migration |
| `OccupationObservation` | 228 539 lignes, journal append-only des décisions métier ; index `jobId, createdAt` jamais parcouru en production (17 Mo) | **conservés** (historique des décisions, §4) ; l’index reste tant qu’un lecteur d’historique par offre est prévu ; à revoir en F7 avec les mesures de charge |
| `DataCorrection` | 28 907 lignes, 2 882 Mo dont 1 169 Mo d’images « avant » et 1 410 Mo « après » ; les 3 645 lignes `PublicationGroupPlan` pèsent 2 451 Mo (705 Ko en moyenne) | **conservée** (décisions et historiques d’identité, §4) ; **règle à inscrire** : les plans de groupe doivent référencer leurs images (empreinte + pointeur vers la preuve) au lieu de les recopier — chantier F4 (stratégie de catalogue), pas un retrait |
| `SourceRun.canAttestAbsence` et colonnes de santé | informatives (registre, rapport de santé) ; les décisions d’absence viennent des captures (`refreshEvidence.ts`) | **conservées**, documentées comme rapport |
| `GeoCache_resolved_idx` | jamais parcouru en production ; `runGeocode` lit par `queryKey` | **retiré** |
| `pg_trgm` | ses deux index (`Job_searchText_trgm_idx`, `DirectOffer_searchText_trgm_idx`) ont été retirés par `20260916210100_recherche_vecteur_reprise` ; aucun opérateur trigramme dans le code | **retirée** en fin de chaîne (la chaîne de migrations continue de la créer puis de retirer ses index avant ce point) |
| `unaccent` | utilisée par `catwalks_normaliser_texte` | **conservée** |
| Colonnes tenues par SQL (`transactionId`, `recordedAt`, `verifiedAt`, `appliedAt`…) | valeurs par défaut et déclencheurs | **conservées** |
| Index restants jamais parcourus (`SourceFieldTrustObservation…`, `ObservationArchiveRef…`, `ObservationArchiveManifest…`) | tailles nulles, tables d’archive | **conservés** ; à revoir en F7 |

### Hors schéma, même lot

- `apps/api/lib/matching/vocabulaire.ts` et son témoin `vocabulaire-d421.test.ts` : aucun appelant de production ; **déplacés par Git** vers `docs/specs/matching/` (historique conservé, en-tête explicite), hors typecheck et hors suites ; le matching reste inchangé (prochain chantier).
- Chemin FashionJobs de découverte : conservé (voir `Company`).

## Migration `20260916230000_f1_legacy_effectif`

Ordre : fonction `validate_job_occupation` réécrite (famille cohérente avec le code métier, plus de contrôle du groupe) → déclencheur recréé sur `occupationReleaseId, occupationCode, jobFunction` → quatre index → dix colonnes de `Job`, trois de `Company` → `DROP EXTENSION IF EXISTS pg_trgm`. Rien n’est supprimé dans `MarketSnapshot`, `DataCorrection`, `OccupationObservation`, `Job.raw`. Appliquée depuis zéro (base jetable, 78 migrations) et sur le clone (voir `lot-f1.md`).

**Retour arrière** : cette migration est destructrice pour la révision Railway `dd3e24d` (qui lit `isFrance`, `fingerprint`, `isAiRelated`, `MarketSnapshot`) ; elle s’inscrit dans la stratégie de base parallèle du dossier de release (ancien couple image + base conservé), répétée en F6.

## Cache de présentation

`PRESENTATION_FIELDS` perd `isFrance`, `adminArea2`, `inseeCode`, `fingerprint` **sans changer `PRESENTATION_VERSION`** : `publicationContentOf` ne lit que les champs de la liste et n’étale jamais une clé inconnue, donc les présentations déjà calculées (55 125 sur le clone au lot 4H3) restent valides avec leurs quatre clés en trop. Un recalcul général n’est pas nécessaire ; le commentaire de la constante le dit.

## Ce que ce document ne prouve pas

- Le comportement de la révision Railway courante face à la base migrée : hors sujet ici, la stratégie de base parallèle l’isole.
- La valeur métier future des spécialisations et de l’historique `MarketSnapshot` : cartes de décision, pas des constats.
