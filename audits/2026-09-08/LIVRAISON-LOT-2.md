# Livraison technique et état de préparation à la production

**8 septembre 2026 — Catwalks / Mode Careers**

> État historique avant déploiement. Le [rapport de déploiement](./DEPLOIEMENT-PRODUCTION.md) et `readiness.json` décrivent désormais la version en production et les validations finales.

**Décision : corrections validées localement ; certification globale de production non acquise.** Ce lot traite des défauts d'identité, de concurrence, de fermeture d'offres, de collecte et de performance reproduits pendant l'audit. Aucun déploiement et aucune écriture en production n'ont été effectués. Les modifications restent dans le répertoire de travail, disponibles pour revue, sans commit.

Révision de référence : `c353ed39bf8f82c44c6bfd2f8e5bfa00ddef7629`. Le [plan complet](./PLAN-VALIDATION-PRODUCTION.md) et l'[audit initial](./AUDIT-PRODUCTION.md) restent les références pour les chantiers qui dépassent cette livraison. Les chiffres de production de l'audit sont une photographie antérieure, pas un nouvel état mesuré après ces corrections.

## 1. Décisions d'architecture et corrections réalisées

### Identité, déduplication et autorité des données

L'identité externe est portée par le couple `sourceKey / externalId`. La contrainte précédente sur entreprise, famille d'ATS et identifiant externe empêchait de représenter correctement deux tenants utilisant le même identifiant. Elle est remplacée par un index de recherche ; l'unicité de l'entrée source reste assurée dans `JobSource`.

L'ingestion d'une offre s'exécute dans une transaction avec verrous partagés avec les opérations de cycle de vie. Les verrous d'entreprise utilisent les identifiants réels de la base, dans un ordre stable. Les collisions et conflits transactionnels ciblés provoquent une reprise de la transaction entière. Une échéance atteinte avant la fin interdit de valider les écritures.

Les veto de déduplication du premier lot sont conservés : pays explicites incompatibles, responsabilités incompatibles, dates trop éloignées et ponts transitifs via une offre incomplète. La réconciliation revérifie les membres sous verrou. Les tests couvrent notamment douze ingestions concurrentes, le déplacement d'une entrée entre entreprises et le refus d'une fusion entre tenants distincts.

Un propriétaire canonique actif est sélectionné de façon stable. Une source secondaire ne peut plus remplacer librement les champs établis par la source de meilleure autorité. Une description correcte devenue plus courte peut être mise à jour. Le salaire est traité avec sa devise, et la géographie comme un ensemble, pour limiter les mélanges incohérents. Lorsque la source canonique disparaît, l'URL peut basculer vers une source encore active.

**Limite :** cette politique ne constitue pas encore une provenance complète champ par champ. Le changement de propriétaire canonique n'est pas une reconstruction intégrale immédiate de tous les champs depuis les observations historiques.

### Observations brutes conservées

`SourceObservation` conserve les révisions brutes distinctes avec leur empreinte, leur source, leur identifiant externe, leur date et une version de pipeline. Ces observations ne dépendent pas d'une clé étrangère vers l'offre ; elles survivent donc à sa suppression. Une réattestation identique ne duplique pas le contenu.

La conservation est transactionnelle avec l'ingestion réussie. **Ce n'est pas encore une archive de toutes les réponses reçues avant validation, ni une file de quarantaine des données rejetées, ni une garantie de replay exact.** Le replay nécessitera aussi les versions des référentiels, règles, paramètres et décisions de confiance. Une politique de rétention et d'effacement reste à définir.

### Collecte complète et fermeture des offres

Chaque résultat d'adaptateur peut maintenant attester explicitement sa complétude. Les anciennes réponses sous forme de tableau ne sont plus implicitement considérées comme exhaustives. Un total déclaré exactement retrouvé, sans doublon ni troncature, peut constituer une preuve ; une valeur `complete: false` reste un veto.

Les runs enregistrent les volumes récupérés et acceptés, le total déclaré, la complétude, les erreurs, la troncature et la capacité à attester une absence. Les dénominateurs de couverture portent sur les offres acceptées. Une collecte incomplète ou inconnue ne peut plus déclencher une fermeture par absence.

Le rafraîchissement exige une attestation explicite et récente. Il protège les sources sans preuve, revérifie les observations sous verrou, et produit une seule transition de fermeture malgré plusieurs rafraîchissements concurrents. Un run réussi mais trop ancien ne prouve pas l'absence actuelle d'une offre.

