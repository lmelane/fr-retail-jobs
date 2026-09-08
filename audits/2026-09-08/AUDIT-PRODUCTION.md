# Audit de production — Catwalks / Mode Careers

> Mise à jour après corrections autorisées : voir le [deuxième lot et état de préparation](./LIVRAISON-LOT-2.md). La validation locale ne vaut pas certification de la production.

**8 septembre 2026 · Luxe, mode et beauté · Audit sans modification du code applicatif**

> Photographie initiale, conservée comme preuve. Après cet audit, l'utilisateur a autorisé des corrections locales : voir le [plan de validation](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/2026-09-08/PLAN-VALIDATION-PRODUCTION.md) et le [premier lot livré](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/2026-09-08/LIVRAISON-LOT-1.md). Les constats ci-dessous ne sont pas tous clos par ce lot.

## 1. Verdict et décision recommandée

**Le projet possède une base technique et un catalogue substantiels, mais la fiabilité nécessaire à une exploitation mondiale à grande échelle n'est pas encore démontrée.** Je recommande de conserver l'architecture principale, de traiter les défauts d'intégrité et de déploiement ci-dessous, puis d'étendre progressivement la couverture avec des objectifs mesurés.

L'audit a constaté une indisponibilité réelle de la recherche pendant une migration, puis son rétablissement. Il a aussi reproduit des fusions d'offres distinctes et des mises à jour qui font perdre l'autorité de la source employeur. Ce sont les priorités : davantage de sources amplifierait ces défauts.

« Meilleur agrégateur mondial » doit devenir un objectif vérifiable : couverture d'un référentiel d'employeurs et de métiers, exactitude, fraîcheur, taux de liens de candidature utilisables, pertinence de recherche et coût d'exploitation. Le nombre d'offres seul ne permet pas de démontrer cette position. Aucun benchmark exhaustif des concurrents n'a été réalisé dans cet audit.

### Périmètre et méthode

- Lecture du monorepo, du schéma Prisma, des migrations, des collecteurs, de la déduplication, du cycle de vie, du site Next.js, des tests et du déploiement.
- Production : consultation de configuration Railway, de journaux et de statistiques SQL en **lecture seule**, avec délais d'exécution bornés. Aucun crawl massif ni test de charge sur la production.
- Tests et reproductions sur une **base PostgreSQL 18 locale jetable**, distincte des bases existantes de l'utilisateur.
- Inspection du site en production et de l'interface locale sur ordinateur et mobile ; application du référentiel d'audit Impeccable et de la direction graphique actuelle `design_2.md`.
- Vérification de recommandations techniques auprès de sources primaires, citées aux endroits pertinents.

Le dépôt et les déploiements ont évolué pendant l'audit par une autre activité. Dernière révision relue : `c353ed39bf8f82c44c6bfd2f8e5bfa00ddef7629`. Les résultats concernent les versions observées ; ils ne certifient pas les modifications ultérieures. Aucun correctif, commit, déploiement ou changement de données de production n'a été effectué par cet audit. Les fichiers ajoutés sont les livrables et preuves d'audit.

### Mesures de production

| Indicateur | Mesure ponctuelle | Interprétation |
|---|---:|---|
| Offres stockées | 73 645 | Inclut les offres inactives |
| Offres actives | **71 636** | Volume du catalogue, pas une preuve d'exhaustivité |
| Entreprises portant des offres actives | **1 054** | À distinguer des marques, groupes et employeurs juridiques |
| Codes pays distincts | **122** | Valeurs stockées ; précision géographique non certifiée |
| Sources actives | **440** | 434 OK, 5 DEGRADED, 1 BROKEN au dernier statut |
| Sources actives sans run depuis 48 h | 0 | Un run récent ne prouve pas une collecte complète |
| Offres actives non revues depuis 48 h | 427 | 0,60 % ; à qualifier par source et état de collecte |
| Offres actives avec validité explicite dépassée | **79** | Contradiction à arbitrer avec la source |
| Offres actives sans pays | **4 754** | 6,64 % ; elles échappent aux recherches par pays |
| Offres actives sans ville | 1 186 | 1,66 % ; certaines offres peuvent légitimement ne pas en avoir |
| Descriptions de moins de 200 caractères | 776 | Indicateur de contrôle, pas preuve automatique d'invalidité |
| Salaire minimum présent, devise absente | **99** | Risque de devise inventée lors de la publication |
| Offres actives sans aucune source active | **0** | Invariant positif dans cet instantané |
| URL canonique différente de toutes les URL de sources actives | **11** | Incohérence à contrôler ; ne signifie pas 11 liens HTTP morts |
| JobSource sans contenu brut | **8 964 / 76 562** | 11,71 % ; capacité de relecture incomplète |
| Jours distincts de MarketSnapshot | **4** | Entre le 4 et le 8 septembre ; historique encore très court |

Ulta Beauty représente 10 051 offres, soit environ **14 %** du catalogue actif. Cette concentration ne prouve ni un défaut sectoriel ni une bonne couverture mondiale : les indicateurs doivent aussi être calculés par pays, métier, employeur et taille de source.

Les 440 sources actives portent une date et un verdict robots. Ce constat ne valide ni l'exactitude de ces verdicts ni leur actualité : l'import possède notamment une date codée en dur. Le nouveau champ `countryIntegrity` était vide dans la mesure ; cela ne prouve pas l'absence d'ambiguïtés géographiques.

### Vérifications exécutées

| Vérification | Résultat | Portée |
|---|---|---|
| TypeScript agrégateur + web | Réussi | Cohérence des types, pas validité de tout SQL brut |
| Suite complète agrégateur | **84 fichiers, 1 460 tests réussis** | Base isolée ; exécution complète au-delà des sélections CI |
| Suite web finale | **82 réussis, 2 ignorés** | 9 fichiers ; inclut les 2 nouveaux tests de fumée SQL ajoutés en parallèle |
| Migrations sur base vide PostgreSQL 18 | **13 migrations réussies** | Ne démontre pas la compatibilité avec une ancienne application encore en service |
| Build de production Next.js | Réussi | Build précédant le correctif SQL concurrent `3b4221d` ; pas de certification de débit |
| Parcours Playwright ordinateur/mobile | **15 réussis, 1 échec** | Échec d'un scénario mobile qui n'ouvre pas « Filtres » avant de chercher « Pays » |
| Inspection mobile | Filtre Pays présent ; pas de débordement à 390 px | L'échec précédent est un scénario à actualiser, pas une fonctionnalité absente |
| Audit npm des dépendances de production | 4 niveaux high, 1 moderate, 0 critical | Comptage de paquets signalés, avec propagation transitive ; exploitabilité à qualifier |

Les parcours réussis comprennent les offres actives, les pages absentes, les offres expirées en 410/noindex et les redirections d'identifiants. Les reproductions supplémentaires démontrent des mécanismes défectueux sur des données synthétiques ; elles ne mesurent pas leur fréquence historique dans le catalogue réel.

### Ce qu'il faut conserver

Le registre des sources, la séparation Job/JobSource, les adaptateurs spécialisés, les migrations versionnées, les traces de cycle de vie, les garde-fous contre les fermetures massives et la suite de tests forment une base utile. La présentation est cohérente avec la direction graphique actuelle. L'échappement du contenu et du JSON-LD, les requêtes paramétrées et plusieurs protections réseau existent déjà.

