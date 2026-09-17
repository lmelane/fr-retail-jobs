# CATWALKS · Suite de mission pour Claude Code Fable 5.1

**Instruction du propriétaire à transmettre intégralement. Établie après lecture du code au HEAD `2974343`, le 16 septembre 2026.**

Cette instruction actualise la passation précédente. Elle ne demande pas de recommencer les lots validés : elle demande d'achever leurs limites réelles, de constituer un catalogue qualifié, de rendre le produit testable de bout en bout localement et de préparer puis conduire les premières ingestions Railway autorisées dans des conditions sûres.

## 1. Mission et définition du résultat attendu

La phase n'est pas close tant que le produit ne peut pas être testé réellement de bout en bout et que les opérations nécessaires au catalogue restent à réaliser. Un dossier de release qui conclut NO-GO est une photographie utile, pas la fin de la mission.

Tu poursuis en totale autonomie. Prends les décisions techniques qui découlent des exigences établies. Ne transforme pas chaque choix d'implémentation en carte à renvoyer au propriétaire. Pour chaque lot : code, suppression du chemin remplacé, tests, audit défensif, preuves, documentation et commit local cohérent, puis suite sans attendre un nouveau « go ».

En sortie, Loïc doit pouvoir :

1. Démarrer une stack locale reproductible avec les versions exactes de l'agrégateur/API, du backend et du website.
2. Voir de vraies offres externes issues de captures qualifiées, avec leurs données natives fiables.
3. Publier/modifier/retirer une offre Catwalks dans un environnement de test, la voir synchronisée dans le catalogue et tester sa candidature locale.
4. Rechercher par pays, mots-clés/entreprise, lieu et filtres, avec les offres Catwalks prioritaires parmi les résultats éligibles.
5. Vérifier qu'une offre externe ouvre son URL native et qu'une offre Catwalks ouvre la modale et l'inscription/authentification existantes si nécessaire.
6. Tester interruption, reprise, modification, retrait, expiration et absence prouvée sans perte ni fermeture infondée.
7. Consulter un état fiable des sources et de la qualité du catalogue, avec des inconnus honnêtes et des blocages expliqués.
8. Réinitialiser uniquement les fixtures et bases de test prévues, sans toucher à Railway production, au clone de sauvegarde ou aux services locaux étrangers.

Il faut ensuite que les premières collectes de production de l'agrégateur puissent s'exécuter source par source, sur un schéma et un runtime réellement validés. Une campagne de masse et un CRON quotidien ne constituent pas la première étape.

## 2. Décisions de périmètre désormais explicites

### `/offres`, matching et onboarding

**Laisser `/offres` dans son état actuel en développement/local.** Ne pas la refondre, la rediriger globalement, en changer la promesse ou supprimer ses flux et ses parcours pendant cette finalisation.

Le moteur de matching et l'onboarding feront l'objet du prochain chantier profond, découpé en lots. Préserver leurs fonctions actuelles. Les tests de candidature utilisent les parcours existants ; ils n'autorisent pas à redessiner l'onboarding maintenant.

Les corrections nécessaires au moteur `/emplois`, à son contrat de données et à la candidature commune restent dans cette phase. Elles doivent utiliser le skill Catwalks pour toute modification UX/UI.

### Autorisations

- Le push du dépôt agrégateur a déjà été autorisé par Loïc. Ne redemande pas cette autorisation par habitude. Vérifie la branche, les secrets, les tests et les effets CI/CD avant de pousser.
- Le propriétaire souhaite avancer vers des ingestions réelles Railway. Prépare les conditions, qualifie les sources, puis utilise uniquement un lancement borné et observable lorsqu'elles sont satisfaites. Une demande d'ingestion n'est pas une autorisation de court-circuiter les gardes de qualification.
- L'activation du CRON quotidien reste hors de cette phase. Les workers planifiés doivent rester gelés ; un pilote ponctuel ne doit pas les réactiver tous.
- Website, backend, back-office, media et DNS restent protégés en production. Leurs changements sont locaux ; une autorisation spécifique est nécessaire pour lever cette restriction.
- La possibilité évoquée de supprimer des données si elles sont mauvaises doit conduire à une décision étayée et à un plan précis. Ce n'est pas une instruction de `DROP DATABASE`, `TRUNCATE` global ou `prisma migrate reset` sur Railway.
- Ne jamais effacer candidatures, utilisateurs, publications directes, configurations, preuves RAW, décisions, historiques d'identité et redirections par assimilation au « vieux catalogue ».

Si une bascule agrégateur casserait le site public protégé, ne la fais pas. Prépare une cible parallèle ou une séquence compatible ; si le changement du site devient indispensable, présente seulement cette levée de restriction concrète, après préparation et tests. Continue le travail local indépendant.

## 3. État vérifié et rectifications du dernier bilan

### 3.1. Dépôts

