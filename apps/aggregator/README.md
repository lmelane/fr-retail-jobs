# Agrégateur — référence de pilotage et diagnostic

**Nettoyage local effectué : 96 outils obsolètes retirés, référentiels et outils maintenus rangés. Build Docker local validé après extension du disque Colima ; aucun déploiement.**

**Ouvrir ce document en premier.** Il rassemble l’état vérifié, les priorités et les liens vers les preuves. Les CSV, anciens rapports et handoffs sont des pièces d’appui, pas des versions concurrentes du catalogue courant.

**Dernier contrôle : 10 septembre 2026, 10:57:16 UTC / 12:57:16 Paris.** Code inspecté : `72f2a65` (merge PR 77). La base de production a été lue dans une transaction `READ ONLY / REPEATABLE READ`. Aucun run d’ingestion, déploiement, changement de cron ou mutation de production n’a été effectué pendant ce diagnostic.

Le chantier LOT 4 reste ouvert. La consigne opérationnelle est de conserver les crons gelés. Ce contrôle n’a pas relu la configuration Railway : le gel est la dernière situation déclarée par le développeur, pas une nouvelle mesure Railway de cette passe.

## 1. Diagnostic en langage simple

Le moteur récupère déjà un volume important, mais la preuve de propriété des portails est en retard sur la collecte. Le manque de certification est réel : **360 des 405 sources actives n’ont aucune revue `SourceIdentityReview` enregistrée**. Les 45 autres passent aujourd’hui le validateur strict de l’application ; aucune de ces 45 revues n’a échoué sur son hash, son âge ou son contenu archivé.

Cela ne veut pas dire que les 360 portails sont faux. Cela signifie que l’application ne dispose pas de la garantie formelle attendue pour eux. Certaines preuves existent ailleurs : **23 de ces sources ont des alias employeur revus**, dont SMCP, Kering, Ulta et Nordstrom. Ces décisions ne sont pas des certifications de portail et ne doivent pas être transformées automatiquement en telles.

Deux autres problèmes accentuent la confusion :

- les outils de reporting utilisent plusieurs définitions de « certifié » ou « complet » ;
- les fichiers mélangeaient référentiels, exports, scripts d’investigation et rapports historiques ; le nettoyage décrit au § 6 corrige cette organisation.

**Conclusion : progrès réel de collecte, dette réelle de certification, et indicateurs à fiabiliser avant toute affirmation de couverture globale.** Aucun pourcentage global d’avancement du LOT 4 n’est calculable honnêtement à partir d’un seul taux de collecte.

## 2. Mesures de production, sans double comptage

| Mesure | Valeur contrôlée |
|---|---:|
| Offres conservées | 78 912 |
| Offres actives | 75 457 |
| Offres actives France (`isFrance`) | 11 131 |
| Sources cataloguées | 503 |
| Sources ACTIVE / RETIRED / PAUSED | 405 / 90 / 8 |
| Sources actives certifiées strictement | 45 — 11,11 % |
| Sources actives sans aucune revue de portail | 360 — 88,89 % |
| Sources actives avec revue présente mais invalide | 0 |

### Quelle part des offres bénéficie de cette garantie ?

Chaque `Job` actif est compté une seule fois. Une source est considérée ici comme opérante si `Source.status=ACTIVE` et sa `JobSource.isActive=true`.

| Ensemble disjoint d’offres actives | Nombre |
|---|---:|
| Uniquement des sources opérantes certifiées | 16 996 |
| À la fois des sources opérantes certifiées et non certifiées | 443 |
| Uniquement des sources opérantes non certifiées | 57 378 |
| Aucune représentation active issue d’une source ACTIVE du catalogue | 640 |
| **Total** | **75 457** |

Ainsi **17 439 offres (23,11 %) disposent d’au moins une source opérante certifiée** ; **57 378 (76,04 %) n’ont que des sources opérantes non certifiées**. Cela mesure une garantie de provenance, pas un taux d’offres fausses ni une preuve de fraîcheur.

Les 640 restantes ne sont pas automatiquement des erreurs : une source peut être temporairement pausée sans justifier la fermeture de ses offres. Elles doivent toutefois figurer dans le périmètre du contrôle de fraîcheur et de visibilité. Parmi leurs représentations : 588 associations actives à la source PAUSED `fashionjobs`, 39 à `hermes`, et d’autres associations pausées/inactives. Ces nombres de représentations ne s’additionnent pas aux ensembles d’offres ci-dessus. Aucune offre de cet ensemble n’est dépourvue de toute ligne JobSource historique.

**Alerte de périmètre :** FashionJobs n’a pas été collecté dans cet audit ; ses anciennes offres présentes en base doivent faire l’objet d’une décision de conservation/retrait et de fraîcheur explicite, pas disparaître du suivi parce que la source est pausée.

### Ce que l’on sait vraiment des 360 non certifiées

| Catégorie exclusive | Sources | Ce que cela signifie |
|---|---:|---|
| Blocage d’accès au site officiel documenté + preuves d’alias partielles | 2 | Versace et Swarovski ; pas de certification de portail |
| Autres sources avec alias employeur revu | 21 | Preuves réutilisables, mais périmètre/tenant/configuration à certifier |
| Ni revue de portail ni alias employeur revu en BDD | 337 | Absence de ces décisions dans la base ; pas une preuve d’absence de recherche en archives |

Pour les 23 sources possédant des alias revus : **42 alias répartis dans 9 dossiers de revue** ont été retrouvés. Les dossiers peuvent regrouper plusieurs sources ; la présence d’une URL dans le dossier global ne signifie pas qu’elle prouve chaque alias du lot.

Exemples de dette documentaire identifiable :

- `sandro` : le dossier existant cite la page officielle SMCP et la relation Sandro/Maje/Claudie Pierlot/Fursac ; pas de `SourceIdentityReview` pour le portail `sandro`.
- `kering` : revue de Kering Corporate appuyée sur l’API officielle et le site Kering ; pas de certification de la source `kering` dans cette table.
- `ulta-jibe` : alias juridique revu avec dossier officiel ; pas de certification du tenant Jibe.
- `bzb` : changement Bizzbee → BZB et correspondances de publications documentés ; revue de portail encore absente.

**Ce qui ne peut pas être affirmé :** « toutes les preuves sont déjà faites, il ne reste qu’à enregistrer 360 lignes » ou « les 337 n’ont jamais été examinées ». Il manque un inventaire des décisions sémantiques liant précisément acteur, portail et configuration. Le diagnostic actuel n’a pas relu individuellement toutes les pages officielles des 405 sources.

## 3. Pourquoi ce retard existe — preuves dans le code

### La porte d’entrée protège les nouvelles promotions, pas tout l’héritage

Dans [sourceStore.ts](src/connectors/sourceStore.ts), `promoteSource()` appelle `requireSourceIdentity()` avant activation. C’est un contrôle utile.

