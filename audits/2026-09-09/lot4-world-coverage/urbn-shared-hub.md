# URBN — hub iCIMS partagé : incident de run, sous-ensemble en double, marques attestées par offre

Découvert en produisant la preuve du lot Talentsoft/iCIMS. Trois constats distincts, chacun mesuré en production avant toute correction.

## 1. Incident : le déploiement de la PR 60 a arrêté le run borné en cours (18:35:11 UTC)

**Faits (journaux Railway + `PipelineRun`)**
- Run borné `lot4-talentsoft-icims-production-validation` (`99ae410d-…`), déploiement de validation `482f102a`, démarré 18:22:42 UTC.
- 18:33:53 : l'auto-déploiement de `main` (merge PR 60, `d825f58`) crée le déploiement `116bd090` sur le même service ; 18:35:11.717 : « Stopping Container » sur `482f102a` (statut `REMOVED`).
- Sources terminées avant l'arrêt : `lagardere-duty-free` 9/9, `aeropostale` 20, `lagardere-travel-retail` **109/109 complet** (0 erreur), `urbn-stores` 943 complet, **DEGRADED : 23 échecs d'écriture** (voir §3).
- `urbn-hub` : énumération observée complète (1 375, 28 pages) à 18:34:49, écriture interrompue à 18:35:10 après **563 ré-attestations sur 1 449** ; aucune ligne `SourceRun`, aucune purge (garde D6), rien de fermé (refresh en pause).
- Le run est resté `RUNNING` en base : aucun finaliseur n'existait pour un conteneur arrêté.

**Cause racine** : un protocole de run borné et un merge vers `main` partagent le service `catwalks-aggregator` ; rien n'empêchait le second de remplacer le premier. Erreur de conduite de ma part : j'ai lancé la chaîne merge/déploiement de la PR 60 pendant le run.

**Corrections**
- Code : `startObservability` installe un gestionnaire `SIGTERM`/`SIGINT` qui clôt le run en `INTERRUPTED` (événement `run.interrupted`, signal et `deploymentId` dans les métriques), idempotent, et `finish()` ne réécrit jamais une interruption. Test d'intégration `observability.test.ts`.
- Conduite : `backups/lot4-20260909/deploy-guard.py` refuse tout merge/déploiement tant que la commande de démarrage de l'aggregator n'est pas la commande normale ou qu'un `PipelineRun` est `RUNNING` ; branché en tête de `merge-and-deploy.sh`.
- Donnée : la ligne `99ae410d` est close `INTERRUPTED` à 18:35:11.717 avec les témoins (déploiement remplaçant, dernier événement, sources terminées/interrompues) — correction d'exploitation `20260909-LOT4-INTERRUPTED-RUN-TS-ICIMS-v1`, répétée sur clone.
- Commande normale restaurée sur le service (déploiement `086d5e68`).

## 2. `urbn-stores` est un sous-ensemble strict de `urbn-hub` (cas D34)

