# Stockage de la base de production de l'agrégateur : ce qui consomme, à quelle vitesse, et la stratégie

*Mesures du 01/10/2026, 17:58 à 18:12 UTC, pendant le RUN (démarré à 16:00 UTC). Lecture seule, par
`apps/aggregator/scripts/ops/db.py readonly` (psql, `default_transaction_read_only = on`, délai de 25 s), sans parcours
lourd : catalogue Postgres, `TABLESAMPLE SYSTEM`, `pg_column_size` (qui ne décompresse pas le TOAST). Aucune écriture,
aucune suppression, aucun VACUUM. Les sorties brutes sont dans `resultats/`.*

**Unités.** Les Go de ce cahier sont décimaux (10⁹ octets). Postgres affiche des Gio : son « 27 GB » vaut 29,5 Go.
L'unité du volume Railway de « 50 Go » n'a pas pu être lue, faute d'identifiants Railway valides (`railway whoami` :
`Unauthorized`). La projection retient donc l'hypothèse prudente de 50 × 10⁹ octets, et donne aussi l'autre lecture.

**Statut des affirmations.**
- **EST** : mesuré ou lu dans le code à l'instant.
- **DÉCIDÉ** : consigné dans `DECISIONS.md`.
- **PROPOSÉ** : recommandation de ce cahier.
- **À ARBITRER** : décision du CEO.

---

## 1. EST : ce qui consomme

### 1.1 Le total

| | Octets | Source |
|---|---|---|
| Base `railway` à 17:58 | 29,47 Go | `01-catalogue.sql` |
| Base `railway` à 18:10 | 29,68 Go, soit +0,21 Go en 12 minutes de RUN | `10-catalogue-actif.sql` |
| WAL | 1,07 Go (64 segments) | `01-catalogue.sql` |
| Autres bases du serveur | 0,02 Go | `01-catalogue.sql` |
| **Occupé, hors fichiers temporaires** | **≈ 30,8 Go** | |

- Le WAL est **borné** : `max_wal_size` = 1 Go, aucun slot de réplication, `archive_mode = off`.
- **Fichiers temporaires** : 106 Go cumulés depuis le démarrage, avec `work_mem` = 4 Mo. Ils sont transitoires, mais un
  tri qui déborde sur disque occupe le volume pendant qu'il tourne.

Historique daté, lu dans les preuves des lots :

| Moment | Taille de la base |
|---|---|
| 08/09 | 1,42 Go |
| 15/09 22:14 | 3,05 Go |
| 16/09 01:40 | 7,40 Go |
| 01/10 18:10 | 29,68 Go |

Les preuves viennent de `audits/2026-09-08/deployment/production-after-migration.jsonl` et de
`audits/reprise-2026-09-15/preuves/lot-4*.json`. Les captures natives ont commencé le **18/09 à 10:28 UTC**.

### 1.2 Par table

Mesuré par `01-catalogue.sql`. Le TOAST est compté avec son index.

| Table | Total | Tas | TOAST | Index | Lignes | Part |
|---|---|---|---|---|---|---|
| `RawBlobBody` | **15,58 Go** | 0,37 | 15,03 | 0,18 | 1 474 085 | **52,9 %** |
| `SearchDocument` | 3,27 Go | 0,10 | 2,89 | 0,28 | 188 631 | 11,1 % |
| `SourceObservation` | 2,88 Go | 0,13 | 2,55 | 0,20 | 421 803 | 9,8 % |
| `Job` | 2,68 Go | 0,24 | 2,16 | 0,29 | 95 423 | 9,1 % |
| `JobSource` | 1,40 Go | 0,18 | 1,17 | 0,06 | 96 483 | 4,8 % |
| `RawCapture` | 1,18 Go | 0,82 | – | 0,35 | 1 211 797 | 4,0 % |
| `SourceExtraction` | 1,07 Go | 0,38 | – | 0,69 | 1 794 548 | 3,6 % |
| `RawBlob` (métadonnées) | 0,45 Go | 0,27 | – | 0,18 | 1 474 096 | 1,5 % |
| `OccupationObservation` | 0,35 Go | | | | 190 092 | 1,2 % |
| `EmployerObservation` | 0,29 Go | | | | 451 126 | 1,0 % |
| `PipelineEvent` | 0,16 Go | | | | 110 518 | 0,5 % |
| Toutes les autres | ≈ 0,16 Go | | | | | 0,5 % |

### 1.3 Ce que contient une ligne, et qui l'écrit

**`RawBlobBody` : les octets gzip de tout ce qui est capturé, adressés par empreinte SHA-256.**
- Écrivains :
  - `persistCapture` (`apps/aggregator/src/capture/store.ts:38-59`) écrit le corps natif de chaque réponse HTTP et
    l'enveloppe de la requête ;
  - `persistExtractionOutputs` (`store.ts:76-96`) écrit le JSON complet de chaque offre extraite (`NormalizedJob`,
    `raw` et description compris) ;
  - `storeRawBlob` (`store.ts:13-19`) écrit les manifestes (`manifest.ts:31`) et les rapports de fin d'ingestion
    (`completion.ts:63`).