Mais `loadActiveSources()` lit simplement toutes les lignes `status=ACTIVE` ; il ne revalide pas leur certification. Les sources héritées continuent donc d’être des candidates à l’exécution globale. Les crons gelés empêchent actuellement une reprise aveugle, mais **le statut ACTIVE ne constitue pas une preuve d’identité**.

À corriger : rendre l’admissibilité d’un lot explicite, faire passer sa sélection par le validateur commun, et conserver séparément les offres historiques quand une source doit être revue. Ne pas fermer toutes les offres d’une source pour le seul motif d’un dossier documentaire incomplet.

### Les travaux récents ont privilégié des lots de collecte et de réparation

Les rapports B1–B5 décrivent la certification des sources touchées par leurs réparations, et non une campagne terminée sur tout le catalogue. En base, les trous concernent des familles entières : **0/45 SmartRecruiters, 0/61 Greenhouse, 0/22 Recruitee, 0/17 Lever, 0/14 Personio** certifiées comme portails. Ce résultat ne prouve pas un défaut de ces ATS ; il situe le travail de qualification restant.

### Les mêmes garanties sont implémentées plusieurs fois

- [sourceIdentity.ts](src/connectors/sourceIdentity.ts), `assertIdentityReview()` : configuration, sujet, tenant, âge, méthode, URLs, contenu archivé et hash.
- [qualify-tracker.py](scripts/coverage/qualify-tracker.py), `certify()` : hash/sujet et âge simplifiés ; ne réexécute pas tout le contrat.
- [proof-dimensions.py](scripts/coverage/proof-dimensions.py) : verdict VERIFIED + hash ; pas de contrôle complet de l’âge/artefact/sujet.
- `certifiedPortalScope()` : verdict VERIFIED + hash seulement, malgré son utilisation pour attribuer des offres au propriétaire.

**Défaut de code constaté, non corrigé dans cette passe :** une revue devenue trop ancienne peut encore fournir un `SINGLE_BRAND` dans le chemin d’ingestion, alors que la porte stricte la refuserait. Les 45 revues présentes aujourd’hui sont valides ; aucune utilisation réellement expirée n’a été démontrée en production.

Autre point à resserrer : dans [identity/resolve.ts](src/identity/resolve.ts), le périmètre `SINGLE_BRAND` peut rattacher au propriétaire **tout nouveau libellé natif**, pas seulement une offre sans employeur. Une contradiction future explicite doit déclencher une revue, pas être absorbée du seul fait d’une ancienne certification mono-marque. Aucun nouveau cas erroné de cette nature n’est affirmé ici ; le chemin de code est trop large au regard de la garantie attendue.

## 4. Les chiffres du tracker v9 ne sont pas encore une vérité unique

Les fichiers ont été réellement inspectés, pas seulement les résumés du développeur.

| Indicateur v9 | Chiffre affiché | Diagnostic |
|---|---:|---|
| Identité certifiée | 45 / 405 | Confirmé par lecture de production et validateur strict |
| Énumération démontrée | 391 / 405 | Inclut deux reçus marqués configuration non courante |
| Collecte complète | 384 / 405 | Même défaut pour Beiersdorf et Tapestry |
| Détails complets | 238 / 405 | Présence de champs selon le reçu ; pas justesse ni canonisation |
| Ingestion en phase | 159 / 405 | Comparaison attachée au snapshot du reçu, pas relecture actuelle des IDs |
| Visibilité prouvée | 0 / 405 | Les preuves publiques L1–L7 ne sont pas consolidées dans cette sortie |
| Tous les contrôles réunis | 0 | Ne démontre pas que zéro source fonctionne correctement ; le reporting est incomplet |

### Anomalie mesurée : reçu périmé néanmoins compté comme complet

Le CSV `tracker-v9/sources-proof-dimensions.csv` indique :

| Source | Reçu pour config courante | Énumération | Collecte |
|---|---|---|---|
| `beiersdorf` | False | EXHAUSTIVE_PROVEN | COMPLETE |
| `tapestry` | False | EXHAUSTIVE_PROVEN | COMPLETE |

Le rapport L7 décrit pourtant Tapestry DEGRADED, avec cinq annonces non publiées et un résiduel sous plafond. Le générateur garde l’ancien reçu et calcule les verdicts positifs même lorsque `receipt_for_current` est faux. C’est une cause racine de reporting, pas un manque de commentaire dans le rapport.

**Retirer seulement ces deux preuves non courantes donne au plus 389 et 382 verdicts sur le même jeu de données**, sans constituer un nouveau taux entièrement requalifié : il reste à contrôler la pertinence des révisions d’adaptateur, les dates, les rejets et les IDs. Ne pas publier « 384 complètes actuellement » sans cette correction.

### Autres faiblesses des générateurs

- Le choix d’un reçu privilégie la date Git du commit puis la date d’observation. La date d’un commit ne démontre pas à elle seule que le protocole testé correspond au code utile actuel ; il faut relier reçu, configuration et dépendances de l’adaptateur.
- Le générateur peut considérer un objet `quality` absent comme aucun champ manquant. Une mesure absente doit rester « non mesuré ».
- Les tableaux `missingInDatabase` / `activeDatabaseAbsentAtSource` sont calculés par `probe-worker.mts` contre le snapshot fourni **avant la collecte**. Leur valeur n’est pas un contrôle de la base après un run ultérieur.
- `parity_companies()` associe des preuves au nom de Maison ; une validation correcte doit identifier source, configuration, snapshot, IDs et instant. Les parités L1–L7 existent mais ne sont pas intégrées à v9.
- `per-source-table.py` titre une colonne « identité & périmètre », alors que son entrée v9 ne contient pas `portalScope`. Il peut aussi afficher « aucune correction de code : preuve à rejouer » par défaut, même pour un défaut d’adaptateur connu. Ce texte est généré, pas une décision d’ingénierie.
- `orchestrate.py` réutilise un reçu quand code/config n’ont pas changé, sans horizon de fraîcheur : cela peut économiser un nouveau test de protocole, mais ne prouve pas que les offres d’aujourd’hui sont toujours les mêmes.

Ces défauts sont **identifiés et documentés, pas corrigés applicativement** pendant cet audit. Ne pas confondre ce diagnostic avec une nouvelle livraison de remédiation.

## 5. Priorité de certification : volume réel, pas ordre alphabétique

| Source non certifiée | Offres actives liées à cette source | Preuve employeur partielle en BDD |
|---|---:|---|
| Ulta Beauty — `ulta-jibe` | 10 290 | Oui |
| Foot Locker — `foot-locker-france` | 2 859 | Non |
| Pandora — `pandora-talenthub` | 2 077 | Non |
| WTTJ sectoriel — `wttj-sector` | 2 002 | Oui, sur certains employeurs ; pas sur le périmètre du board |
| L’Oréal — `l-oreal-professionnel` | 1 804 | Non |
| H&M Group — `hm-group` | 1 706 | Non |
| Boots | 1 608 | Non |
| Nordstrom | 1 575 | Oui |
| Estée Lauder Companies | 1 457 | Oui |
| PVH | 1 397 | Non |