| Dépôt | Chemin | État à vérifier avant reprise |
|---|---|---|
| A | `/Users/lmelane/Downloads/catwalks-job-aggregator` | Branche `codex/production-foundations-20260915`, HEAD `2974343` ; code de release annoncé `c9b520b`, 77 migrations présentes |
| W | `/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-website` | HEAD `bbedeee`, modifications des lots suivants encore non commitées |
| B | `/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-backend` | HEAD `63f61fa`, modifications d'outbox/schéma encore non commitées |
| BO | `/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-back-office` | Dernier HEAD connu `75c594b` ; préserver |
| M | `/Users/lmelane/Desktop/catwalksmedia-system/catwalksmedia` | HEAD `a916ac2`, travail résiduel utilisateur à préserver |

Au contrôle de cette instruction : W porte 54 fichiers suivis modifiés et 18 non suivis ; B, 6 et 10 ; M, 1 et 15. Ces comptes peuvent évoluer. Ils ne remplacent pas l'inventaire et les empreintes au démarrage. « Tout est committé » ne décrit donc pas l'ensemble des dépôts.

A conserve les trois fichiers utilisateur modifiés (`package.json` agrégateur, `bashTalents.ts`, son test), les 25 fichiers non suivis historiques et la passation précédente non suivie. Ne pas les absorber avec `git add -A`. La nouvelle instruction est un livrable documentaire supplémentaire.

Références principales dans A :

```text
audits/reprise-2026-09-15/release-2026-09-16.md
audits/reprise-2026-09-15/qualification-sources-2026-09-16.md
audits/reprise-2026-09-15/lot-5g3c.md
audits/reprise-2026-09-15/lot-6.md
audits/reprise-2026-09-15/lot-7.md
audits/reprise-2026-09-15/lot-8.md
audits/reprise-2026-09-15/lot-9.md
audits/reprise-2026-09-15/lot-12.md
docs/architecture/source-ingestion.md
docs/architecture/source-onboarding.md
docs/architecture/recherche-marche.md
```

Vérifier les noms existants avant lecture ; le lot 6 est documenté par ses bilans réels, pas par un fichier `lot-6b.md` supposé.

### 3.2. Acquis à préserver

- `7a33772` : fin d'ingestion immuable, preuve d'absence fondée sur capture admise, manifeste refresh version 4, suppression de la purge de génération. Ne pas recréer `purge.ts` ni refaire le lot 5G3C.
- `3680e5a`, `38a9cf9`, `37ecc7c` : recherche bornée par marché, projection des offres directes et consommation locale par le site.
- `bf2a535` : normalisation/recherche vectorielle, pertinence et curseurs ; charge mesurée sur le clone existant.
- `c0dea1b` : améliorations de langue du moteur ; cela ne constitue pas une internationalisation complète du site.
- `82b7379` : balisage et sitemap du catalogue éligible, indexation maintenue fermée.
- `8d5104b`, `85fb8c8` : retrait de vestiges Mode Careers et de code sans appelant.
- `c9b520b` : garde API fermé en production sans clé et inventaire daté de qualification.
- `a916ac2` dans M : corrections de traduction du Journal, locales.

Les 77 migrations sont présentes dans le dépôt. Le schéma Railway 44, les quatre services `dd3e24d` et les 436 sources ACTIVE non qualifiées sont des constats du rapport de Claude, non relus sur Railway lors de la rédaction de cette instruction. Actualiser ces mesures en lecture seule avant toute action.

### 3.3. Blocage de release confirmé : retour arrière non prouvé

Le rapport affirme que les migrations sont additives et en déduit que `dd3e24d` peut relire la base migrée. **Cette généralisation est réfutée par le code SQL :**

```text
20260916030000_source_execution_controls : DROP TABLE "SourceCursor"
20260916080000_remove_manual_source_volume : DROP COLUMN "verifiedJobCount"
20260916120000_source_access_decisions : DROP COLUMN "robotsVerdict", "robotsCheckedAt"
```

`git grep` sur `dd3e24d` retrouve précisément ces usages dans `connectors/sourceStore.ts`, `pipeline/ingest.ts` et l'ancien mécanisme de curseur. Le retour d'une ancienne image sur la nouvelle base ne peut donc pas être déclaré compatible pour l'ensemble des services.

Corriger le dossier de release et démontrer une stratégie de retour arrière avec image **et état de base compatibles**. Ne supprime pas les nouvelles migrations pour préserver éternellement le legacy. Ne migre pas la base partagée sous des anciens consommateurs actifs sans avoir testé le résultat.

### 3.4. Qualification : il reste du développement

`connectors/sourcePortal.ts::configuredPortal` prend actuellement en charge Ashby, Recruitee et Workday, puis renvoie `null` pour les autres familles. La qualification de Teamtailor et d'autres ATS ne se réduit donc pas à lancer `source-onboard access`.