La séparation produit actuelle reste pertinente : Mode Careers/Fashion Atlas assure la découverte ; Catwalks porte les candidats et le matching. Il n'est pas nécessaire de recréer un ATS, une CVthèque ou une authentification concurrente dans l'agrégateur. La cadence quotidienne décidée pour la collecte est conservée dans la feuille de route.

## 2. Problèmes et corrections prioritaires

**P0** : incident critique ou risque immédiat de disponibilité. **P1** : défaut à traiter avant une exploitation élargie, car il compromet les offres, le contrôle opérationnel ou la sécurité. **P2** : amélioration structurante à planifier, avec validation avant montée en charge ou ouverture du marché concerné.

### A01 — P0 — Migration incompatible avec le site encore en service

**Constat observé.** La recherche affichait « Service momentanément indisponible ». Les journaux entre 10:33 et 10:35 UTC contenaient `The column Job.country does not exist in the current database.` La base portait déjà `countryCode`, tandis qu'un processus web interrogeait encore `country`. Le renommage SQL est direct dans la [migration, ligne 29](/Users/lmelane/Downloads/catwalks-job-aggregator/packages/db/prisma/migrations/20260908230000_country_code_rename/migration.sql:29).

**État final observé.** À **12:44:53, heure de Paris**, `/emplois` répondait à nouveau sans le message d'indisponibilité ; `/api/jobs?page=1` renvoyait HTTP 200, 25 offres et un total de 71 636. Le rétablissement est intervenu sans action corrective de cet audit. L'incident demeure une preuve d'insuffisance du processus de déploiement.

**Correction.** Exécuter les migrations dans une étape unique, coordonnée avec tous les consommateurs de la base. Pour un simple renommage de propriété, envisager un mapping Prisma conservant le nom SQL. Si le renommage physique atomique reste requis, prévoir une bascule coordonnée avec fenêtre de maintenance explicite et retour arrière compatible. Une migration progressive est une autre option, à arbitrer avec la décision actuelle de ne pas conserver de colonnes parallèles. Ajouter une sonde de disponibilité qui exécute une vraie lecture d'offres.

**Validation.** Tester la matrice ancienne/nouvelle application × ancien/nouveau schéma correspondant à la stratégie retenue ; exécuter les requêtes web réelles après migration ; démontrer la procédure de retour arrière. Une migration réussie sur base vide ne suffit pas.

### A02 — P1 — La déduplication fusionne des emplois distincts

**Constat reproduit.** Deux offres de pays différents peuvent fusionner lorsqu'elles partagent entreprise, ville normalisée et titre. `Store Manager` et `Assistant Store Manager` obtiennent une similarité de 0,8 et peuvent fusionner. Deux titres identiques publiés à 180 jours d'écart fusionnent avant le contrôle temporel. Voir [clé de regroupement](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/match.ts:77), [concept métier](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/match.ts:138) et [ordre des contrôles](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/match.ts:185).

**Impact.** Disparition d'opportunités réelles, mauvaise localisation, contenu composite et historique de recrutement faux.

**Correction.** Distinguer l'identité certaine — source, tenant, identifiant de recrutement — de la ressemblance. Faire du pays, du lieu vérifié, du niveau hiérarchique, du temps de travail et de la référence de poste des contraintes de non-fusion lorsque leurs valeurs sont fiables et incompatibles. Respecter les identifiants distincts d'une même source. Évaluer l'écart temporel aussi pour les titres identiques ; gérer explicitement les republications. Conserver séparément les cas ambigus.

**Validation.** Ces trois reproductions doivent cesser de fusionner. Construire un corpus multilingue annoté, avec homonymes de villes, assistants/directeurs, boutiques multiples, contrats et republications. Mesurer séparément les faux regroupements et les doublons résiduels, avec intervalle de confiance. Prioriser la précision de fusion.

### A03 — P1 — La déduplication n'est pas atomique entre travailleurs

**Constat reproduit.** Deux collectes simultanées de sources différentes ont créé deux Job pour le même poste. La recherche du cluster puis sa création ne sont pas sérialisées ; les contraintes d'unicité propres à chaque source ne couvrent pas ce cas. Voir [upsert](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/upsert.ts:152).

**Correction.** Sérialiser la décision pour une clé de regroupement dans une transaction courte, ou router les candidats d'une même partition vers un seul travailleur. Employer un verrou transactionnel ou un mécanisme équivalent avec gestion explicite des reprises. Réexaminer aussi la contrainte Job `(companyId, source, externalId)` : elle doit respecter l'espace d'identifiants de chaque tenant, pas seulement le nom de la famille d'ATS.

**Validation.** Rejouer simultanément la même offre depuis plusieurs sources et après interruption : un seul Job, toutes les JobSource attendues, aucun événement de création doublé. La reproduction utilisait une barrière déterministe entre lecture et écriture ; le défaut n'est pas un simple soupçon de charge.

### A04 — P1 — Une source secondaire peut écraser les données de l'employeur

**Constat reproduit.** Une offre employeur `Store Manager`, salaire 50 000, a conservé son URL employeur et son rang `EMPLOYER_DIRECT`, mais son titre et son salaire ont été remplacés par ceux du jobboard : `Assistant Store Manager`, 25 000. Le fait qu'une source soit déjà attachée est assimilé à l'autorité de réécriture. Voir [détection alreadyKnown](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/upsert.ts:552) et [réattestation des champs](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/upsert.ts:495).

**Correction.** Porter une `canonicalSourceId` explicite et la provenance de chaque champ : source, observation, version de normalisation, confiance. Une source inférieure peut compléter un champ absent ; son écrasement d'une valeur employeur exige une règle explicite. Accepter une correction légitime même si la nouvelle description est plus courte : la longueur ne représente pas la vérité.

**Validation.** Permuter l'ordre d'arrivée des sources et de leurs corrections ; obtenir le même résultat canonique. Vérifier les salaires, contrats, géographie, titres et descriptions, pas seulement l'URL.

### A05 — P1 — Le contenu brut ne suit pas les mises à jour

**Constat reproduit.** Après ingestion de la révision 2, `Job.raw` et `JobSource.raw` restaient en révision 1. L'attachement d'une nouvelle source ne renseigne pas non plus son brut dans ce chemin. Voir [écriture JobSource](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/upsert.ts:556). La production contient 8 964 JobSource sans brut.

**Impact.** Un backfill ou une nouvelle normalisation peut réintroduire une valeur ancienne ; une correction ne peut pas toujours être expliquée ou reconstruite.

**Correction.** Conserver des observations brutes versionnées, horodatées et identifiées par empreinte, idéalement dans un stockage objet avec une politique de rétention. Lier chaque valeur normalisée à l'observation effectivement utilisée. Séparer le brut courant et l'historique ; ne pas copier des documents volumineux dans chaque requête web.

**Validation.** Rejouer une observation donnée avec une version de normalisation déterminée et retrouver les mêmes valeurs. Vérifier mise à jour, rattachement de source, absence de changement, correction plus courte et suppression des données personnelles non nécessaires.

### A06 — P1 — Le délai limite ne termine pas le travail en cours

