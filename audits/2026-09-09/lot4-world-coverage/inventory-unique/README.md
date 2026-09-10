# Inventaire de suivi unique — LOT 4 (généré le 2026-09-10T18:45Z)

Un seul inventaire, régénéré depuis la base de production (lecture seule) et les jeux de preuves existants par `apps/aggregator/scripts/coverage/unified-inventory.mts <dossier>` puis `inventory-readme.py`. Il remplace les trackers v3–v10 comme point de suivi (ceux-ci restent des photographies datées). Rien n'y est saisi à la main ; rien n'y est fusionné : un acteur présent dans plusieurs jeux est **une ligne** qui dit quels jeux le nomment.

**Clé de déduplication** : alias revu (`CompanyAlias.reviewId`) ou orthographe fusionnée → clé canonique de la société racine ; sinon `resolveCompany(nom).companyId`. FashionJobs ne sert qu'à découvrir des acteurs : jamais une source d'offres. Une source peut nourrir plusieurs acteurs (portail de groupe) et un acteur peut avoir plusieurs sources : les deux liens sont listés (`sources` porte `via-postings` quand le lien vient des offres et non de la Maison cataloguée).

## Dénominateurs (chaque jeu garde le sien)

| Jeu | Taille | Acteurs après déduplication | Dont avec ≥ 1 source ACTIVE |
|---|---:|---:|---:|
| Benchmark FashionJobs (libellés de découverte) | 1 653 | 1 629 | 269 |
| Rapprochement de la découverte web (2026-09-10) | 65 | 65 | 12 |
| Marques de portefeuilles de groupes (observations) | 275 | 266 | 99 |
| Candidats B6 (tenants avec lien réciproque archivé) | 33 tenants | 20 acteurs | — |
| Sociétés de production avec offres actives | 1 000 | 998 | — |
| Table `Source` (tous statuts) | 532 (ACTIVE 433, RETIRED 91, PAUSED 8) | 502 Maisons cataloguées | — |
| **Union dédupliquée** | — | **2 488** | 858 |

## Où en sont les acteurs

| Mesure | Nombre |
|---|---:|
| Acteurs avec au moins une source ACTIVE | 858 |
| … dont toutes les sources actives certifiées (contrat strict, configuration courante) | 195 |
| Acteurs FashionJobs sans aucune source active | 1 360 |
| Acteurs FashionJobs présents dans aucun autre jeu | 1 198 |
| Sociétés avec offres actives mais sans source ACTIVE (source retirée/pausée, offres héritées) | 156 |

Étapes FashionJobs (registre `audits/2026-09-09/fashionjobs-portals/ledger.json`) : RESEARCH_NOT_STARTED 741 · RESEARCH_INCOMPLETE 583 · ACTIVE_SOURCE_CANDIDATE 200 · CAREER_LINK_REVIEW_REQUIRED 64 · IDENTITY_MATCH_AMBIGUOUS 29 · OFFICIAL_PORTAL_TECHNICAL_VALIDATION_REQUIRED 12.

### Prochaine action par acteur (dérivée, pas décidée)

| Action | Acteurs |
|---|---:|
| recherche de portail officiel à mener | 1 292 |
| certifier la configuration courante des sources actives | 663 |
| contrôle live (collecte → publication) et couverture mondiale à prouver | 195 |
| marque de portefeuille : portail à rechercher | 158 |
| sans source active : acteur nourri par une source retirée/pausée ou historique | 112 |
| revue manuelle (lien carrière / identité ambiguë) | 56 |
| qualifier le portail candidat (identité + validation réelle) | 10 |
| B6 : certifier et activer le tenant candidat | 2 |

## Où en sont les sources ACTIVE

| Dimension | Répartition |
|---|---|
| Identité (contrat de promotion sur la configuration courante) | LEGACY_UNCERTIFIED 343 · CERTIFIED_CURRENT 90 |
| Périmètre certifié | none 355 · SINGLE_BRAND 46 · MULTI_BRAND 32 |
| Complétude selon le **dernier run de production** | NOT_PROVEN 196 · PROVEN_BY_DECLARED_TOTAL 135 · COMPLETE_FLAG_ONLY 102 |
| Énumération selon le **reçu du tracker v10** (adaptateur courant rejoué) | EXHAUSTIVE_PROVEN 388 · NO_RECEIPT 29 · NOT_PROVEN 16 |
| Collecte selon le reçu | COMPLETE 380 · NO_RECEIPT 29 · NOT_PROVEN 13 · INCOMPLETE_EXPLAINED 11 |
| **Verdict combiné** | RECEIPT_COMPLETE_PRODUCTION_RUN_DUE 253 · PROVEN_BY_DECLARED_TOTAL 135 · RECEIPT_COMPLETE 16 · NOT_PROVEN 15 · INCOMPLETE_EXPLAINED 9 · COMPLETE_FLAG_ONLY 5 |
| Statut du dernier run | OK 214 · DEGRADED 192 · NEW 26 · BROKEN 1 |
| Sources nourrissant plusieurs acteurs | 45 |
| Offres actives sous les sources ACTIVE | 80 073 (offres actives en base : 79 516) |

`RECEIPT_COMPLETE_<date>_PRODUCTION_RUN_DUE` : le dernier run de production (run global du 2026-09-08, sémantique d'alors : DEGRADED ⇒ `complete=false`) est antérieur au reçu de l'adaptateur courant qui prouve l'énumération ; la source doit être rejouée en production (crons gelés) avant d'être comptée complète **en production**. `COMPLETE_FLAG_ONLY` : l'éditeur ne déclare aucun total (un document, ou pagination épuisée) — complet selon l'adaptateur, sans contre-preuve indépendante.

## Fichiers

- `actors.csv` — une ligne par acteur : jeux, étape FashionJobs, libellés, verdicts de découverte, groupes de portefeuille, tenants B6, société (id, kind, domaine, groupe, offres actives), sources `clé=STATUT:IDENTITÉ[:via-postings]`, action suivante.
- `sources.csv` — une ligne par source : identité, périmètre, dernier run, complétude du run, reçu (énumération, collecte, date, détails), verdict combiné, offres actives, acteurs nourris.
- `summary.json` — les dénominateurs et répartitions ci-dessus.

Ce que cet inventaire ne dit pas : la couverture **mondiale** d'un acteur (un flux complet prouve le flux, pas l'acteur), ni la parité front (relue par lot dans `lot-*-volumes.json` et par le tableau final).