- Un contenu identique n'est stocké qu'une fois (`ensureBlob`, `store.ts:21-36`).
- 1,47 M blobs, 14,28 Go de gzip, 68 Go une fois décompressés : le gzip divise par 5,5.

Répartition par nature, mesurée sur 5 % des blocs par `03-croissance.sql` :

| Nature | Part des octets | Taille moyenne gzip | Go |
|---|---|---|---|
| Réponses natives des sources (pages HTML, JSON d'ATS) | **82,0 %** | 16,4 Ko | 11,6 |
| Sorties d'extraction, une par offre et par tentative | 16,9 % | 3,8 Ko | 2,4 |
| Manifestes | 0,9 % | | 0,13 |
| Enveloppes de requête et rapports d'ingestion | 0,2 % | | 0,03 |

**Aucun corps n'a jamais été archivé** : `RawBlobArchive` compte 0 ligne (`11-purges-existantes.sql`).

**`SearchDocument` : la projection de recherche servie par l'API.**
- Écrite par `apps/api/lib/search-index.ts` (`initializeSearchIndex`, `drainSearchIndex`).
- Un document pèse 9,6 Ko : `document` (3,3 Ko) et `vector` (6,3 Ko).
- **Deux générations** coexistent : `search-4-20260924-v2`, non servie, et `search-5-20260924-v2`, servie. La
  génération servie est une constante compilée dans l'API : `SEARCH_VERSION` (`search-index.ts:12`).
- search-4 représente 0,97 Go de charge vivante, **≈ 1,7 Go de la table au prorata** (`09-generation-search4.sql`).
- **Sa file `SearchPending` grossit sans fin** : 23 047 lignes. Les déclencheurs mettent en file pour toutes les
  générations enregistrées (`packages/db/prisma/migrations/20260924120000_search_projection/migration.sql:31-33`), et
  personne ne vide celle de search-4.

**`SourceObservation` : une ligne par version distincte de la sortie d'adaptateur d'une publication.**
- Écrite par `observations.ts:17-21`, appelée par l'upsert à chaque offre de chaque RUN.
- `raw` pèse 5,6 Ko en moyenne, soit 2,3 Go vivants.
- 100 % des lignes échantillonnées portent leur JSON en ligne, aucune n'a de pointeur de blob, et toutes ont leur
  provenance de capture.

**`Job`, `JobSource` : le catalogue.**
- Par ligne de `Job` : `raw` 5,5 Ko, `searchVector` 3,6 Ko, `description` 2,7 Ko, `searchText` 2,7 Ko.
- Par ligne de `JobSource` : `raw` 5,5 Ko, `presentation` 4,1 Ko, `sourceFacts` 1,1 Ko.
- Le catalogue compte 90 404 offres actives sur 95 423 (`10-catalogue-actif.sql`).

**`RawCapture`, `SourceExtraction`, `RawBlob`, `CaptureBatch` : les métadonnées de preuve.**
- Taille par ligne : `RawCapture` ≈ 1 Ko (URL, en-têtes, empreintes), `SourceExtraction` ≈ 0,6 Ko (une ligne par offre
  et par tentative, y compris quand la sortie est identique), `RawBlob` ≈ 0,3 Ko.
- **Elles sont immuables par déclencheur** : aucune suppression n'est possible sur `RawBlob`, `RawCapture`,
  `CaptureBatch` et `CaptureOutcome` (`packages/db/prisma/migrations/20260915170000_native_capture/migration.sql:119-126`),
  ni sur `SourceExtraction`.

### 1.4 La même sortie d'adaptateur, stockée quatre fois

`05-doublons-raw.sql` compare les valeurs sur 524 publications échantillonnées :
- `Job.raw` est égal à `JobSource.raw` pour **516 sur 516** publications canoniques ;
- la dernière `SourceObservation.raw` est égale à `JobSource.raw` pour **521 sur 524** ;
- le même contenu figure aussi dans le blob de sortie d'extraction (`store.ts:79-84`).

Soit environ 3,35 Go vivants de copies :

| Copie | Go | Lecteur en production |
|---|---|---|
| `SourceObservation.raw` | 2,3 | Aucun. Seulement `sourceExpiry` et `raw-capture.mts`, deux scripts manuels (`observations.ts:26-31`) |
| `Job.raw` | 0,52 | **Aucun trouvé** dans l'API, l'agrégateur ou les déclencheurs SQL. À reconfirmer au lot |
| `JobSource.raw` | 0,53 | Lu par la déduplication d'identité Teamtailor, iCIMS et Workday, et par le déclencheur `invalidate_publication_presentation` (`migrations/20260915230000_publication_presentation/migration.sql:6`) |

### 1.5 Le gonflement

C'est l'espace mort ou libre, réutilisé par la même table mais pas rendu au volume (`02-composition.sql`) :

| Table | Fichier | Charge vivante | Écart | Activité depuis le démarrage |
|---|---|---|---|---|
| `Job` | 2,39 Go | ≈ 1,49 Go | ≈ 0,9 Go | 885 719 mises à jour |
| `SearchDocument` | 2,99 Go | ≈ 1,83 Go | ≈ 1,15 Go | 555 928 mises à jour, 80 592 suppressions (search-3) |
| `JobSource` | 1,35 Go | ≈ 1,03 Go | ≈ 0,3 Go | |

`02-composition.sql` affiche ces tailles en Mio (`pg_size_pretty`) ; elles sont converties ici en Go décimaux.

Les tables d'insertion seule (`RawBlobBody`, `RawCapture`, `SourceExtraction`, `SourceObservation`) n'ont pas de tuples
morts.

---

## 2. EST : la vitesse de croissance

### 2.1 Les corps bruts

Mesure exacte par `RawBlob.createdAt`, dans `03-croissance.sql`. Un blob n'est écrit qu'une fois et aucun n'a été
archivé, donc les octets gzip d'un jour sont les octets ajoutés ce jour-là.

| Jour | Blobs nouveaux | Gzip | Disque (× 1,09) |
|---|---|---|---|
| 24/09 | 124 105 | 1,39 Go | 1,52 Go |
| 25/09 | 115 637 | 1,17 Go | 1,28 Go |
| 26/09 | 112 036 | 1,15 Go | 1,25 Go |
| 27/09 | 82 219 | 0,81 Go | 0,89 Go |
| 28/09 | 117 125 | 1,19 Go | 1,30 Go |
| 29/09 | 86 520 | 0,83 Go | 0,90 Go |
| 30/09 | 180 327 | 1,93 Go | 2,10 Go |
| 01/10 à 18:03, RUN en cours | 116 159 | 1,16 Go | 1,27 Go |

- Le 30/09 cumule une collecte du matin (04:00 à 10:00 UTC) et le RUN (`04-horaire-run.sql`).
- Le facteur 1,09 est mesuré : taille réelle de `RawBlobBody` divisée par les octets gzip déclarés (en-têtes TOAST,
  index, tas).
- **La déduplication garde peu** : environ 57 % des réponses capturées chaque jour sont des octets jamais vus.

### 2.2 Toutes les tables

Moyenne des 7 derniers jours, du 25/09 au 01/10 :

| Poste | Par jour | Méthode |
|---|---|---|
| Corps bruts (`RawBlobBody`) | **1,28 Go** | exact |
| `SourceObservation` (≈ 35 000 versions par jour) | 0,22 Go | exact |
| `RawCapture` (≈ 100 000 captures) | 0,105 Go | 5 % des blocs, total recoupé à −1,8 % |
| `SourceExtraction` (≈ 140 000 sorties) | 0,088 Go | 5 % des blocs, recoupé à −3,8 % |
| `RawBlob` (métadonnées) | 0,04 Go | exact |
| Catalogue et recherche (≈ 2 380 offres nouvelles, deux générations) | ≈ 0,16 Go | exact sur les lignes, coût par ligne mesuré |
| `EmployerObservation`, `OccupationObservation`, `PipelineEvent` | 0,06 Go | exact |
| **Total** | **≈ 1,9 Go par jour de RUN** | |

**Recoupement indépendant** : la base est passée de 7,40 Go le 16/09 à 29,68 Go le 01/10, soit +22,3 Go pour 12 jours
de RUN. Cela donne 1,86 Go par jour de RUN.

### 2.3 La volatilité des observations

Sur 1 247 observations échantillonnées, 1 117 (90 %) ont une version précédente : chaque publication a en moyenne 4,3
versions en 13 jours. Les clés qui changent d'un jour à l'autre (`06-volatilite-observations.sql`) :

| Clé | Paires de versions | Sources |
|---|---|---|
| `detail` | 385 | 16 |
| `postedOn` | 246 | 10 |
| `postingEvidence` | 206 | 16 |

`postedOn` est émis par l'adaptateur Workday : c'est une date relative du type « Posted 3 Days Ago », qui change chaque
jour.

### 2.4 Projection de saturation

Hypothèse : 1,9 Go par jour, plus les 830 Mo de D-503 ce soir.

| Capacité | Libre après ce soir | Saturation | Seuil de prudence (5 Go libres) |
|---|---|---|---|
| 50 × 10⁹ octets | 50 − 29,68 − 1,07 − 0,83 = **18,4 Go** | **≈ 9,7 jours, vers le 11/10** | **vers le 08/10** |
| 50 Gio | 22,1 Go | ≈ 11,6 jours, vers le 13/10 | vers le 10/10 |

Un jour de requalification comme le 30/09 (+2,1 Go de corps) avance l'échéance. Postgres arrêté sur un disque plein,
c'est l'API arrêtée et le RUN en échec.

Le seuil de prudence couvre :
- les fichiers temporaires des tris ;
- la construction d'une génération de recherche (≈ 1,7 Go de plus pendant la bascule) ;
- les pics de WAL ;
- un éventuel `VACUUM FULL`.

---

## 3. POURQUOI chaque donnée est conservée

Il s'agit de lecteurs réels (fichier:ligne), et de ce que les décisions disent.

### 3.1 Ce que disent les décisions

**Aucune décision ne fixe de durée de rétention des captures brutes, ni n'autorise leur purge.**
- **D-435** (`catwalks-backend/docs/governance/DECISIONS.md:4727-4733`) demande de distinguer ce que la source a
  renvoyé et ce que le connecteur a extrait, puis : « Rétention maîtrisée, accès restreints ». Aucune durée.
- **D-453 §4** (`DECISIONS.md:3806-3810`) et **R-142** retirent une source « sans destruction des données brutes,
  conservées comme preuve ».
- **D-492** (`DECISIONS.md:710-712`) et **D-451** (`:3931-3932`) : toute opération destructrice de données reste hors de
  l'autonomie et vient au CEO avec sa sauvegarde préalable.
- La durée existe seulement dans le code et la doc technique :
  - `HOT_RETENTION_DAYS = 14` et `ARCHIVE_MINIMUM_MONTHS = 12` (`apps/aggregator/src/retention/retention.ts:7-9`) ;
  - `docs/architecture/native-capture.md:117-118` : « Fenêtre chaude de 14 jours », « Conservation distante d'au moins
    12 mois ».
- **D-488** (`DECISIONS.md:847-849`) : « search-3 est retirée ce soir ; search-4 est gardée jusqu'au lendemain après le
  RUN [du 01/10] […]. Chaque retrait reste confirmé au moment de l'exécuter. »
- **D-503** (`DECISIONS.md:54-55`) : chargement de GeoNames et des codes postaux, ≈ 830 Mo. **D-496** retient une base
  mondiale de villes.

### 3.2 Par catégorie

| Donnée | Qui la lit (code) | Ce qui est structurellement nécessaire, et combien de temps |
|---|---|---|
| **Manifeste, rapport de fin d'ingestion** (0,13 Go au total) | L'attestation d'absence lit seulement eux (`apps/aggregator/src/pipeline/attestingCapture.ts:133-135`). La dernière collecte admise peut dater de plusieurs jours si la source échoue | **Chauds en permanence.** Minuscules, et leur absence bloque toute fermeture par absence (refus `preuve scellée illisible`, `:136-138`) |
| **Enveloppes de requête** (0,03 Go) | Rejeu (`batch.ts:96`), périmètre d'accès (`sourceAccessEvidence.ts`) | Chaudes en permanence : coût négligeable |
| **Corps natifs de réponse** (11,6 Go gzip) | **En production, seulement le lot du jour** : publication de l'offre (`capture/publication.ts:22-28`), validation et rejeu de qualification (`capture/batch.ts:88-104`, tous les corps du lot), périmètre d'accès redérivé de la capture du jour (D-453). **Au-delà** : rejeu et audit par scripts manuels (`rejouer-depuis-raw.mts`, `raw-capture.mts`, `audit-corps.mts`…) | **Chauds : la journée du RUN, plus une marge (3 jours proposés).** Au-delà, la valeur est la preuve et le rejeu, lus rarement : leur place est une archive relisible. `readRawBlob` relit déjà l'archive quand le corps chaud manque (`store.ts:61-73`) |
| **Sorties d'extraction** (2,4 Go gzip) | Publication du jour (`publication.ts:22-26`). Le rejeu compare les empreintes sans lire les sorties (`manifest.ts:53-64`) | Comme les corps natifs |
| **`SourceObservation.raw`** (2,3 Go) | Aucun lecteur en production | **Pas nécessaire en double** : le même JSON est dans la sortie d'extraction pointée par `captureOutputId`. La ligne (empreinte, provenance) suffit à dire « cette version a été vue » |
| **`Job.raw`** (0,52 Go) | Aucun lecteur trouvé | Pas nécessaire en double |
| **`JobSource.raw`** (0,53 Go) | Déduplication d'identité, invalidation de la présentation | Nécessaire tant que ces deux lecteurs ne lisent pas une empreinte ou des clés d'identité extraites |
| **Métadonnées `RawCapture` / `SourceExtraction` / `CaptureBatch`** | Rejeu, attestation, audit | Récentes : oui. Anciennes : la preuve qu'elles portent doit survivre, pas forcément dans Postgres (export daté et haché). **La durée est à arbitrer** |
| **search-4** (≈ 1,7 Go) | Plus aucun : l'API sert search-5. Elle ne servait qu'au retour vers l'API d'avant la v3 (D-488) | **Plus nécessaire** après le RUN du 01/10, selon D-488. Le retour arrière de D-503 vise les images d'hier, qui servent search-5 |
| **Base de villes** (+0,83 Go ce soir) | Proximité et suggestions (D-496, D-499) | Nécessaire en entier selon D-496 (« base mondiale ») |
| **`SourceRun`** | Santé des sources | 10 jours, purgé (voir ci-dessous) |

---

## 4. EST : ce qui existe comme rétention ou purge

| Mécanisme | Planifié ? | Fonctionne ? |
|---|---|---|
| Élagage de `SourceRun` à 10 jours (`pipeline/health.ts:39`, `:591-599`, appelé à chaque RUN) | Oui | **Oui** : la plus ancienne ligne date du 22/09 21:57 (`11-purges-existantes.sql`) |
| Vidage de la file de la génération servie (`search-index.ts:87,91`, en continu dans l'API) | Oui | Oui pour search-5. **search-4 n'est vidée par personne** (23 047 lignes) |
| **Archive des corps vers un stockage S3** (`retention/retention.ts`, `retention/objectStore.ts`, `capture/store.ts:99-127`) | **Non** : script manuel `scripts/ops/retention.mts` (« No schedule is activated », ligne 1) | **N'a jamais tourné** : `RawBlobArchive` = 0 |
| Retrait d'une génération de recherche (`retireSearchGeneration`, `search-index.ts:148-158`) | Non : `apps/api/scripts/search/index.mts retire` | Utilisé pour search-3 le 30/09 |
| `PipelineEvent`, `SourceObservation`, `EmployerObservation`, `OccupationObservation`, `JobEvent` | Aucune purge | Plus anciennes lignes au 18/09 |

Pourquoi l'archive n'a jamais tourné (lu dans le code) :
1. **Aucune variable `OBSERVATION_ARCHIVE_S3_*` en production.** C'est vrai dans l'inventaire Railway du 23/09
   (`audits/2026-09-23/railway-runtime-inventory.json`) et confirmé par `RawBlobArchive` = 0 aujourd'hui.
2. **Le contrat d'exécution refuserait de démarrer un service portant des variables non déclarées**
   (`packages/runtime/index.mjs:70-73`, `unexpected environment keys`). Ajouter les variables sans les déclarer
   arrêterait le worker, donc le RUN.
3. **Le mode opératoire ne tient pas le volume.**
   - Un plan couvre au plus 1 000 blobs, porte sur des sources nommées et exige le hachage du plan relu
     (`retention.ts:15-16`, `:33-37`) : le stock demanderait environ 1 500 plans relus, et ≈ 116 de plus par jour.
   - L'archivage fait, par blob, un PUT, une relecture distante et une transaction (`store.ts:106-126`).
4. **La fenêtre chaude codée (14 jours) ne libérerait rien aujourd'hui.** Les captures datent de 13,3 jours :
   `RawBlobBody` plafonnerait vers 17 ou 18 Go.

Ce qui est solide et réutilisable :
- l'archive relit et vérifie chaque octet avant d'écrire le pointeur (`store.ts:106-108`) ;
- un déclencheur interdit de supprimer un corps sans pointeur d'archive vérifié (`native_capture/migration.sql:128-139`) ;
- le stockage n'expose aucune opération de suppression (`objectStore.ts:17`) ;
- le lecteur relit l'archive de façon transparente (`store.ts:61-73`) ;
- le transport a été validé sur un environnement Railway isolé (`docs/architecture/native-capture.md:3`, `:145`).

---

## 5. OPTIONS, chiffrées

Deux notions de gain :
- **« Interne »** : la place est rendue à la table et réutilisée par ses prochaines écritures. La croissance s'arrête,
  mais le volume ne baisse pas.
- **« Rendu au volume »** : il faut réécrire la table (`VACUUM FULL`). Cela pose un verrou exclusif pendant la
  réécriture et demande une place libre égale aux données gardées. `pg_repack` n'est pas disponible sur ce serveur.

| # | Option | Gain | Risque, ce qui casse si c'est mal fait | Réversibilité |
|---|---|---|---|---|
| **A** | **Retirer search-4** (D-488, déjà tranché, confirmation à l'exécution) | ≈ **1,7 Go interne**, arrêt de la file orpheline (23 000 lignes) | Bloque les écritures d'offres de 10 à 60 s : à faire hors du RUN. Plus de retour vers l'API d'avant la v3. Rendre la place au volume demande un `VACUUM FULL "SearchDocument"`, qui verrouille la table servie : recherche indisponible pendant la réécriture | Reconstruire search-4 demanderait l'ancienne API et une réindexation de plusieurs heures. En pratique irréversible, sans perte de donnée source |
| **B** | **Corps natifs et sorties d'extraction de plus de 3 jours vers un stockage objet**, en gardant chauds manifestes, rapports et enveloppes. La base garde l'empreinte, la taille et le pointeur | Aujourd'hui **≈ 9,5 Go de gzip, soit ≈ 10,3 Go de disque** (`07-retention-scenarios.sql` : 4,84 Go cités par les 3 derniers jours). Ensuite la table **plafonne vers 5 Go** et la croissance perd **1,28 Go par jour** | Variables non déclarées au contrat : le worker refuse de démarrer. Bucket indisponible : rejeu et audit des vieilles captures impossibles, mais pas de fausse fermeture, car l'attestation lit des preuves gardées chaudes. Les scripts de rejeu et d'audit doivent recevoir le stockage, sinon ils échouent sur un corps archivé. Bucket supprimé ou identifiants perdus : perte des preuves (un bucket versionné ou verrouillé est recommandé). `VACUUM FULL "RawBlobBody"` pendant le RUN : collecte bloquée | Réversible tant que le bucket existe : le corps se relit, et une recapture identique le réchauffe (`store.ts:31-34`) |
| B-7 | La même chose avec 7 jours chauds | ≈ 5,4 Go de gzip, ≈ 5,9 Go de disque ; plafond vers 10 Go | Idem | Idem |
| B-14 | La même chose avec 14 jours chauds (le code actuel) | **0 aujourd'hui** ; plafond vers 17 ou 18 Go | Idem | Idem |
| **C** | **Ne plus stocker les copies de la sortie d'adaptateur** : `SourceObservation.raw` (garder la ligne, l'empreinte et la provenance) et `Job.raw` | **≈ 2,8 Go** (2,3 + 0,52), et **−0,19 Go par jour** | Les scripts qui lisent `SourceObservation.raw` (`sourceExpiry`, `raw-capture.mts`) doivent lire la sortie d'extraction. Une observation sans `captureOutputId` perdrait son seul exemplaire : il y en a 0 dans l'échantillon, à recompter exactement avant. La mise à NULL de masse est une opération destructrice : GO du CEO, sauvegarde, par tranches hors RUN | Irréversible pour les valeurs effacées, mais elles restent dérivables du blob d'extraction tant qu'il est conservé |
| C' | `JobSource.raw` remplacé par les clés d'identité utiles et une empreinte | ≈ 0,5 Go | Touche la déduplication et le déclencheur de présentation : lot plus risqué | Comme C |
| **D** | **Réduire la volatilité** : ne pas faire d'une date relative (`postedOn` Workday), ou d'un champ `detail` qui bouge seul, une nouvelle version | Une part, **non mesurée par source**, des 0,22 Go par jour d'observations et des 0,2 Go par jour de sorties d'extraction | Change ce que l'adaptateur extrait : rejeu et témoins à refaire. Ne doit pas masquer un vrai changement d'offre | Réversible (code) |
| **E** | **Partitionner par mois les métadonnées de preuve et le journal**, et exporter les partitions anciennes, hachées, vers l'archive : `RawCapture`, `SourceExtraction`, `RawBlob`, observations, `PipelineEvent` | Plafonne **≈ 0,3 Go par jour** de lignes immuables, soit environ 110 Go par an au rythme actuel | Les déclencheurs d'immuabilité restent : on détache une partition, on ne supprime pas de ligne. La migration de tables de plus d'un million de lignes demande une répétition sur clone et une fenêtre hors RUN | Partitions exportées : réimportables |
| F | Rendre le gonflement (`VACUUM FULL` de `Job`, `SearchDocument`, `JobSource`) | ≈ 2,4 Go | Verrou exclusif sur les tables servies par l'API, et la place se reremplit avec les mises à jour | – |
| G | WAL | 0 : déjà borné à 1 Go, sans slot | – | – |
| H | Base de villes réduite aux 44 pays des marchés et aux langues de l'interface | **≤ 0,3 Go, une seule fois.** Les marchés couvrent 72,5 % des localités et 77 % des codes postaux. Les noms de `cities500` ne portent pas de langue | Contredit la « base mondiale » de D-496 : une offre hors marché perdrait son point | Rechargement |
| I | Agrandir le volume | Recule l'échéance | Ne change pas la pente de 1,9 Go par jour. Réversibilité (réduire un volume) à vérifier chez Railway | – |

---

## 6. RECOMMANDATION (PROPOSÉ)

### 6.1 Où vit chaque donnée

**Postgres, l'état chaud.** Sa taille doit suivre la taille du catalogue, pas le temps qui passe. Il garde :
- l'état courant : `Job`, `JobSource`, registre, décisions, une seule génération de `SearchDocument` (plus la précédente
  au plus 48 h pendant une bascule) ;
- la base de villes ;
- les empreintes, tailles et pointeurs de **tous** les blobs ;
- les manifestes, les rapports d'ingestion et les enveloppes de requête ;
- les corps et sorties des 3 derniers jours ;
- les métadonnées de preuve et le journal des N derniers jours, N à arbitrer.

**Stockage objet compatible S3, l'archive.** Il garde :
- les corps natifs et les sorties d'extraction au-delà de 3 jours ;
- les partitions exportées des métadonnées anciennes.

Le code attend déjà un stockage S3 (`objectStore.ts`). Trois fournisseurs possibles : Railway Buckets (transport déjà
validé), Cloudflare R2 ou AWS S3, de préférence en région UE. À 1x, l'archive grossit d'environ 0,4 To par an de gzip.
Aux tarifs publics de 0,015 à 0,023 $ par Go et par mois (à reconfirmer), cela fait quelques dollars par mois la
première année. zstd n'est pas un levier pour Postgres, qui ne propose que pglz ou lz4 pour le TOAST. Il deviendra
utile dans le bucket le jour où l'archive se mesurera en To : il faudra alors empaqueter par tentative de capture
plutôt que par blob.

### 6.2 Politique de rétention par catégorie (à arbitrer)

| Catégorie | Dans Postgres | Dans l'archive | Lecteurs |
|---|---|---|---|
| Manifestes, rapports, enveloppes | toujours | – | attestation d'absence, rejeu, périmètre |
| Corps natifs, sorties d'extraction | 3 jours | ≥ 12 mois, comme la doc technique ; durée à trancher | RUN du jour, puis rejeu et audit |
| `SourceObservation` | lignes sans `raw` | – (le JSON est dans la sortie d'extraction) | scripts manuels |
| `RawCapture`, `SourceExtraction`, `CaptureBatch`, observations, `PipelineEvent` | N jours (30 proposés) | export mensuel haché | rejeu, audit |
| `SourceRun` | 10 jours (existant) | – | santé |
| Génération de recherche non servie | ≤ 48 h après la bascule, retrait dans la procédure de release | – | – |

### 6.3 L'ordre proposé

1. **Ce soir ou demain, hors RUN** : option A. C'est la confirmation de D-488.
2. **Dans la semaine**, avant le seuil de prudence du 08/10 : option B en mode automatique. Cela suppose :
   - le bucket et ses identifiants ;
   - les variables déclarées au contrat d'exécution ;
   - une commande planifiée après le RUN, sans plan relu par lot, dont la garde reste le déclencheur « pas de
     suppression sans archive vérifiée » ;
   - le rattrapage du stock en parallèle ;
   - puis un `VACUUM FULL "RawBlobBody"` de nuit, pour rendre environ 10 Go au volume.

   Effet attendu : la croissance tombe d'environ 1,9 à environ 0,6 Go par jour.
3. **Lot suivant** : C, puis D. La croissance tombe vers 0,4 Go par jour.
4. **Avant 2 à 3 mois** : E. Postgres atteint alors un régime permanent proportionnel au catalogue (≈ 20 Go à 1x).
5. **Filet** : I, seulement si l'étape 2 n'est pas en production quand il reste moins de 8 Go (vers le 07/10).

### 6.4 Volume attendu à 10 fois plus d'offres et de sources

Hypothèse : ≈ 950 000 offres, ≈ 4 300 sources, ≈ 1 M captures par jour. Ce sont des ordres de grandeur.

| Poste | Aujourd'hui | 10x sans changement | 10x avec la stratégie |
|---|---|---|---|
| Corps bruts dans Postgres | 15,6 Go, +1,3 Go par jour | **+13 Go par jour : 50 Go pleins en 3 jours** | ≈ 13 Go (1 jour chaud) à 39 Go (3 jours) : à 10x, **1 jour chaud, ou écriture directe dans le bucket** |
| Catalogue et recherche | 7,4 Go (2 générations, `raw` en double) | ≈ 74 Go | ≈ 30 à 40 Go (1 génération, sans copies) |
| Métadonnées de preuve et observations | 5,6 Go, +0,5 Go par jour | +5 Go par jour | fenêtre de 14 jours ≈ 40 Go ; moins si les ré-attestations identiques passent au manifeste |
| **Postgres en régime permanent** | croît de 1,9 Go par jour | **croît d'environ 19 Go par jour** | **≈ 80 à 100 Go, stable, proportionnel au catalogue** |
| Archive objet | 0 | – | ≈ 4,7 To par an de gzip (moins avec un empaquetage zstd, à mesurer) |

---

## 7. DÉCISIONS À SOUMETTRE AU CEO (À ARBITRER)

Format carte de décision. Tous les chiffres sont mesurés ci-dessus.

**🔷 DÉCISION 1 — Exécuter le retrait de search-4 (D-488)**
- **Contexte** : search-4 occupe ≈ 1,7 Go, n'est plus servie depuis le 30/09 à 20:46, et sa file atteint 23 047 lignes
  que personne ne vide.
- **Options** :
  - **A.** Retirer après le RUN du 01/10, comme tranché par D-488. Le blocage des écritures d'offres dure de 10 à 60 s.
  - **B.** Attendre encore : la file continue de grossir.
- **Reco** : A, hors RUN. Le `VACUUM FULL` qui rendrait la place au volume se décide à part, car il coupe la recherche
  le temps de la réécriture.
- **Irréversible** : plus de retour vers l'API d'avant la v3.

**🔷 DÉCISION 2 — Archiver les corps bruts dans un stockage objet**
- **Contexte** : 15,6 Go, soit 53 % de la base, et +1,28 Go par jour. Aucun corps n'a jamais été archivé. Saturation
  vers le 11/10, seuil de prudence vers le 08/10.
- **Options** :
  - **A.** Bucket compatible S3 en UE, 3 jours chauds, archivage automatique après le RUN, archive ≥ 12 mois : gain
    ≈ 10 Go, puis −1,28 Go par jour.
  - **B.** 7 jours chauds : gain ≈ 6 Go.
  - **C.** 14 jours, comme le code actuel : 0 aujourd'hui.
  - **D.** Seulement agrandir le volume.
- **Reco** : A. C'est le seul levier qui casse la pente, et le mécanisme sûr existe déjà.
- **À trancher aussi** : le fournisseur (Railway Buckets, R2 ou S3), la durée d'archive, et l'archivage sans relecture
  humaine de chaque plan.
- **Irréversible seulement** si le bucket est supprimé.

**🔷 DÉCISION 3 — Supprimer les copies de la sortie d'adaptateur (`SourceObservation.raw`, `Job.raw`)**
- **Contexte** : 2,8 Go de JSON identique à la sortie d'extraction (521 sur 524 et 516 sur 516 publications), sans
  lecteur en production, et +0,19 Go par jour.
- **Options** :
  - **A.** Arrêter de l'écrire, puis effacer le stock par tranches, après sauvegarde.
  - **B.** Arrêter de l'écrire seulement : la croissance s'arrête, le stock reste.
  - **C.** Ne rien faire.
- **Reco** : B tout de suite, A après l'option B de la décision 2.
- **Destructif** : GO explicite requis (D-492).

**🔷 DÉCISION 4 — Durée de conservation des métadonnées de preuve dans Postgres**
- **Contexte** : `RawCapture`, `SourceExtraction`, `RawBlob`, les observations et `PipelineEvent` sont immuables et
  ajoutent ≈ 0,3 Go par jour, soit environ 110 Go par an. Aucune décision ne fixe de durée : D-435 dit « rétention
  maîtrisée », sans chiffre.
- **Options** :
  - **A.** 30 jours dans Postgres, puis export mensuel haché vers l'archive.
  - **B.** 90 jours.
  - **C.** Tout garder et agrandir le disque en continu.
- **Reco** : A. Elle se décide maintenant et s'implémente dans les 2 ou 3 mois.

---

## 8. Réconciliation (gouvernance)

| Écart | Classe |
|---|---|
| `HOT_RETENTION_DAYS = 14`, `ARCHIVE_MINIMUM_MONTHS = 12` (`retention.ts:7-9`, `native-capture.md:117-118`) sans décision | comportement existant non documenté par une décision : **question métier à arbitrer** (décisions 2 et 4) |
| Archive des corps écrite et documentée, jamais branchée : pas de planification, pas de variables, contrat d'exécution fermé | composant sans appelant en production |
| Retrait de search-4 tranché par D-488 pour le 01/10, non exécuté au moment de la mesure | décision validée non implémentée |
| `Job.raw` et `SourceObservation.raw` écrits sans lecteur de production, copies du blob d'extraction | comportement existant non documenté |
| D-503 annonce « 26 Go sur 50 » : 26 Gio, soit 27,9 Go, avant le RUN ; 29,7 Go à 18:10 | aucun écart de règle, différence d'unité à garder en tête |

## 9. Méthode, limites, rejeu

Les scripts, numérotés dans l'ordre de lecture :
- `01-catalogue.sql` : tailles, TOAST, index, tuples morts, WAL, slots ;
- `02-composition.sql` : taille par colonne et gonflement ;
- `03-croissance.sql` : croissance par jour et par table ;
- `04-horaire-run.sql` : heures d'écriture ;
- `05-doublons-raw.sql` : doublons de `raw` ;
- `06-volatilite-observations.sql` : clés qui changent ;
- `07-retention-scenarios.sql` : âge de la dernière référence et ensemble chaud ;
- `08-ensemble-minimal-detail.sql` : décomposition de l'ensemble chaud ;
- `09-generation-search4.sql` : search-4 ;
- `10-catalogue-actif.sql` : catalogue actif et taille instantanée ;
- `11-purges-existantes.sql` : les purges tournent-elles ?

`mesure-volume.sql` et `mesure-croissance.sql` sont les premières mesures de 18:00, gardées telles quelles.

Rejeu de chacun :

```
python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f audits/2026-10-01/stockage/<script>.sql'
```

Limites :
- Les estimations par `TABLESAMPLE SYSTEM` sont recoupées avec les comptes exacts :
  - captures : −1,8 % ;
  - sorties d'extraction : −3,8 % ;
  - octets par nature : 14,18 Go contre 14,28 Go exacts ;
  - âges : 14,43 Go.
- Le coût par ligne des nouvelles offres inclut le gonflement moyen : c'est un majorant.
- L'occupation réelle du volume Railway n'a pas été lue (identifiants Railway invalides). Elle peut dépasser la base et
  le WAL : fichiers temporaires, journaux du serveur.
- La journée du 01/10 était incomplète au moment de la mesure : le RUN était en cours.
- `db.py readonly` reste un garde-fou libpq, pas un rôle sans droit d'écriture (voir son commentaire) : les scripts ne
  contiennent que des `SELECT`.
