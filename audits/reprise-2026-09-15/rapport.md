# CATWALKS : audit de reprise du 15 septembre 2026

## Décision

**La fondation existe, mais l’agrégateur n’est pas prêt pour une exploitation quotidienne autonome.** Les blocages portent sur la vérité des données, le cycle de vie et le cloisonnement des marchés. La quantité de tests et les déploiements réussis ne couvrent pas ces défauts.

La direction retenue est celle d’un moteur spécialisé de recherche d’offres : **publication native de chaque source → observations conservées → faits traçables → recherche par marché**. Les taxonomies restent des enrichissements de recherche, explicitement séparés des déclarations de l’employeur. Une fusion approximative ne doit plus décider quelle annonce ou quelle valeur existe.

Le terme « canonique » recouvre actuellement plusieurs choses. Il faut retirer la normalisation universelle forcée et les fusions non prouvées. Il faut conserver les identifiants techniques stables, les rapprochements exacts et les URL canoniques SEO nécessaires. Effacer l’historique ou les preuves ne supprimerait pas la dette : cela supprimerait la possibilité de corriger les erreurs.

## Périmètre, méthode et limites

- Cinq dépôts examinés, remotes GitHub actualisés sans prune ; branches, commits, PR, worktrees et fichiers locaux inventoriés avant intervention.
- PostgreSQL Railway : mesures sous `default_transaction_read_only=on`, transactions explicitement `READ ONLY`, délais de requête bornés. Aucun outil de migration ou de test d’écriture dirigé vers une base réelle.
- Énumération récursive de **toutes les 85 327 représentations JobSource actives reliées à une offre publique**, dans un même snapshot : **3 538 combinaisons famille / chemin JSON / type**. Les tableaux sont parcourus. Ce n’est pas un échantillonnage des seules clés racines.
- Mesures principales : 15/09/2026, 13:03 à 13:17 UTC. Les horodatages et dénominateurs exacts sont conservés dans les preuves. Chaque groupe de requêtes a son propre snapshot ; l’ensemble n’est pas une transaction globale multi-services.
- Exécution des tests d’agrégation et de l’API contre un **PostgreSQL 18 local jetable**, créé pour cet audit ; build et navigateur locaux pour le website ; contrôles Railway du Journal via SSH/psql en lecture seule, sans connexion à un hôte applicatif interne.
- **Pas de recollecte exhaustive des 536 portails tiers.** « Dernier statut » signifie dernier état enregistré, et non un test HTTP effectué aujourd’hui. Le CSV indique cette limite pour chaque source. Les coûts contractuels/API et les budgets de production ne sont pas établis.
- Le code applicatif existant n’a pas été corrigé pendant cette phase d’audit. Les fichiers déjà modifiés ont conservé leurs empreintes. Aucun push, merge, déploiement, changement de cron ou écriture de production.

### Livrables de preuve

| Fichier | Contenu |
|---|---|
| [inventaire-git.md](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/inventaire-git.md) | Toutes les références, travaux locaux, worktrees et PR interrogées, dépôt par dépôt |
| [sources.csv](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/sources.csv) | Les 536 sources, volumes, pays, états, preuves d’absence, signaux RAW et statut de validation |
| [adaptateurs.md](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/adaptateurs.md) | Les 43 familles enregistrées, dispatch, pagination, détails et points de stockage RAW |
| [couverture-marches.csv](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/couverture-marches.csv) | 119 codes pays présents + pays inconnu ; numérateurs exacts par dimension |
| [raw-chemins.csv](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/raw-chemins.csv) | Inventaire récursif complet des chemins et types observés |
| [raw-signaux.json](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/raw-signaux.json) | Qualification conservatrice des quatre dimensions commencées dans la passation |
| [preuves/](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/preuves) | Tests, reproductions, déploiements, mesures et captures navigateur |
| [plan.md](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/plan.md) | Ordre d’exécution, composants, risques, tests et critères de fin |

Les réponses sources complètes et les configurations d’accès ne sont pas copiées dans les livrables destinés au dépôt public. L’empreinte SHA-256 du snapshot RAW est enregistrée dans `preuves/raw-inventaire.json`. Les payloads complets de travail restent locaux, hors dépôt.

## A. Git / GitHub

| Dépôt | Branche / HEAD local | Situation distante et locale |
|---|---|---|
| Agrégateur, `lmelane/fr-retail-jobs` (public) | `mesure-vocabulaire-contrat` / `9504c9f` | 8 commits absents des refs distantes ; 5 fichiers suivis modifiés + 26 non suivis. `origin/main=dd3e24d`. Comparaison par ascendance : HEAD a 9 commits propres, main 1. |
| Website, `lmelane/catwalks-front-end` | `front-f1-sauvegarde` / `cd25cef` | 12 commits non poussés sur HEAD ; 14 toutes branches confondues. 6 fichiers suivis modifiés + 5 non suivis. `origin/main=bccf541`, revert de FRONT F1. Aucun PR ouvert. |
| Backend, `lmelane/catwalks-back-end` | `main` / `63f61fa` | Synchronisé ; 2 fichiers suivis modifiés + 2 non suivis, dont alias d’anciens slugs et script de rattachement de Maisons. |
| Back-office, `lmelane/catwalks-backoffice` | `main` / `75c594b` | Propre, synchronisé, aucun PR ouvert. |
| Media, `lmelane/catwalksmedia` | `main` / `086f75c` | HEAD synchronisé ; **14 fichiers suivis modifiés + 26 non suivis**. Traduction, migration 025, tests et routes EN non commités. Aucun PR ouvert. |

### Commits nommément demandés

| Commit | Présence constatée |
|---|---|
| `959a705` | Agrégateur, branche locale actuelle ; absent des refs GitHub et de main |
| `375ee61` | Website, branche locale actuelle ; absent des refs GitHub et de main |
| `cd25cef` | HEAD website ; absent des refs GitHub et de main |
| `9504c9f` | HEAD agrégateur ; absent des refs GitHub et de main |
| `c54b937` | Commit website retrouvé : câblage des libellés de filtres natifs ; local non poussé |