Ces dix sources concernent **26 697 offres distinctes**, soit **35,4 % du catalogue actif**. Les lignes par source ne doivent pas être additionnées sans déduplication ; une offre peut avoir plusieurs sources.

Une certification réutilise les preuves valides déjà présentes et complète le maillon manquant (acteur officiel → portail exact → périmètre → configuration). Elle n’exige pas automatiquement une nouvelle ingestion. Pour WTTJ ou un cabinet, prouver le portail ne prouve pas l’identité de chaque employeur ni l’appartenance sectorielle de chaque offre.

## 6. Organisation du dossier : ce qui est normal et ce qui ne l’est pas

### Inventaire avant rangement

- `apps/aggregator` : **602 fichiers suivis**, environ 10,7 Mo.
- `src` : **501 fichiers**, dont code, tests et fixtures. Un adaptateur par protocole et des tests séparés sont normaux ; ne pas fusionner tout cela dans un fichier monolithique.
- `data` : **94 fichiers suivis**, dont **78 directement à sa racine**, environ 7,3 Mo : référentiels + exports + rapports + traces historiques mélangés.
- `src/discovery` : **97 fichiers**, comprenant de nombreux scripts d’investigation historiques, à distinguer du moteur de découverte courant.
- `audits` : **655 fichiers suivis**, neuf versions de tracker et plusieurs générations de rapports.
- `backups` : privé et non versionné. Des outils opérationnels importants (`deploy-guard.py`, `run-lot.sh`) n’existent actuellement que là.

Le problème n’est donc pas « 501 modules = mauvais code ». Le problème est **l’absence de frontière claire entre application, référentiels, outils de diagnostic, preuves et état de pilotage**.

### Nettoyage structurel du 10 septembre 2026

- **96 anciens outils retirés** : sondes ponctuelles, scripts de réparation historiques, ancien validateur CSV et dry-run d’emploi utilisant des colonnes supprimées. Les commandes obsolètes `purge` et `promote-validated` ont été retirées du CLI. La promotion courante garde sa revue d’identité obligatoire.
- **32 fichiers d’outillage conservés déplacés vers `scripts/`** : qualification/complétude, identité, secteurs, audits et réparations rejouables. Le code métier reste dans `src/`.
- **24 rapports et 64 exports/traces déplacés hors de l’application**, dans `audits/legacy-aggregator-reports/` et `audits/legacy-aggregator-data/` ; un ancien log privé reste dans `backups/cleanup-20260910/legacy-data/`. Les contenus sont conservés ; les scripts supprimés restent dans l’historique Git et dans l’archive privée du nettoyage.
- **10 référentiels et entrées utiles classés** dans `data/reference`, `data/imports` et `data/seeds`. Imports, Docker et lecteurs d’outils mis à jour ensemble.
- **Discovery : sortie explicite obligatoire**, hors de l’application. Le suivi d’avancement appartient au dossier de la passe ; aucune ancienne liste de domaines morts n’est chargée implicitement. Une liste optionnelle se fournit avec `--dead-list`.
- **Contrôle durable dans la CI** : structure du dossier, présence des référentiels et typecheck de tous les scripts TypeScript maintenus. Les `.mts` ne passent plus sous le radar du compilateur.

Les deux fixtures Saks déjà présentes sont conservées à l’identique. Le document de travail non suivi `lot-web-2026-09-10.md` est conservé à l’identique dans `audits/legacy-aggregator-data/discovery/`.

### Où se trouve la vérité ?

| Besoin | Référence réelle | Ne pas utiliser à sa place |
|---|---|---|
| Pilotage et diagnostic actuel | Ce document, daté, avec preuves | Un ancien checkpoint isolé |
| Sources opérationnelles et statut | Table PostgreSQL `Source` | `sources.csv`, `sources.discovered.csv`, exports |
| Entreprises / alias / relations | `Company`, `CompanyAlias`, revues correspondantes | Une égalité de nom ou un fichier de pistes |
| Certification du portail | Dernière `SourceIdentityReview` + validateur commun | Un compteur d’offres ou une revue d’alias seule |
| Offres, représentations et historique | `Job`, `JobSource`, observations et événements | Un total de scraper |
| Métier, contrat, secteur canoniques | Modèles/référentiels versionnés et chemins d’écriture | Labels de présentation du front |
| Preuve de collecte | Reçu daté, configuration et code identifiés, RAW | Une liste déclarée « complète » sans contexte |
| Preuve publique | Contrôle API/front lié aux mêmes IDs et instant | Un simple HTTP 200 |
| Archives privées et sauvegardes | `backups/`, accès local contrôlé | Git ou README public |

### Racine du dépôt nettoyée

La racine conserve les applications, packages, documentation, archives, dépendances et fichiers de configuration. **23 fichiers et deux dossiers historiques ont été retirés de la racine** : audits HTML répétés, anciens plans, maquettes, exports, copies de polices et ancien fichier workspace pointant vers d’autres projets.

- Les sept documents historiques suivis par Git sont conservés dans `audits/legacy-project-files/`, dont l’ancien handoff. Ils décrivent leur époque ; leurs commandes et chiffres ne remplacent pas ce README.
- Les 20 autres artefacts historiques et les deux classeurs des anciennes archives sont regroupés dans une archive privée vérifiée : `backups/cleanup-20260910/root-cleanup/legacy-project-artifacts.zip`. `RESTORE-INDEX.json` et `WORKBOOK-RESTORE-INDEX.json` conservent les chemins et empreintes ; les trois copies identiques du même audit HTML n’occupent qu’une entrée.
- Les quatre polices à la racine étaient identiques aux fichiers actifs dans `apps/web/public/fonts/` ; seules les copies inutiles ont été supprimées.
- `.env`, Git, réglages locaux, dépendances, code et sauvegardes PostgreSQL sont conservés. Les quelque 55 Go de `backups/` incluent un répertoire PostgreSQL de 34 Go et des dumps : leur rétention est un sujet distinct, aucun n’a été supprimé comme « fichier temporaire ».

Le contrôle `npm run check:layout -w @catwalks/aggregator` vérifie maintenant **la racine du dépôt et l’application**. Il refuse de nouveaux rapports ou exports non classés à la racine. Un nouveau fichier d’infrastructure légitime exige une mise à jour explicite de cette convention. Les preuves de conservation figurent dans le [reçu de nettoyage](../../audits/2026-09-10/cleanup/manifest.json).

### Arborescence de travail