Le relevé des 112 revues anciennes `VERIFIED` n'en fait pas des certifications récentes liées à la révision et au lecteur. La campagne doit utiliser le contrat courant complet : identité, rôle, accès, technique, admission, fin d'ingestion et droit d'absence séparés.

### 3.5. Zéro dette : non démontré à ce stade

Le schéma contient encore, entre autres, `Job.isFrance`, `seniority`, `jobFunction`, `isRetail`, `isAiRelated`, `fingerprint`, `Job.raw`, des pointeurs `canonical*` et `SourceRun.canAttestAbsence`. Leur présence ne prouve pas qu'ils sont morts, mais exige une revue de responsabilité et d'usage. Un relevé des exports TypeScript ne certifie pas le schéma, les triggers, SQL dynamiques, index et scripts d'exploitation.

Le bilan 12 conserve explicitement `apps/api/lib/matching/vocabulaire.ts` sans appelant de production. Ne pas déclarer « zéro code mort runtime » tant que cette exception reste dans le code exécuté. Si le contenu est une spécification pour le prochain chantier, déplacer proprement cette spécification hors runtime, conserver son historique, sans modifier le matching actuel.

## 4. Décisions fonctionnelles à appliquer sans nouvel arbitrage routinier

1. **RAW natif et provenance restent la vérité.** Aucune valeur absente fabriquée ; enrichissements séparés et révocables ; aucune taxonomie universelle obligatoire.
2. **Pause de collecte ≠ fermeture employeur.** La pause empêche la collecte et l'attestation d'absence. Les publications suivent leur propre disponibilité et leur fraîcheur. Si leur preuve devient insuffisante, elles quittent le catalogue servi par retrait explicite de vérification, sans `closedAt` inventé. Définir une politique de fraîcheur justifiée et mesurée par source, pas un TTL universel arbitraire.
3. **Sources historiques non certifiées ≠ catalogue neuf qualifié.** Ne pas mélanger les populations dans les compteurs ni servir l'ancien stock comme preuve de la nouvelle chaîne.
4. **Pays actif strict.** Aucune recherche mondiale silencieuse ; lieux et suggestions contextuels ; « remote » seul ne signifie pas worldwide.
5. **Deux origines et deux candidatures.** Union/éligibilité/tri avant pagination, priorité Catwalks dans le résultat pertinent, aucune fuite de données privées du backend.
6. **`/offres`, matching et onboarding restent inchangés fonctionnellement.** Ils ne bloquent pas l'achèvement du catalogue et de `/emplois` local.
7. **Indexation publique maintenue fermée jusqu'à bascule autorisée.** Le SEO peut être testé entièrement localement. Pas de conversion systématique en HTTP 410 d'une offre simplement retirée faute de preuve ; préserver URLs et distinguer les causes.
8. **Internationalisation à terminer localement.** Les exigences de langue du pays existent déjà. Ne pas laisser les marchés DE/IT/ES/NL/CN en français en considérant le chantier terminé. Une difficulté à lire Indeed n'empêche pas de travailler avec les déclarations natives des sources et des références officielles locales. Ne pas contourner un 403.
9. **I18n et traduction d'annonces distincts.** Reprendre la cible de catalogues versionnés/ICU et la migration propre vers `next-intl`, ou démontrer et documenter une alternative répondant intégralement aux mêmes besoins. La coexistence permanente de deux moteurs est exclue. Le fournisseur d'Indeed n'est pas établi ; ne pas inventer son identité. Les annonces restent dans leur langue native par défaut.
10. **Domaine existant conservé en production.** Préparer/tester les contextes pays et langues sur hôtes locaux de test. Ne pas imposer un changement DNS public pour pouvoir valider le moteur en local.

## 5. Ordre des lots de finalisation

Les identifiants F0 à F8 servent à la suite ; ils ne renumérotent pas les lots déjà livrés. Tu peux ajuster le découpage si le code le justifie, en conservant les critères et sans créer un sous-lot pour chaque fichier.

### F0 · Réconcilier les preuves, la release et le travail local

- Inventorier les cinq dépôts, processus, ports, bases et travaux utilisateur. Actualiser les sauvegardes sans écraser celles des lots précédents.
- Distinguer code commité, code local, code installé dans le checkout de tests et code déployé. Identifier les écarts entre le runtime testé avec Ba&sh utilisateur et l'archive exacte `c9b520b`.
- Corriger le statut de fin de phase et les affirmations de migration/rollback inexactes. La lecture seule d'une source ne la qualifie pas.
- Remplacer les cartes déjà résolues par les décisions de la section 4. Garder seulement les questions véritablement externes.
- Isoler puis committer localement les travaux de W et B du chantier lorsqu'ils sont validés, sans absorber les changements légaux/slugs/autres travaux du propriétaire. L'interdiction de push ne signifie pas interdiction de commit local.
- Reprendre les tests utiles absents des PR #160/#168, vérifier leur pertinence actuelle et éviter tout merge aveugle. Ne pas confondre clôture administrative d'une PR et intégration effective de ses invariants.