Lever dispose d'une pagination bornée et contrôlée, avec prise en charge du domaine européen. Le générique JSON-LD distingue fin naturelle, répétition, plafond et échec de détail. Les parcours sitemap/RSS qui ne garantissent pas l'exhaustivité restent explicitement incomplets. Le dispatcher Greenhouse s'appuie sur le contrat de liste complète de son API Job Board.

**Conséquence de déploiement importante :** les adaptateurs historiques sans preuve de complétude continuent d'ingérer, mais ne peuvent plus justifier une fermeture par absence. Il faudra mesurer les sources concernées et certifier leurs contrats. Sans ce chantier, des offres anciennes resteront protégées plus longtemps ; ce compromis est visible et ne doit pas être présenté comme un catalogue parfaitement frais.

### Délais, réseau et navigateur

Le budget d'une source est propagé aux requêtes, lectures, attentes et reprises. L'orchestrateur attend la terminaison du travail annulé avant de libérer son emplacement. Les files d'attente par hôte retirent les tâches annulées. Une erreur interrompt également les travaux frères utilisant le même signal.

Les requêtes HTTP vérifient les destinations et les adresses DNS effectivement remises à la connexion. Les redirections sont contrôlées ; les identifiants et en-têtes sensibles ne sont pas transmis à une autre origine. Les réponses inutilisées sont annulées, les lectures sont bornées, et la décompression gzip dispose d'un plafond de sortie.

Chromium passe par un proxy local dont les connexions HTTP et HTTPS utilisent la même vérification DNS publique. Les requêtes du contexte sont aussi filtrées, les service workers bloqués et certains transports contournant le proxy désactivés. Des tests couvrent les adresses privées littérales et obtenues par DNS ; une navigation HTTPS publique réelle a réussi après cette modification.

**Limite :** ces contrôles applicatifs doivent être complétés et vérifiés dans l'environnement d'exécution : isolation des workers, droits minimaux, politique réseau et tests de résistance. Ils ne constituent pas une certification de sécurité exhaustive.

### Recherche et facettes

Le calcul des résultats, totaux et facettes réutilise désormais une sélection filtrée dans une même requête SQL. Les listes d'entreprises ne sont plus tronquées arbitrairement à 300 pour calculer les facettes. La pagination dispose d'un ordre stable ; les paramètres sont bornés. Les gros contenus bruts et la projection technique de recherche sont exclus des chargements de fiches et listes ordinaires.

Une projection `Job.searchText`, maintenue par triggers lors des changements d'offre ou de nom d'entreprise, alimente un index trigramme partiel sur les offres actives. Elle sert de présélection ; les prédicats métier d'origine restent appliqués, notamment pour les alias d'entreprises. Des tests comparent les résultats aux filtres Prisma antérieurs et vérifient la maintenance de l'index après modification.

Le premier lot corrigeait aussi les données structurées : aucune durée de validité de trente jours inventée et aucun salaire publié sans devise connue.

### Santé des sources

Une commande de lecture `npm run health:report -w @catwalks/aggregator` produit un rapport cohérent dans une transaction en lecture seule. Elle compte les offres actives distinctes à risque : absence de source active fraîche, URL canonique non portée par une source active, ou validité explicite dépassée. Une alternative fraîche protège contre le premier risque.

Les comptes par source peuvent se recouvrir et ne doivent pas être additionnés pour obtenir le total mondial. Les dimensions historiques non mesurées restent nulles. Le rapport annonce explicitement les dimensions manquantes : contradictions de champs, ambiguïtés pays, complétude validée, dérive des adaptateurs et couverture d'un référentiel mondial. **Il s'agit d'une première base opérationnelle, pas du Health Score complet annoncé.** Le rapport synthétique joint ne décrit pas la production.

La promotion d'une source exige désormais un verdict `ALLOWED` explicite. Le chemin d'import CSV reste à harmoniser, notamment son initialisation du statut et sa date de contrôle prédéfinie.

## 2. Preuves de validation

Les tests utilisent des données synthétiques et PostgreSQL 18 local. Les suites et le build applicatif ont été exécutés sous Node 22.23.2. La CI a été alignée sur PostgreSQL 18, mais aucune exécution distante de CI n'est revendiquée ici.