```text
apps/aggregator/
  README.md               # état courant, diagnostic et procédures
  src/                    # application, tests et fixtures
  scripts/
    coverage/             # discovery, qualification, reçus et reporting
    identity/             # plans et application des réparations d’identité
    sectors/              # revue et application des secteurs
    trust/                # audits et backfills avec garde-fous
    enrich/               # backfill des dimensions d’emploi
    generate-country-labels.mts
    check-layout.mjs
  data/
    reference/            # données lues par l’application
    imports/              # entrées explicites pour rapprochement/import
    seeds/                # amorçage du catalogue, jamais vérité de production
  Dockerfile, start.sh, package.json, tsconfig*.json, vitest.config.ts

audits/                   # preuves datées ; historiques rangés à part
backups/                  # RAW, sorties de travail et sauvegardes privées
```

Depuis la racine du dépôt :

```sh
npm run check:layout -w @catwalks/aggregator
npm run typecheck
npm run test:unit -w @catwalks/aggregator
# Intégration uniquement avec DATABASE_URL pointant vers une base de TEST dédiée.
npm run test:integration -w @catwalks/aggregator
```

Discovery, uniquement lorsqu’une nouvelle recherche est autorisée :

```sh
npx tsx apps/aggregator/src/cli.ts discover --input=/chemin/acteurs.csv --output-dir=/chemin/prive/passe-discovery --limit=50 --concurrency=2
```

`--dead-list=/chemin/preuves-domaines.tsv` est optionnel. `--fresh` réexamine les tâches même présentes dans le journal de cette passe. Cette commande crée des candidats à revoir ; elle n’active pas les sources. Pour une mesure de complétude, suivre [la procédure coverage](scripts/coverage/README.md).

Les anciennes commandes mentionnées dans les rapports datés décrivent leur exécution historique. Les outils maintenus autrefois sous `src/coverage`, `src/identity/*.mts`, `src/sectors/*.mts`, `src/trust/*.mts` sont désormais sous `scripts/` avec la même sous-arborescence. Les sondes historiques `src/discovery/*.mts`, `validateSources`, `runval` et `checkelc` n’ont plus de commande active. Les nouveaux reçus conservent leur configuration, commit et date ; un déplacement de code ne requalifie pas un ancien reçu.

Les migrations et compatibilités encore nécessaires aux données historiques restent en place. Le référentiel `reference/maisons.csv` reste lu par la classification sectorielle : son autorité par rapport aux décisions sectorielles en BDD relève d’un chantier métier séparé. Des outils de livraison privés (`deploy-guard.py`, `run-lot.sh`) restent à rendre reproductibles dans le dépôt ; ils ne font pas partie du runtime nettoyé.

## 7. Plan de correction issu du diagnostic

| Priorité | Travail | Critère de validation |
|---|---|---|
| P1 — avant décision de reprise globale | Unifier certification / périmètre / admissibilité des lots autour du même validateur | Même verdict pour promotion, ingestion, tracker ; tests expiration, contradiction, hash modifié |
| P1 — avant utilisation des ratios | Ne plus compter un reçu de configuration ancienne comme preuve actuelle | Tapestry et Beiersdorf sortent des verdicts positifs non justifiés ; comparaison avec les derniers runs |
| P1 — volume | Qualifier d’abord les dix sources majeures puis les autres | Preuve exacte par source, nombre d’offres nouvellement couvertes par la garantie sans double comptage |
| P1 — visibilité réelle | Intégrer les parités L1–L7 et traiter les 640 offres sans source opérante | Chaque offre justifiée par une politique de fraîcheur / pause / retrait ; aucune suppression automatique |
| P1 — contenu | Terminer les limites Tapestry, Oniverse, périmètre Aptar et employeurs ambigus | Écarts identifiés, mesures actuelles, aucune date/pays/identité forcés |
| P2 — reproductibilité | Versionner les outils de livraison et d’audit réutilisables | Reprise possible depuis le dépôt + accès autorisés, pas un répertoire privé historique |
| Organisation — réalisée localement | Séparation référentiels / exports / outils ponctuels | Chemins migrés, contrôles de structure et typecheck des scripts ajoutés ; validation ci-dessous |
| P2 — LOT 4 | Achever discovery, qualification et passe globale autorisée, puis audit final | Critères de sortie du brief couverts individuellement, sans pourcentage composite inventé |

L’audit final n’exonère pas des validations intermédiaires. Les volumes présents ne suffisent pas à certifier un agrégateur mondial complet ou « sans erreur ».

## 8. Preuves et historique — ouvrir seulement selon le besoin

### Diagnostic présent

- [Mesures agrégées de production](../../audits/2026-09-10/diagnostic-identite/identity-summary.json).
- [Classement des 405 sources actives](../../audits/2026-09-10/diagnostic-identite/sources-classification.json) : statut strict, poids en offres, présence d’alias revus.
- [Protocole de mesure et hash du snapshot privé](../../audits/2026-09-10/diagnostic-identite/measurement-proof.json).
- [Inventaire des déplacements et hashes conservés](../../audits/2026-09-10/diagnostic-identite/document-moves.json).

Les snapshots complets et scripts de ce diagnostic sont dans `backups/diagnostic-20260910/` : données privées, non commitées. Le diagnostic s’appuie sur ces lectures, le code et les reçus archivés ; aucune nouvelle collecte ATS n’a été lancée.

### Nouvelle recherche web — à réconcilier, pas un catalogue validé

Le [rapport consolidé des lots web 1–2](../../audits/2026-09-10/discovery-web/2026-09-10-decouverte-web-lots1-2.md) est conservé tel que livré. **Ne pas importer ses lignes « absent vérifié » comme de nouveaux acteurs** : sa méthode compare des CSV historiques. Le snapshot de production du diagnostic contient déjà Swarovski (527 offres liées à sa source), Pandora (2 077) et Douglas (151). Ces nombres sont datés ; ils ne constituent pas une relecture de production au moment du rangement.

La synthèse du fichier annonce 26 nouvelles sources, sa section 2 contient 36 lignes et le message de livraison en annonce 37. Les catégories et compteurs doivent être recalculés après rapprochement par identité canonique et tenant. Les nouveaux portails découverts restent des pistes utiles, sans qualification implicite des acteurs ni preuve de couverture.

Les trois fichiers recréés dans `data/discovery` ont été retirés de l’application : rapport consolidé dans les preuves datées, deux brouillons conservés en privé. [Reçu de rangement et empreintes](../../audits/2026-09-10/discovery-web/filing-receipt.json). Les contenus ont été conservés à l’identique. Aucun import, retrait catalogue ou activation réalisé.

**Règle de travail :** `data/` contient uniquement `reference/`, `imports/`, `seeds/` et son README. Les livraisons de recherche vont dans `audits/<date>/<sujet>/` et sont reliées depuis ce README ; les brouillons et sorties privées vont dans `backups/`. Ne pas recréer `data/discovery`.

### Documentation technique maintenue

- [Architecture et règles de livraison](../../docs/architecture/production-foundations.md) : responsabilités, autorité des données, migrations, readiness et limites actuelles.
- [Identité des employeurs et des sources](../../docs/employer-identity.md) : certification, règles de résolution, commandes de réparation, alias et preuves de conservation.