**Sortie :** matrice unique des écarts, versions reproductibles par dépôt, sécurité de release corrigée, aucun travail perdu.

### F1 · Audit du schéma et suppression du legacy effectif

Produire un inventaire de chaque table, champ, index, contrainte, fonction et trigger :

```text
Objet → responsabilité → écrivains → lecteurs → SQL/scripts/usage dynamique
→ données présentes → preuve ou cache → coût → décision → migration → test
```

Classer en : preuve immuable, identité/liaison, projection reconstruisible, exploitation utile, compatibilité temporaire indispensable, sans usage. Les commentaires du schéma ne sont pas une preuve ; certains décrivent encore d'anciennes cartes ou de l'Intelligence supprimée.

Revoir notamment les champs nommés en §3.5, les doublons `Job`/`JobSource`/`DirectOffer`, l'ancienne santé `SourceRun`, la taxonomie et ses enrichissements, les dimensions géographiques et les index français. Supprimer les champs réellement sans rôle avec leurs lecteurs/écrivains/imports/index/commandes/docs. Conserver les pointeurs d'identité/publication et preuves qui ont une fonction : « canonical » ne signifie pas toujours taxonomie imposée.

Vérifier absence de double source d'autorité : disponibilité et expiration, employeur, lieux multiples, candidature, titre/description, salaire, langue, preuves de retrait. Toute donnée dérivée doit avoir son propriétaire et sa reconstruction.

Migrations nouvelles, pas de réécriture opportuniste de migrations déjà appliquées. Tester depuis zéro et depuis le schéma réel de production sauvegardé. Qualifier verrous, transactions longues, index, espace disque et `ALTER ROLE ... plan_cache_mode`, dont l'effet dépasse une seule requête.

**Sortie :** schéma justifié objet par objet ; aucun champ mort laissé par habitude ; aucune preuve supprimée sous prétexte de nettoyage ; compatibilité/retour arrière réellement testés.

### F2 · Stack locale complète et reproductible

Créer un seul parcours maintenu de démarrage local, avec des commandes réellement livrées pour préparer, démarrer, vérifier, arrêter et réinitialiser les seules données de test. Choisis les noms selon le dépôt existant ; ne documente pas des commandes non implémentées.

Composants : base catalogue, archive RAW locale ou bucket isolé existant, API catalogue, base/backend Catwalks de test, synchronisation/outbox des offres directes, website local, boîtes de réception/authentification de test si nécessaires. Le back-office existant peut servir à publier une offre locale s'il est indispensable au scénario, sans refonte.

Exigences :

- Installation depuis locks et versions Node vérifiées ; ne pas laisser l'utilisateur avec un `node_modules` incapable de démarrer faute de S3 SDK.
- Secrets locaux dédiés et fichiers privés ignorés. Une clé catalogue de test des deux côtés, y compris en mode build/start de production local ; aucune dépendance accidentelle à la tolérance de `next dev` sans clé.
- Ports documentés, détection de conflit, aucun arrêt de Supabase `*_dix` ou d'un serveur utilisateur.
- Aucune écriture vers Vercel/Railway/media production, aucun vrai email candidat, aucune vraie candidature externe envoyée pendant le test.
- Comptes synthétiques clairement identifiés et données directes de test isolées. Les offres externes présentées comme réelles proviennent de captures réellement qualifiées ; un scénario synthétique doit être marqué comme tel.
- Reprise de la synchronisation au-delà de 500 offres ; doublons, désordre, crash et retraits testés.
- Tests d'hôtes pays en local, cookies, langue, URL et cache cohérents, sans modifier le DNS public.
- Démarrage possible après reboot sans dépendre de scripts oubliés dans `/tmp` ou d'une base jetable dont les fixtures ont été effacées.

**Sortie :** un guide bref avec URLs, identifiants de test privés, commandes, scénario manuel et preuve navigateur. « Build vert » n'est pas ce livrable.

### F3 · Oh My Cream, premier dossier prioritaire, puis qualification par vagues

#### Oh My Cream existe déjà

Ne crée pas de doublon. La source figure dans les seeds et le registre audité :

```text
key : oh-my-cream
maison : Oh My Cream
kind : teamtailor
tenant : teamtailor:careers.ohmycream.com
careersDomain : careers.ohmycream.com
config existante : {"origin":"https://careers.ohmycream.com"}
```

Le registre du 16 septembre lui donne `statutCatalogue=ACTIVE`, mais `modeOperationnel=PAUSED_BLOCKED`, `ACCESS_MISSING`, sans identité courante qualifiée. Il recense 22 offres historiques et un dernier run DEGRADED du 8 septembre ; ce ne sont pas les offres fraîches prouvées du jour.

