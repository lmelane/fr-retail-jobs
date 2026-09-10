# Architecture actuelle et règles de livraison

Relecture du code : **10 septembre 2026**, révision `6ac43ec` et modifications locales de nettoyage. Ce document décrit l’implémentation et les procédures ; il ne certifie pas un déploiement ni la couverture mondiale. L’état de travail, les chiffres datés et les priorités restent dans le [README de l’agrégateur](../../apps/aggregator/README.md). Les règles détaillées d’identité sont dans [Identité des employeurs et des sources](../employer-identity.md).

## Organisation et autorité des données

Le projet est un monorepo modulaire : collecte dans `apps/aggregator`, interface et API dans `apps/web`, schéma et fonctions partagées dans `packages/db`. PostgreSQL porte le catalogue opérationnel, les offres et leurs historiques. Les workers et le web sont des processus séparés ; le code du dépôt ne démontre pas à lui seul leur capacité à absorber des millions d’offres.

| Sujet | Référence dans l’implémentation | Limite à respecter |
|---|---|---|
| Catalogue des sources | Table `Source`, [sourceStore.ts](../../apps/aggregator/src/connectors/sourceStore.ts) | Un CSV historique n’est pas l’état de production ; `ACTIVE` ne prouve pas une certification |
| Employeur canonique | `Company.id`, `canonicalKey`, alias et revues | Une source, un ATS, un groupe et une Maison sont des objets distincts |
| Représentation native | `JobSource`, identité `(sourceKey, externalId)` | Les IDs de deux tenants ne sont pas interchangeables |
| Offre canonique | `Job`, représentations associées, redirections et événements | Une fusion d’employeurs n’autorise pas automatiquement une fusion d’offres |
| Métier | [Moteur d’occupation](../../packages/db/occupation-engine.ts), releases dans [le schéma](../../packages/db/prisma/schema.prisma) | Un intitulé non reconnu reste une donnée à enrichir, pas une raison de supprimer l’offre |
| Contrat et rythme | `employmentTerm`, `workTime`, `programType`, `engagementType`, attributs associés | « Temps plein » et « CDI » ne sont pas la même dimension ; les labels sont distincts des valeurs internes |
| Secteurs | `Company.sectorCodes`, `SectorConcept`, revues de secteurs | Plusieurs secteurs par entreprise ; `Company.sector` et le CSV de Maisons subsistent dans des chemins historiques |
| Preuves et historique | `SourceObservation`, `EmployerObservation`, `JobEvent`, revues et `DataCorrection` | L’absence de preuve historique ne se répare pas en inventant une observation native |

Le [schéma Prisma](../../packages/db/prisma/schema.prisma) est la référence exacte pour les champs, relations et contraintes. Les nombres d’entreprises, adaptateurs ou migrations ne sont pas des constantes de cette documentation.

## Chemin d’une source et d’une offre

1. La recherche produit des candidats, avec provenance et preuves officielles. FashionJobs sert à découvrir des acteurs ; ce chantier n’autorise pas la collecte de ses offres.
2. [registerSourceCandidate](../../apps/aggregator/src/connectors/sourceCandidate.ts) crée une source nouvelle en `DRAFT`. Il vérifie la configuration, le kind et les collisions de tenant ; il ne certifie pas l’appartenance du portail.
3. La revue d’identité et les autres préconditions permettent une promotion explicite par `promoteSource`. Une source existante ne doit pas être écrasée ou réactivée par un import historique.
4. L’adaptateur énumère le flux mondial configuré. Les réponses, identifiants, rejets, détails manquants et limites doivent être mesurés. Un total déclaré par l’éditeur ne remplace pas une liste d’identifiants réconciliée.
5. Le pipeline conserve le RAW, résout l’employeur, normalise les dimensions puis écrit la représentation et l’offre canonique. Certaines erreurs d’identité ou retenues de publication bloquent l’admission et conservent des preuves : elles doivent rester visibles dans les écarts.
6. Les contrôles rapprochent les IDs natifs, les écritures en BDD et les résultats publics. Une collecte complète d’un flux ne prouve ni l’identité, ni tous les portails d’un groupe, ni la visibilité en front.