Toute modification de ces mécanismes ou commandes doit mettre à jour le document concerné dans la même PR.

Ces deux documents ont été réécrits le 10 septembre 2026 après comparaison au code. Ils décrivent les mécanismes et leurs limites ; les chiffres et l’avancement restent dans ce README. L’ancienne procédure de six migrations et les chemins `src/identity/*.mts` ne sont plus les consignes courantes.

### Éléments du LOT 4

- [Brief complet et critères de sortie](../../audits/2026-09-09/lot4-world-coverage/brief.md).
- [Dernier rapport de livraison détaillé](../../audits/2026-09-09/lot4-world-coverage/qualification-2026-09-10-b.md).
- [Tracker v9 historique](../../audits/2026-09-09/lot4-world-coverage/tracker-v9/proof-dimensions-summary.json) — utiliser avec les réserves du § 4.
- [Outils de qualification](scripts/coverage/README.md).
- [Historique de reprise](../../audits/legacy-project-files/HANDOFF_LOT4_2026-09-09.md).
- [Anciennes décisions datées](../../CLAUDE.md).
- [Rapports historiques archivés](../../audits/legacy-aggregator-reports/).

## 9. Statut de cette intervention

**Audit et nettoyage structurel locaux réalisés.** Le rangement inclut des changements applicatifs de chemins et de CLI ; les défauts métier des sections 3–4 restent documentés, sans remédiation silencieuse. Aucune réparation de données de production, ingestion, modification de cron, merge ou déploiement dans cette intervention.

Validation locale : résultats et inventaire vérifiable dans [le reçu de nettoyage](../../audits/2026-09-10/cleanup/manifest.json). Les journaux complets sont privés dans `backups/cleanup-20260910/`. Les contrôles d’intégration utilisent une base de test dédiée. Aucun test de charge.

Tests validés : **1 694 unitaires agrégateur, 265 intégration, 98 unitaires web et 14 tests web avec BDD** ; les 14 passent aussi au deuxième lancement. Typecheck application/scripts/front, syntaxe Python, empreintes des données et contrôle de structure passent. Le générateur CLDR reproduit le référentiel sans changement.

**Docker débloqué et validé le 10 septembre :** le disque de données Colima était limité à 40 GiB, rempli à 98 %. Capacité portée durablement à **60 GiB** ; les 13 conteneurs auparavant actifs ont été restaurés, les cinq autres restent arrêtés. Aucun volume ni image supprimé. Le build local `catwalks-aggregator:local` passe ; référentiels, Chromium et garde de périmètre CLI vérifiés dans l’image. Après build : **14,69 GiB libres dans Docker**, 26,90 GiB sur le disque hôte selon le contrôle préalable. [Preuve complète](../../audits/2026-09-10/cleanup/docker-recovery.json).

Commande de build local recommandée :

```sh
npm run build:local -w @catwalks/aggregator
# Mesure seule, sans build :
npm run build:local -w @catwalks/aggregator -- --check
```