| Vérification | Résultat |
|---|---:|
| Tests unitaires agrégateur | 1 351 réussis, 66 fichiers |
| Tests d'intégration agrégateur | 187 réussis, 25 fichiers |
| Tests web | 100 réussis, 2 ignorés, 10 fichiers |
| Parcours E2E ordinateur et mobile | 16 réussis |
| Typecheck des deux applications | Réussi |
| Build de production Next.js | Réussi |
| Contrôle des espaces du diff Git | Réussi |
| Migration d'un ancien schéma peuplé | Quatre nouvelles migrations appliquées ; données témoins préservées |
| Sauvegarde/restauration locale | 70 000 offres restaurées ; comptes et empreintes égaux sur 14 tables |
| Projection de recherche | 70 000 lignes, aucune divergence constatée |

Total : **1 654 tests réussis, 2 ignorés**. Les deux tests ignorés dépendent d'une copie locale historique de production à une adresse codée en dur. Les tests SQL génériques et les nouveaux tests de recherche en base ont, eux, été exécutés. Les contrôles de restauration portent sur des fixtures : plusieurs tables sont vides dans le jeu de 70 000 offres. Une autre restauration couvre séparément les 2 000 observations brutes.

### Performances de recherche

Même jeu synthétique de 70 000 offres, 1 000 entreprises, 100 sources. Douze requêtes mesurées par scénario, concurrence quatre, après préchauffage. Mesure de la couche de requêtes avec facettes, sans rendu HTTP ni réseau de production. Les percentiles sur ce petit échantillon donnent une indication comparative, pas un SLO certifié.

| Scénario | P95 avant | P95 final |
|---|---:|---:|
| Catalogue mondial | 593 ms | 621 ms |
| Filtre pays | 125 ms | 162 ms |
| Recherche par titre | 16 641 ms | 772 ms |
| Titre et ville | 25 675 ms | 269 ms |
| Aucun résultat | 20 686 ms | 11 ms |
| Page éloignée | 965 ms | 565 ms |

L'amélioration concerne surtout les recherches textuelles. Les deux premiers cas n'ont pas progressé dans ce relevé ; davantage de mesures sont nécessaires pour distinguer variance et régression. Une requête très large reste coûteuse. La taille de l'index est d'environ 10,4 Mio sur ces descriptions répétitives et ne prédit pas sa taille en production.

### Écritures concurrentes

Sur 2 000 offres, dix entreprises, quatre workers : **221 créations/seconde** et **447 réattestations/seconde**. P95 par opération : 32,7 ms et 10,6 ms. Après réattestation, exactement 2 000 offres, entrées source, observations distinctes et événements `OPENED`. L'essai initial avant optimisation de la sélection des candidats mesurait 124 créations/seconde ; la mesure finale inclut aussi le coût du nouvel index de recherche.

Ce test exclut les latences ATS, la variété réelle des sources, les longues descriptions, les grands clusters d'un même employeur, les quotas, les pannes réseau et la charge prolongée. Il ne prouve pas la capacité de 440 collecteurs concurrents ou de plusieurs réplicas web.

Les preuves détaillées sont dans [readiness.json](./readiness.json), [load-validation.json](./load-validation.json), [search-validation.json](./search-validation.json), [migration-validation.json](./migration-validation.json), [restore-validation.json](./restore-validation.json) et [search-index-validation.json](./search-index-validation.json). Les scripts `validate-load.mts` et `validate-search.mts` refusent les destinations autres que leurs bases locales dédiées.

## 3. Déploiement coordonné des quatre migrations

Ordre prévu :

1. `20260909000000_identity_integrity` : identité externe, propriétaire canonique, observations brutes.
2. `20260909010000_run_attestation` : preuves structurées d'exécution.
3. `20260909020000_run_completion` : complétude explicite.
4. `20260909030000_indexed_job_search` : extension `pg_trgm`, projection, triggers, remplissage et index.

Chaque migration est transactionnelle. Leur date dans le nom assure leur ordre dans l'historique ; elles ont été préparées et testées le 8 septembre.

Avant déploiement : répéter l'opération sur une copie représentative isolée, mesurer durée et verrous, vérifier les droits de création de l'extension et la marge disque, sauvegarder puis démontrer la restauration. Le remplissage et la construction de l'index dans la transaction peuvent bloquer des accès ; le test local ne donne pas une durée de maintenance fiable en production.

Séquence d'exploitation : suspendre **tous** les écrivains (ingestion, refresh, reconcile et scripts de maintenance), appliquer les migrations, générer le client Prisma, construire et déployer les versions compatibles, contrôler les surfaces et invariants, puis reprendre avec un groupe de sources certifiées avant généralisation. Superviser latence, erreurs, verrous, espace disque, fermetures, fusions et volumes.