Le front lit l’ensemble mondial. **Aujourd’hui, la France utilise `isFrance` dans [jobs.ts](../../apps/web/lib/jobs.ts)** ; les autres pays passent par les correspondances de `countryCode`. Ne pas supposer que `isFrance=true` et `countryCode='FR'` sont deux comptages identiques sans les mesurer. Les compteurs et résultats doivent être comparés sur les mêmes filtres, IDs et instant.

Les valeurs inconnues restent explicites et investigables. Une date de découverte technique ne devient pas une date de publication native pour obtenir un balisage Google Jobs. La conservation d’une offre et son éligibilité au balisage sont deux contrôles distincts.

## Cycle de vie et concurrence

Les observations et événements servent à distinguer première détection, dernière observation, modification, fermeture, réouverture, retrait administratif et fusion. Un timeout, un 403 ou une indisponibilité de source ne prouvent pas une fermeture employeur.

Les [règles d’attestation](../../apps/aggregator/src/pipeline/attestation.ts) et les reçus `SourceRun` gouvernent le droit d’attester une absence. Le [nettoyage de génération](../../apps/aggregator/src/pipeline/purge.ts) passe par la désactivation des représentations ; la commande ancienne qui supprimait tous les jobs et entreprises a été retirée du CLI. Ne pas confondre ces deux mécanismes.

Les [verrous d’écriture](../../apps/aggregator/src/lib/writeLocks.ts) coordonnent les mutations concernées. Les redirections conservent les anciennes identités et URLs. La correction doit être répétée sur clone et vérifier les propriétés des lignes, pas uniquement l’égalité d’un total avant/après.

## Limites encore présentes dans le code relu

| Point | Constat actuel | Conséquence opérationnelle |
|---|---|---|
| Sources héritées | `loadActiveSources()` charge les lignes ACTIVE sans appeler le validateur strict d’identité | Ne pas lancer tout le catalogue en supposant toutes ses sources certifiées |
| Périmètre de portail | `certifiedPortalScope()` ne réexécute pas tous les contrôles de `assertIdentityReview()` | Âge, artefact et sujet doivent être unifiés avant une certification automatique générale |
| Mono-marque | Le résolveur peut rattacher un nouveau libellé explicite au propriétaire du portail | Une contradiction explicite ne doit pas être absorbée sans revue |
| Reporting | Les défauts de sélection des reçus et de configuration courante sont documentés dans le README | Ne pas présenter les anciens ratios comme une preuve actuelle |
| Livraison | Certains outils opérationnels sont encore privés dans `backups/` | Ne pas prétendre que toute la procédure est reproductible depuis Git seul |

Ces points sont documentés, pas corrigés par cette mise à jour de documentation. La lecture du code n’est pas une nouvelle mesure de leurs effets en production.

## Migrations, déploiement et reprise

**La liste de six migrations du document précédent était obsolète.** La procédure courante doit partir du répertoire complet [prisma/migrations](../../packages/db/prisma/migrations), du commit à livrer et de l’état réel de `_prisma_migrations`.

- Préparer sauvegarde, restauration et répétition des migrations/corrections nécessaires sur clone. Vérifier les lecteurs et writers compatibles, ainsi que la durée et les verrous des opérations.
- Appliquer les migrations par une opération de release contrôlée. Les éventuels hooks Railway sont une configuration externe à vérifier ; ce document n’affirme pas leur état actuel.
- Ne pas appliquer de DDL depuis un cron. [start.sh](../../apps/aggregator/start.sh) sort immédiatement si `PIPELINE_PAUSED=1`, sinon vérifie `prisma migrate status` puis exécute une commande autorisée. Il ne migre pas la base.
- Traiter séparément DDL, backfill et index concurrents lorsque le SQL le demande. Ne pas envelopper un `CREATE INDEX CONCURRENTLY` dans une transaction. Examiner un échec avant tout `migrate resolve` ; aucun baseline automatique.
- Ne pas déployer pendant un run. Un arrêt correctement marqué `INTERRUPTED` ne rend pas le run complet et ne transforme pas ses absences en fermetures.
- Vérifier les révisions réellement déployées, les migrations, les réponses publiques et les témoins du lot. Ne pas revenir à un writer incompatible avec les nouvelles identités admises en base.

