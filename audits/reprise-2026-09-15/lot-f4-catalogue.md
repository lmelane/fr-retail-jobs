# Lot F4 — Catalogue propre et stratégie de reconstruction

Document daté du **17 septembre 2026**. Il distingue, à chaque affirmation, ce qui est **mesuré** (clone de production `catwalks_rehearsal_20260915`, copie locale en lecture seule, migrée jusqu'à la révision de ce dépôt ; stack locale du lot F2), ce qui est **décidé** (instruction de Loïc du 16/09, rapport F0), ce qui est **proposé** et ce qui **reste à arbitrer**. Aucune suppression n'a été exécutée, ni en production ni sur le clone.

## 1. Décision de départ, confirmée par la mesure

**Ne pas vider la base de production.** Le rapport F0 a réfuté la migration directe (dix des trente-trois migrations en attente sont destructrices pour la révision déployée `dd3e24d`, qui relit encore leurs objets). La mesure de ce lot ajoute un fait décisif : **la production ne possède aucune capture native** (0 `CaptureBatch`, 0 `RawCapture`, 0 `SourceValidation`, 0 `SourceAccessDecision`, 0 admission, lu le 16/09). L'ancien stock (87 607 offres, 83 018 actives, 90 764 représentations) n'a donc **aucune preuve brute rejouable** : il ne se reconstruit que par recollecte, et il ne peut pas être « réparé » en un stock certifié.

| Option | Ce qu'elle exige | Ce qu'elle casse ou risque | Retour arrière | Verdict |
|---|---|---|---|---|
| **A. Base parallèle** : copie restaurée de la production, migrée 44 → 81, servie par la nouvelle révision ; l'ancien couple image + base reste intact | une restauration prouvée (F7), la migration rejouée et chronométrée (F6), un réglage d'URL par service au moment de la bascule | rien pour le site public tant que le basculement des lecteurs n'a pas eu lieu ; double coût de base pendant la transition | re-pointer les lecteurs vers l'ancienne base, qui n'a jamais été touchée | **retenue** |
| **B. Réparation bornée dans la base actuelle** : migrations appliquées en place, projections remplacées | prouver que `dd3e24d` survit à chaque migration en attente (réfuté en F0 pour dix d'entre elles), verrouiller les écrivains, rejouer sans capture native | le site public protégé lit la base pendant la migration ; un échec à mi-chemin laisse une base ni ancienne ni nouvelle | restauration complète d'une sauvegarde, avec perte des écritures intermédiaires | **écartée** |

L'ancien environnement conservé pendant la transition est une **étape de migration**, pas un second pipeline : critère de retrait proposé au §6.

## 2. Inventaire avant toute suppression (clone, 16/09)

### Volumes

| Objet | Lignes | Taille | Rôle | Reconstructible ? |
|---|---|---|---|---|
| `Job` | 87 607 (83 018 actives) | 2 211 Mo | projection publique ; **ses identifiants sont les URL publiques** (`/emplois/[id]`, `/api/emplois/offre/[id]` du site) et les cibles de `mergedIntoId` | par recollecte seulement ; les identifiants doivent survivre |
| `JobSource` | 90 764 (85 327 actives) | 808 Mo | représentations par source, RAW de l'ancien pipeline (`raw`, `sourceFacts`, `presentation`), aucune capture liée | non (RAW non rejouable, mais conservé) |
| `DataCorrection` | 28 907 | 2 748 Mo | journal append-only des corrections revues ; **2 451 Mo** = 3 645 instantanés avant/après de `PublicationGroupPlan` (jusqu'à 3,9 Mo par ligne) | non |
| `MaintenancePlan` | 4 205 | 682 Mo | plans de maintenance revus | non |
| `SourceObservation` | 141 933 | 623 Mo | observations brutes de l'ancien pipeline | non |
| `OccupationObservation` | 228 539 | 463 Mo | journal append-only des décisions métier | non |
| `EmployerObservation` | 75 051 | 44 Mo | observations d'employeur | non |
| `JobEvent` | 44 624 | 11 Mo | historique de cycle de vie | non |
| `MarketSnapshot` | 17 670 | 5 Mo | photographie quotidienne, **sans écrivain ni lecteur** dans cette révision (F1) | non |
| `Company` / `CompanyAlias` / `EmployerIdentityReview` | 1 622 / 239 / 53 | 1 Mo | identités d'employeur et décisions revues | non |
| `Source` / `SourceRevision` / `SourceIdentityReview` / `PostingScopeDecision` / `PublicationIdentityDecision` / `SectorReview` | 536 (436 actives) / — / 112 / 224 / 540 / 12 | < 2 Mo | registre et décisions | non |
| `SourceRun` / `PipelineEvent` / `PipelineRun` | 7 551 / 6 155 / — | 12 Mo | santé et journal d'exécution | oui (histoire seulement) |
| `GeoCache` | 1 950 | 0,5 Mo | géocodage | oui, à coût d'appels |
| `DirectOffer*`, `DirectFeedCursor` | 0 | — | offres directes Catwalks (aucune en production) | — |
| tables de capture, validation, accès, admission, fin d'ingestion, extraction, blobs | 0 | — | preuves natives, absentes de la production | créées par la campagne |

Consommateurs, clés étrangères, déclencheurs et index sont inventoriés objet par objet dans [`schema-inventaire-2026-09-16.md`](schema-inventaire-2026-09-16.md) (F1). Les clés étrangères notables pour une suppression : `JobSource.jobId` → `Job` (restaurée par une migration en attente, absente du schéma déployé), `Job.mergedIntoId` → `Job`, `Job.companyId` → `Company`, `DataCorrection` sans clé étrangère (journal), `SourceIngestionAdmission` → revue d'identité, validation, lot de capture.

### Ce qui ne doit jamais être effacé « par assimilation au vieux catalogue »

Registre (`Source`, `SourceRevision`), décisions (identité, accès, validation, admission, fin d'ingestion, périmètre de publication, identité de publication, secteurs), identités d'employeur (`Company`, alias, revues), corrections et journaux append-only (`DataCorrection`, `OccupationObservation`, `JobEvent`), offres directes et leurs événements, identifiants d'offres et redirections (`Job.id`, `mergedIntoId`), captures brutes et blobs, curseurs. Le tout est conservé tel quel dans la base parallèle par construction (copie).

### Projections jetables, et à quelle condition

Seules sont jetables des projections **recalculables depuis une preuve conservée** : le cache de présentation (`JobSource.presentation`, recalculé par le lecteur depuis le RAW retenu), les lignes de santé (`SourceRun`) au-delà d'une fenêtre, `MarketSnapshot` **si** la carte de décision du §7 le tranche. Une ligne `Job` de l'ancien stock n'est pas jetable : son identifiant est une URL publique.

## 3. Stratégie retenue : deux stocks explicitement séparés dans une seule base

1. **Copie** de la production restaurée dans une base parallèle (procédure et durée mesurées en F7 ; la stack locale du lot F2 en est la répétition à petite échelle : catalogue né vide, 81 migrations).
2. **Migration** 44 → 81 sur la copie, chronométrée, avec les comptes table par table avant/après (F6).
3. **Ancien stock marqué non certifié** : toute ligne `Job` / `JobSource` sans admission d'ingestion (`JobSource.captureBatchId IS NULL`) est de l'**ancien stock** ; elle reste servie tant que la bascule n'a pas eu lieu, jamais présentée comme certifiée. La séparation est une propriété de la donnée (présence d'une capture admise), pas un drapeau à poser.
4. **Nouveau catalogue** construit **par recollecte sous admission** des sources qualifiées par la campagne F3 (identité vérifiée, collecte validée hors réseau, accès sur périmètre observé) : c'est ce que la stack locale contient déjà (mesure au §5). Une offre de l'ancien stock retrouvée par une recollecte prend sa représentation certifiée **sans changer d'identifiant** (même `sourceKey` + `externalId` → même `Job`), donc les URL publiques survivent.
5. **Bascule** des lecteurs (API, puis site) vers la base parallèle une fois les portes vertes ; retrait de l'ancien stock non recollecté après le délai du §6, avec sauvegarde indépendante.
6. **Retour arrière** : re-pointer les lecteurs vers l'ancienne base, jamais touchée ; les preuves acquises entre-temps restent dans la base parallèle (rien à effacer pour revenir).

## 4. Qualité de chaque offre servie : règles formalisées

Chaque règle nomme sa preuve et son effet ; un inconnu non requis reste inconnu (jamais inventé, jamais bloquant), une absence critique bloque.

| Règle | Preuve | Effet si absente |
|---|---|---|
| Identité stable | `Job.id` conservé, `sourceKey` + `externalId` uniques, `mergedIntoId` pour les doublons prouvés | l'offre n'existe pas |
| Source, capture, version | `JobSource.captureBatchId` / `captureOutputId` (admission), `Job.pipelineVersion`, lecteur figé (`readerRevision`) | ancien stock non certifié |
| Employeur prouvé | nom natif de l'offre, ou nom de la Maison si le portail est certifié SINGLE_BRAND, alias revu sinon (`identity/resolve.ts`) | refus d'écriture (`EmployerIdentityReviewRequired`) |
| Texte natif complet ou partiel explicite | `description` reconstituable depuis le RAW par le lecteur de publication (`recovery.ts`) ; sinon `CONTENT_MISSING` | non publiable |
| Lien de candidature correct | `url` HTTPS publique de l'offre, rejouée par le lecteur (`IDENTITY_MISMATCH` sinon) | non publiable |
| Pays démontré | `countryCode` avec `countryIntegrity` probante (`RAW_COUNTRY_CODE`, `RAW_COUNTRY`, `VERIFIED`) ; règle du pays actif strict pour la recherche | hors de tout marché (servie nulle part) |
| Lieu | `city`, `postalCode`, `adminArea1`, géocodage | inconnu, filtrable seulement par pays |
| Date native ≠ collecte | `postedAt` natif ; jamais `firstSeenAt` | inconnue, tri par observation |
| Échéance qualifiée | `validThrough` natif ou `JobSource.expiresAt` avec `expiryEvidence` | pas de fermeture par échéance |
| Salaire, contrat, temps, expérience, formation | valeurs natives normalisées (`employmentEvidence`, `salary*`, `experienceYears`, `educationLevel`) | inconnus explicites |
| Statut courant | `isActive`, `closedAt`, `withdrawnAt`, absence attestée par capture (lot 5G3C) | jamais fermée sans preuve |

Les rejets sont inspectables : motifs de validation (`SourceValidation.report.reasons`), motifs de refus d'écriture (`PipelineEvent` durables `job.write_failed`), quarantaines (`JobSource.quarantineReason`).

## 5. Métriques avec dénominateurs

Le script versionné [`scripts/ops/catalogue-quality-report.mts`](../../apps/aggregator/scripts/ops/catalogue-quality-report.mts) produit le rapport (JSON et Markdown) sur n'importe quelle base catalogue, en lecture seule : sources (enregistrées, actives, avec admission, fraîcheur de la dernière fin d'ingestion), offres (publiées, actives, fermées, retirées, fusionnées, représentations, quarantaines, captures), refus d'écriture par motif, couverture des offres actives champ par champ, pays servis avec leur volume, fraîcheur (date native, dernière observation), doublons prouvés et grappes candidates, cas en revue, détail par source.

Première exécution sur la stack locale le 16/09 à 21 h UTC, pendant la campagne, puis exécution de référence le **17/09 à 01 h 14 UTC**, à la fin des douze vagues (rapport privé `backups/reprise-20260916-lotF/f4-qualite-2026-09-17.{json,md}`) : 406 sources enregistrées, 166 actives dont 165 avec admission et 163 ingérées dans l'heure ; 19 500 offres actives, toutes avec capture native ; couverture : description utile 99,9 %, pays 99,6 % (prouvé par une observation native 91,6 %), ville 96,7 %, code postal 85,2 %, géocodées 66,8 %, date native 100 %, échéance 5,3 %, contrat 74,1 %, temps de travail 74,5 %, expérience 0,2 %, formation 1,1 %, salaire 4,6 %, langue 97,8 %, métier classé 100 % ; 70 pays servis ; fraîcheur médiane de la dernière observation 1,3 h ; dernières fins d'ingestion : 19 459 publiées, 13 retenues, 1 806 refusées à l'écriture, toutes `EmployerIdentityReviewRequired:PORTAL_OWNER_NOT_CERTIFIED` (carte de décision du lot F3 ; le registre F3, qui compte les écritures refusées sur le dernier verdict de chaque source, en donne 2 202 sur 33 sources) ; 19 500 offres actives sans revue d'employeur. L'état de la stack cumule les trois passages de campagne (des sources activées par un passage antérieur et non requalifiées ensuite restent actives) : le registre F3 (dernier verdict par source, 154 qualifiées sur 407) fait foi, pas ce compte. Une « couverture mondiale » ne se lit que dans ce tableau des pays servis, jamais dans une liste de codes.

## 6. Fraîcheur par source et critère de retrait de l'ancien stock

- **Fraîcheur** : la dernière fin d'ingestion admise par source (`SourceIngestionCompletion.completedAt`) et la dernière observation par représentation (`JobSource.lastSeenAt`) sont les deux mesures ; une source en pause n'est pas une source fermée (décision §4 de l'instruction), sa fraîcheur vieillit et se lit.
- **Critère de retrait proposé** de l'ancien stock non certifié, après bascule : une représentation sans admission dont la source a été **recollectée sous admission** (donc dont l'absence a été constatée par une capture attestante) ou dont la source est **RETIRED** ; jamais par âge seul. Ce retrait est une carte de décision au moment de la bascule, avec le compte exact.

## 7. Cartes de décision

🔷 DÉCISION — Borner les instantanés de `DataCorrection`
Contexte : 3 645 lignes `REVIEWED_PUBLICATION_PARTITION` (entité `PublicationGroupPlan`) pèsent 2 451 Mo sur 2 748 (instantanés avant/après complets, jusqu'à 3,9 Mo par ligne) ; les 25 000 autres corrections pèsent moins de 100 Mo.
Enjeu : la table double la base sans ajouter de preuve (le plan avant est déjà retenu par `MaintenancePlan`, l'après est la ligne courante) ; une restauration et chaque sauvegarde en paient le coût.
Options : A — règle « référence, pas copie » pour les nouvelles corrections d'entité `PublicationGroupPlan` (avant/après = empreinte + pointeur vers le plan retenu, plafond de 64 Ko par ligne imposé par SQL), l'historique conservé tel quel (coût : une migration additive et l'écrivain `remediation/plan.ts` ; réversible) · B — même règle, puis compaction de l'historique en archive objet (S3) avec empreinte (coût : outillage d'archive ; réversible par restauration) · C — ne rien changer (coût : 2,4 Go transportés à chaque copie).
Reco : A maintenant, B au premier chiffrage de sauvegarde qui le justifie.
Impact si on ne tranche pas : chaque répétition de restauration (F7) et chaque sauvegarde transportent 2,4 Go de doublons.

🔷 DÉCISION — `MarketSnapshot`
Contexte : 17 670 lignes (5 Mo) écrites chaque nuit par l'ancien pipeline ; dans cette révision, ni écrivain ni lecteur (F1) ; les lignes `live` ne sont pas reconstructibles.
Enjeu : conserver une série historique sans consommateur, ou la retirer du schéma pour ne plus la migrer.
Options : A — conserver la table telle quelle, hors runtime, jusqu'à un consommateur nommé (coût nul ; réversible) · B — exporter la série en archive (CSV horodaté, empreinte) puis supprimer la table par migration (coût : une migration destructive après export prouvé ; irréversible sans l'archive) · C — supprimer sans export (irréversible).
Reco : A pour cette release ; B seulement avec un besoin d'analyse nommé.
Impact si on ne tranche pas : rien ne casse ; 5 Mo migrés avec le reste.

## 8. Ce que ce lot a produit, et ce qui reste

- Produit : la stratégie ci-dessus, l'inventaire mesuré, les règles formalisées, le script de métriques (exécuté), les cartes de décision, la séparation ancien/nouveau stock par propriété de la donnée.
- Reste, dans les lots suivants : la restauration réellement démontrée et chronométrée (F7), la migration 44 → 81 rejouée sur copie avec comptes (F6), la bascule des lecteurs (hors de cette phase pour le site protégé), le retrait de l'ancien stock (carte au moment de la bascule).