**Retour arrière :** ne pas relancer automatiquement les anciens écrivains après suppression de l'ancienne contrainte d'unicité. De nouvelles identités désormais permises peuvent empêcher son rétablissement. Prévoir une correction en avant ; une restauration de sauvegarde est une procédure séparée avec perte potentielle des écritures postérieures à son point de reprise. Le seul rollback de l'image web ne constitue pas un plan de retour arrière complet.

## 4. Travaux restant obligatoires avant certification générale

| Priorité | Chantier | Critère de clôture |
|---|---|---|
| P0 | Certification des contrats des sources actives | Inventaire des 440 sources observées, preuve d'exhaustivité par adaptateur, tests de pages manquantes/doublons/compteurs trompeurs ; inconnues explicitement protégées et visibles |
| P0 | Migration et reprise sur infrastructure représentative | Répétition documentée, restauration vérifiée, durée et RPO/RTO mesurés, reprise des écrivains et smoke tests sans incompatibilité de schéma |
| P0 | Alertes et continuité d'exploitation | Pannes injectées de cron, DB, ATS et worker ; alerte réellement reçue ; alarme indépendante si la surveillance elle-même ne tourne plus |
| P0 | Cohérence des outils de maintenance | `purge`, `retireSource`, séparation et suppressions soumis aux mêmes verrous/invariants ; conservation et signification des événements vérifiées |
| P0 | Activation des sources | Import CSV et promotion suivent le même contrat de preuve datée ; aucune activation fondée sur une date inventée |
| P0 | Capacité et sécurité d'exécution | Charge prolongée, contrôle de concurrence, connexions et mémoire ; isolation réseau/OS, droits DB minimaux, traitement des alertes de dépendances documenté |
| P0 | Stockage et sauvegardes | Dimensionnement réel observations + projection + index + WAL + sauvegardes ; politique de rétention, archivage et restauration testée |
| P1 | Provenance et replay | Observations rejetées conservées selon politique, versions de contexte capturées, replay produisant les mêmes projections ; décisions par champ explicables |
| P1 | Géographie | Inventaire versionné des ambiguïtés AZ/AR/NH/CA, témoins DE/Canada/Argentine, preuve indépendante ; aucun remplacement par simple correspondance ville/État |
| P1 | Health Score complet | Contradictions, dérive, attestation et complétude fiable mesurées ; nombre distinct d'offres affectées ; historique suffisamment long |
| P1 | Indexation et acquisition | File durable avec reprise/quota/idempotence, bonnes dates de fermeture, validation des pages et liens de candidature |
| P1 | Interface et accessibilité | Correction des constats d'autocomplétion, clavier/focus, filtre pays et réponses de pagination obsolètes ; tests sur vrais parcours |
| P1 | Qualité mondiale | Référentiel d'employeurs, marques, pays, langues et métiers ; échantillon annoté indépendant pour précision, doublons, liens actifs et fraîcheur |

Le volume PostgreSQL observé pendant l'audit était de 5 Go, dont environ 1,55 Go utilisés. Cette ancienne photographie ne suffit pas à autoriser la croissance des observations et des index. Mesurer l'occupation actuelle et la croissance quotidienne avant migration est nécessaire.

Les suppressions de `Job` peuvent encore supprimer des `JobEvent` par cascade ; la nouvelle table d'observations ne résout pas toute la conservation historique. La file d'indexation externe et les alertes ne sont pas rendues durables par cette livraison. Les dépendances signalées dans l'audit initial doivent faire l'objet d'une analyse d'exposition et d'une mise à jour validée, sans correction forcée aveugle.

Les seuils de disponibilité, fraîcheur, erreurs et latence du plan doivent être observés sur plusieurs cycles réels, notamment les sources les plus volumineuses. Une certification mondiale exige aussi un référentiel de couverture : 122 codes pays stockés ou 440 sources actives ne démontrent ni exactitude ni exhaustivité.

## 5. État du répertoire de travail

Les modifications applicatives et les quatre migrations sont locales et non publiées. Les fichiers de données déjà modifiés ou non suivis par l'utilisateur, dont `deadhost.rescue.tsv`, ne font pas partie de cette livraison. Les bases de test et le conteneur Docker créés pour cette validation sont jetables ; les rapports et scripts de reproduction sont conservés dans ce dossier.

Le prochain passage de validation doit fermer les P0 ci-dessus avant d'élargir l'exploitation. Aucune garantie « zéro erreur » ou « scalable à 100 % » ne découle des tests : l'engagement vérifiable porte sur des invariants, des seuils de service, une détection effective et une capacité de reprise démontrée.