La [readiness web](../../apps/web/app/api/health/route.ts) vérifie la BDD, les migrations attendues avec leurs checksums et des colonnes requises. Le contrat est injecté au build par [next.config.mjs](../../apps/web/next.config.mjs). Un HTTP 200 prouve cette disponibilité au moment du contrôle, pas la justesse des offres ni la couverture mondiale.

## Vérifications locales et rangement

Depuis la racine du dépôt :

```sh
npm run check:layout -w @catwalks/aggregator
npm run typecheck
npm run test:unit -w @catwalks/aggregator
npm run build:local -w @catwalks/aggregator
```

Les tests d’intégration utilisent une base de test dédiée ; plusieurs suites y modifient les données. Aucun test destructif sur une copie utilisée comme preuve ou sur la production. Le build local vérifie l’espace hôte/Docker avant de démarrer ; la capacité et les mesures de la machine sont documentées dans le README, pas dans une seconde fiche d’état.

Le code et les tests restent dans `src/`, les outils maintenus dans `scripts/`, les références et entrées explicites dans `data/`. Preuves datées dans `audits/`, RAW et sauvegardes privés dans `backups/`. Aucun rapport, classeur ou export ne doit recréer un dossier de travail à la racine ou dans `data/discovery`.

## Familles ATS rencontrées dans le LOT 4 — ce qui est établi, par quoi, et ce que les tests couvrent

Connaissance réutilisable entre Maisons : une nouvelle Maison sur une famille ci-dessous se configure (tenant / site / board / origine) et se prouve (page officielle → board exact, libellés natifs lus) **sans nouveau script**. « Documentation officielle » = la référence publique de l'éditeur a été lue ; « observation » = comportement établi sur les réponses réelles archivées (reçus natifs, fixtures de test). Les tests cités sont ceux du dépôt (`apps/aggregator/src/ats/adapters/*.test.ts`).