**Constat de code.** Le `Promise.race` de [withTimeout](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/ingestOrchestrator.ts:115) termine l'attente, mais n'annule pas la collecte ni ses écritures. Le travailleur suivant peut démarrer alors que le précédent continue. L'entrée CLI assume l'absence de [verrou entre runs](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/cli.ts:90). Les limites par hôte sont locales au processus.

**Correction.** Propager un signal d'annulation dans HTTP, navigateur, pagination et boucle d'écriture. Ajouter un bail par source, expirant et renouvelable, avec un numéro de génération empêchant un ancien travailleur d'écrire après perte du bail. Gérer l'arrêt du conteneur. En cas de plusieurs instances, partager le budget de requêtes par hôte.

**Validation.** Après timeout ou perte du bail : aucune écriture tardive et aucune requête nouvelle. Après arrêt brutal : reprise bornée et idempotente. Ne pas augmenter la concurrence avant ces garanties.

### A07 — P1 — Une collecte partielle peut être interprétée comme complète

**Constat de code.** Des branches de l'[adaptateur JSON-LD générique](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/genericJsonLd.ts:88) renvoient les offres déjà obtenues après une interruption sans transmettre partout une preuve structurée de troncature. Le refresh interprète certaines notes textuelles par expression régulière. La [garde de purge](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/ingest.ts:495) reçoit un statut OK et pas le nombre d'écritures échouées. Enfin, le [curseur avance](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/ingest.ts:317) avant la persistance des offres.

**Correction.** Imposer à chaque adaptateur un résultat structuré : complet/partiel/bloqué/échoué/vide confirmé, périmètre parcouru, total annoncé, éléments lus, éléments persistés, erreurs et prochain curseur. Une absence n'est attestable que sur un périmètre entièrement parcouru et persisté. Enregistrer le curseur après les écritures durables. Utiliser le même prédicat d'attestation pour ingestion, purge, refresh et réconciliation.

**Validation.** Interrompre à chaque page et à chaque phase d'écriture ; reprendre sans perte. Faire échouer une page intermédiaire ou une écriture : aucune offre non revue ne doit disparaître. Inclure les sources sans total annoncé et les collectes tournantes sur plusieurs jours.

### A08 — P1 — Le cycle de vie ne distingue pas suffisamment absence et impossibilité de vérifier

**Constat de code.** Les sources dont le dernier run est BROKEN/TIMEOUT/ERROR/CHALLENGED protègent leurs offres sans borne liée à leur dernière collecte saine. À l'inverse, l'historique SourceRun est élagué après dix jours : une source arrêtée peut finir par perdre cette preuve de protection. Un résultat réellement vide se confond avec une panne. Voir [refresh](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/refresh.ts:66) et [rétention des runs](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/health.ts:264).

Le refresh sélectionne des sources périmées puis les désactive par identifiant sans revérifier `lastSeenAt`. Une collecte intercalée peut être écrasée. Certaines listes `IN` demeurent non découpées, malgré le découpage déjà présent pour les Job.

**Correction.** Conserver un état durable du dernier parcours complet par source. Définir les états « confirmé actif », « non revérifiable », « absence confirmée », « expiré », avec règles de publication explicites. Une panne ne prouve pas une fermeture ; elle ne doit pas non plus afficher indéfiniment une fraîcheur fictive. Distinguer un vide confirmé. Rendre les mises à jour conditionnelles ou protégées par le bail ; découper toutes les opérations volumineuses.

**Validation.** Couvrir panne prolongée, source vide réelle, source supprimée du planning, fermeture d'une petite source, collecte concurrente et plus de 32 767 identifiants. Contrôler les variations par source, en complément du garde-fou global.

### A09 — P1 — La validité publiée peut être inventée

**Constat reproduit et mesuré.** Une offre avec `validThrough` au 1er janvier 2025 reste active après refresh ; 79 offres actives ont une validité dépassée dans la mesure. Le [JSON-LD](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/lib/job-posting-schema.ts:69) remplace toute date passée ou absente par la date du rendu + 30 jours, sans vérifier une observation employeur récente.