| Mesure (prod, 2026-09-09 18:45 UTC) | Valeur |
|---|---|
| Représentations actives `urbn-stores` | 970 |
| … dont l'`externalId` existe aussi dans `urbn-hub` | **970 / 970** |
| … portées par le même `Job` | 934 |
| … portées par un **second `Job` actif** (doublon visible : même titre, même lieu, même société, créés à 12 min d'écart le 2026-09-08) | **36** |
| Offres `urbn-hub` hors `urbn-stores` | 479 (home office NA/EU 206, stores EU 127, supply chain 63, Menus & Venues 38, sans page 25, stores NA 20) |

Le hub (`hub-urbn.icims.com`, `hub=15`) fédère huit hôtes de tenant iCIMS : `stores-na`, `stores-eu`, `homeoffice-na`, `homeoffice-eu`, `supplychain-na`, `supplychain-eu`, `menusandvenues-na` — la page de chaque offre du hub est servie par l'hôte d'origine. `urbn-stores` (`stores-na-urbn.icims.com`) relit 943 offres déjà lues par le hub, et les 36 doublons sont des `Job` distincts pour la même annonce.

**Décision (précédent D34/D36, preuve au niveau de l'offre, pas du nom)** : `retire-source urbn-stores` — retrait administratif de la route ; les 934 offres partagées restent attestées par le hub (id, URL, `firstSeenAt` conservés), les 36 doublons sans autre attestation sont supprimés (leur jumeau hub reste actif). Aucune fermeture employeur.

## 3. Les 23 refus d'écriture et l'employeur par offre

Les 23 échecs `EmployerIdentityReviewRequired` de `urbn-stores` sont 23 **nouvelles** annonces dont le libellé de catalogue (« URBN Stores ») ne correspond pas à la société résolue (« URBN ») : la porte d'identité a refusé de créer une identité sans revue — comportement voulu (le run est resté DEGRADED et n'a rien purgé).

Mais la vraie information est ailleurs : **chaque page d'offre porte un JSON-LD `JobPosting.hiringOrganization` qui nomme la marque employeuse et son site officiel (`sameAs`)**. Distribution sur les 1 449 offres actives du hub :

| `hiringOrganization.name` | `sameAs` | Offres | Attribution revue |
|---|---|---|---|
| Anthropologie | anthropologie.com | 434 | Anthropologie |
| Urban Outfitters | urbanoutfitters.com | 326 | Urban Outfitters |
| Free People | freepeople.com | 250 | Free People |
| FP Movement | freepeople.com/fpmovement | 142 | Free People (site officiel = freepeople.com) |
| URBN | urbn.com | 72 | URBN (propriétaire) |
| — (page sans `JobPosting` unique) | — | 64 | URBN (aucune preuve par offre) |
| Terrain | shopterrain.com | 41 | Terrain |
| Menus and Venues | urbnmenusandvenues.com | 38 | Menus and Venues (restauration — périmètre à décider) |
| Nuuly | nuuly.com | 35 | Nuuly |
| Anthro Weddings | anthropologie.com/bhldn-weddings | 25 | Anthropologie |
| Reclectic | UNAVAILABLE | 16 | URBN (aucun site officiel publié) |
| Maeve | anthropologie.com/maeve | 6 | Anthropologie |

Règle appliquée (même doctrine qu'OTB : la marque est créditée quand la page l'atteste explicitement, jamais déduite d'un titre) : **la marque est l'organisation dont la page nomme le site officiel** ; un libellé dont le `sameAs` est un chemin du site d'une marque (FP Movement, Anthro Weddings, Maeve) est crédité à cette marque, le libellé brut restant dans RAW et dans l'observation. Le site officiel `urbn.com` (page « Our Brands », archivée) présente Anthropologie, Urban Outfitters, Free People, FP Movement, Nuuly, Terrain et Menus & Venues comme ses marques, et sa page d'accueil lie `hub-urbn.icims.com` (lien réciproque).

**Points laissés à Loïc** : (a) FP Movement / Anthro Weddings / Maeve rattachés à la marque mère plutôt qu'en Maisons distinctes — réversible par alias ; (b) Reclectic (16, revente) et Menus and Venues (38, restauration) : identité et périmètre.

**Corrections universelles**
- `enrichPostingEvidence(job, html, {employerFromJobPosting})` : l'employeur vient du `hiringOrganization.name` de la page (règle `EXPLICIT_JOBPOSTING_EMPLOYER`, chemin `jsonld.hiringOrganization.name`), **opt-in par source** (`config.employerFromJobPosting: true`, posé par la revue) ; l'organisation est toujours enregistrée dans RAW, même sans opt-in. iCIMS passe l'option ; tout adaptateur qui lit une page de détail peut l'adopter.
- `planReviewedPortalOwners` : `portalHosts` (hôtes du portail hébergé chez l'éditeur, d'où viennent les preuves par offre — la preuve de propriété reste sur le domaine officiel), `targetDomain` par marque (domaine officiel attesté par `sameAs`, pour le logo, jamais deviné), et scission de marques sur un portail dont le propriétaire est déjà juste.
- Revue `20260909-LOT4-PORTAL-OWNER-URBN-HUB-v1` : 1 297 offres créditées à 6 marques (Anthropologie 465, Free People 392, Urban Outfitters 326, Terrain 41, Menus and Venues 38, Nuuly 35), 152 restent à URBN ; alias source-scopés pour les 11 libellés observés ; certification `OFFICIAL_DOMAIN` ; secteurs attestés par « Our Brands ».

## 4. Exécution

_Complété après répétition sur clone et application en production (voir `urbn-clone-*.log`, `urbn-owner-production-proof.json`, `urbn-certification-production-proof.json`, `urbn-production-after.json`)._