| Famille (kind) | Établi par | Ce qui est établi | Tests (pagination · plafonds · détails · dates · statuts · erreurs) | Limites connues |
|---|---|---|---|---|
| **Workday** (`workday`) | observation de l'API CXS (`/wday/cxs/<tenant>/<site>/jobs`, détail `/job/<path>`), aucune documentation publique | pagination `offset`/`limit` ; le `total` peut être un **plafond** (Tapestry : 2 000 annoncées, 2 085 réelles) → partition par facette (`partitionFacet`) et attribution native par valeur de facette ; l'employeur vient du détail (`logoImage.alt` nettoyé, puis `hiringOrganization` sans code d'entité) ; enseigne par préfixe de lieu (`brandFromLocationPrefix`) ; dates relatives (« Posted 3 Days Ago », « 30+ » = plancher, jamais une date) ; `timeType`, `endDate`, `country` lus en `en-US` ; un détail sans employeur ou non lu = **retenue**, jamais l'employeur du groupe ; lignes sans `externalPath` = rejetées avec motif | `workday.test.ts` (19 : chemin, logo alt, entité, dates, lieux, détail, retenues), `workday.partition.test.ts` (5 : plafond, facettes, chevauchement, repli), `workday.locationPrefix.test.ts` (3 : 747 lignes réelles) | pas de facette de marque sur certains tenants de groupe (VF) → offres sans employeur tenues ; alt de logo parfois un nom de fichier (`_LOGO300x300`, traité) |
| **Greenhouse** (`greenhouse`) | documentation officielle du Job Board API (`boards-api.greenhouse.io/v1/boards/<board>/jobs?content=true`) + observation | un document, sans pagination ; `location.name` = ville nue ; le pays vient de `offices[].location` quand l'adresse est remplie ; `first_published` = date de publication (pas `updated_at`) ; aucun libellé employeur natif (le board est celui de la Maison) | `greenhouse.test.ts` (3 : pays depuis le bureau, jamais depuis la ville, fixture réelle On) | pays absent quand le bureau n'a pas d'adresse (On : 218/309) — limite de la donnée publiée, vérifiée sur la réponse brute |
| **Lever** (`lever`) | documentation officielle des Postings (`api.lever.co/v0/postings/<site>?mode=json&skip&limit`, région `eu`) + observation | pages de 100, fin sur page courte ; page répétée détectée ; `country` (ISO-2) et `workplaceType` lus, jamais déduits ; échec de page = collecte incomplète | `lever.test.ts` (6 : > 100, région EU, page en échec, page répétée, plafond ≠ complet, pays/télétravail) | — |
| **Teamtailor** (`teamtailor`) | observation du flux public par société et du JSON-LD des pages (l'API officielle exige un jeton) | pagination par lien `next`, cycles et pages dupliquées refusés, attestation seulement après la dernière page ; `hiringOrganization` = libellé natif (entité juridique : « L'IMPERTINENTE - Ysé ») ; ré-hébergement sur `jobOrigin` | `teamtailor.test.ts` (11 : URL, organisation, dernière page, budget de pages, JSON malformé, doublons, cycles, identité étrangère) | le libellé natif est l'entité juridique : périmètre à confronter à la Maison (contrôle `classifyLabel`) |
| **SuccessFactors / SAP RMK** (`successfactors`) | observation des sites carrière (recherche paginée HTML, chemin JSON v2 pour certains tenants — D35) | total éditeur lu, pagination jusqu'au total ; détail par microdonnées (titre, adresse, dates) prioritaire sur le slug ; locales lues une fois ; codes de province d'une lettre écartés | `successfactors.test.ts` (38 : détail, adresses, préfixes de chemin, locales, ordre des formats) | tenants derrière WAF (403) — blocage d'accès, pas de parsing |
| **DigitalRecruiters** (`digitalrecruiters`) | observation de l'API JSON publique (annonces × diffusions, compteur éditeur) | diffusions regroupées en une offre (toutes localisations conservées), pagination jusqu'au compteur, énumération prouvée sur plusieurs pages ; compteur qui change ou page répétée = non complet ; repli `en_US` quand `fr_FR` est vide | `digitalrecruiters.test.ts` (5) | — |
| **Flatchr** (`flatchr`) | observation de la page société publique (`<slug>.flatchr.io/fr/company/<slug>`) | pays et description complets ; identité de poste stable à travers republication ; réponse tronquée ou sans compteur = non attestée ; doublons et employeurs étrangers refusés | `flatchr.test.ts` (7) | — |
| **Talentsoft** (`talentsoft`) | observation des sites carrière (`list-of-jobs.aspx`, gabarits actuel `ts-offer-list-item` et historique `ts-offer-card`) | id numérique, titre, lieu, date par carte ; section « Description du poste » ; aucun libellé employeur ni **pays** dans la liste | `talentsoft.test.ts` (13 : id, catégories, HTML, deux gabarits, ligne réf/date/ville, entités) | pays absent (109/109 Lagardère FR) — à établir sur la page de détail avant de le qualifier de limite éditeur |

Règles transverses vérifiées sur ces familles : verdict d'accès **explicite** (RFC 9309 : ALLOWED lu ≠ absent ≠ injoignable, `src/lib/candidateChecks.ts`) ; la preuve d'identité nomme le **board configuré** sur une page officielle archivée ; les libellés natifs lus à la validation décident du périmètre (SINGLE_BRAND refusé dès qu'un libellé n'est pas une entité de la Maison) ; un libellé sans alias revu sur un portail MULTI_BRAND est **refusé à la porte** (collecté, non publié) et la source n'atteste pas l'absence tant qu'il n'est pas résolu.