Les huit commits non poussés de l’agrégateur couvrent les villes par marché, BE, CN, commentaires, expérience/études, retrait de la séniorité déduite de la promesse, couverture occupationCode et parité des facettes. Les douze du website couvrent les sélecteurs, la langue, les marchés et leurs filtres. Les deux autres commits locaux du website (`c56a5f7`, `1b12f0a`) subsistent sur une autre branche : ne pas les appliquer aveuglément en plus du travail présent.

### PR encore ouvertes de l’agrégateur

- [#168 : chore: code mort retiré, chiffres périmés remplacés par des mesures (lot 4A)](https://github.com/lmelane/fr-retail-jobs/pull/168). Le HEAD distant contrôlé est `be5c61c`. Ses contrôles verts ne valident **pas** les huit commits locaux suivants.
- [#160 : Taxonomie v2 — optique et pharmacie au périmètre (décision propriétaire)](https://github.com/lmelane/fr-retail-jobs/pull/160). Branche `p10-optique-pharmacie`, `7cf74cf`, non mergée ; contrôle agrégateur en échec, contrôle web vert au contrôle GitHub. Pourtant la base annonce déjà `catwalks-occupations-20260914-v2` comme release active : **code versionné, déploiement et données ne forment pas une livraison unique**.

Les déploiements Railway agrégateur/API/refresh/reconcile annoncent `dd3e24d`, le main distant, et non le HEAD local. Aucun des travaux locaux ci-dessus ne doit donc être présenté comme déployé.

## B. Historique réconcilié

Les statuts de code, Git et exploitation sont séparés : un correctif peut être présent localement tout en restant incomplet à l’écran.

| Lot historique | Statut actuel | Preuve / réserve |
|---|---|---|
| Ouverture CN amont / website | **LOCAL NON POUSSÉ ; PARTIEL** | Deux commits retrouvés ; CN au registre. Ni interface zh-CN ni cloisonnement des résultats par `marche` seuls. |
| Ouverture BE amont | **LOCAL NON POUSSÉ** | `bc785e8`, registre et témoins présents. |
| CA/NL/AU website, anciennes offres inaccessibles | **LOCAL NON POUSSÉ** | `0abad0f`. 6 212 était un chiffre historique ; couverture actuelle mesurée séparément. |
| Libellés natifs des filtres | **LOCAL NON POUSSÉ ; PARTIEL** | `c54b937` ; en-têtes natifs visibles. Valeurs et nombreux textes restent français. |
| Facettes website sous seuil | **LOCAL NON POUSSÉ ; CONFIRMÉ** | `cd25cef`, rendu et tests ; copie locale du registre. |
| Parité amont des facettes | **LOCAL NON POUSSÉ ; CONFIRMÉ** | `9504c9f`, tests exécutés. La duplication des registres subsiste. |
| Séniorité déduite retirée de la promesse | **LOCAL NON POUSSÉ ; CONFIRMÉ sur la chaîne candidate étudiée** | Registre et projection candidat ; moteur/colonne internes conservés. Pas de colonne `seniorityConfidence` dans le schéma. |
| Couverture métier sur occupationCode | **LOCAL NON POUSSÉ ; CONFIRMÉ** | `b33e628`, `35e2df9`. La famille n’est pas devenue automatiquement la facette publique. |
| Expérience et études depuis RAW | **LOCAL NON POUSSÉ ; PARTIEL** | `9fed10a` lit des champs supplémentaires, mais la réattestation ne les propage pas et educationLevel reste nul partout en production. |
| Horaires/workSchedule | **PARTIEL** | Migration présente et appliquée en base ; colonne renseignée sur 0 offre publique. |
| Quatre dimensions RAW, scripts D435-D437 | **PRÉSENTS ; MÉTHODE INSUFFISANTE** | Ancienne exploration racine/préfixes, seuils/échantillonnage et fausses conclusions d’absence. Nouvel inventaire récursif fourni ici. |
| Ba&sh date source | **LOCAL NON COMMITÉ ; PARTIEL** | Adaptateur et tests modifiés ; repli sur la date du listing si détail en échec, RAW detail insuffisant. |
| Langue distincte du marché | **LOCAL NON POUSSÉ ; PARTIEL** | Registre FR/EN, middleware, catalogue et sélecteur. Priorité URL non appliquée partout côté client. |
| Suppression next-intl inutilisé | **LOCAL NON POUSSÉ ; CONFIRMÉ** | `4138811`, dépendance retirée. |
| Pages légales FR/EN | **LOCAL NON COMMITÉ ; PARTIEL** | Fichiers et tests présents ; statut de premier jet conservé. Aucune validation juridique établie. |
| Migration Journal 025 | **LOCAL NON COMMITÉ ; APPLIQUÉE EN BASE** | schema_migrations : 15/09 11:06:14 UTC ; table présente. Elle n’est pas dans l’image versionnée contrôlée. |
| Traduction Journal automatique | **PARTIEL** | Appel console présent localement ; pas d’appel traduction dans le pipeline autonome étudié. Pas de file durable de reprise. |
| Rattrapage Journal | **PARTIEL, NON TERMINÉ** | 60/142 EN publiés, 22 échecs, 60 manquants ; dernière modification traduction 11:29:38 UTC. |
| Fichiers Journal transférés en conteneur | **CONFIRMÉ, NON REPRODUCTIBLE DEPUIS LE COMMIT DÉPLOYÉ** | Moteur présent dans console-article malgré son absence du commit déployé ; empreinte différente du fichier local, voir F. |
| Catalogue massif de sources | **CONFIRMÉ EN BASE ; VALIDATION OPÉRATIONNELLE PARTIELLE** | 536 entrées ; 437 actives ; 213 actives sans preuve positive d’absence sur les sept jours mesurés. |
| Expiration autonome | **PARTIEL / DÉFAUT REPRODUIT** | `validThrough` ignoré par le refresh étudié ; 443 offres actives déjà expirées. |
| Cron quotidien | **NON ACTIVÉ, GEL CONFIRMÉ** | Trois services workers suspendus, conforme à la consigne. |
| SEO du nouveau catalogue website | **PARTIEL** | URLs et garde noindex ; JobPosting et sitemap de ce catalogue non branchés. |
| Refonte `/offres`, ATS, matching | **NON ENGAGÉE DANS CET AUDIT** | `/offres` reste la surface de l’ancien backend ; agrégateur servi via `/emplois`. |

Les témoignages historiques de mutation volontaire de tests ne peuvent pas être certifiés rétrospectivement par un simple test vert aujourd’hui. Les défauts nouveaux ont été reproduits sur l’implémentation actuelle ; aucun correctif ni nouveau garde de production n’est présenté comme terminé.

## C. État technique de l’agrégateur

### Stock et intégrité structurelle

| Mesure | Valeur |
|---|---:|
| Job totales | 87 580 |
| Job actives, non fusionnées, non retirées | 83 431 |
| JobSource totales / actives | 90 764 / 85 327 |
| JobSource actives avec RAW non nul | 84 173 |
| Job publiques avec Job.raw non nul | 82 429 |
| Observations enregistrées / clés de source | 137 324 / 459 |
| Offres publiques sans représentation active | 0 |
| Représentations actives sans source au registre | 0 |
| Offres actives sans pointeur de propriétaire source | 4 590 |
| Propriétaire désigné ne correspondant plus à une représentation active | 0 |
| Offres actives non revues depuis plus de 48 h | 61 241 |
| Offres actives avec validThrough passé | 443 |
| Taille totale de la base | 3,70 Go décimaux |

`closedAt`, `withdrawnAt` et `mergedIntoId` sont des dimensions de cycle de vie, pas des catégories forcément disjointes à additionner.

### Sources

**536 = 437 ACTIVE + 7 PAUSED + 92 RETIRED.** Aucun DRAFT/VALIDATED dans ce registre de production au snapshot. Cela ne signifie pas que les fichiers historiques de candidats ont tous été traités. Le code `registerSourceCandidate` crée bien un DRAFT ; les JSON de qualification/tracker sont des listes datées, pas un second catalogue actif fiable.

Les seeds CSV locales contiennent 83 lignes de sources, contre 82 dans la version suivie avant l’ajout local Ba&sh. Elles servent à importer ; elles ne décrivent pas l’ensemble des 536 sources en base. Confondre seeds et catalogue perdrait l’essentiel du stock.

Parmi les sources actives, le dernier état enregistré est OK pour 215, DEGRADED pour 196, NEW pour 23 et BROKEN pour 3. Sur sept jours : 727 SourceRun, dont 387 OK, 33 NEW, 302 DEGRADED, 5 BROKEN. Ce mélange de validations bornées et de runs techniques **n’est pas un taux de réussite d’un cron quotidien global**.

| Source | Représentations publiques | Dernier état enregistré |
|---|---:|---|
| ulta-jibe | 10 290 | DEGRADED |
| lvmh | 6 433 | OK |
| foot-locker-france | 2 859 | DEGRADED |
| hm-group | 2 420 | OK |
| knitwell-us-retail | 2 196 | DEGRADED |
| tapestry | 2 183 | DEGRADED |
| pandora-talenthub | 2 077 | DEGRADED |
| wttj-sector | 2 002 | OK |
| l-oreal-professionnel | 1 804 | BROKEN |
| mango | 1 792 | BROKEN |

La troisième source active BROKEN est `motel`. Les sept PAUSED sont `a-p-c`, `clarins-wttj`, `helena-rubinstein-8`, `hermes`, `monsieur-tshirt`, `pied-de-biche`, `sessun`. Leur suspension ne prouve pas que leurs offres sont fermées. La décision d’abandonner une source exige une preuve de remplacement/arrêt et un traitement explicite des représentations restantes.

### Ce qui peut être conservé

- PostgreSQL/Prisma, contraintes d’identité et transactions ; locks source/employeur et événements de cycle de vie.
- `Source`, `SourceRun`, `SourceObservation`, `JobSource` : briques utiles pour une architecture fondée sur les publications des sources.
- Contrats de parcours, identifiants vus, rejets nommés, `canAttestAbsence` et manifestes de refresh. Leur principe est bon ; leur périmètre d’application doit être corrigé.
- HTTP centralisé : tentatives bornées, délai de connexion 20 s, lecture 30 s / 20 Mo, contrôle des redirections, garde SSRF, Retry-After, détection de challenges et budget annulable par source.
- Pagination et détails déjà développés pour les familles réelles : les réparer et compléter, sans réécrire tous les connecteurs.
- API paramétrée, garde de clé à comparaison constante, request-id et erreurs d’indisponibilité distinctes d’une recherche sans résultat.

### Où le RAW n’est pas réellement brut

Le RAW stocké est souvent **la sortie de l’adaptateur**, pas la réponse HTTP d’origine. Avature, Taleo, Ba&sh et plusieurs chemins HTML enregistrent quelques champs fabriqués. Workday combine listing/détail et métadonnées ajoutées. Les observations sont inscrites après parsing ; elles ne permettent pas de reconstruire une page entière perdue avant cette étape.

Dans `dedup/upsert.ts`, la promotion peut remplacer `Job.raw` sans changer `Job.source`. Une mesure groupée par ce dernier peut donc attribuer le RAW au mauvais adaptateur. Ici les familles sont jointes depuis `Source.kind` via `JobSource.sourceKey`.

**Conséquence : le stock RAW existant est le meilleur point de départ disponible, mais il n’est pas une archive complète des extractions originales.** Les champs déjà jetés nécessiteront une recollecte. Aucune interpolation ne peut les recréer honnêtement.

### Défauts de cycle de vie reproduits

1. **Périmètre du refresh écrasé.** Dans `pipeline/refresh.ts`, le spread `sourceKey: {notIn: skipped}` remplace le précédent `{in: onlyKeys}`. Jeu réel PostgreSQL isolé : source autorisée + source saine hors périmètre + source cassée. Le refresh autorisé pour une source ferme deux offres, dont celle hors périmètre. Les requêtes d’orphelins et de réouverture sont également globales. Un manifeste borne mieux les identifiants, mais ne corrige pas toute la logique de périmètre.
2. **Expiration déclarée ignorée.** Le refresh lit lastSeenAt et la preuve d’absence ; il ne traite pas validThrough. Une offre revue récemment mais expirée reste active dans la reproduction. Le stock réel en contient 443.
3. **Actualisation partielle.** `reattestationFields` ignore experienceYears, educationLevel, latitude, longitude, postalCode et department. Une source devenue plus précise ne répare pas ces valeurs sur l’offre existante. La reproduction avec six valeurs nouvelles retourne `{}`.
4. **Précision salariale perdue.** Prisma stocke salaryMin/Max comme Int. Écriture locale 12.31 / 20.8 → lecture 12 / 20. `coerceAmount` conserve correctement la décimale : la perte se situe au stockage, pas dans cette fonction.
5. **Déduplication approximative trop autoritaire.** À même employeur et ville, deux identifiants de sources distincts « Sales Advisor » / « Beauty Advisor » sont déclarés doublons par `isProbableDuplicate`. Cette reproduction prouve la possibilité d’une fusion injustifiée ; elle ne chiffre pas le nombre de faux rapprochements présents en base.

Preuves exécutables et résultats : `scripts/*witness*`, `preuves/witnesses.json`, `preuves/lifecycle-witness.json`.

## D. Données et chaîne source → UI

La présence d’une colonne ne certifie ni la provenance ni la qualité sémantique. Les nombres ci-dessous portent sur les 83 431 offres publiques, sauf mention explicite des représentations.

| Dimension | État mesuré / chaîne actuelle | Rupture ou limite |
|---|---|---|
| Pays | 78 543 codes présents ; RAW → normalisation → countryCode → recherche/API | 4 888 pays inconnus ; `marche` ne contraint pas countries. Provenance/inférence à conserver. |
| Ville | 79 375 valeurs ; API et facette présentes | Chaînes et homonymes ; localisation multiple ramenée à une offre unique ; villes proposées contextualisées mais recherche libre encore mondiale. |
| Région/État | 18 353 adminArea1 ; principalement US/CA | Pas de couverture mondiale ni de filtre d’État natif complet. |
| Code postal | 23 034 | Réattestation incomplète ; formats pays à conserver comme texte. |
| Coordonnées / distance | 22 508 paires dans les bornes géographiques | Adresses multiples et centroïdes ; absence de vérité de précision. Pas de recherche par rayon complète sur le website étudié. |
| Employeur / groupe | Company + relations/alias + preuves d’employeur ; facettes servies | Nom du portail ≠ Maison qui recrute. Dédup employeur et groupe ne doivent pas fabriquer l’identité d’une offre. |
| Secteur | Référentiels/projections et filtres | Une catégorie inférée n’est pas une déclaration employeur. Portée luxe/mode/beauté/retail à versionner et auditer. |
| Famille métier | jobFunction : 78 276 | Enrichissement, distinct du métier fin ; pas devenu le nouveau filtre public par le seul correctif de mesure. |
| Métier fin | occupationCode : 40 346 | Facette sur le métier fin ; classification et release actives à distinguer de la publication source. |
| Séniorité | Interne, règles et occupationEvidence | Retirée du registre candidat local ; ne pas reconvertir un niveau qualitatif en années. |
| Durée/contrat | employmentTerm : 26 277 ; projection API | Codes transversaux encore présentés avec labels français ; pas de bijection juridique universelle. |
| Temps plein/partiel | workTime : 60 120 | Champ utile, à conserver séparément du contrat et du programme. |
| Programme | programType : 4 753 | Disponibilité très variable par marché ; sens source à conserver. |
| Saison / engagement | isSeasonal non nul : 3 449 ; engagementType : 162 | Une valeur false compte comme renseignée, pas comme « offre saisonnière ». Facettes publiques limitées par couverture. |
| Horaires | workSchedule : 0 | Migration ≠ donnée branchée ; aucune promesse candidat prête. |
| Lieu de travail | workplaceType : 6 162 | Parsing contradictoire et champs imbriqués ignorés ; preuves détaillées ci-dessous. |
| Langue de l’annonce | language : 70 652 | Détection/enrichissement à distinguer de la langue d’interface ; ne pas remplacer le texte original. |
| Expérience | experienceYears : 483 | Les échelles qualitatives ne se convertissent pas en années ; correctif d’adaptateurs sans réattestation complète. |
| Études | educationLevel : 0 | Donnée source présente, rupture adaptateur/réattestation/projection. Aucun filtre candidat à annoncer comme prêt. |
| Salaire | Au moins un montant positif : 1 483 | Montant, devise, période, brut/net et fourchette doivent voyager ensemble ; stockage Int inadapté. |
| Date de publication | postedAt : 81 973 | Présence ≠ date fidèle. Séparer publication source, première découverte et dernière vérification ; Ba&sh encore fragile. |
| Fin de validité | validThrough : 5 867 | Non appliqué dans le refresh courant ; recherche sur isActive seulement. |
| Description | 82 851 descriptions ≥ 200 caractères | Longueur seule ne prouve ni authenticité, ni qualité, ni absence de boilerplate. |
| Compétences | Tableau non vide : 78 014 | Volume principalement issu d’extraction/enrichissement ; ne pas l’appeler « compétences déclarées » sans preuve par valeur. |

### Fin de l’audit des quatre dimensions RAW

L’inventaire de chemins est exhaustif pour le snapshot défini. La qualification sémantique est volontairement plus restrictive : elle reconnaît des formes établies et conserve les autres comme éléments à traiter. **Les comptes suivants sont des minima de signaux exploitables, pas des prévisions de couverture après backfill.** Plusieurs représentations peuvent viser la même offre ; le script donne les deux grains.

| Dimension qualifiée | Représentations | Offres distinctes liées | Interprétation |
|---|---:|---:|---|
| Salaire : montant positif repéré | 3 698 | 3 684 | La devise et la période peuvent encore manquer. |
| Salaire : montant + devise + période non vide | 2 117 | 2 103 | Tuple à interpréter selon sa source, sans annualisation implicite. |
| Salaire comportant des décimales | 1 291 | 1 291 | Justifie de corriger le modèle numérique avant branchement. |
| Niveau d’études déclaré | 1 450 | 1 426 | Valeurs natives conservées ; flags de formulaires exclus. |
| Signal explicite de mode de travail | 10 852 | 10 627 | Valeur à lire dans sa structure native ; faux booléens génériques exclus. |
| Paires latitude/longitude nommées et plausibles | 26 809 | 26 153 | Ne certifie ni précision ni adresse du poste. Autres encodages géographiques inventoriés séparément. |

#### Salaire : preuves et faux positifs

- **Jibe : 10 290 représentations**, salary_value/min/max tous à zéro. Le nom de champ ne représente pas un salaire publié.
- Generic listing : 1 608 valeurs `baseSalary.value.value=0`, notamment Boots. Même conclusion.
- Teamtailor : 1 341 représentations avec montant positif ; 445 avec décimales. Des devises vides subsistent.
- iCIMS : 1 208 montants positifs ; minValue/maxValue directement dans baseSalary, structure différente du schéma attendu le plus courant. Période absente de cette forme : ne pas l’inventer.
- Lever : 400 montants positifs avec devise/période ; intervalles hourly/yearly/bi-weekly natifs. Les 4 salaryRange restantes de la population concernée ne justifient pas un montant positif.
- LVMH : 571 valeurs textuelles « To be negotiated ». Ce sont des conditions de rémunération, pas des nombres.
- Recruitee : 156 montants positifs ; 129 tuples avec période non vide. Flatchr comporte aussi des montants et `show_salary` : leur qualification monétaire complète reste à faire ; ils ne sont pas inclus dans le minimum qualifié.
- Magnet contient montants natifs `min_src/max_src` et montants transformés : ne pas mélanger les deux avec une même périodicité.

#### Études

Recruitee 639 valeurs ; Flatchr 354 ; WTTJ-sector 381 ; WTTJ 31 ; Workable 45 valeurs utiles. Somme : 1 450 représentations. Aucun mapping inventé entre un diplôme français et un niveau américain. `education_required/optional` de Greenhouse décrit une collecte de candidature, pas un niveau exigé. `no_diploma` peut être une déclaration explicite ; elle ne doit pas être perdue dans un null générique.

#### Télétravail

- LVMH `workingMode` non vide sur 4 117 représentations, avec valeurs réellement multilingues.
- Workday : `detail.jobPostingInfo.remoteType` sur 2 133. **`similarJobs.remoteType` décrit d’autres offres** et ne doit jamais servir à renseigner celle auditée.
- Eightfold : `workLocationOption` présent sur 2 726.
- SmartRecruiters : flags remote/hybrid dans `location`, non à la racine.
- Recruitee : 47 offres avec hybrid=true et remote=false ; **46 appartenant à leur source propriétaire sont stockées ONSITE**. Le lecteur choisit remote=false avant hybrid=true. Autre reproduction : « No remote » est lu REMOTE car la regex positive passe avant la négation.

#### Géolocalisation

L’inventaire retrouve Jibe, SmartRecruiters, Phenom, WTTJ, JobAffinity, Oracle, Rituals et les JSON-LD génériques. Le minimum qualifié traite les paires nommées et les bornes ±90/±180, conserve les coordonnées zéro valides, isole les paires (0,0) suspectes et compte les lieux multiples. Il ne prétend pas interpréter les 211 structures SuccessFactors `jobLocationShortWithCoordinates`, les coordonnées texte Magnet, les géométries TalentFunnel et les variantes TalentRecruiter comme un seul point certifié. Ces formes sont dans `raw-chemins.csv` et doivent recevoir leur propre contrat.

### Anciennes mesures à ne pas réutiliser

`verif-raw-4-dimensions.mjs` s’arrête aux clés racines, à des motifs connus et à des sous-ensembles ; son message « la source ne publie rien » n’est pas démontré. `d437-couverture-simulee.mjs` confond plusieurs objets/flags/coordonnées partielles avec des valeurs utiles. Le nouveau rapport remplace leurs conclusions, sans supprimer les fichiers antérieurs de l’utilisateur.

## E. Recherche et international

### Défaut principal : marché ≠ périmètre des résultats dans le code actuel

`parseFilters` ne construit countries que depuis `pays` ou un `lieu` résolu comme pays. `marche` sert ensuite aux facettes ; il ne devient pas une condition SQL de pays.

Exécution du **code local courant** contre Railway en lecture seule :

| Paramètres | Total | Observation |
|---|---:|---|
| marche=US | 83 431 | Première page contenant BE, GB, IE, SG, FR, AU, DE, HU |
| marche=US + pays=US | 36 942 | Résultats US |
| marche=FR | 83 431 | Résultats mondiaux |
| marche=CN | 83 431 | Résultats mondiaux |

L’interface locale reproduit ce comportement : filtre « Job type » américain au-dessus d’offres belges et britanniques. **C’est un blocage de la logique Indeed demandée.** La sélection d’un marché doit définir un espace de recherche cohérent ; une recherche mondiale doit être un choix distinct et explicite.

Les villes sont mieux cloisonnées dans le code local : `Pa` → Palo Alto/Paramus/etc. en US, Paris/Pantin/etc. en FR, aucune en CN. Cependant le website ajoute les noms de tous les pays dans `assainirSuggestions`, indépendamment du marché. Les suggestions retournent de simples chaînes sans identifiant de lieu/pays/région. Cela ne résout pas les homonymes ni les marchés transfrontaliers.

### Mesures par marché

Numérateurs et toutes les dimensions dans `couverture-marches.csv`. Valeurs ci-dessous arrondies à 0,1 point ; elles mesurent la présence de la colonne servie, pas une validation de chaque valeur.

| Marché | Offres | Contrat/durée | Temps | Programme | Métier fin | Mode travail | Salaire positif |
|---|---:|---:|---:|---:|---:|---:|---:|
| US | 36 942 | 19,2 % | 81,8 % | 0,3 % | 53,9 % | 4,1 % | 1,1 % |
| FR | 11 026 | 69,2 % | 64,3 % | 22,2 % | 48,8 % | 13,6 % | 6,0 % |
| GB | 3 305 | 38,9 % | 64,6 % | 0,6 % | 41,2 % | 8,0 % | 1,3 % |
| CA | 3 129 | 34,9 % | 79,5 % | 1,2 % | 36,5 % | 13,7 % | 0,3 % |
| DE | 3 080 | 32,5 % | 74,9 % | 8,0 % | 49,5 % | 12,2 % | 0,1 % |
| IT | 2 693 | 45,3 % | 68,0 % | 16,2 % | 52,4 % | 4,8 % | 8,0 % |
| ES | 2 197 | 47,7 % | 66,5 % | 5,3 % | 57,0 % | 1,8 % | 2,0 % |
| NL | 1 849 | 36,1 % | 78,2 % | 2,5 % | 38,7 % | 20,8 % | 0,2 % |
| AU | 1 234 | 36,2 % | 65,7 % | 0,7 % | 37,4 % | 6,7 % | 0,2 % |
| CN | 1 224 | 47,1 % | 81,9 % | 17,1 % | 33,1 % | 2,2 % | 0,0 % |
| CH | 1 220 | 17,2 % | 49,1 % | 26,3 % | 25,7 % | 17,7 % | 0,5 % |
| BE | 671 | 43,1 % | 81,4 % | 22,4 % | 45,9 % | 8,8 % | 1,8 % |

Le seuil de 20 % est bien une règle locale du registre. Il ne garantit pas la représentativité : une seule grande source peut faire franchir le seuil. **Conserver le seuil comme garde provisoire**, puis le calculer sur le périmètre réellement servi avec provenance, nombre de sources et date de mesure. La qualité et le sens natif doivent précéder l’affichage. Une facette renseignée à 90 % par des inférences douteuses reste impropre à une promesse factuelle.

La Chine exclut volontairement des facettes très concentrées malgré leur couverture brute. Cette décision existe localement ; elle ne signifie pas que toutes les offres chinoises portent des contrats français ni qu’une UI chinoise est livrée.

### Moteur de recherche

- SQL à paramètres liés, recherche ILIKE, index GIN trigram sur searchText, CTE matérialisée partagée entre résultats et facettes : fondation conservable.
- Requête limitée à 200 caractères, huit termes ; recherche sur titre, description, société/alias, ville/localisation, département et informations d’emploi. Extension des groupes/maisons et aliases de métiers en complément.
- Pas de classement lexical explicite favorisant titre, nom exact ou proximité : ordre final pays prioritaire, postedAt, firstSeenAt, id.
- Pas de normalisation générale des accents démontrée. Exécution FR : `école` 1 586 résultats ; `ecole` 401. Casse couverte par ILIKE, accents différents.
- Chinois : sous-chaîne `销售`, 577 résultats CN ; aucune preuve d’un moteur de segmentation/translittération multilingue complet.
- Pagination OFFSET, 25 résultats, page maximale 10 000. Les facettes sont calculées sur le jeu déjà filtré : revalider l’ergonomie des choix OR et les coûts sur gros périmètres.
- Requêtes mesurées depuis Paris vers Railway : environ 0,5 à 2,8 s sur les cas consignés après correction du répertoire de travail de l’outil d’audit. Ce sont des temps complets individuels, **pas** un p95 sous charge ni une certification de capacité à un million d’offres.
- L’expansion des groupes lit un CSV relativement à process.cwd(). Le premier outil lancé depuis la racine a montré la dégradation ; le scénario a été rejoué depuis apps/api. Le packaging standalone doit garantir la présence de cette ressource : ce point reste à vérifier dans l’image API.

## F. Langues, légal et Journal

### Website

Le registre actuel ne déclare que **FR et EN**, indépendamment des douze marchés. DE et zh-CN sont des objectifs, pas des langues d’interface implémentées.

Test navigateur local, build de production, sans cookie préalable :

| Langue / marché demandés | HTTP | Résultat après hydratation |
|---|---:|---|
| FR / FR | 200 | Texte français ; html lang fr-FR ; catalogue mondial |
| FR / US | 200 | Texte français + titres de filtres US ; html lang fr-US ; catalogue mondial |
| EN / FR | 200 | Texte toujours français ; html lang fr-FR |
| EN / US | 200 | Texte toujours français + titres de filtres US ; html lang fr-US |
| DE / DE | 404 | Langue non déclarée |
| zh-CN / CN | 404 | Langue non déclarée |

`AppliquerLangue` et plusieurs composants clients lisent le cookie ou le défaut FR, sans appliquer la priorité du préfixe URL. La langue calculée par le middleware ne gouverne donc pas tout le rendu. `PageEmplois` garde du français en dur, y compris compte, erreurs et actions. La projection API formate les valeurs en français, sans recevoir la langue de l’interface. Les titres de filtres dépendent du marché : ce ne sont pas des traductions complètes de l’UI. Une seconde passe avec CW_LANG=en donne bien html lang en-US et une ossature anglaise, mais le corps de PageEmplois reste français : le cookie ne termine pas la traduction.

`Vary: Accept-Language, Cookie` ajouté localement dans next.config n’atteint pas les réponses de page testées : Next renvoie ses Vary RSC et Accept-Encoding. Cependant `/emplois` est dynamique ; l’en-tête absent ne suffit pas, à lui seul, à démontrer une contamination effective du cache en production. Préférer des URLs explicites et une stratégie de cache testée, sans généraliser `headers()` au layout racine.

### Pages légales

Trois pages et catalogues FR/EN présents localement. Les noms/identifiants restent des constantes du contenu ; les catalogues sont typés et les dates mises en forme par langue. Le marqueur exact `PREMIER JET — à faire valider juridiquement avant mise en ligne (D-14).` existe dans les commentaires. Le composant affiche aussi le statut en langue courante et en français ; la ponctuation visible suit la règle D-319.

Les six rendus FR/EN des trois pages légales ont répondu HTTP 200 ; leurs notes affichent le premier jet en français et, côté EN, aussi en anglais (`preuves/ui-followup.json`).

**Statut : traduction technique locale présente, validation juridique non établie, rien déployé par cet audit.** Une comparaison exhaustive clause par clause par un professionnel n’a pas été réalisée. Le build et les tests ne valent pas validation du contenu légal. Le commentaire de serveur.ts affirmant n’avoir que les tests comme appelants est désormais faux : les trois pages légales appellent langueCourante.

### Journal FR + EN

La table additive `journal_article_translations` relie article_id/lang à l’article français. Contraintes uniques par article/lang et slug/lang. Les commentaires parlant d’une unicité inter-table des slugs ne sont pas matérialisés par une telle contrainte ; les espaces de routes FR/EN doivent porter cette distinction.

État réel Railway : **142 FR PUBLISHED ; 60 EN PUBLISHED ; 22 EN FAILED ; 60 EN absents.** Les 60 EN publiés correspondent au hash des champs FR actuels (titre, extrait, corps) au contrôle de 13:15 UTC : **0 version publiée périmée selon cette empreinte**. L’empreinte n’inclut pas tous les champs visuels. Aucune mise à jour de traduction après 11:29:38 UTC au snapshot.

La migration 025 est appliquée dans la base, mais non commitée localement. Le service console-article déployé annonce `69782a6` ; son moteur de traduction présent sur disque n’appartient pas à cette image versionnée. Empreintes contrôlées : translation-rules identique au fichier local ; translate-article et console-server différents ; fichier de migration 025 absent du conteneur. Les lectures SSH supplémentaires du moteur complet ont échoué : **le diff exact de son contenu n’est pas certifié**, la divergence de checksum l’est.

Le timeout utilise Promise.race : il peut rendre la main sans annuler le travail. La reprise n’est pas portée par une file durable. La relance du stock par défaut saute les traductions déjà publiées avant de tester leur péremption ; `--perimes` est nécessaire pour ce parcours. La publication console locale appelle la traduction, mais la publication autonome du pilote n’a pas le même appel identifié.

Les refus observés mélangent citations protégées, détection trop large de noms propres et sorties encore françaises. Interdire les tirets cadratins partout tout en conservant littéralement une citation qui en contient crée une contradiction à régler explicitement ; ne pas altérer une citation pour faire passer un test.

## G. SEO

La page de détail `/emplois/[slug-id]` et ses métadonnées existent. Elle reste noindex sans `EMPLOIS_INDEXABLE=1`, ce qui convient à une phase non publiée. Les titres originaux restent natifs.

**Rupture de bout en bout :** `jobPostingSchema` est testé dans l’API, mais aucun appelant de rendu n’a été trouvé dans l’application API courante. Le nouveau website ne l’injecte pas ; les fonctions sitemapOffersChunk/Count n’ont plus de route appelante dans l’API. Les routes historiques `/offres` du website continuent de consommer l’ancien backend. Le nouveau catalogue ne possède donc pas encore une chaîne vérifiée « offre active → page publique → JobPosting → sitemap → retrait ».

La fiche fermée peut être rendue avec bandeau/noindex en HTTP 200 ; ce n’est pas un 410 implémenté côté website. La disparition définitive, la fusion, le retrait de confiance et l’expiration doivent avoir des comportements différents et testés. Un problème d’API ne doit pas générer une page indexable qui ressemble à une offre valide.

Références officielles contrôlées : Google demande de traiter les offres fermées, accepte notamment validThrough passé, retrait de page 404/410 ou suppression de JobPosting, et recommande de notifier les changements via l’Indexing API avec un sitemap de couverture. Il distingue aussi la canonicalisation des copies d’une même offre. [Documentation JobPosting](https://developers.google.com/search/docs/appearance/structured-data/job-posting).

Pour le multilingue, conserver des versions accessibles explicitement et relier les traductions réelles. Ne pas déclarer des hreflang vers une interface non traduite ou une 404. [Documentation internationale](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites).

Ces recommandations ne garantissent pas l’indexation ni la visibilité dans Google Jobs. Aucun test Search Console/Rich Results sur une nouvelle publication n’a été réalisé : aucun nouveau contenu n’a été déployé.

## H. Automatisation et capacité

### État Railway confirmé

Trois workers : `catwalks-aggregator`, `catwalks-refresh`, `catwalks-reconcile`. Cron `0 0 29 2 *`, `PIPELINE_PAUSED=1`, commandes correspondantes ingest-all/refresh/reconcile. Pas d’INGEST_ONLY_KEYS restant sur ces services au contrôle. Service de lecture : `catwalks-api`. Les déploiements sont réussis sur `dd3e24d`.

Ce gel n’est pas une panne à réparer en l’enlevant maintenant. **Aucune preuve d’un cycle quotidien complet et autonome n’est disponible dans les exécutions de cet audit.**

### Capacité actuelle et conditions d’échelle

Quatre sources concurrentes par défaut, budget de 40 minutes par source ; limite tenant/hôte de quatre requêtes en vol et temporisation adaptative. Les listes et plusieurs unions de pages restent matérialisées en mémoire. Il existe des checkpoints/cursors, des contrats de persistance et de la télémétrie, mais pas une file durable générale de tâches de source avec lease, reprise et limitation distribuée couvrant tous les processus.

Les gates HTTP en Map mémoire protègent un processus. Répliquer les workers sans coordination peut multiplier la pression par tenant. Les locks de base protègent des mutations ; ils ne remplacent pas le budget réseau partagé.

La base dispose d’indexes utiles, dont le trigram de recherche. Les statistiques PostgreSQL de tuples sont des estimations et ne remplacent pas les counts exacts. L’historique contient des mesures CPU/RSS/DB de runs bornés ; aucune ne démontre une capacité soutenue à plusieurs millions d’offres. Chiffrer débit, coût, mémoire, p95 et temps de rattrapage avant de choisir un moteur externe ou de multiplier les services.

### Tests exécutés

| Vérification | Résultat |
|---|---|
| Agrégateur unitaire | 2 223 / 2 223, 144 fichiers |
| Agrégateur intégration, PostgreSQL local jetable | 397 / 397, 50 fichiers |
| Typecheck agrégateur + API | Succès |
| API | **240 réussis, 1 échec, 2 ignorés**, 21 fichiers |
| Website | 745 / 745, 65 fichiers |
| Build website | Succès ; 152 pages générées ; répertoire de build séparé |
| Journal, tests ciblés de traduction | 58 / 58 ; purs/structurels, sans publication |
| Reproductions ciblées | Refresh hors périmètre, expiration, salaire, réattestation, mode de travail, dédup et marché confirmés |
| Navigateur local | Matrice langue/marché, desktop 1440 et mobile 390 ; aucune erreur JS dans les six cas initiaux |

L’échec API est précis : le test `suggest-villes-marche` classe encore CN parmi les marchés inconnus et attend Paris. Le code local reconnaît désormais CN. Le garde n’a pas suivi l’ouverture du marché. Les contrôles distants verts ne couvrent pas ce HEAD local.

Les preuves de corruption sont des scénarios actuels ; elles n’ont pas été transformées en tests verts en modifiant les attentes. Aucun test en échec n’a été masqué.

## I. Dette et risques prouvés

### À corriger avant toute réactivation

| Priorité | Défaut | Effet utilisateur / exploitation |
|---|---|---|
| P1 | `marche` ne borne pas la recherche | Offres hors pays sous des filtres natifs trompeurs |
| P1 | Périmètre refresh écrasé ; orphelins/réouvertures globaux | Mutation d’offres hors périmètre d’une reprise bornée |
| P1 | validThrough ignoré par le refresh | Offres expirées encore actives |
| P1 | RAW projeté et provenance Job.source trompeuse | Valeurs perdues ou attribuées à la mauvaise source |
| P1 | Réattestation ne met pas à jour six champs | Corrections de parsing sans réparation du stock |
| P1 | Salaire en Int | Perte des décimales |
| P1 | Lecture contradictoire du télétravail | 46 offres hybrides propriétaires stockées onsite dans le sous-ensemble établi |
| P1 | Dédup approximation faisant autorité | Fusion possible de postes distincts |
| P1 | Code/DB/containers Journal et taxonomie désalignés | Redéploiement non reproductible, travail perdu ou comportement différent |
| P1 avant lancement international | Préfixe langue ignoré côté client, textes FR, DE/zh absents | Promesse internationale non tenue |
| P1 avant ouverture SEO | Chaîne JobPosting/sitemap/retrait incomplète | Catalogue non livré comme surface SEO fiable |
| P2 | API test CN en échec | Pipeline de validation local non vert |
| P2 | Mesures statiques et registres dupliqués | Risque connu de divergence API/website |
| P2 | Scripts et documentation sur anciens chemins/services | Diagnostic trompeur, maintenance plus risquée |

Exemples de dette vérifiés : README et commentaires `apps/web` malgré le passage à apps/api ; script ops cherchant `catwalks-web` alors que le service est `catwalks-api` ; commentaire prétendant qu’un champ absent n’est jamais « non collecté » ; ancien curseur FashionJobs conservé malgré la source retirée ; commentaires d’appelants langue devenus faux ; libellés morts et doubles circuits `/offres`/`/emplois`. Les nombreuses branches après squash et worktrees marqués prunable exigent un tri de sauvegarde, pas une suppression aveugle.

La clé API est facultative dans le code : absente, le service s’ouvre volontairement. Le constat porte sur ce comportement conditionnel, pas sur une exposition effective actuelle démontrée. Le contrat de démarrage devra préciser explicitement les environnements dans lesquels cette ouverture est acceptable.

### Audit technique ciblé de l’interface

Intégrité produit **insuffisante** : la présentation du marché et le contenu réel divergent. Le détecteur Impeccable a signalé un seul `broken-image` dans LogoMaison ; **faux positif vérifié** : src dynamique, contrôle du domaine, repli monogramme, onError, taille et lazy-loading présents.

Grille indicative sur le périmètre `/emplois`, fondée sur le code et les rendus inspectés, sans certification WCAG : accessibilité 2/4, performance 2/4, responsive 3/4, thème 3/4, intégrité 1/4, soit **11/20**. Les limites d’i18n et de réponse moteur dominent ; contrastes exhaustifs, lecteurs d’écran et charge réseau mobile réelle non mesurés.

Points conservables : boutons natifs, états ARIA, fermeture Échap et restitution du focus dans FiltreMenu, états vides/erreurs explicites, logos avec repli, disposition mobile sans débordement horizontal dans la capture testée. Recommandations ciblées : `$impeccable harden` pour langue/états et contrats de marché, `$impeccable optimize` pour le budget de requêtes et le temps de réponse, puis `$impeccable polish` après correction fonctionnelle. Ces commandes peuvent être exécutées séparément ou ensemble dans le lot UI ; refaire `$impeccable audit` après les corrections.

## J. Plan d’exécution

Le [plan en lots](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/plan.md) commence par les invariants et la récupération des travaux, puis les défauts de cycle de vie et le contrat RAW. Il conserve les briques utiles, remplace les décisions approximatives qui font autorité et supprime les circuits devenus inutiles après bascule vérifiée.

**Critère de sortie global :** chaque valeur affichée doit être reliée à une déclaration source ou explicitement présentée comme enrichissement ; chaque annonce active doit avoir une preuve de disponibilité suffisamment récente ; marché, recherche, filtres et URL doivent servir le même périmètre ; une reprise après panne doit être démontrée. Jusqu’à cette preuve, le statut est « fondation en stabilisation », pas « production ready à 100 % ».