Cette commande exige 12 GiB libres côté Docker et 8 GiB côté hôte avant le build. Elle mesure le disque Docker avec un conteneur Alpine éphémère, en lecture seule et sans réseau (`--pull=never`). Sur une nouvelle machine, préparer l’image de sonde `alpine:latest` ; si elle manque, le contrôle échoue explicitement. Les seuils sont des marges préventives, pas une garantie pour toute taille future du projet. Ils sont configurables via `BUILD_MIN_DOCKER_FREE_GIB` et `BUILD_MIN_HOST_FREE_GIB`. Le script ne supprime jamais de volume, image ou cache. Pour Colima : `colima ssh -- df -h /var/lib/docker` mesure la capacité réelle ; l’agrandissement suit [la procédure officielle](https://github.com/abiosoft/colima/blob/main/docs/FAQ.md#how-can-disk-size-be-increased) et nécessite de préserver/restaurer les services locaux.

**Limites restantes :** image validée localement sur arm64, non déployée. Les quatre tests web sur corpus réel nécessitant une copie de production dédiée n’ont pas été exécutés. L’installation npm signale deux avis de sécurité modérés ; aucune dépendance n’a été modifiée pour ce dépannage. Les modifications de cette intervention restent locales et non commitées.

## 10. Mission de reprise — ajout et certification des sources

Périmètre : qualifier les candidats issus de la recherche web et vérifier les sources existantes auxquelles ils correspondent, puis remettre un état exploitable au développeur chargé de terminer le LOT 4. Cette mission ne vaut pas clôture du lot mondial.

1. **État de départ réel.** Lire le diff local et ce README ; intégrer le nettoyage sans réintroduire ses fichiers historiques. Relever le commit, les services déployés et le statut réel des runs/crons avant toute opération. La production, pas les CSV historiques, détermine ce qui existe déjà.
2. **Rapprochement déterministe.** Pour chaque ligne, rechercher entreprise canonique, alias, groupe, source et `tenantKey`. Classer séparément nouvel acteur, nouveau portail d’un acteur existant, source déjà couverte, configuration à réparer ou piste non résolue. Recalculer les compteurs du rapport ; « absent vérifié » dans ce rapport n’est pas une autorisation de création.
3. **Preuve d’identité.** Archiver le lien officiel acteur → portail carrière → ATS, la configuration exacte, le tenant/site, la date et le périmètre `SINGLE_BRAND` / `MULTI_BRAND`. Conserver les libellés bruts et alias. Une source de groupe n’est pas automatiquement une Maison ; un portail mono-marque ne doit pas absorber une contradiction employeur explicite.
4. **Qualification technique mondiale.** Employer l’adaptateur existant, le corriger ou en créer un réutilisable si nécessaire. Tester sur les réponses natives réelles : pays, langues, pagination, facettes, plafonds, identifiants, doublons, rejets et détails. Conserver RAW et reçus. Une collecte complète d’un flux ne prouve pas la couverture de tous les portails mondiaux.
5. **Chemin d’enregistrement existant.** Utiliser `registerSourceCandidate` (`src/connectors/sourceCandidate.ts`) pour une source nouvelle en DRAFT, puis les revues `SourceIdentityReview` et `promoteSource` (`src/connectors/sourceStore.ts`). Le CLI expose `identity-profile`, `review-source-identity` et `promote`. Une source existante exige une revue explicite de sa configuration ; ne pas écraser ses réglages ni réactiver une source retirée par simple rejeu. Respecter les autres préconditions de promotion : accès daté et offre réelle vérifiée. Un portail sans offre réelle peut être documenté sans activation.
6. **Fondations et corrections.** Traiter les divergences de validation et de reporting décrites aux § 3–4 avant de s’en servir pour certifier automatiquement des lots. Ne pas transformer une preuve absente, périmée ou de configuration différente en résultat positif.
7. **Livraison et témoins.** Pour les écritures de production : sauvegarde fraîche, clone, répétition, contrôle des invariants et rejeu idempotent. Pour le code : tests, diff revu, commit, merge, déploiement contrôlé ; aucun déploiement pendant un run. Après activation, une ingestion bornée autorisée puis réconciliation source → BDD → API/front. Pas de relance globale ni dégel des crons dans cette mission.
8. **Remise au développeur du LOT 4.** Un tableau par acteur/source indiquant identité, périmètre, configuration, collecte, détails, ingestion et visibilité, chacun avec preuve datée. Fournir également nouveautés réelles, doublons évités, alias créés, offres collectées/publiées/rejetées et écarts restants. Séparer code corrigé, commit, main, déploiement et données réparées. Ce bilan alimente la suite du LOT 4 sans annoncer une couverture mondiale non démontrée.

**Organisation :** état courant dans ce README ; preuves datées dans `audits/` ; RAW et brouillons privés dans `backups/`. Ne pas recréer `data/discovery`, un nouveau fichier « master » ou un handoff concurrent. Les variations d’acteurs/alias restent des données ; pas de branches de code propres à chaque Maison. Aucune offre ne disparaît faute de canonisation et aucune fusion ambiguë n’est forcée.

## 11. Reprise du 10 septembre 2026 (après-midi) — état courant et prochaines actions

**Responsable unique : le développeur LOT 4.** Le nettoyage de la matinée est commité et déployé tel quel (PR 79, `eb72236`) après re-vérification (1 694 tests, typecheck application + scripts, `check:layout`, préflight Docker). Crons gelés ; aucune reprise globale.

### Corrigé et déployé depuis ce diagnostic

| Défaut (§ 3–4) | Correctif | Preuve |
|---|---|---|
| Périmètre `SINGLE_BRAND` lu avec verdict + hash seulement dans l’ingestion | `portalScopeOf()` applique le validateur strict de la promotion (âge, méthode, artefact, page officielle) — PR 82 | `sourceIdentity.test.ts` |
| `SINGLE_BRAND` créditait tout libellé natif au propriétaire | un libellé qui nomme un employeur canonique distinct est refusé (revue) ; une entité fusionnée reste le propriétaire — PR 82 | `identity-gate.test.ts` |
| Reçus de configuration non courante comptés comme preuves | `snapshot.mts` porte le verdict strict d’identité ; `proof-dimensions.py` / `qualify-tracker.py` le lisent ; reçu non courant ⇒ `NOT_PROVEN` / `STALE_RECEIPT` — PR 82 | recalcul sur photographie du 10/09 : identité 45/405, énumération 391 → 389, collecte 384 → 382 (Tapestry, Beiersdorf) |
| Collecte et publication confondues (Aptar Pharma, restauration URBN) | `PostingScopeDecision` : décision par offre (verdict, règle, motif, preuve) ; OUT_OF_SCOPE ⇒ retenue archivée + retrait `OUT_OF_SCOPE`, jamais une clôture, jamais ré-attesté — PR 78 | run L8 aptar-beauty : 38 retraits, 0 clôture, collecte intacte |
| Attribution par entité juridique sur un tenant qui code l’enseigne | Workday `brandFromLocationPrefix` (Saks : NM/SF/BG/O5) — PR 78 ; revue propriétaire par code de lieu | `workday.locationPrefix.test.ts` (747 lignes réelles) |
| Plafond `total` Workday (2 000) et attribution par facette | `partitionFacet` — PR 76 ; Tapestry 2 086 offres attribuées (L7) | `qualification-2026-09-10-b.md` § 7.2 |

### Procédure B6 sécurisée (validée par Loïc, 2026-09-10 après-midi) — les cinq points

| Point | Ce qui manquait | Ce qui est en place | Preuve |
|---|---|---|---|
| Arrêt immédiat sur erreur | chaînes `cmd \| grep \| tail` (exit code de `tail`), attente de déploiement non bloquante | `b6-batch.sh`, `b6-certify-existing.sh`, `b6-repair-chain.sh` : `set -eu`, une étape = une commande journalisée, arrêt et extrait d'erreur ; `lot-run-chain.sh` sort en erreur si le déploiement attendu n'est pas SUCCESS et ne restaure jamais par-dessus un run encore en cours | journaux `backups/lot4-20260909/b6-<lot>/`, `repair-<nom>/` |
| Commit déployé vérifié | le run pouvait tourner sur une autre image | `run-lot.sh` relit révision du `PipelineRun` = `origin/main`, statut COMPLETED, 0 échec d'écriture, 0 `SourceRun` non attestant | `lot-<lot>-after-run.json` |
| Verdict d'accès explicite | `robots.txt` absent ou injoignable pouvait valoir ALLOWED | `src/lib/candidateChecks.ts` : ALLOWED / DISALLOWED **lus** (statut HTTP + sha256), NO_ROBOTS (404/410), UNREACHABLE (401/403/429/5xx/réseau) ; seul un ALLOWED lu est promouvable | 10 tests ; note de la source ; `b6-validate-<phase>-<clé>.json` |
| Board exact et périmètre prouvés | `mustContain` libre ; périmètre déclaré sans confrontation aux libellés | certification refusée si la page officielle ne nomme pas le board **configuré** (référence dérivée de la config) ou si les libellés natifs lus contredisent SINGLE_BRAND (`classifyLabel` OWNER / OWNER_ENTITY / OTHER) ; l'énoncé de revue cite la référence et les libellés | `b6-integrate.mts certify` ; `b6-retro-controls.md` |
| Sauvegarde avant la première mutation | dump pris avant le run, pas avant register/certify/promote | dump frais **restauré sur le clone** avant toute mutation de production ; répétition sur le clone (ingestion bornée locale incluse) puis production | `b6-<lot>-backup-proof.json`, `repair-<nom>-backup-proof.json` |

Volumes désormais séparés par `lot-volumes.mts` : collectées → retenues (holds / refus d'identité / échecs d'écriture / hors périmètre) → écrites → publiées BDD → API publique, avec un verdict de complétude indépendant de l'activation. Contrôle rétrospectif des 9 sources B6 déjà intégrées : accès, board, déploiement conformes 9/9 ; **3 défauts d'attribution trouvés et réparés** (Ysé publié sous son entité juridique en doublon ; On et La Prairie sous une clé « source-scoped ») — cause racine corrigée dans la porte (PR 84 : propriétaire d'un portail SINGLE_BRAND = Maison du catalogue, création sous clé canonique), réparation sous protocole (347 offres déplacées, rejeu 0). Détail : `audits/2026-09-09/lot4-world-coverage/qualification-2026-09-10-b.md` § 7.5.

**Inventaire de suivi unique** : `audits/2026-09-09/lot4-world-coverage/inventory-unique/` (généré par `scripts/coverage/unified-inventory.mts` + `inventory-readme.py`) réconcilie les 1 653 libellés FashionJobs, le rapprochement web (65), les marques de portefeuille (275), les candidats B6 (33 tenants), les sociétés actives et la table `Source`, avec les dénominateurs de chaque jeu et une ligne par acteur dédupliqué. Tableau final par source : `scripts/coverage/final-table.mts`.

### Fin de la passe B6 (10 septembre, soir) et travaux restant pour clore le LOT 4

**Passe B6 — terminée pour le périmètre engagé** (33 tenants qualifiés au matin) : 27 nouvelles sources activées et 6 sources existantes certifiées sous la procédure sécurisée, toutes avec dump frais → clone → production → run borné → volumes séparés → vérification hors ligne par identifiant et motif → parité API. Détail : `audits/2026-09-09/lot4-world-coverage/qualification-2026-09-10-b.md` § 7.5 à 7.10 ; preuves dans `qualification-0910b/`.

| Tenant / acteur | Sources | Résultat | Écart explicite (non résolu) |
|---|---:|---|---|
| Lot n°1 (Armand Thiery, On, Boardriders, American Vintage, Ysé, La Fée Maraboutée, Shinola, La Prairie) + Arc'teryx | 9 | 955 offres publiées, parité 9/9 ; 3 défauts d'attribution trouvés par le contrôle rétrospectif et réparés (347 offres) | Greenhouse : pays absent quand le bureau n'a pas d'adresse (On 218/309) |
| Fast Retailing (UNIQLO, GU, Theory, Fast Retailing) | 16 (3 certifiées + 13 activées) | UNIQLO 566 · Theory 24 · Fast Retailing 13 · GU 9 ; 11 entités juridiques fusionnées ; 14 alias revus | — |
| KnitWell Group (LOFT, WHBM, Chico's, Lane Bryant, Soma, Talbots, Ann Taylor, Haven Well Within, Off The Rax) | 4 (1 certifiée + 3 activées) | 2 116 collectées, 2 113 publiées, 27 alias revus, parité 9/9 | 2 libellés d'entité laissés en revue (2 offres, non publiées) ; 1 ligne sans chemin par site ; la source n'atteste pas l'absence tant que les libellés ne sont pas résolus |
| VF Corporation (+ Icebreaker) | 1 | MULTI_BRAND, 578 publiées sur 1 273 collectées, parité 2/2 | **695 offres sans employeur dans le détail : archivées, tenues, non publiées** (décision Loïc : jamais créditées au groupe pour publier) |
| Lagardère Travel Retail | 2 (1 certifiée + DE activée) | acteur unifié (130 offres rapatriées de l'orthographe « Lagardère Travel ») | Talentsoft : aucun pays ni employeur dans la liste (à vérifier sur le détail avant de qualifier de limite éditeur) |
| Homonyme retiré | 1 | `loft` (proptech brésilienne sous la marque LOFT) : 62 offres retirées D27 | — |
| Non activés | — | Soeur et Luxexperience (doublons), Galderma (hors périmètre), KS Groupe (cabinet d'intérim : **arbitrage Loïc**) | — |

**Ce qui reste pour clore le LOT 4** — mesuré le **2026-09-10 à 19:11Z**, même instant que la référence ci-dessous (`inventory-unique/uncertified-families.md`, pré-tri généré, pas une certification) :

| Famille | Sources | Offres actives | Blocage réel | Prochaine action (mécanismes existants) |
|---|---:|---:|---|---|
| Portails de groupe non certifiés | 30 | 9 421 | aucun technique ; alias par libellé à revoir | `b6-aliases.mts` + `b6-certify-existing.sh` (méthode Saks / KnitWell), par lots |
| Homonymie suspecte | 26 | 1 510 | l'identité peut être fausse (cas `loft`) | audit hors ligne des titres / pays / hôtes archivés ; `retire-source` ou alias, puis certification |
| Portail sur le domaine officiel de la Maison | 83 | 9 858 | aucun | `b6-certify-existing.sh` par lots de 10–15 (OFFICIAL_DOMAIN) |
| Lien réciproque officiel déjà archivé | 12 | 333 | aucun | `b6-certify-existing.sh` (OFFICIAL_LINK) |
| Jobboards / balayage sectoriel / cabinet | 3 | 2 490 | identité de board : décision Loïc | — |
| Aucun lien officiel archivé | 189 | 8 610 | recherche à mener ; quelques sites illisibles (WAF) | `research-portals.mts` ciblé, puis certification ; blocage daté sinon |
| **Total non certifié** | **343 / 433 actives** | 32 222 | | |

Autres dossiers ouverts : attestation d'absence par partition (Tapestry, 97 offres dé-listées) ; `wttj-sector` (identité de board) ; 640 offres sans source opérante (conservation / retrait) ; Menus & Venues, Versace, Swarovski (décisions Loïc / sites illisibles) ; reprise des crons (décision Loïc, distincte de cette clôture). Le tableau final par source avec les **cinq états** (officielle · opérationnelle · exhaustive · attribution · publication) est `final-table.md`, régénérable.

### LOT P1 (10 septembre, soir) — une référence mesurable avant toute reprise de production

Objectif : fiabiliser les mesures et figer le périmètre restant, sans réaudit complet et sans aucune ingestion. Aucune donnée de production n'a été mutée ; crons gelés.

**Environnement vérifié à 19:07–19:08Z** : tree propre et aligné sur `origin/main` (`50b8095`) ; 42 migrations locales = 42 appliquées en production, 0 en attente, 0 inconnue, 0 en échec ; les trois workers portent le sentinel de gel `0 0 29 2 *`, `PIPELINE_PAUSED=1`, aucune `INGEST_ONLY_KEYS` résiduelle ; déploiements SUCCESS ; **aucun run en cours**.

Le contrôle de gel est désormais un outil du dépôt, `scripts/ops/read-crons.py` (**lecture seule**, sort en échec si un cron n'est pas gelé, si `PIPELINE_PAUSED` n'est pas posé ou si une `INGEST_ONLY_KEYS` traîne) — il ne dépend plus de `backups/`, et il est distinct de la mutation `freeze-crons.py`.

**La mesure de référence** — `scripts/coverage/reference-snapshot.mts`, une **seule transaction en lecture seule**, donc tous les chiffres partagent le même instant. C'est le correctif du défaut de fond : deux rapports du même après-midi annonçaient « 344 non certifiées sur 432 actives, 88 certifiées » (18:19Z) et « 90 certifiées sur 433 » (18:46Z) — deux photographies différentes lues comme un même état. Le prédicat de certification est **celui de la porte de promotion** (`assertIdentityReview`, même ordre `createdAt desc` : une contradiction ultérieure prime), jamais une seconde logique.

| Indicateur (2026-09-10 19:11Z) | Valeur | Dénominateur explicite |
|---|---:|---|
| Sources | 433 ACTIVE · 8 PAUSED · 91 RETIRED | 532 lignes `Source` |
| Certifiées au contrat strict | 90 | 441 ACTIVE/PAUSED |
| Non certifiées (= 433 − 90 des ACTIVE) | 343 | familles : 30 G · 26 A · 83 B · 12 C · 3 D · 189 E = **343**, 32 222 offres |
| Offres actives | 79 516 | dont **0** sans source ACTIVE/PAUSED |
| Représentations actives | 81 586 | 2 070 de plus que les offres : **2 047 offres multi-sources** (unité distincte, jamais confondue) |
| Dernier run par source | OK 222 · DEGRADED 192 · NEW 26 · BROKEN 1 | 441 ; **0 source sans aucun run** |
| Attribution employeur | PROUVÉE 40 · partielle 27 · observée sans revue 21 · **non observée 353** | 441 |

**Deux périmètres coexistent et ne se contredisent pas** : `unified-inventory.mts` compte les **ACTIVE seules** (433), la référence et `final-table.mts` comptent **ACTIVE + PAUSED** (441). Le pont est imprimé dans la référence : les 8 sources PAUSED apportent 8 runs OK (214 + 8 = 222) et 1 513 représentations (80 073 + 1 513 = 81 586). Un rapport qui cite l'un de ces chiffres doit citer son périmètre.

**Quatre défauts de mesure corrigés, chacun prouvé avant correction :**

1. **Un défaut ouvert arrondi à « 100 % ».** La synthèse affichait « Publication vérifiée 440 | 100 % » alors que 440 lignes sur 441 passaient : `Math.round(100 × 440 / 441) = 100` effaçait le seul défaut ouvert (`ulta-jibe`, société résiduelle « Ulta Beauty, Inc. », 1 offre). Corrigé par `src/coverage/reporting.ts` (`share`) : **99,8 % (440/441)**, et « 100 % » est réservé à l'unanimité. Testé, y compris 9999/10000 → 99,9 %.
2. **Le dénominateur de l'attribution était tronqué.** Le taux ne portait que sur les représentations *observées* (26 265 sur 81 586). Les 353 sources sans aucune observation apparaissaient comme « no observation » dans la même colonne qu'un échec mesuré. Corrigé : le dénominateur est **toute** représentation active, et `NOT_VERIFIED` est un état distinct — jamais un succès, jamais un échec. Effet : attribution prouvée **58 → 40**, « les cinq états à la fois » **33 → 25**. Les deux implémentations indépendantes (référence SQL et tableau final) donnent désormais exactement 40 / 353 / 27 / 21.
3. **Fenêtre glissante non datée.** « aucun sur 7 j » confondait « aucun rejet » et « rejets hors fenêtre ». La fenêtre est désormais **datée dans l'en-tête du tableau** et dans chaque cellule.
4. **Le CSV de référence servait une colonne `sourceKey` vide** (en-tête `sourceKey`, champ `key`) — corrigé et re-généré.

**Point 4 du lot — quatre questions séparées, là où un seul compteur servait de preuve** (`scripts/coverage/public-visibility.mts`, échantillon explicite, jamais un load test) : parité des compteurs · égalité des identifiants · visibilité réelle de la fiche · éligibilité Google Jobs. Sur les 25 sociétés les plus fournies, 2 fiches échantillonnées chacune : compteurs **25/25**, identifiants **25/25**, fiches joignables **25/25**, éligibilité **24/25**. La séparation a immédiatement trouvé ce que le compteur masquait :

> **Défaut ouvert — 1 452 offres actives sans `postedAt`, donc sans JSON-LD `JobPosting`, donc inéligibles Google Jobs** alors que leur page répond 200 sans `noindex`. Concentré à 76 % sur une source : `ralph-lauren-avature`, **1 103 offres sur 1 104 non datées** (les autres sources Avature datent 95 % de leurs offres : L'Oréal 1 676/1 804, adidas 1 079/1 142). Le RAW archivé de cette source ne conserve que `source`, `reference`, `department` : **il ne permet pas de trancher hors ligne**. L'adaptateur exige un format strict `Posted 01-Oct-2026` (`DATE_MARKER`) et perd la date en silence sinon — même motif que le défaut L'Oréal corrigé le 2026-09-05. **Ce n'est donc pas qualifié de limite éditeur** : le test discriminant (lire une carte réelle du board Ralph Lauren et comparer au marqueur) demande une collecte, hors périmètre de ce lot, et est la première action de P2.

**Ce que ce lot ne prouve pas** : les 416 sociétés non échantillonnées par le contrôle de visibilité sont **non vérifiées**, pas conformes ; les 353 sources sans observation d'identité restent sans preuve d'attribution ; la cause du défaut Ralph Lauren reste à établir par observation.

### En cours ou restant

- **Saks / Exemplar Luxury Group — fait** : revue propriétaire (1 621 opérations), re-certification MULTI_BRAND, run borné L9 (742/746 complet, 0 refus) : Neiman Marcus 420 · Saks Fifth Avenue 189 · groupe 133 · Bergdorf Goodman 66 · Saks OFF 5TH 27, parité 5/5 (`qualification-2026-09-10-b.md` § 7.2).
- **Rapprochement du rapport de découverte web** : outil `scripts/coverage/reconcile-discovery.mts` (lecture seule, BDD courante) ; résultat `audits/2026-09-10/discovery-web/reconciliation.md` — 65 lignes : déjà couvertes 10, configuration/attribution 10, nouveaux acteurs 21, nouvelle source d’un acteur existant 3, investigation 21. Swarovski et Pandora sont couverts (sources ACTIVE), Douglas est le même portail sous un autre hôte.
- **Certification par volume — fait** : les dix sources du § 5 sont certifiées (2 SINGLE_BRAND, 8 MULTI_BRAND dont 2 par défaut faute de libellés dans les reçus) → **56 sources actives certifiées sous le contrat strict** (tracker v10 : `audits/2026-09-09/lot4-world-coverage/tracker-v10/`). `wttj-sector` reste à traiter comme un board, pas comme un portail d'employeur.
- **Périmètre B6** : `audits/2026-09-09/lot4-world-coverage/b6-candidates-sector.md` (33 tenants : 28 dans le périmètre, VF multimarque, Luxexperience doublon YNAP, Galderma hors périmètre, 2 en revue) ; rien n’est activé sans certification + décision sectorielle + ingestion bornée + parité front.
- **Décisions de Loïc** : Menus & Venues (recommandation : hors périmètre, exclusion de publication sans retrait — script prêt, `--owner-go`), captures officielles Versace / Swarovski, reprise des crons.
- **Attestation d’absence par partition** (Tapestry : 97 offres dé-listées non fermables tant que la source n’atteste pas) — à construire dans `attestation.ts`.
- **Checklist de clôture** : `audits/2026-09-09/lot4-world-coverage/closure-checklist.md` (terminé / restant / bloqué, fin de passe B6 ≠ fin du lot).
