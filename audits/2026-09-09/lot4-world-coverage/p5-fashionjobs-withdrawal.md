# FashionJobs sort du circuit des offres — 2026-09-11

**Décision produit (propriétaire, 2026-09-11)** : FashionJobs est **exclusivement** une source de découverte de Maisons, groupes et enseignes. Elle sort à 100 % du circuit des offres. **WTTJ reste autorisé** comme source d'offres.

## Périmètre, mesuré juste avant application

| Mesure (2026-09-11 06:13Z) | Offres |
|---|---:|
| Attestations FashionJobs vivantes | **585** |
| Dépendant de FashionJobs **seul** → retrait administratif | **585** |
| Disposant d'une autre source admissible → simple détachement | **0** (déjà détachées le 10/09) |
| Dont périmètre France | **583** |

**Les 585 identifiants sont archivés avant la mutation** (`p2-repairs-proof/p5-fj-perimeter-production.json`, `apply: true`) — le correctif du défaut de traçabilité du 10 septembre, où seuls 5 identifiants sur 172 avaient été conservés.

## Résultat, vérifié en production

| Contrôle | Avant | Après |
|---|---:|---:|
| Attestations FashionJobs vivantes | 585 | **0** |
| Offres actives | 79 516 | **78 932** (−584) |
| Retraits administratifs (`withdrawnAt` + motif) | 0 | **584** |
| **Fermetures employeur** | 0 | **0** |
| Offres à la fois retirées **et** fermées | 0 | **0** |
| Événements `WITHDRAWN` | 0 | **584** |
| Événements `CLOSED` | 0 | **0** |
| Lignes `JobSource` FashionJobs **conservées** | 1 206 | **1 206** |
| Offres sans source ACTIVE | 637 | **53** |

**Ce n'est pas une fermeture employeur.** `deactivateJob` avec la disposition `WITHDRAWN` pose `withdrawnAt` et `withdrawalReason` et laisse **`closedAt` à null** ; `deactivateSources` compte `jobsWithdrawn` et `jobsClosed` séparément. Vérifié : 584 retraits, **0 fermeture**. Identifiants, RAW et historiques sont **intégralement préservés** (1 206 lignes `JobSource` intactes).

Rejeu de l'opération : **0 offre à traiter**.

### L'offre conservée

Une offre Hermès (`cmtk2abeb…`) survit au retrait : elle reste attestée par la source `hermes` (statut PAUSED) et son URL pointe vers **WTTJ**, source autorisée. Elle **ne dépend plus de FashionJobs**. Les 53 offres sans source ACTIVE sont les 52 sous sources WTTJ en pause, plus celle-ci.

## Verrouillage de la réintroduction

Le retrait du catalogue seul ne suffirait pas : une ligne `Source` peut être recréée, `sources.csv` est **ré-importé à chaque démarrage** et réécrit la config, une config peut être copiée, un ancien chemin d'exécution rejoué lors d'une reprise. Trois barrières, à trois niveaux :

1. **L'adaptateur refuse** — `fetchFashionjobsJobs` lève `FashionjobsOffersWithdrawn` quelle que soit la configuration. C'est la **seule porte** par laquelle des offres pourraient rentrer, et elle échoue bruyamment plutôt que silencieusement. Le corps de crawl devenu inutile est supprimé.
2. **La ligne seed du CSV est retirée** — plus aucune réécriture de config au démarrage.
3. **La source est RETIRED** dans le catalogue, par `retire-source` (D27), qui « retire des attestations et ne prouve jamais une fermeture employeur ». Appliqué après le retrait des offres : **0 offre affectée**.

**Trois tests** verrouillent la décision : refus quelle que soit la config (y compris les formes qu'une reprise passerait : `maxPages`, `startPage`, `maxJobs`), message diagnosticable, et **circuit de découverte intact**.

## Ce qui reste utilisable, et l'est

Le circuit de découverte d'acteurs est **inchangé** : `connectors/fashionjobs/companyDirectory.ts` et `pipeline/discoverFashionJobs.ts` lisent l'annuaire des sociétés, pas les offres.

**Les Maisons découvertes restent dans l'inventaire** : **354 sociétés** ont un jour été nourries par FashionJobs, **354 sont toujours canoniques**, et **59 conservent des offres actives** provenant d'autres sources. La découverte a produit une valeur durable, indépendante du circuit des offres.

## Deux dossiers publics rattachés

Les deux offres à URL incohérente relevées le 10 septembre **faisaient partie des 585** et sont donc retirées par cette opération :

- **Boardriders** `cmtpkwxko…` — titre « Stagiaire E-Commerce & CRM », RAW « Coordinateur Web-Merchandising », URL Beaumanoir : trois annonces en une. **Retirée administrativement**, RAW conservé.
- **Aroma-Zone** `cmtpkx05b…` — titre et RAW concordants. **Retirée** au même titre (dépendait de FashionJobs seul).

Le défaut public est donc résolu par le retrait lui-même, sans correction d'association : ces offres ne sont plus servies au candidat, et leur RAW reste disponible pour instruction.