Le [site officiel Oh My Cream](https://www.ohmycream.com/) porte un lien « Recrutement » vers le portail. Le [portail carrière](https://careers.ohmycream.com/) se présente comme un site Teamtailor. La [liste sans filtre](https://careers.ohmycream.com/jobs) annonçait 25 offres lors de la consultation web utilisée pour cette instruction. Ce relevé web est une piste vérifiée, **pas une capture admise du pipeline**, ni une certification d'exhaustivité. Refaire les captures nécessaires dans le système.

L'URL fournie par Loïc contient `split_view`, une boîte géographique `geobound_coordinates[...]` et `query`. Ce sont des paramètres d'affichage/filtrage. Ne pas limiter l'identité de la source ni la collecte mondiale à cette vue cartographique. Partir de la configuration existante et qualifier le portail entier sans perdre d'éventuelles offres hors de cette boîte.

#### Travail de qualification

1. Relire la source exacte dans la base cible et vérifier key/tenant/configuration/révision. Une répétition d'enregistrement doit être idempotente, sans mutation de statut implicite.
2. Étendre le contrat de relation officielle à Teamtailor avec preuve du domaine personnalisé/tenant exact. Tests positifs et négatifs : autre tenant, autre hôte, redirection, filtre géographique, URL de détail ressemblante et page non officielle.
3. Capturer la page officielle et le portail avec le lecteur courant. Documenter le rôle employeur/éditeur ; ne pas inventer SINGLE_BRAND d'après le seul texte « Oh My Cream ».
4. Établir l'accès avec les preuves requises et l'identité effective du collecteur. L'accès robots n'a pas été certifié lors de cette rédaction ; ne pas déduire ALLOWED du fait que la page s'ouvre dans un navigateur.
5. Collecter les listes et détails dans l'environnement isolé, conserver les réponses, contrôler pagination, identifiants natifs, lieux, dates, employeur, texte, candidature, doublons et rejets.
6. Rejouer hors réseau et à froid, qualifier le résultat complet et ses limites. Un compteur « 25 » n'est pas une preuve à lui seul.
7. Publier dans le catalogue local sous admission réelle, vérifier l'offre à l'écran et sa redirection, puis refaire une collecte pour vérifier les mises à jour/idempotence.
8. Si l'énumération Teamtailor n'est pas encore certifiante pour l'absence, le dire et empêcher les fermetures. Achever le contrat natif avant de promettre le cycle complet.

**Sortie Oh My Cream :** source existante qualifiée pour des capacités explicites, offres locales fraîches prouvées, zéro doublon de source, dossier de preuves et statut opérable. Si un vrai obstacle externe bloque, le documenter et poursuivre les autres sources ; une lacune de notre contrat est à développer, pas à renvoyer au propriétaire.

#### Campagne globale

Traiter ensuite le catalogue par vagues en couvrant familles ATS, employeurs/groupes/éditeurs, pays et formats. Prioriser les sources officielles prouvables, la couverture produit et les gros volumes fiables ; ne pas contourner une source bloquée pour gonfler un compteur.

Chaque source doit avoir des capacités distinctes : collecte, publication, mise à jour et fermeture par absence. Aucun verdict global de famille ne remplace l'examen du tenant. Les statuts du registre doivent réellement contrôler les écrivains et être compréhensibles dans les rapports.

Étendre les contrats encore manquants, traiter domaines personnalisés, limites navigateur, secrets/références privées, contenu complet Eightfold/WTTJ, Ba&sh utilisateur, nombres JSON et requalifications. La capture des réponses de détail est nécessaire ; vérifier aussi que les lecteurs reconstruisent et servent effectivement ces détails. « Capturé quelque part » ne suffit pas à qualifier la fiche publique.

Figer le runtime de chaque campagne : les preuves sont liées au lecteur. Une modification du lecteur pendant la vague impose de requalifier ce que le contrat invalide, pas de désactiver le contrôle d'empreinte. Réutiliser les preuves encore valides selon leur contrat et produire les nouvelles captures nécessaires.

Ne pas arrêter après un seul pilote. Achever le traitement des sources du périmètre avec des verdicts prouvés : qualifiée, refusée, inaccessible, retirée ou en blocage externe. Une simple liste de 444 `PAUSED_BLOCKED` n'est pas une campagne terminée.

### F4 · Catalogue propre et stratégie de reconstruction

#### Décision de départ

**Ne pas vider la base de production maintenant.** Une purge effacerait le matériau permettant de réparer les erreurs et ne résoudrait pas le défaut de qualification. Construire d'abord le nouveau catalogue vérifié, avec une séparation explicite de l'ancien stock non certifié.

Comparer deux options concrètes :

- Base/cible parallèle de reconstruction, puis bascule contrôlée des lecteurs autorisés : préférable si cela évite de casser l'ancien site et rend le retour arrière simple.
- Réparation et remplacement bornés des projections dans la base actuelle : possible si l'identité, les dépendances, les gardes et le rollback sont prouvés.

Choisir selon mesures et dépendances réelles. Ne pas maintenir deux pipelines permanents : un ancien environnement conservé temporairement pour rollback est une étape de migration, avec critère de retrait documenté.

#### Avant toute suppression éventuelle

- Inventaire des tables et consommateurs, clés étrangères, triggers, volumes et données non reconstructibles.
- Sauvegarde indépendante, chiffrée/protégée selon l'environnement, empreinte et restauration réellement démontrée.
- Conservation du registre, décisions, configurations, captures, admissions/fins d'ingestion, audit, identités, redirections et offsets utiles.
- Plan explicite des seules projections jetables ; même une projection peut porter des IDs d'URLs partagées à préserver.
- Reconstitution depuis captures/recollectes, vérification de couverture, diff et durée, puis validation de la nouvelle lecture.
- Plan concret de retour arrière sans effacer les nouvelles preuves acquises entre-temps.

Une suppression irréversible hors du périmètre précisément démontré exige une décision explicite sur le plan final. Ne pas interpréter « si les DATA ne sont pas bonnes » comme une autorisation de détruire toutes les données d'un service.

#### Qualité de chaque offre servie

Identité stable, source/capture/version, employeur prouvé, texte natif complet ou statut partiel explicite selon contrat, lien de candidature correct, pays et lieux démontrés, date native distincte de la collecte, échéance qualifiée, salaire/contrat/temps/expérience/formation sans invention, statut courant cohérent.

Ne pas transformer une valeur inconnue en refus global systématique si elle n'est pas nécessaire à l'éligibilité ; ne pas laisser passer une absence critique d'identité, de contenu utile, de candidature ou de pays requis par la recherche. Formaliser ces règles et rendre les rejets inspectables.

Préparer des métriques avec dénominateurs : offres observées/publiées/retenues/rejetées, motifs, descriptions, pays, localisations, dates, salaire déclaré, doublons prouvés et cas en revue. Une couverture mondiale annoncée doit correspondre au stock qualifié, pas à une liste de codes pays.

**Sortie :** catalogue local qualifié, stratégie de reprise testée, identités et preuves conservées, aucune suppression de production non maîtrisée.

### F5 · Finir le produit local et son audit de bout en bout

Terminer les limites des lots 6 à 9, sans toucher au chantier futur `/offres` :

- Les deux inputs doivent réellement proposer titres/entreprises du pays actif et lieux administratifs/postaux du pays. Vérifier le code, pas seulement la présence des inputs dans l'UI.
- Contrat unique des facettes, données inconnues explicites, valeurs locales et absence de repli mondial.
- Recherche et tri des deux origines ; stabilité des pages lors de mises à jour ; totals/facettes cohérents.
- Langue au rendu serveur, hydratation, cookie, URL, hôte et cache. Corriger le reste de `lang="fr"` statique lorsque le contexte servi est anglais ou autre ; éviter l'affichage mélangé français/anglais par défaut silencieux.
- Variantes régionales utiles, catalogues DE/IT/ES/NL/zh-CN pour les marchés effectivement ouverts et tests de textes longs/écritures sans espaces. Ne pas annoncer une langue non traduite.
- Géographie multi-lieux, remote/hybride et frontières explicites. Les titres/lieux natifs ne sont pas des faux labels à traduire arbitrairement.
- JSON-LD, canonical, sitemap et disponibilité concordent avec la fiche. Indexation publique désactivée jusqu'à décision de bascule.
- `/offres`, onboarding, auth, `/reset-password`, `/mes-jobs`, `/maisons/[slug]` et pages légales ne régressent pas.

Skill obligatoire :

`/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-backend/docs/dev-skill/SKILL.md`

Lire les références design et produit, appliquer la DA Catwalks aux besoins du moteur, ne pas forcer un lookbook 100vh. Documenter l'utilisation du skill et vérifier dans le navigateur réel desktop/mobile/clavier. La mention précédente « pas de revue skill formelle » doit être résolue par ce travail.

Scénario de réception locale, avec preuves enregistrées :

1. Capturer, qualifier et ingérer une vraie source ; retrouver une offre et ouvrir son lien externe sans envoyer de candidature.
2. Créer une offre Catwalks locale, la synchroniser, vérifier qu'elle apparaît sous les bons filtres et priorités.
3. Candidater connecté puis non connecté, inscription/authentification de test, retour et confirmation locale, aucune communication réelle à un tiers.
4. Modifier et retirer l'offre directe ; vérifier propagation sans résurrection par événement ancien.
5. Rejouer les événements en double/désordre ; tester plus de 500 offres synthétiques directes clairement isolées.
6. FR → US → autre marché → retour navigateur ; villes homonymes, code postal et télétravail ; URL partagée conservant le contexte.
7. Expiration déclarée et absence prouvée dans une fixture isolée, interruption et source en pause ; aucune fermeture hors périmètre.
8. Arrêter/reprendre un composant, reprendre la synchronisation, vérifier audits et compteurs.
9. Redémarrer depuis un environnement propre en suivant uniquement le guide livré.

Ne pas prétendre avoir observé une disparition réelle chez un employeur pour satisfaire un test. Les changements lifecycle difficiles à provoquer naturellement se démontrent avec un flux natif synthétique explicitement identifié et les véritables écrivains/DB.

### F6 · Exploitation minimale et premiers pilotes Railway

Le CRON reste ultérieur, mais les défauts nécessaires à la sûreté d'une ingestion manuelle ne sont pas « hors release ».

Avant pilote :

- Séquence image/schéma/base compatible et rollback effectivement répété ; vérifier extensions, version PG, contraintes différées et temps de migration.
- Authentification API testée, clé servie uniquement côté serveur. La poser sur Railway sans capacité à mettre à jour le consommateur protégé peut casser le site ; résoudre l'ordre de bascule, éventuellement avec une nouvelle cible API/base utilisée d'abord par le local.
- Nouvelle image exacte construite et testée depuis des commits/locks complets. Distinguer environnement de qualification, archive et cible de production.
- Source(s) précisément nommée(s), qualifiée(s) sous cette révision et ces accès ; aucune reprise automatique de tous les anciens ACTIVE.
- Lancement ponctuel à allowlist fermée et bornes de temps/HTTP/écritures, sans modifier le gel des autres workers ni le CRON global.
- Un seul propriétaire effectif du travail, interruption/reprise idempotentes, limite hôte/tenant garantissant que les processus ne doublent pas la charge.
- Mettre en place et tester le contrôle partagé entre processus si plusieurs workers peuvent coexister. Une simple promesse « on n'en lancera qu'un » n'est pas un verrou.
- Tester heartbeat et dead man's switch avec panne réelle simulée, rétablissement, absence de faux positifs et sortie inspectable.
- Choisir et démontrer le contrat de reprise : checkpoints sûrs ou recommencement borné/idempotent. Le manque du mot `checkpoint` n'est pas à lui seul un bug ; une reprise qui perd, duplique ou épuise les budgets en est un.

Déroulé du premier pilote :

1. Photographier schéma, image, sources, volume, état public et gel des tâches ; sauvegarde/restauration disponibles.
2. Répéter exactement sur une copie et vérifier les bornes.
3. Exécuter une source qualifiée dans le périmètre production autorisé. Oh My Cream peut être le pilote après qualification ; ne pas inventer sa qualification pour respecter cet ordre.
4. Vérifier réponse brute → sortie → admission → publication → fin d'ingestion → API → lecture locale, hashes et compteurs.
5. Exécuter une deuxième collecte bornée et vérifier idempotence/mises à jour. L'absence ne s'applique que si les capacités de cette source et sa preuve l'autorisent.
6. Relire état réel, audits, erreurs, coûts/latences, effets sur les consommateurs. Stopper le pilote en cas de garde violée ; aucune continuation de masse.
7. Étendre par vagues lorsque les portes restent vertes, en conservant l'allowlist et les limites par source.

Ne pas démarrer une ingestion réelle pendant que le code de qualification ou le runtime est encore modifié. Ne pas mélanger purge historique et collecte du jour dans une seule commande opaque.

**Sortie :** une ou plusieurs ingestions réelles prouvées de bout en bout, sans CRON activé, sans casser les autres productions et avec un catalogue qualifié distinct du passé non vérifié.

### F7 · Charge, restauration, nettoyage et contrôle final

- Tests sur 100 000 puis 1 million de documents réalistes dans un environnement isolé : requêtes, facettes, suggestions, pagination, indexation et concurrence d'ingestion.
- Mesurer latence et erreurs avec méthode, séries, SLO et ressources explicites. Le relevé existant sur 87 607 offres n'est pas une preuve à 1 million. Conserver tous les logs de comparaison, ne pas les écraser entre campagnes.
- Test de reprise après arrêt du worker, panne DB, 429, indisponibilité S3 et archive corrompue. Les sources indépendantes doivent pouvoir progresser sans vague de fermetures infondées.
- Répéter restauration d'une sauvegarde au schéma actuel ou d'une sauvegarde connue suivie de toutes les migrations. Vérifier les données, pas seulement le démarrage PostgreSQL.
- Rejouer l'inventaire de code mort ET l'audit de schéma ; vérifier SQL/chargements dynamiques/CLI ; sortir les spécifications futures du runtime lorsqu'elles n'ont pas de consommateur.
- Supprimer vieux chemins, scripts doublons, flags de bypass, docs obsolètes et imports/deps inutiles. Garder les preuves et migrations nécessaires.
- Toutes les commandes locales/exploitation maintenues fonctionnent depuis le dépôt ; pas de dépendance à un script personnel non versionné dans `/tmp`.
- Les tests pertinents doivent être verts. Un rouge préexistant n'est pas automatiquement acceptable pour le périmètre livré. Distinguer environnement absent et bug, réparer l'environnement local ou le défaut plutôt que le laisser dans le bilan.

Le Journal possède son lot séparé : ses 53 rouges mentionnés et le test de site rouge doivent être qualifiés/résolus pour déclarer cette brique validée. Le rattrapage réel et son coût sont remesurés juste avant exécution ; pas de mutation media pendant l'interdiction. Ce chantier indépendant ne doit pas empêcher la réception locale du catalogue emploi.

### F8 · Livraison à Loïc et clôture réelle

Fournir :

1. **Guide de test local** court : commandes réelles, URLs, versions, accès de test privés, ordre et arrêt/nettoyage.
2. **Scénario de réception de bout en bout** avec traces/captures et résultat de chaque étape, réalisable par Loïc.
3. **Registre de qualification** source par source, capacités, preuves et exceptions, dont Oh My Cream.
4. **Rapport qualité du catalogue** : dénominateurs, inconnus, couverture par pays, fraîcheur, causes de rejet/retrait, pas de chiffres trompeurs.
5. **Audit de schéma** et suppression du legacy effectif, migrations testées et objets conservés justifiés.
6. **Release exacte** par dépôt : commit, lock, image, schéma, empreinte/runtime et état local/distant clairement séparés.
7. **Dossier Railway** : pilote(s) réellement exécuté(s) ou obstacle précis restant, sauvegarde/restauration, migration, rollback, coûts et gel des CRON.
8. **Liste résiduelle courte** limitée aux vraies dépendances externes ou aux chantiers explicitement suivants : `/offres`, matching, onboarding, activation CRON, bascules publiques encore protégées.

Ne pas clore avec « il vous reste à qualifier les sources » si le propriétaire vient précisément de te confier cette campagne. Ne pas lui rendre une liste d'opérations techniques autorisées que tu pouvais effectuer.

## 6. Méthode de test et conservation du travail

Les règles de la première passation demeurent : RAW source de vérité, travail par lots, preuves natives et replay, décisions traçables, tests utiles et audit défensif, zéro bypass, aucune perte de travaux utilisateur.

Environnements connus à relire :

```text
Checkout isolé : /tmp/catwalks-lot0-verification-20260915
État test privé : /tmp/catwalks-audit-20260915/lot1-test-state.json
Base de tests : catwalks_lifecycle_test
État clone privé : /tmp/catwalks-audit-20260915/lot4e3-state.private.json
Base de répétition : catwalks_rehearsal_20260915
Secrets S3 test : /tmp/catwalks-audit-20260915/lot2-s3.private.json
Sauvegardes : A/backups/reprise-20260915-lot0/ et A/backups/reprise-20260916-*/
```

La preuve du schéma 69 de l'ancienne passation est historique : les derniers lots annoncent 77. Vérifier `_prisma_migrations` et les objets réellement présents avant usage. Ne jamais réinitialiser le clone pour une suite de tests.

Les scripts `lot6-check.py` et `lot6-full.py` sont des aides existantes à lire, pas des procédures invulnérables. Vérifier synchronisation, suppression de résidus, cible, logs et suites incluses. `npm run test:local` demeure la campagne isolée sur base neuve ; le build API est séparé. Ne pas oublier les tests Python/SQL en se limitant à un script qui n'en lance qu'une partie.

Ne synchronise jamais le checkout ni ses dépendances pendant un test, une mutation défensive ou une capture. Restaurer exactement les mutations puis revalider. Une admission liée à un ancien hash ne certifie pas le nouveau runtime.

Lecture/audit des bases réelles : transaction READ ONLY, délais bornés, pas d'URL ou secret dans les logs. Les captures privées restent privées. Utiliser les sauvegardes existantes ; ne pas les écraser pour fabriquer un nouveau point de départ.

Pas de tests en production, de vraie candidature, d'email envoyé, de publication d'article, de notification à un tiers ou de mutation de DNS comme effet secondaire d'un E2E local.

## 7. Départ immédiat

Commence par F0 et le défaut de rollback, puis F1/F2 et Oh My Cream en F3. Avance ensuite jusqu'à la réception locale et aux pilotes Railway selon les portes décrites.

Ta première réponse doit indiquer l'état réel retrouvé et la première action exécutée, pas demander une nouvelle liste d'arbitrages. Si une opération exige réellement une levée de restriction externe, prépare son résultat concret, explique précisément le blocage et continue tout le reste.

**Critère final : un catalogue fiable et traçable, un produit réellement testable en local par Loïc, des ingestions Railway qualifiées et maîtrisées, et aucun travail technique autorisé laissé en suspens sous l'étiquette « phase close ».**