**Correction.** Séparer la dernière vérification d'activité et la date limite de candidature. Arbitrer une contradiction entre date et présence dans l'ATS à partir d'une observation récente et fiable. Publier la validité source lorsqu'elle est connue ; l'omettre lorsqu'elle est inconnue. Google prévoit explicitement cette omission et demande le retrait des offres qui ne sont plus disponibles. [Documentation Google JobPosting](https://developers.google.com/search/docs/appearance/structured-data/job-posting).

**Validation.** Une offre peut rester confirmée active sans date limite inventée. Une fermeture confirmée déclenche le retrait approprié ; le JSON-LD et la page racontent le même état. La logique 410/noindex déjà testée doit être conservée.

### A10 — P1 — Le lien canonique peut rester attaché à une source inactive

**Constat reproduit.** Après désactivation de la source employeur, l'URL canonique reste celle de l'employeur alors que seule une source jobboard est active. Une nouvelle ingestion du jobboard ne la remplace pas : le calcul de l'[autorité canonique](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/upsert.ts:585) inclut encore les sources inactives. La production présente 11 incohérences de ce type au sens de la comparaison d'URL, sans test HTTP exhaustif de ces liens.

**Correction.** Recalculer la source canonique parmi les sources actives et vérifiées après fermeture, réouverture, retrait, fusion ou changement d'URL. Modifier URL et provenance atomiquement. Conserver la préférence employeur lorsqu'elle est encore justifiée et un libellé de candidature fidèle à la destination effective.

**Validation.** Zéro URL canonique sans source active correspondante, sauf exception documentée. Contrôler séparément que le lien atteint une candidature pour le bon poste : un HTTP 200 ou une page carrière générique ne suffisent pas.

### A11 — P1 — Les indicateurs peuvent annoncer un succès ou une dégradation à tort

**Constats.** Les [exceptions d'ingestion](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/ingest.ts:544) deviennent des statistiques `errors: 1`, mais l'orchestrateur incrémente tout de même `ok`. Certains incidents et challenges n'atteignent donc pas leur traitement dédié. Le [heartbeat](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/cli.ts:120) omet `timedOut` dans son booléen de succès.

À l'inverse, la qualité des champs est calculée sur les offres retenues, puis divisée par le nombre collecté avant filtrage sectoriel. **Reproduction :** 100 offres lues, 20 dans le secteur, 20 complètes et écrites ; la source est déclarée DEGRADED avec « descriptions manquantes sur 80 % ». Voir [calcul de couverture](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/health.ts:189).

**Correction.** Définir un résultat de run unique et typé, jusqu'au code de sortie et à l'alerte. Séparer disponibilité, complétude de collecte, pertinence sectorielle, qualité des champs et erreurs d'écriture. Rendre chaque dénominateur explicite. Une source excluant des offres hors secteur n'est pas intrinsèquement dégradée.

**Validation.** Tester succès, timeout, challenge, échec HTTP, écriture partielle et filtrage sectoriel ; vérifier ensemble le SourceRun, le statut Source, le digest, le heartbeat et le code de sortie.

### A12 — P1 — La protection SSRF ne couvre pas toutes les connexions

**Constat de code, sans tentative d'exploitation.** Le [garde réseau](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/lib/ssrf.ts:62) bloque des noms et IP explicites, mais ne vérifie pas les adresses résultant du DNS. Les redirections [réutilisent les mêmes paramètres HTTP](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/lib/http.ts:99), y compris les en-têtes fournis, même lors d'un changement d'hôte. Dans le navigateur, vérifier l'URL finale après `goto` intervient après certaines connexions ; les sous-requêtes ne sont pas toutes couvertes par cette validation.

**Correction.** Valider les adresses A et AAAA puis contrôler l'adresse effectivement utilisée ; refuser les réseaux internes au niveau réseau également. Vérifier chaque redirection et sous-requête avant connexion. Ne pas transmettre de cookies ou d'en-têtes d'autorisation à une autre origine. Isoler les navigateurs de collecte des services et secrets internes. Ces contrôles complètent les recommandations de défense contre les résolutions DNS trompeuses. [Référentiel OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

**Validation.** Dans un environnement de test fermé : domaines résolvant vers IP privées, IPv6, rebinding, redirections, sous-ressources et changement d'origine. Zéro connexion interdite, même si la validation applicative est contournée. Évaluer l'exposition réelle des adaptateurs qui créent leur propre navigateur.

### A13 — P1 — L'activation d'une source ne garantit pas un verdict acceptable

**Constat reproduit.** Une source DRAFT portant `robotsVerdict: DISALLOWED`, une date, une configuration et une offre validée a été promue ACTIVE. Le [contrôle](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/connectors/sourceStore.ts:205) vérifie la présence du verdict, pas sa signification. L'[import CSV](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/connectors/sourceStore.ts:176) fixe `robotsCheckedAt` au 2 septembre 2026 et crée directement les nouvelles lignes en ACTIVE.

**Correction.** Employer des verdicts structurés avec conditions par chemin, date de vérification réelle, expiration et preuves. Faire appliquer la même politique par import, promotion et exécution. L'import doit préserver les contrôles opérationnels et l'historique au lieu de donner artificiellement une date de vérification. Conserver un arrêt par source et un processus de retrait rapide.

**Gouvernance.** Tenir pour chaque source les modalités d'accès, les droits de réutilisation, les restrictions, le contact et les champs autorisés. Un verdict robots ne remplace pas l'examen de ces droits. Pour les données personnelles éventuellement présentes dans les annonces ou le brut, documenter finalité, base légale, minimisation, rétention et traitement des demandes. La CNIL rappelle que l'accès public ne dispense pas de ces vérifications. [Recommandations de la CNIL](https://www.cnil.fr/sites/default/files/2024-06/recommandations_reutilisateurs_donnees_publiees_sur_internet.pdf).

**Validation.** La reproduction DISALLOWED doit être refusée par tous les chemins. Réévaluer une source dont les conditions changent et prouver sa suspension. L'audit ne conclut pas à l'illégalité du catalogue ; il identifie un contrôle insuffisant et des droits non vérifiés source par source.

### A14 — P1 — Une panne du registre de confiance réautorise les valeurs douteuses

**Constat.** En cas d'erreur de lecture des verdicts, l'[ingestion repart avec une Map vide](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/ingest.ts:459) et les priorités par défaut. Une valeur structurée déjà reconnue incorrecte peut redevenir prioritaire. La [lecture des verdicts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/trust/persist.ts:87) n'utilise pas leur âge ; aucune réévaluation périodique complète n'a été démontrée dans le planning inspecté.

**Correction.** Utiliser la dernière version saine du registre ou empêcher les écrasements qui nécessitent cette confiance lorsque le registre est indisponible. Ne pas bloquer inutilement les observations brutes sûres. Versionner les décisions, leur expiration et les preuves ; organiser la réévaluation et les alertes de dérive.

**Validation.** Simuler l'indisponibilité du registre : aucune valeur précédemment rejetée ne doit redevenir canonique par simple panne. Rejouer aussi des verdicts expirés et un changement de structure d'ATS.

### A15 — P1 — Les facettes et certains totaux sont incomplets

**Constat certain dans le code.** La [requête des entreprises](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/lib/jobs.ts:308) prend les 300 premières, puis calcule les secteurs et groupes à partir de ce sous-ensemble. Avec 1 054 entreprises actives, la longue traîne n'entre pas dans ces agrégats sans filtre. Les villes et sources sont aussi plafonnées à 60 et 40 choix. Le volume exact d'offres perdu dans chaque facette n'a pas été mesuré.

**Correction.** Calculer les totaux par dimension directement sur l'ensemble correspondant aux filtres. Séparer ce total de la liste paginée ou recherchable des choix de facette. Pour permettre de changer une facette, exclure son propre filtre du comptage lorsque c'est le comportement souhaité ; le traitement spécifique du pays fournit déjà un précédent.

**Validation.** Sur un jeu de plus de 300 entreprises réparties entre secteurs et groupes, les totaux doivent se réconcilier avec le catalogue, y compris la catégorie inconnue. Une entreprise peu volumineuse doit rester trouvable. Ne pas interpréter une liste de « premiers choix » comme une statistique exhaustive.

### A16 — P1 — La CI n'exécute pas toute la suite et ne protège pas tous les scénarios critiques

**Constat.** Les commandes de [test de l'agrégateur](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/package.json:17), utilisées par la [CI](/Users/lmelane/Downloads/catwalks-job-aggregator/.github/workflows/ci.yml:43), omettent dix fichiers existants : sourceConfig, sourceStore côté connectors, hostGate, http.retry, normalize côté lib, responseIntegrity, wafToken et les trois tests de trust. La suite complète exécutée par cet audit les inclut et réussit.

Deux tests de rapprochement des statistiques web restent conditionnés à une URL locale exacte. **Évolution prise en compte :** le commit concurrent `3b4221d` a ajouté deux tests de fumée SQL utilisables sur toute base au bon schéma ; ils passent dans le contrôle final. Il ne faut donc plus affirmer qu'aucun SQL d'intelligence n'est exécuté en CI. Les tests de cohérence sur données restent à rendre portables. Voir [conditions des tests](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/lib/__tests__/intelligence-facts.integration.test.ts:10).

**Correction.** Définir des projets de tests explicites couvrant tous les fichiers et interdire les omissions silencieuses. Utiliser PostgreSQL correspondant à la production, actuellement 18 dans l'observation contre 16 en CI. Corriger le parcours mobile en ouvrant Filtres. Ajouter les reproductions de cet audit, les contrats de pagination et la matrice de déploiement. Vérifier effectivement la protection de branche, sans se fier au commentaire du workflow.

**Validation.** CI verte sur l'ensemble du périmètre prévu, aucun test critique ignoré pour une URL de machine personnelle, mêmes invariants sur fixtures multilingues et migrations depuis un état existant.

### A17 — P1 — L'exploitation et la reprise doivent être démontrées

**Constats observés.** Dans l'instantané Railway des services applicatifs, `healthcheckPath` et `preDeployCommand` étaient vides ; des déploiements étaient simultanément en construction. Le web reposait sur une réplique dans une région. Le volume PostgreSQL était configuré à 5 Go, avec environ 1,55 Go utilisés. Cela ne constitue pas en soi une saturation, mais justifie une projection incluant index et croissance des observations.

Le [deadman web](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/lib/deadman.ts:20) regarde le dernier SourceRun de n'importe quelle source : une seule source récente peut masquer les autres. Il dépend lui-même du web et de PostgreSQL. L'absence de configuration de transport peut être comptée comme alerte traitée ; sa présence effective en production n'a pas été vérifiée.

Le [Dockerfile de l'agrégateur](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/Dockerfile:1) contient un fallback `migrate resolve` déclenché par toute erreur de migration. Il doit être limité au cas exact de baselining et retiré du démarrage normal. **Qualification :** le manifeste Railway observé utilisait Railpack ; le risque Docker concerne ce chemin lorsqu'il est employé, pas une cause prouvée de l'incident.

**Correction.** Versionner configuration des services, commandes et versions ; distinguer liveness et readiness ; ajouter une surveillance externe du parcours recherche → fiche → destination. Suivre chaque source et chaque cycle complet. Séparer les rôles DB web/collecte/migration. Formaliser sauvegardes, restauration à un instant donné, retour arrière et propriétaire d'incident. Alerter sur stockage, connexions, latence, âge de collecte et échec réel de notification.

**Validation.** Exercer la restauration sur une base isolée et mesurer perte de données et délai ; exécuter un arrêt de travailleur, un redéploiement et une indisponibilité DB en staging. Les mentions historiques de sauvegardes dans la documentation ne remplacent pas une restauration actuellement vérifiée. Une seconde réplique ne corrige pas une migration incompatible partagée.

### A18 — P2 — La recherche et la pagination feront payer le volume à chaque requête

**Constats.** La [recherche](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/lib/jobs.ts:238) multiplie les conditions `contains` insensibles à la casse sur plusieurs champs et jointures. Les index observés sur Job sont B-tree, sans index adapté au texte. Le [chargement d'une page](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/lib/jobs.ts:594) déclenche une dizaine de requêtes, recalcule les facettes et charge les colonnes complètes de Job, dont le brut, avant projection.

Le tri `postedAt`, puis `firstSeenAt`, n'a pas d'identifiant final de départage ; les dates nulles ont une sémantique implicite. La pagination par offset dérive quand des offres arrivent. Une valeur `page=1.5` a été acceptée lors du contrôle local. Aucune limitation applicative de coût ou de débit n'a été identifiée sur ce chemin public ; une éventuelle protection amont n'a pas été certifiée.

**Correction.** Commencer par PostgreSQL : index de recherche plein texte et/ou trigrammes adaptés aux requêtes, tri explicite avec identifiant stable, pagination par curseur, projections réduites et cache des agrégats. PostgreSQL permet l'indexation trigramme des recherches ILIKE. [Documentation pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html). Valider entier, borne de pagination, longueur et nombre de termes ; limiter durée, débit et coût des requêtes. Distinguer erreur de saisie et indisponibilité DB.

**Validation.** Mesurer `EXPLAIN (ANALYZE, BUFFERS)` en staging sur un jeu représentatif, puis tester à 3× le volume et 3× le trafic de pointe prévu. Mesurer p50/p95/p99 et connexions, pas seulement un temps local. Un moteur spécialisé devient pertinent si ces mesures ou la pertinence multilingue le justifient ; il n'est pas un prérequis immédiat.

### A19 — P2 — Le coût d'ingestion augmente inutilement avec le nombre de sources

**Constat de code.** À chaque source, [previousCounts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/health.ts:207) relit l'historique global des runs. L'orchestration réexécute aussi des chargements de catalogue et de confiance pour chaque run individuel. L'upsert entreprise est répété par offre et certaines lectures de JobSource transportent des bruts inutiles.

**Correction.** Charger un contexte immuable par cycle, lire uniquement le dernier état nécessaire par source avec index adapté, mémoriser les entreprises résolues, grouper les écritures compatibles et écrire seulement les champs réellement modifiés. Utiliser ETag/Last-Modified ou flux différentiels lorsque la source les propose ; mutualiser la récupération des portails de groupes avant répartition par marque. Préférer API/feed officiels, puis extraction structurée, puis navigateur lorsque nécessaire.

**Validation.** Suivre requêtes DB, temps CPU, octets réseau, secondes de navigateur et coût par 1 000 offres confirmées. Comparer avant/après sur petit flux, groupe massif, jobboard filtré et source lente. Conserver la cadence quotidienne ; une cadence plus fréquente sur certaines sources constitue un arbitrage produit séparé.

### A20 — P2 — Le modèle mondial doit représenter les ambiguïtés et la diversité des emplois

**Constat.** Le schéma s'est récemment amélioré avec `countryCode`, `countryIntegrity`, les dimensions de contrat et `adminArea1`. Il reste centré sur un lieu principal ; la résolution régionale et le géocodage ne forment pas encore un référentiel mondial complet. Les valeurs nouvelles ne doivent pas donner une impression de couverture déjà certifiée.

**Correction.** Introduire des lieux identifiés avec pays, subdivision, alias multilingues, coordonnées et niveau de confiance ; accepter plusieurs lieux et une zone admissible pour le télétravail. Distinguer groupe, marque, employeur juridique, franchise et cabinet. Stocker les dimensions de contrat séparément, conserver le texte d'origine et les inconnues. Un libellé international permanent ne doit pas être traduit automatiquement en une qualification juridique française précise.

Pour les métiers, couvrir retail, création, atelier, artisanat, production, qualité, supply chain, digital, fonctions siège, parfumerie/cosmétique et recherche. Versionner taxonomies et règles, mesurer précision et taux d'inconnu par langue/source ; éviter de laisser le dernier intitulé d'offre changer arbitrairement la catégorie de toute une entreprise.

**Validation.** Échantillons stratifiés et annotés : codes CA ambigus, villes homonymes, subdivisions hors États-Unis/Canada, caractères non latins, postes multilieux, temps partiel, saisonnier, alternance et remote restreint. Toute inférence reste distinguable d'une donnée employeur attestée.

### A21 — P2 — Les salaires sont encore trop dépendants du contexte français

**Constats.** `salaryMin` et `salaryMax` sont des [entiers](/Users/lmelane/Downloads/catwalks-job-aggregator/packages/db/prisma/schema.prisma:375), alors qu'un taux horaire peut comporter des décimales. L'[extraction textuelle](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/normalize/salary.ts:49) reconnaît principalement l'euro et déduit mois/année d'un seuil de montant. Le [JSON-LD](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/lib/job-posting-schema.ts:112) remplace une devise absente par EUR ; 99 offres avec salaire minimum présentent ce manque en production.

**Correction.** Utiliser des montants décimaux et une devise ISO attestée ; distinguer heure, jour, semaine, mois et année d'après la source. Conserver fourchette, brut/net lorsqu'explicite, rémunération variable et texte original. Afficher « devise non précisée » ou omettre la donnée structurée incomplète ; ne pas inventer une rémunération comparable. Une éventuelle conversion pour comparaison doit être datée et séparée du salaire source.

**Validation.** Jeux USD horaires décimaux, GBP annuels, EUR mensuels, JPY, séparateurs locaux, fourchettes et chiffres d'affaires proches d'un salaire. Aucune devise par défaut et aucune période devinée silencieusement dans les champs attestés.

### A22 — P2 — La recherche géographique promet plus qu'elle ne réalise

**Constat de code et contrôle local.** Le champ affiche [« Ville, région ou pays »](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/components/search-pill.tsx:76), mais ses valeurs alimentent `ville`, puis une [égalité sur city](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/lib/jobs.ts:234). Saisir France ne reproduit donc pas le filtre pays France et peut renvoyer zéro résultat.

**Correction.** Fournir une sélection de lieu typée — ville, région, pays, zone remote — avec suggestions explicites. À court terme, aligner le libellé sur le comportement réellement disponible. À terme, gérer alias et fautes, pays de la ville, distance et langues. Distinguer zéro correspondance, filtre trop restrictif et service indisponible ; proposer un élargissement concret.

**Validation.** Paris/Paris Texas, France, California, Milan/Milano et caractères non latins. Les totaux, URL partagée, filtres visibles et bouton retour doivent représenter la même recherche.

### A23 — P2 — Des détails d'accessibilité et de concurrence affectent l'interface

**Constats.** L'[autocomplétion](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/components/search-pill.tsx:220) ne relie pas l'option parcourue au champ par `aria-activedescendant` et des identifiants d'options. Le [menu mobile plein écran](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/components/site-nav.tsx:143) n'a pas une gestion complète du focus de dialogue. Certaines cibles de filtre mesurent environ 34–36 px de haut, sous l'objectif de confort de 44 px du projet ; cette mesure seule ne constitue pas un échec WCAG AA.

Le [chargement des pages suivantes](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/components/jobs-view.tsx:170) ajoute toute réponse reçue sans vérifier qu'elle appartient encore aux filtres courants. Un changement de filtre pendant une requête lente peut ainsi mélanger les résultats. Cette course est identifiée dans le code ; elle n'a pas été reproduite dans le navigateur.

**Correction.** Compléter le parcours clavier, le focus et les annonces des suggestions selon le [modèle W3C Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/). Gérer ouverture/fermeture/retour du focus du menu, zoom et réduction des animations. Annuler les requêtes obsolètes et vérifier un identifiant de génération avant ajout ; dédupliquer les identifiants affichés. Borner le DOM ou virtualiser seulement si les mesures le nécessitent. Maintenir un accès clavier au chargement supplémentaire.

**Validation.** Clavier seul, VoiceOver/NVDA, réseau ralenti avec changement de filtre, 320/390/768/1280 px, zoom et textes longs. Le test mobile Pays doit ouvrir Filtres, comme un utilisateur : le bouton existe bien.

**Appréciation UI provisoire, sur 0–4 par axe :** accessibilité 2 ; performance 2 ; responsive 3 ; cohérence des styles 3 ; intégrité de l'implémentation 2. **12/20**, sans valeur de certification. La performance est limitée par l'absence de mesures terrain et de charge ; l'identité visuelle actuelle est cohérente. Aucun motif d'imposer une refonte esthétique globale.

### A24 — P2 — Un catalogue international n'est pas encore un produit multilingue

**Constat.** Les [boutons FR](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/components/site-nav.tsx:102) n'ont pas d'action ; l'interface et ses formats restent français. Plusieurs dimensions déjà présentes — fonction, séniorité, temps de travail, programme, remote — ne sont pas encore pleinement exploitables dans les filtres candidats.

**Correction.** Démarrer avec un parcours FR/EN complet : navigation, lieux, formats, filtres, erreurs et métadonnées. Déployer ensuite les langues selon la demande et les marchés prioritaires. Conserver l'annonce originale ; marquer toute traduction comme telle. Ne pas promettre une interface traduite avec un sélecteur inactif. Introduire les filtres dont la couverture et la précision sont suffisantes, avec catégorie inconnue visible plutôt qu'exclusion silencieuse.

**Validation.** Parcours complet dans chaque langue publiée, noms et descriptions longues, pluriels, encodages, formats de rémunération et URL stables. Vérifier `lang`, les correspondances entre versions linguistiques et l'absence de pages traduites vides. Mesurer les recherches sans résultat par langue et pays avant d'en ajouter d'autres.

### A25 — P2 — L'historique de marché peut être effacé ou mal interprété

**Constats.** La [purge supprime physiquement les Job](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/purge.ts:66) et la relation [JobEvent cascade](/Users/lmelane/Downloads/catwalks-job-aggregator/packages/db/prisma/schema.prisma:481) : l'historique associé disparaît. Quatre dates de snapshots ne permettent pas encore d'éprouver une analyse de tendance longue. L'ajout d'une source peut ressembler à une hausse de recrutement sans changement chez l'employeur.

**Correction.** Conserver les événements métier nécessaires indépendamment de la suppression opérationnelle, avec rétention définie. Séparer fin d'offre, fusion, correction, retrait de source et suppression réglementaire. Maintenir une correspondance entre identifiants fusionnés et offre survivante. Versionner les taxonomies et distinguer faits observés, données reconstruites et changements de couverture. Pour les tendances, publier aussi un panel constant et la couverture des sources.

**Validation.** Après purge ou fusion, reconstruire les créations et fermetures du mois sans compter une correction comme un recrutement. Distinguer « nous avons découvert cette offre » de « l'employeur vient d'ouvrir ce poste ». Conserver la séparation existante entre snapshots live et reconstruits.

### A26 — P2 — La notification aux moteurs n'est pas une file durable

**Constat de code.** Le [CLI](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/cli.ts:110) cherche les fermetures via `lastSeenAt`, qui décrit l'observation, pas `closedAt`. Le [module d'indexation](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/googleIndexing.ts:98) place les créations avant les suppressions, tronque au plafond par run et n'enregistre pas les éléments dits « deferred ». Les mises à jour d'offres existantes ne disposent pas d'une livraison durable dans ce chemin. La configuration effective du compte et ses quotas n'ont pas été certifiés.

**Correction.** Alimenter une file persistante d'événements de publication, correction et retrait dans la transaction métier ; livrer après commit, avec reprise, déduplication par URL, quotas journaliers et priorité aux retraits. Utiliser l'URL canonique finale et les dates de changement métier. Garder des sitemaps exacts et un `lastmod` significatif. L'API et le sitemap sont complémentaires selon la [documentation Google](https://developers.google.com/search/docs/appearance/structured-data/job-posting).

**Validation.** Dépasser le quota, couper le service, le relancer : aucune notification perdue. Une fermeture doit rester en attente jusqu'à traitement, sans être évincée par un afflux d'offres nouvelles. La notification n'est pas une garantie d'indexation ou de classement.

### A27 — P2 — Les dépendances et les builds doivent devenir reproductibles

**Constat mesuré.** `npm audit --omit=dev` signale cinq paquets : quatre high et un moderate, notamment les chaînes deepmerge-ts/Prisma et PostCSS/Next. Il s'agit de dépendances signalées et de propagations, pas de cinq vulnérabilités applicatives indépendantes démontrées. Les versions verrouillées observées incluent Next 15.5.25 et Prisma 6.19.3. Les Dockerfiles exécutent `npm install`, alors que la CI utilise `npm ci`.

**Correction.** Qualifier si des données non fiables peuvent atteindre les fonctions concernées, choisir une montée de version supportée et testée, mettre à jour le lockfile par changement contrôlé. Éviter `npm audit fix --force` automatique : les propositions observées impliquent notamment un retour de version Prisma ou un changement majeur Next. Aligner runtime local/CI/production, utiliser des builds reproductibles, scanner les images, exécuter sans privilèges inutiles et conserver l'inventaire des composants.

**Validation.** Tests métier, build et staging sur les versions retenues ; absence de régression Prisma/migrations/navigateur ; traitement documenté de chaque avis résiduel. Si une atteignabilité publique est démontrée, relever immédiatement la priorité. Les détails datés figurent dans le fichier de preuve des dépendances.

### A28 — P2 — La couverture mondiale doit être pilotée comme un produit de données

**Constat stratégique.** 440 sources, 1 054 entreprises et 71 636 offres sont des actifs réels ; aucun dénominateur ne permet encore de déduire une couverture mondiale exhaustive. Les très grands flux peuvent masquer l'absence d'une maison, d'un pays ou d'un métier entier.

**Correction.** Construire un registre de couverture indépendant du catalogue d'offres : groupes, marques, employeurs, pays, métiers, domaines officiels, tenants ATS et sources de secours. Chaque absence doit avoir un état : pas de poste ouvert, source non couverte, accès indisponible, collecte partielle, employeur hors périmètre. Classer les partenaires par contribution marginale en offres uniques valides, stabilité et coût, pas par nombre brut de lignes.

Prioriser les accords de diffusion et les flux officiels des groupes et maisons ; compléter les boutiques/franchises, les petits employeurs spécialisés, ateliers et fonctions peu couvertes selon le périmètre commercial retenu. Industrialiser l'intégration d'une source : découverte → qualification → échantillon contrôlé → validation → activation → suivi. Une source nouvelle ne devrait pas nécessiter une suite de commandes manuelles impossible à reproduire.

**Validation.** Maintenir un référentiel représentatif — par exemple 200 employeurs prioritaires, complété d'une longue traîne stratifiée — et comparer périodiquement les offres visibles sur leurs canaux autorisés aux offres agrégées. Mesurer couverture d'employeurs et couverture de leurs offres séparément. Faire un benchmark concurrentiel sur ce même panel avant toute revendication de leadership.

## 3. Architecture cible : évolution progressive du système actuel

La priorité est de clarifier les contrats entre étapes. Le monorepo TypeScript, PostgreSQL et les adaptateurs peuvent rester. À ce volume, les observations ne justifient pas une migration immédiate vers une multitude de microservices, un cluster Kubernetes ou un moteur de recherche séparé.

```mermaid
flowchart LR
    R[Registre des sources et droits] --> S[Planification quotidienne et baux]
    S --> C[Collecteurs bornés par source et hôte]
    C --> O[Observations brutes versionnées]
    O --> N[Normalisation et contrôles]
    N --> D[Identité et fusion transactionnelles]
    D --> P[Catalogue canonique PostgreSQL]
    P --> Q[Recherche et agrégats mis en cache]
    Q --> W[Mode Careers et Fashion Atlas]
    P --> E[Événements durables]
    E --> G[Indexation et historique]
```

Ces blocs sont des responsabilités ; ils n'exigent pas un service distinct chacun. La supervision doit couvrir toutes les étapes et un parcours extérieur au système.

### Invariants à inscrire dans la conception

1. **Observation immuable :** on sait ce qui a été reçu, quand, depuis quelle source et avec quel extracteur.
2. **Écriture idempotente :** une reprise produit le même catalogue, sans création supplémentaire ni perte d'offre.
3. **Identité prudente :** deux offres ressemblantes restent séparées tant que la fusion n'est pas suffisamment prouvée.
4. **Provenance des champs :** le titre, le lieu, le contrat, le salaire et l'URL ont chacun une origine explicable.
5. **Absence prouvée :** seule une collecte complète et persistée sur un périmètre peut établir qu'une offre n'y figure plus.
6. **Publication fidèle :** aucune date, devise, localisation ou précision contractuelle n'est inventée pour remplir un champ.
7. **Événement durable :** une création, correction, fusion ou fermeture produit une notification rejouable après commit.
8. **Déploiement compatible :** aucun lecteur encore en service ne reçoit un schéma qu'il ne comprend plus.

Une file de travaux durable peut commencer dans PostgreSQL avec réservations transactionnelles, reprises et nombre d'essais borné. Un service spécialisé sera justifié par des mesures de contention, de débit ou de besoins opérationnels. Les gros bruts ont vocation à sortir des lignes consultées par le site ; PostgreSQL conserve leurs références et les index utiles.

### Schéma logique à compléter

| Objet | Responsabilité à rendre explicite |
|---|---|
| Source | Identité du tenant, droits et chemins, statut, propriétaire, version de configuration |
| SourceRun | État de complétude, périmètre, volumes lus/acceptés/écrits, erreurs, curseur validé, bail |
| Observation | Brut, empreinte, date, URL de collecte, version d'extracteur et référence de stockage |
| JobSource | Identité locale de l'offre, dernière observation, activité confirmée et URL de candidature |
| Job | Identité canonique, source canonique, état de publication et champs normalisés |
| Provenance de champ | Observation gagnante, règle, confiance et date de décision |
| Lieu / organisation | Identifiants stables, hiérarchie, alias, relations et ambiguïtés |
| Événement / livraison | Changement métier, destinataire, tentatives, dernier résultat, acquittement |
| Snapshot | Date, couverture, taxonomie, mode observé/reconstruit et métriques |

Il s'agit d'un modèle cible à adapter aux tables existantes, pas d'une demande de créer toutes ces tables sans examen. Des contraintes de base doivent couvrir les invariants certains : unicité dans le bon espace d'identifiants, relations valides et domaines de valeurs. Les ambiguïtés métier doivent rester représentables au lieu d'être corrigées par défaut.

## 4. Feuille de route et ordre des dépendances

| Étape | Travaux | Résultat concret pour autoriser l'étape suivante |
|---|---|---|
| **0 — Avant le prochain déploiement sensible** | A01 ; readiness et procédure de A17 | Procédure de bascule et retour arrière éprouvée ; recherche, fiche et agrégats fonctionnels après migration |
| **1 — Protéger l'intégrité des offres** | A02–A05, A09–A10, A14 ; tests A16 associés | Reproductions corrigées ; règles de fusion et provenance documentées ; aucun champ inventé |
| **2 — Rendre la collecte récupérable** | A06–A08, A11–A13 ; supervision et reprise A17 | Baux, annulation, curseurs durables, attestation unique, alertes exactes ; reprise après interruption |
| **3 — Fiabiliser la découverte** | A15, A18–A19, A21–A23, A26–A27 | Facettes justes, coûts bornés, parcours mobile/clavier, indexation durable ; benchmark de charge |
| **4 — Déployer par marchés** | A20, A24–A25, A28 | Référentiels, parcours FR/EN puis autres langues, couverture mesurée et historique interprétable |

Les tests et la sécurité accompagnent chaque étape. La rétention du brut et des événements doit être décidée tôt afin d'éviter une perte d'historique pendant les phases suivantes. Le traitement des salaires sans devise peut être remonté dès l'étape 1 pour arrêter cette publication incorrecte.

**Ordre de grandeur de programme :** les changements ponctuels peuvent prendre quelques jours ; la sécurisation de l'ensemble des mécanismes d'intégrité et de reprise représente plusieurs semaines. Une couverture internationale différenciante se construit ensuite sur plusieurs mois, notamment à cause des accords de sources, de l'annotation qualité et des langues. Ce n'est pas un devis : l'équipe, le trafic attendu, le budget et les marchés prioritaires ne sont pas connus. Un planning engagé doit être établi à partir des lots ci-dessus, avec propriétaire, estimation et critère d'acceptation pour chacun.

### Réparation du catalogue après les correctifs

Corriger le code ne répare pas automatiquement les 71 636 offres déjà présentes. Prévoir une opération distincte et contrôlée :

1. Geler un état de référence et conserver les observations nécessaires à la comparaison.
2. Produire, en lecture seule, les listes de fusions suspectes, champs contradictoires, URL incohérentes, devises manquantes et localisations ambiguës.
3. Recalculer dans une base isolée à partir des observations disponibles ; recollecter uniquement les preuves nécessaires via les sources autorisées lorsque le brut manque.
4. Examiner les changements proposés : nouvelles identités, séparations, fusions, fermetures, titres, salaires, pays et URL. Les incohérences n'autorisent pas un remplacement aveugle.
5. Appliquer ensuite par lots idempotents avec journal, contrôle des invariants, seuil d'arrêt et possibilité de retour arrière.
6. Réconcilier les pages canoniques, liens historiques, événements et notifications d'indexation.

Cette opération n'a pas été exécutée pendant l'audit.

## 5. Critères de validation de la production

Les valeurs suivantes sont des **cibles initiales proposées**, à ajuster avec le trafic et les engagements commerciaux. Elles ne sont pas des performances mesurées aujourd'hui.

| Domaine | Cible / preuve à obtenir |
|---|---|
| Disponibilité web | 99,9 % mensuel sur un parcours utile, et pas seulement sur une réponse HTTP 200 |
| Mise en production | Aucun lecteur incompatible pendant la migration ; retour arrière exercé |
| Cycle quotidien | Chaque source prévue a un résultat explicite ; aucune omission silencieuse ; 7 cycles consécutifs examinés avant élargissement |
| Fraîcheur | P95 de dernière vérification < 30 h sur le périmètre à cadence quotidienne ; toute source au-delà de 48 h expliquée et signalée |
| Fusion | Objectif de faux regroupements < 0,1 % parmi les fusions ; mesure sur corpus pertinent avec incertitude publiée |
| Liens canoniques | 100 % justifiés par une source active, hors exceptions tracées ; objectif de destinations de candidature correctes ≥ 99 % sur échantillon |
| Données publiées | Zéro devise/date/localisation inventée ; contradictions visibles dans le contrôle qualité |
| Réconciliation | 100 % des offres actives avec au moins une source active ; totaux des facettes exacts avec inconnus explicités |
| Recherche | Cibles de p95 : < 500 ms avec cache et < 1 s sans cache pour les requêtes usuelles, à éprouver sous charge représentative |
| Interface | Parcours recherche → offre → candidature fonctionnel sur mobile et au clavier ; aucun mélange de résultats lors d'un changement de filtre |
| Reprise | Objectifs initiaux RPO ≤ 15 min et RTO ≤ 60 min, uniquement si la solution de sauvegarde et la restauration testée les permettent |
| Coût | Budget mensuel et coût par 1 000 offres valides définis ; alerte sur dérive avant saturation |

Pour la précision de fusion, 100 exemples réussis ne permettent pas de revendiquer 99,9 %. À titre indicatif, environ 3 000 fusions examinées sans erreur donnent une borne supérieure proche de 0,1 % au niveau de confiance 95 % sous hypothèses d'échantillonnage appropriées ; la diversité des sources et les dépendances entre exemples doivent aussi être prises en compte. Démarrer avec un corpus plus petit sert à trouver les défauts, pas à certifier ce niveau.

### Tableau de bord à construire

| Famille | Mesures utiles |
|---|---|
| Couverture | Employeurs suivis / référentiel, offres retrouvées / offres source contrôlées, contribution unique de chaque source |
| Collecte | Dernier parcours complet, âge par source, pagination couverte, erreurs, blocages, durée et file de reprise |
| Qualité | Exactitude par champ, contradictions, inconnus, descriptions exploitables, géographie et devises |
| Identité | Faux regroupements, doublons restants, changements d'autorité canonique, séparations et republications |
| Candidat | Zéro résultat, pertinence des premiers résultats, fiche ouverte, clic de candidature, destination incorrecte signalée |
| Exploitation | Latence et erreurs web, connexions DB, durée SQL, stockage, coût navigateur, succès réel des alertes |
| SEO | Offres éligibles, événements en attente, retraits livrés, cohérence sitemap/JSON-LD/canonique, état Search Console |

Segmenter ces mesures par source, ATS, pays, langue, métier et taille d'employeur. Publier le taux d'inconnu ; le masquer améliore artificiellement les pourcentages. Un clic vers l'employeur ne prouve pas une candidature terminée : mesurer cette dernière seulement avec une confirmation ou une intégration appropriée.

### Avantages concurrentiels à construire après la fiabilisation

- **Qualité vérifiable :** dernière vérification, source officielle lorsque disponible, bouton de signalement et correction traçable.
- **Spécialisation métier :** recherche comprenant les métiers, savoir-faire, types de boutiques et contraintes de contrat du luxe, de la mode et de la beauté.
- **Couverture explicable :** distinguer une maison sans poste et une maison non couverte ; ne pas confondre un grand volume retail et l'ensemble du secteur.
- **Distribution fiable :** pages utiles, langues effectivement maintenues, alertes et recherches sauvegardées intégrées au parcours Catwalks existant lorsque ce périmètre est retenu.
- **Intelligence de marché crédible :** tendances à couverture constante et historique corrigible, fondées sur des observations conservées.

## 6. Preuves et limites

| Livrable | Contenu |
|---|---|
| [verification.json](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/2026-09-08/verification.json) | Tests exécutés, versions, observations d'incident/rétablissement et requêtes SQL de mesure |
| [production-metrics.json](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/2026-09-08/production-metrics.json) | Résultats des SELECT de production et inventaire des index Job |
| [reproductions.json](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/2026-09-08/reproductions.json) | Résultats des scénarios synthétiques : fusion, concurrence, provenance, brut, validité, URL, promotion et couverture |
| [dependencies-audit.json](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/2026-09-08/dependencies-audit.json) | Réponse datée de npm audit avec avis et chaînes de dépendances |

Les scripts temporaires de diagnostic ne sont pas ajoutés au code du projet. Le serveur et la base isolée créés pour l'audit sont arrêtés à l'issue des vérifications ; les services et données préexistants de l'utilisateur sont préservés.

**Ce qui reste à établir avant une certification opérationnelle :** trafic attendu et budget ; charge et capacité maximales ; précision réelle sur échantillons annotés ; fonctionnement de toutes les destinations de candidature ; couverture et conditions de chacune des sources ; sécurité réseau effective et permissions DB ; sauvegardes restaurables ; acheminement réel des alertes ; configuration Search Console et quotas ; contrôle complet d'accessibilité. Les constats du code, les résultats locaux et les statistiques ponctuelles ne remplacent pas ces preuves.

L'audit fournit les chemins de correction et leurs critères de validation. Il ne constitue ni une correction exécutée, ni une garantie d'exhaustivité du marché mondial.
