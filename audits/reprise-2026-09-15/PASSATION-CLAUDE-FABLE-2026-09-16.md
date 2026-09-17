# CATWALKS · Instruction complète de reprise pour Claude Fable

> **Archive de passation avant les lots 5G3C à 12.** Pour poursuivre après le travail de Claude au HEAD `2974343`, utiliser [l'instruction de finalisation actualisée](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/INSTRUCTION-FINALISATION-LOCAL-CATALOGUE-2026-09-16.md). Les versions de code, comptes de migrations et travaux restants décrits ci-dessous sont historiques ; ils ne remplacent pas cet état plus récent.

**Photographie vérifiée le 16 septembre 2026. Dernier lot de code terminé : 5G3B3B.**

Ce document est le prompt de mission à transmettre intégralement à Claude Fable. Les instructions ci-dessous s'adressent directement à lui. Il contient les décisions du propriétaire, l'état de reprise, les références vérifiables et les critères de sortie. Il ne contient aucun secret.

## Sommaire

1. Mission, autonomie et périmètre
2. Règles produit et données
3. Autorisations et productions protégées
4. État exact des cinq dépôts
5. Travaux utilisateur à préserver
6. Lecture initiale et autorité des preuves
7. Historique des lots réalisés
8. Architecture implémentée à préserver
9. Dernier lot : changements, validation et limites
10. Prochain lot : absence et fermetures liées aux captures
11. Qualification restante des sources et du stock
12. Lot 6 : recherche par pays et deux origines
13. Lot 7 : pertinence et performance
14. Lot 8 : pays, langue, domaines et traduction
15. Skill Catwalks et validation UX/UI
16. Lot 9 : SEO du catalogue
17. Journal, CRON, matching et `/offres`
18. Lot 12 : suppression du legacy et documentation
19. Environnements, sauvegardes et preuves
20. Commandes et discipline de validation
21. Méthodologie de chaque lot
22. Release et définition de fin
23. Traitement des blocages et compte rendu
24. Tes premières actions

## 1. Mission, autonomie et périmètre

Tu reprends Catwalks comme responsable de la réalisation technique et de la cohérence produit. Le propriétaire est Loïc. Sa vision est de faire de Catwalks le moteur mondial de recherche d'emploi spécialisé dans le luxe, la mode, la beauté et le retail, avec un niveau d'exigence comparable à Indeed.

**Ta mission est d'exécuter toute la suite jusqu'à sa finalisation dans le périmètre autorisé.** Ne te limite ni à un audit, ni à un plan, ni au prochain petit correctif. Implémente, vérifie, corrige, documente, prépare et effectue les livraisons autorisées. Continue d'un lot au suivant lorsque ses conditions de sortie sont satisfaites. N'attends pas un nouveau « go » à chaque étape.

Prends les décisions techniques qui découlent des règles établies. Tu peux remettre en question une ancienne décision si le code, les captures ou les mesures la réfutent. Conserve ce qui est validé tant qu'aucune preuve ne justifie son remplacement. Ne recommence pas l'ensemble de l'audit depuis zéro et ne détricote pas les garde-fous pour accélérer la suite.

Les validations de lot sont des validations techniques dont tu as la charge, pas des demandes répétées d'approbation humaine. Signale les blocages réellement externes : droit d'accès manquant, preuve indisponible, autorisation de production explicitement exclue, validation juridique impossible à fournir techniquement. Termine tout ce qui reste indépendant de ces blocages.

**Ordre actuel :** terminer la liaison des preuves d'absence et des fermetures aux captures, puis lot 6, lot 7, lot 8, lot 9, nettoyage/release du lot 12. Achever aussi les qualifications de sources et reprises de données encore ouvertes, en les rattachant à des lots explicites. Le lot Journal 11 appartient à la feuille de route, avec ses propres limites d'autorisation. L'activation CRON, le matching et la nouvelle promesse de `/offres` sont la phase suivante : ne les activer ni les redéfinir implicitement pendant cette phase.

Le propriétaire a accepté de passer au lot 6 après l'audit du lot absence/fermetures. **Ce passage ne signifie ni clôture universelle du lot sources ni validation globale de production.** Ne transforme pas cette décision d'ordre en abandon du reste.

## 2. Règles produit et données

### 2.1. La vérité commence par la publication brute

- Les réponses natives capturées avant parsing sont la première preuve disponible. Les sorties d'extraction sont conservées séparément, avant les transformations communes.
- L'ancien champ RAW d'un adaptateur reste une preuve historique utile, mais il ne devient pas rétroactivement une réponse HTTP capturée.
- Les projections de `Job`, les faits normalisés et les caches de recherche sont reconstructibles. Ils ne peuvent pas servir à fabriquer une donnée native qui a été perdue.
- Ne jamais inventer un employeur, un diplôme, une expérience, un salaire, une localisation, une date ou une disponibilité.
- Distinguer : déclaré, interprété avec preuve, enrichi/inféré, absent, non collecté, non interprété, invalide et contradictoire.
- Une collecte partielle ne doit pas effacer une preuve fiable antérieure. Une donnée ancienne ne doit pas être présentée comme fraîchement attestée sans nouvelle observation.
- RAW, métadonnées techniques et décisions internes restent séparés. Aucun motif de retrait interne injecté dans le payload source.
- Conserver décimales, devises, périodes et unités. Pas d'annualisation implicite ni de conversion de salaire présentée comme une déclaration employeur.
- Les coordonnées valides contenant zéro ne sont pas automatiquement nulles ; un couple suspect ne devient pas une localisation inventée.
- Un diplôme absent n'est pas « aucun diplôme requis ». Une négation de télétravail ne doit pas être transformée en télétravail positif.

### 2.2. Sortir de la normalisation canonique forcée

Le propriétaire ne veut plus qu'une taxonomie universelle impose la vérité du catalogue. Aucun métier canonique, diplôme canonique ou contrat français ne doit devenir une condition pour publier ou découvrir une offre internationale.

Les titres et concepts locaux restent natifs. Les classifications, synonymes et rapprochements sont des aides séparées, versionnées, traçables et révocables. L'absence de classification ne rend pas une offre invisible à la recherche textuelle.

Ne supprime pas aveuglément tout identifiant comportant le mot `canonical` : les identifiants techniques de publication, ensembles d'IDs d'énumération, rapprochements exacts prouvés et URL canoniques SEO ont une fonction différente. Corriger une ambiguïté de nom ne dispense pas de préserver son contrat et les données historiques.

### 2.3. Deux origines dans le même produit

1. Offre publiée par une Maison sur Catwalks : parcours Catwalks, modale de candidature, inscription/authentification si nécessaire, retour à l'offre.
2. Offre issue de l'agrégateur : redirection vers l'offre externe.

L'origine et l'action de candidature sont explicites dans le contrat de données. Ne les déduis pas d'un domaine ou d'une forme d'identifiant.

Après application des conditions d'éligibilité, des filtres et de la recherche, les offres Catwalks passent devant les offres agrégées. La pertinence et la fraîcheur ordonnent les résultats à l'intérieur de chaque origine. Cette priorité ne permet jamais d'afficher une offre hors pays ou hors filtres.

L'union des deux origines, les filtres et le tri précèdent la pagination. Additionner deux pages déjà paginées dans le navigateur est interdit : totaux, facettes et classement seraient faux.

### 2.4. Deux inputs principaux

- Input 1 : « Intitulé de poste, mots-clés ou entreprise ». Suggestions issues des offres réellement disponibles dans le pays actif, couvrant les deux origines.
- Input 2 : « Ville, département, code postal ou Télétravail », avec les subdivisions adaptées au pays : département, État, province, etc.
- Aucun choix de pays dans l'input 2. Le pays est un contexte distinct choisi automatiquement puis modifiable explicitement.
- Les localisations sont structurées et bornées au pays actif. Paris, Texas et Paris, France sont deux lieux différents. Les codes postaux restent des chaînes de caractères.
- Télétravail est un mode de travail, pas une ville. « Remote » seul ne prouve pas un droit de recrutement mondial. Ne confonds pas hybride et télétravail intégral.
- Les filtres affinent ces deux entrées. Ils ne remplacent pas la découverte principale.

### 2.5. Pays, langue et filtres

Sur une entrée neutre, le pays détecté par une IP de confiance définit le marché initial et sa langue par défaut. Un choix manuel de pays actualise le marché, la langue associée, les offres, les filtres et les suggestions. Il doit afficher uniquement les offres compatibles avec le pays cible.

Pays et langue demeurent deux dimensions techniques distinctes, notamment pour les pays multilingues. Un contexte pays explicite dans l'URL prime sur l'IP ; le choix mémorisé s'applique à l'entrée neutre. Un VPN, un code inconnu ou une IP absente n'autorise aucun repli mondial silencieux.

Les filtres doivent représenter la réalité du marché : contrats locaux, job types, temps de travail, programmes, expériences et diplômes déclarés. Ne traduis pas simplement une grille française pour tous les pays.

Le seuil historique de couverture des facettes est `0.2`. Des tests protègent les corrections DE/IT/ES/CH. La cible validée est un contrat de disponibilité par marché tenant compte de l'utilité locale, de la qualité et de la couverture. Ne retire pas le seuil seul pour obtenir artificiellement « plus de filtres ». Si tu le remplaces, livre ensemble la politique mesurée, le contrat API, le consommateur UI et leurs tests. Ne hausse jamais une couverture en inventant des valeurs.

## 3. Autorisations et productions protégées

Les dernières consignes du propriétaire priment sur la passation initiale lorsqu'elles l'ont explicitement modifiée. Le droit de pousser l'agrégateur a été accordé ; l'interdiction spécifique de toucher aux autres productions n'a pas été levée.

| Périmètre | Autorisation et conduite |
|---|---|
| Agrégateur local | Lire, modifier, tester, migrer les bases de test identifiées, faire des commits locaux et préparer la release en autonomie. |
| Dépôt Git agrégateur | Push autorisé par Loïc. Vérifier secrets, contenu, tests, branche cible et déclenchements CI/CD avant push ; aucune raison de redemander ce droit déjà donné. Pas de force push ni d'écrasement de travaux. |
| Railway agrégateur | Tests autorisés, y compris directement via Railway si utile. Utiliser l'environnement isolé décrit plus bas. Les droits de mutation de cette reprise sont bornés à l'agrégateur ; toute livraison réelle doit respecter les garde-fous de release et le gel des collectes. |
| Website, backend, back-office | Changements et validation locaux. Aucun push, merge ou déploiement vers leurs productions dans le périmètre actuellement établi. |
| Website Vercel | Production explicitement protégée. Ne pas changer de branche de production pour tester, ni déclencher un déploiement production. |
| Media/Journal | Lecture et travail local, conservation du travail existant. Pas de mutation de production media sans levée explicite de cette restriction. |
| DNS/domaines publics | Préparer et vérifier le plan local. Ne pas modifier le DNS ou les domaines actifs dans cette phase locale protégée. |
| CRON de production | Activation reportée à la phase suivante, même si tous les tests logiciels passent. |

L'objectif final est un produit livré en production. La consigne générale d'autonomie n'est pas une levée implicite des interdictions spécifiques ci-dessus. Pour un périmètre protégé, termine d'abord toute la release concrète et révisable : image, migrations, reprise du stock, tests, sauvegarde, retour arrière et ordre de bascule. Puis formule une seule demande précise pour l'autorisation encore manquante, en citant la restriction. Continue les autres travaux autorisés.

Un push agrégateur susceptible de déclencher des workers n'est pas un simple rangement de code : inspecte les déclencheurs avant l'action. Garder les workers gelés ne signifie pas que les migrations, l'API ou leurs données peuvent être modifiées sans plan de release.

Ne jamais exécuter de `git reset --hard`, `git clean -fd`, restauration globale de fichiers utilisateur, suppression de worktree ou nettoyage Docker global sans avoir qualifié et préservé exactement le contenu concerné. Aucun test de destruction sur une base réelle. Aucune clé, URL authentifiée ou payload privé dans Git, les logs publics ou les réponses au propriétaire.

## 4. État exact des cinq dépôts

Les chemins ci-dessous sont locaux à la machine de Loïc. Les abréviations sont documentaires, pas des variables déjà définies dans le shell.

| Alias | Chemin absolu | Branche à la passation | HEAD vérifié |
|---|---|---|---|
| A, agrégateur | `/Users/lmelane/Downloads/catwalks-job-aggregator` | `codex/production-foundations-20260915` | `4708f8ab700fa07b1046466d8982adf0d3e87311` |
| W, website | `/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-website` | `front-f1-sauvegarde` | `bbedeeeb405ca790813e7025f1be64a80a64ca42` |
| B, backend | `/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-backend` | `main` | `63f61fa2cdd0598df8a59c2fe49bed73e8b68a5e` |
| BO, back-office | `/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-back-office` | `main` | `75c594bc444c34fdad0c9b1d3312d99f8f23322c` |
| M, media | `/Users/lmelane/Desktop/catwalksmedia-system/catwalksmedia` | `main` | `086f75c154c7eea619abc424e7323a2bec39d738` |

Le dossier parent `catwalks-build` n'est pas un dépôt Git.

Remotes vérifiés :

- A : `https://github.com/lmelane/fr-retail-jobs.git`
- W : `https://github.com/lmelane/catwalks-front-end.git`
- B : `https://github.com/lmelane/catwalks-back-end.git`
- BO : `https://github.com/lmelane/catwalks-backoffice.git`
- M : `https://github.com/lmelane/catwalksmedia.git`

**Pas de push ni de déploiement réalisé par les derniers lots de reprise.** Les références distantes du rapport initial datent du 15 septembre ; elles n'ont pas été actualisées pour écrire ce prompt. Ne les présente pas comme l'état GitHub actuel sans vérification.

L'audit initial avait notamment identifié les PR agrégateur #168 et #160 et des divergences entre code, taxonomie active et déploiements. Ne les merge pas par réflexe. Actualise leur statut et compare les patches utiles, y compris en cas de squash. L'ascendance seule ne démontre pas l'absence d'un correctif.

Les commits historiques demandés par Loïc étaient `959a705` et `9504c9f` dans A, `375ee61`, `c54b937` et `cd25cef` dans W. Ils ont été retrouvés et sauvegardés au lot 0. Ne les réapplique pas aveuglément au-dessus de la reprise actuelle.

Utilise `git status`, `git diff`, `git log`, `git worktree list` et les manifestes avant toute intervention. Préfixe de branche pour de nouvelles branches techniques : `codex/`. Ne change pas inutilement la branche de reprise A.

## 5. Travaux utilisateur à préserver

### 5.1. Agrégateur

Avant la création de ce fichier de passation, A avait exactement trois fichiers suivis modifiés, aucun fichier staged et 25 fichiers non suivis hérités de l'utilisateur.

Fichiers suivis modifiés :

```text
apps/aggregator/package.json
apps/aggregator/src/ats/adapters/bashTalents.ts
apps/aggregator/src/ats/adapters/bashTalents.test.ts
```

Les 25 fichiers non suivis : trois scripts `verif-bash-live.mts`, `verif-ca-californie.mts`, `verif-langues-marches.mts` dans `apps/aggregator/scripts/ops/`, et 22 fichiers dans `audits/mesures-d435-d436/`. Le présent prompt est un nouveau livrable documentaire distinct ; sa présence non suivie ne doit pas être confondue avec cet état antérieur.

Ne fais pas `git add -A`. Stage explicitement le périmètre du lot. Les changements Ba&sh ne sont pas une permission pour les jeter ou les certifier sans examen. Ils ont été préservés ; leur qualification fonctionnelle reste un sujet identifié.

### 5.2. Autres dépôts

- W : changements existants de `next.config.mjs`, pages légales, tests de parité/suggestions, composants et catalogues légaux FR/EN. Le commit local `bbedeee` appartient au lot 4H3 et distingue correctement fermeture et retrait.
- B : `docs/governance/DECISIONS.md`, `prisma/schema.prisma`, migration `20260914135914_anciens_slugs_d425` et `scripts/rattacher-maisons-d424.mjs`.
- BO : propre lors de la vérification du 16 septembre.
- M : travail important non commité sur traduction, migration 025, newsroom, routes EN, articles et assets. Ne pas traiter ces fichiers comme du bruit ni copier le runtime distant par-dessus.

### 5.3. Preuve de conservation

Manifeste initial : `A/backups/reprise-20260915-lot0/manifest.json`.

Sur 86 fichiers initiaux des cinq dépôts, **82 sont encore identiques octet pour octet** au contrôle de passation. Quatre exceptions antérieures sont documentées :

1. `apps/aggregator/package.json` : évolutions de dépendances/outillage des lots antérieurs ; changements utilisateur résiduels conservés.
2. `apps/aggregator/src/pipeline/sourceStore.test.ts` : assertion utilisateur du catalogue préservée ; fixtures et nettoyage de test adaptés.
3. `apps/aggregator/data/seeds/sources.csv` : 83 configurations originales et leurs cinq premières colonnes conservées ; anciens champs `job_count`, `verified`, puis `robots_verdict` retirés dans les lots qui ont remplacé leurs fonctions.
4. `apps/aggregator/scripts/ops/verif-catalogue-coherence.mts` : vérification de collisions conservée ; anciens affichages supprimés avec leurs champs.

Copies originales supplémentaires :

```text
A/backups/reprise-20260916-lot5d/sourceStore.user-original.test.ts
A/backups/reprise-20260916-lot5f/sources.user-original.csv
A/backups/reprise-20260916-lot5f/verif-catalogue-coherence.user-original.mts
```

La preuve versionnée récente est `A/audits/reprise-2026-09-15/preuves/lot-5g3b3b-preservation.json`. Un relevé privé de la passation se trouve dans `/tmp/catwalks-audit-20260915/passation-claude-fable-before.private.json` ; il contient les HEAD, états Git et empreintes courantes, sans identifiants d'accès.

Préserver le travail utilisateur n'impose pas de conserver éternellement un script devenu obsolète. Son remplacement ou sa suppression doit être explicite, justifié par le code, sauvegardé et inclus dans le bon lot, jamais effectué par un nettoyage global.

## 6. Lecture initiale et autorité des preuves

Ordre de lecture recommandé, sans exécuter les commandes des documents à l'aveugle :

1. Ce prompt, puis `A/CLAUDE.md` et les éventuels `AGENTS.md`/instructions applicables réellement présents.
2. `A/audits/reprise-2026-09-15/lot-5g3b3b.md` et ses sept JSON de preuve.
3. `A/docs/architecture/source-ingestion.md`, puis `native-capture.md`, `source-access.md` et `source-onboarding.md`.
4. `A/audits/reprise-2026-09-15/plan.md`, `rapport.md`, `lot-4i.md`, `lot-4h3.md`, `lot-5g3b3a.md`.
5. Les fichiers d'implémentation et tests correspondant au prochain lot, listés en section 10.
6. Les autres bilans de lot à mesure qu'ils deviennent pertinents, plutôt que tous les anciens logs en bloc.

Autres références :

- `A/docs/architecture/production-foundations.md`
- `A/docs/architecture/publication-identity.md`
- `A/docs/architecture/source-facts.md`
- `A/apps/aggregator/README.md`
- `A/apps/aggregator/scripts/ops/README.md`
- `A/audits/reprise-2026-09-15/inventaire-git.md`

Passation historique fournie par l'utilisateur :

`/Users/lmelane/.codex/attachments/102892f3-69c9-4025-a83a-9885edea74fb/pasted-text.txt`

Elle contient des mesures anciennes et des consignes ensuite précisées. **Elle ne remplace ni les instructions les plus récentes ni le code vérifié.** Ne réintroduis pas ses seuils, architectures ou restrictions supersédés sans les réconcilier.

Les audits datés sont des preuves historiques. Un « reste à faire » dans un ancien lot peut avoir été résolu ensuite. En particulier, le manifeste complet et le rejeu strict signalés comme manquants dans 4I ont été traités en 5A.

À l'inverse, certaines documentations de fonctionnement sont en retard : `source-access.md` contient encore une mention d'anciens écrivains non liés au registre, alors que 5G3B3B les a supprimés. `production-foundations.md` et le récapitulatif du plan contiennent aussi des états antérieurs à plusieurs 5G. Mets-les à jour d'après le code ; ne les utilise pas pour réintroduire du legacy ou annoncer qu'une fonction manque alors qu'elle existe.

## 7. Historique des lots réalisés

Tous les états ci-dessous désignent une validation locale ou isolée, pas un déploiement global.

| Lot | Résultat à conserver | Réserve utile |
|---|---|---|
| 0 | Inventaire des cinq dépôts, sauvegardes des 86 fichiers et commits locaux, checkout de validation isolé, tests sur PostgreSQL jetable, architecture cible | Les défauts métier recensés ne sont pas résolus par cet inventaire |
| 1 | Cycle de vie borné, plans/manifestes, revalidation sous verrou, échéances par publication, fermeture distincte du retrait | Les preuves de run/absence restaient à rattacher au système de captures ajouté ensuite |
| 2 | Capture native avant parsing, sorties d'extraction immuables, replay, archive froide et stockage Railway isolé vérifié | Les pertes historiques ne sont pas reconstituées artificiellement |
| 3 | Faits RAW et réattestation corrigés ; décimales et interprétations sourcées | Les lecteurs non qualifiés restent explicitement signalés |
| 4A–4C | Fin des fusions approximatives, identité native immuable, groupes réversibles, présentation par publication, transitions atomiques du propriétaire | Pas de fusion titre/ville/maison sans preuve |
| 4D–4H3 | Relectures de familles, reprise d'échéances et de groupes sur clone, séparation et quarantaine sans perte d'identité ni d'URL | Le stock complet n'est pas intégralement qualifié |
| 4I | Inventaire des contenus/identités restant insuffisants | Ce relevé est une photographie, pas une nouvelle certification |
| 5A | Manifeste intégral du résultat, comparaison stricte du replay, clôture sérialisée | Un manifeste exact ne prouve pas à lui seul l'exhaustivité du portail |
| 5B | Configuration figée, budgets d'exécution séparés, suppression de vieux chemins de curseur | Pas de réglage transitoire intégré à l'identité d'une source |
| 5C | Révisions immuables des configurations, protection des transitions A → B → A | Une configuration revenue à la même valeur n'est pas la même révision |
| 5D | Validation technique issue de capture/replay, qualification de zéro natif, porte de promotion | Aucun compteur saisi manuellement ne certifie une source |
| 5E | Revues d'identité liées à une révision et ordonnées sous verrou | Les 112 revues historiques non liées ne sont pas promues rétroactivement |
| 5F | Parcours unique `source-onboard`, retrait d'une vingtaine d'anciennes orchestrations | Découverte, identité, accès, technique et activation gardent des rôles distincts |
| 5G1 | Captures de pages d'identité/d'accès séparées des offres, contrôle commun des cooldowns | Une page archivée n'est pas une autorisation |
| 5G2A | Relation page officielle → portail exact, premiers contrats Ashby/Recruitee/Workday | Autres familles/domaines personnalisés à qualifier |
| 5G2B | Revue d'identité liée aux captures natives inspectées ; fin du dossier textuel comme autorité | Ne pas inventer le rôle employeur à partir d'un nom |
| 5G3A | Employeur natif prioritaire, inférence depuis portail limitée au champ absent et au périmètre certifié | L'éditeur d'un board n'est pas nécessairement l'employeur |
| 5G3B1 | Robots évalué pour l'identité réelle du collecteur, groupes/chemins/encodages | Robots n'est pas une autorisation juridique générale |
| 5G3B2A | Provenance privée immuable des requêtes envoyées, redirections et identité de transport | Couverture navigateur encore partielle |
| 5G3B2 | Décisions d'accès immuables liées aux preuves natives et à la révision ; anciens champs retirés | Pas de certification universelle des sources |
| 5G3B3A | Admission avant réseau pour chaque ingestion enregistrée ; validation de ses nouveaux octets | Source ACTIVE seule insuffisante |
| 5G3B3B | Publication et retraits liés obligatoirement à une capture admise ; revalidation après attentes ; audit de périmètre immuable | Absence, `SourceRun` et purge de génération restent la prochaine étape |

Repères Git récents à retrouver avec `git show`, sans cherry-pick :

```text
e7bc984  5A
8e3e437  5B
ff023e7  5C
77e18db  5D
bc72a7b  5E
5a55fd7  5F
7dfaf5c  5G1
728832d  5G2A
7b46eef  5G2B
dcc3342  5G3A
bc18e42  5G3B1
13435b8  5G3B2A
a565950  5G3B2
932c5c6  5G3B3A
4708f8a  5G3B3B, HEAD agrégateur
bbedeee  correction website du lot 4H3
```

Le lot 4H3 a porté le clone à **55 125 présentations reconstruites**, avec **294 publications en quarantaine** et aucun membre reconstructible restant prisonnier d'un groupe mixte incomplet. Le relevé 4I comptait **35 639 autres publications non qualifiées**, dont ces quarantaines. Ce sont des populations de publications, pas des recrutements distincts ni des chiffres de production actuelle.

## 8. Architecture implémentée à préserver

### 8.1. Capture et archives

- `CaptureBatch` porte source, révision, but, configuration effective, version de lecteur, ordre de tentative et budget.
- `RawCapture` décrit les reçus et leur provenance ; `RawBlob` identifie les octets par SHA-256 ; `RawBlobBody` conserve leur version chaude compressée.
- `SourceExtraction` conserve les sorties complètes et ordonnées de l'adaptateur.
- `CaptureOutcome` scelle le résultat ou l'échec. Pas d'ajout ultérieur aux reçus/sorties après clôture.
- Les nouvelles offres utilisent le format 2, but `JOBS`. Les pages de preuve utilisent le format 3, `SOURCE_IDENTITY` ou `SOURCE_ACCESS`.
- Le format 1 historique reste lisible selon son contrat ; il n'acquiert pas un manifeste inventé.
- Le replay est hors réseau, consomme tous les reçus et compare offres et métadonnées. Une réponse manquante, incomplète, corrompue ou non consommée est un échec.
- Les octets HTTP sont ceux livrés par `fetch` après décompression éventuelle, pas une capture TLS.
- L'archive distante doit être relue et vérifiée avant purge de la copie chaude. Les hashes des octets et du gzip sont distincts et vérifiés.
- L'identité technique du transport n'est pas un droit d'accès. Cookies, Authorization et secrets ne deviennent jamais de la preuve métier publique.

### 8.2. Registre, qualification et admission

L'entrée maintenue est `A/apps/aggregator/scripts/ops/source-onboard.mts` ; lis aussi `src/onboarding/arguments.ts` avant toute commande. Elle expose notamment `register`, `profile`, `evidence`, `relation`, `identity`, `access`, `collect`, `validate`, `status`, `promote`. Respecte les options `--apply` et les révisions explicites exigées ; ne déduis pas la syntaxe depuis ce résumé.

Parcours cible : candidat DRAFT → captures officielles/portail → relation et rôle d'identité prouvés → accès qualifié sur requêtes observées → capture de qualification → validation technique → promotion explicite → nouvelles ingestions admises → contrôle des nouvelles captures avant écriture.

`collect` est une qualification, pas une ingestion publique. Une sonde DRAFT/PAUSED ou non enregistrée peut être conservée et examinée sans pouvoir publier.

`SourceIngestionAdmission` est immuable. Elle relie la capture aux décisions qui autorisaient son démarrage. La création a lieu dans la transaction qui alloue le batch, avant le transport et avant ses reçus/résultats. Les contraintes SQL empêchent l'ajout rétroactif d'une admission à une ancienne sonde.

Les contrôles portent sur la révision exacte, l'adaptateur/configuration, les politiques courantes, l'identité, l'accès, le lecteur courant, la fraîcheur et les tentatives ultérieures. La qualification technique utilisée pour démarrer doit provenir d'une capture récente, actuellement moins de 24 heures selon le contrat du lot. Vérifie les constantes, ne change pas leur valeur pour faire passer un test devenu périmé.

La collecte en cours est revalidée après capture, y compris quand elle est vide. Un échec ou une tentative plus récente invalide l'usage opportuniste d'une qualification ancienne.

### 8.3. Publication et retraits

Fichiers centraux sous `A/apps/aggregator/src/` :

```text
capture/observations.ts
capture/publicationPolicy.ts
connectors/sourceRevision.ts
connectors/sourceAdmission.ts
connectors/sourceAccess.ts
connectors/sourceIdentity.ts
connectors/sourceValidation.ts
dedup/upsert.ts
pipeline/publicationHold.ts
pipeline/deactivateSources.ts
pipeline/scopeDecisions.ts
lib/writeLocks.ts
```

`archiveAdapterOutput` exige une vraie paire capture/sortie et vérifie identité, RAW, URL et empreinte. Aucun nouveau chemin sans capture pour publier. Les observations anciennes restent lisibles/archivables sans être faussement certifiées.

`requireCurrentCaptureRevision` refuse une capture non liée au registre et vérifie l'admission courante. `upsertDeduplicated` copie l'entrée avant le premier `await`, contrôle avant la résolution d'identité, puis de nouveau après les attentes de verrous, juste avant l'écriture. **Les deux contrôles sont intentionnels.** Le premier évite des effets de bord d'identité avec une admission déjà invalide ; le second couvre expiration/révocation pendant l'attente.

`enforcePublicationPolicy` refuse la publication d'une sortie capturée comme retenue/retirée, les motifs/dates falsifiés et une exclusion courante de périmètre. L'exception Workday d'employeur absent exige toujours un portail SINGLE_BRAND certifié.

`archivePublicationHold` et `deactivateCapturedPublication` revérifient sous verrou. La désactivation dérive identité, disposition et date de l'entrée vérifiée ; les représentations attachées et détachées sont couvertes. Une attestation plus récente prime. Les événements sont idempotents.

`deactivateAdministrativeSources` reste réservé au retrait administratif `SOURCE_RETIRED` et au nettoyage de génération encore à reprendre. Ce n'est pas un passage de repli pour contourner une capture refusée.

Une décision interne `OUT_OF_SCOPE` n'est pas injectée au RAW. Son texte exact appliqué, son hash et la sortie concernée sont enregistrés dans `DataCorrection`, immuable et idempotent. Une décision ultérieure ne réécrit pas l'ancienne preuve.

### 8.4. Verrous et migrations

Le schéma comporte **69 migrations** à la passation. La dernière est :

```text
packages/db/prisma/migrations/20260916140000_posting_scope_write_lock/migration.sql
SHA-256 : 0566ef4a8a71ac4d6d55d9755c557baf5e9c67c606040f8d2b4c47ef6c271dd5
```

Elle sérialise INSERT/UPDATE/DELETE de `PostingScopeDecision` avec le verrou de source, même lorsqu'aucune ligne n'existait. En cas de changement de clé, l'ordre des verrous est déterministe. Le calcul SQL du verrou doit correspondre exactement au contrat JS ; ne le remplace pas par une sérialisation « équivalente » non vérifiée.

Cette migration n'a pas réécrit les lignes historiques. Ne renomme pas une migration déjà stabilisée pour poursuivre le numérotage. Les évolutions suivantes doivent être de nouvelles migrations cohérentes avec les bases visées.

## 9. Dernier lot : changements, validation et limites

### 9.1. Résultat vérifié

Commit `4708f8a`, message `fix: require admitted captures for publication and withdrawals`, 42 fichiers du lot. Le travail applicatif s'est arrêté après sa validation, sa sauvegarde et son commit local. Le lot absence/fermetures n'a pas commencé.

| Contrôle | Résultat du dernier lot |
|---|---:|
| Tests unitaires agrégateur | 2 585 PASS |
| Tests d'intégration agrégateur | 761 PASS |
| Tests API | 259 PASS |
| Tests Python | 11 PASS |
| Total | **3 616 PASS** |
| Tests API optionnels réservés au corpus | 2 non exécutés |
| Typechecks et build API | PASS |
| Migrations sur base neuve | 69 PASS |
| Contre-épreuves applicatives | 18 défauts réintroduits, tous détectés |
| Contre-épreuves SQL | 4 défauts réintroduits, tous détectés |
| Suite après restauration des mutations | 65 tests PASS |

Ces chiffres sont une preuve datée, pas un seuil à atteindre artificiellement. La suite website du lot 4H3 comptait 755 tests réussis ; elle n'a pas été réexécutée à chaque lot backend sans changement du site.

Empreinte du runtime effectivement testé :

```text
local-sha256:2863893eaaf12ec3719287d108d30b0f65b8f4edf88f692879900415f0a47edf
282 fichiers runtime, ensembles et octets identiques entre travail et vérification.
```

**Ce runtime inclut des modifications utilisateur non commitées, notamment Ba&sh. Il ne certifie pas une image construite depuis le seul HEAD Git.** Avant release, réconcilier proprement ce qui doit être intégré, puis reconstruire et qualifier le commit exact livré.

### 9.2. Preuve native réelle et limite importante

Le scénario réel Polène/Ashby a capturé :

- page officielle `https://www.polene-paris.com/blogs/rh/careers` ;
- flux `https://api.ashbyhq.com/posting-api/job-board/polene-paris?includeCompensation=true` ;
- document `https://api.ashbyhq.com/robots.txt`.

80 offres observées en calibration puis en ingestion admise. 90 blocs de preuve/sorties archivés dans le stockage Railway de test, relus puis retirés du stockage chaud. Deux revalidations identiques depuis les archives froides sans appel HTTP au portail.

Les 80 tentatives de publication à froid ont été **refusées** avec `PORTAL_OWNER_NOT_CERTIFIED` : le lien officiel prouve la relation au portail, mais aucune revue SINGLE_BRAND n'a été inventée. Cette expérience prouve la lecture froide et le refus sûr ; elle ne prouve pas une publication native réelle réussie. Les écritures positives sont couvertes par intégration réelle avec transport HTTP synthétique et revue de fixture certifiée.

Une seule source de test est passée DRAFT → ACTIVE → PAUSED. Zéro offre publiée dans cette expérience, zéro source de production activée. Le refus après PAUSED est vérifié.

Identifiants pour retrouver cette preuve dans la base de test, s'ils sont encore présents :

```text
sourceKey : publication-live-polene-b1b8ffe7-13e7-4e1e-ad85-6f1643d767e1
sourceRevisionId : 6c8f9506-a623-44a1-8f47-064d9df3a9ea
identityCapture : b506a9c8-fe50-461d-bf2e-da9c28539fb1
calibrationCapture : 3382f880-a947-446f-be17-461e11a9f7f0
calibrationValidation : 56a07c3d-3de8-461e-b95b-8ca4a95e3cfa
accessCapture : e8896c71-b3c3-47b9-8bbb-675e0e51d149
ingestionCapture : a13f2227-c99b-4ec3-9516-109a86d9dcb2
```

Ne rejoue pas ces identifiants comme des qualifications encore fraîches. Une nouvelle expérience nécessite de nouvelles captures et des décisions réellement valides.

### 9.3. Limites de tests à comprendre

`pipeline/publicationBoundary.test.ts` comporte 28 scénarios, avec uniquement le transport HTTP mocké ; capture, replay, qualification, admission, SQL et écrivains sont réels. Il couvre absence de provenance, sondes non admises, RAW/URL/motifs/dates altérés, mutation de l'entrée appelante, révocations, retrait attaché/détaché, scope, attente de verrous et immutabilité.

`test/publicationPersistenceFixture.ts` est un helper de tests isolant la persistance de suites historiques. Il mocke l'admission, pas toute la chaîne de sécurité. Il doit être importé avant les imports de modules qui capturent les mocks. Les suites de frontières de publication et d'admission ne doivent pas l'importer. **Ne présente pas un test vert utilisant ce helper comme la preuve du vrai contrôle d'admission.**

La politique technique existante refuse encore un flux non vide composé uniquement de retenues, sans publication qualifiée (`NO_QUALIFIED_PUBLICATION`). Les tests du dernier lot utilisent un flux mixte. Ce cas doit être examiné dans le prochain lot ; ne modifie pas des fixtures pour cacher le problème.

La publication d'un flux entier n'est pas atomique. Les contrôles par offre interdisent de poursuivre une ancienne capture invalidée, mais des offres déjà écrites avant l'échec peuvent subsister. Il faut un contrat explicite de fin d'exécution/publication avant de tirer une absence de ce flux.

### 9.4. Fichiers de preuve

Sous `A/audits/reprise-2026-09-15/` :

```text
lot-5g3b3b.md
preuves/lot-5g3b3b-validation.json
preuves/lot-5g3b3b-counterproofs.json
preuves/lot-5g3b3b-fresh-migrations.json
preuves/lot-5g3b3b-live-admission.json
preuves/lot-5g3b3b-preservation.json
preuves/lot-5g3b3b-runtime-match.json
preuves/lot-5g3b3b-stock-migration.json
```

## 10. Prochain lot : absence et fermetures liées aux captures

### 10.1. Le travail demandé

**Rattacher les preuves d'absence et les fermetures aux captures.** C'est un périmètre ciblé, mais critique. Aucune promesse honnête de durée ou de nombre de fichiers n'a été faite. Ne le gonfle pas artificiellement ; ne réduis pas non plus l'audit parce qu'il a été décrit comme un « petit lot ».

Tu peux lui attribuer un identifiant clair après inspection, par exemple un sous-lot suivant de 5G. Aucun numéro de lot suivant n'a encore été validé par du code. Ne repars pas en 5G3B2, déjà livré.

### 10.2. Point de départ confirmé dans le code

Sous `A/apps/aggregator/src/pipeline/`, lire :

```text
attestation.ts / attestation.test.ts
enumeration.ts / enumeration.test.ts
refreshEvidence.ts
refreshPlan.ts / refreshPlan.test.ts
refreshManifest.ts / refreshManifest.test.ts
refresh.ts / refresh.test.ts / refreshScope.test.ts
ingest.ts
purge.ts / purge.test.ts
deactivateSources.ts
retireSource.ts / retireSource.test.ts
lifecycle.ts / lifecycle.operational.test.ts / lifecycle-events.test.ts
reconcile.ts
publicationBoundary.test.ts
```

Examiner aussi les producteurs de `SourceRun` et `PipelineEvent`, le schéma Prisma, les commandes `refresh-preview.mts`, `refresh-manifest.mts`, `refresh-audit.mts`, `bounded-refresh-command.py`, les tables/plans `MaintenancePlan` et `DataCorrection`, les gardes de capture/admission et les lecteurs d'échéance.

Défauts de liaison encore présents :

- `refreshEvidence.ts::readAbsencePlan` lit le dernier `SourceRun`, puis des `PipelineEvent` tels que `source.enumeration_observed`, `job.write_failed`, `job.publication_held`, `source.rows_rejected`. Le lien est essentiellement `sourceKey/runId`, avec empreintes calculées depuis ces faits ; il n'est pas encore fondé sur une capture admise scellée et son résultat natif vérifié.
- `attestation.ts` exige `complete === true` et refuse erreurs, troncature et états non probants. Les ratios ne servent qu'à refuser, jamais à démontrer l'exhaustivité. Préserver cette distinction.
- `purgeStaleForSource` appelle encore `deactivateAdministrativeSources` sur `pipelineVersion < version` avec une disposition `CLOSED`.
- `ingest.ts::purgeQuietly` contrôle des statistiques de run et un historique de volume avant cette purge. Ce n'est pas une preuve native liée à la capture dans chaque transaction de fermeture.
- Les manifestes et protections de cycle de vie du lot 1 sont utiles et à faire évoluer, pas à remplacer par une deuxième mécanique concurrente.

### 10.3. Invariants à obtenir

1. Une absence se démontre sur le **même périmètre natif et la même révision de source**, avec IDs comparables et parcours complet prouvé. Un volume stable, 90 % de couverture ou un booléen `complete` non qualifié ne suffisent pas.
2. L'exécution, sa capture admise, son manifeste scellé, sa validation et sa preuve d'énumération doivent être liés de façon durable et vérifiable, sans dépendre d'un log mutable présenté comme autorité.
3. La preuve doit distinguer une offre vue, retenue, rejetée, dont l'écriture a échoué et réellement absente. Une offre non publiée par notre pipeline n'est pas automatiquement retirée par l'employeur.
4. Une source inaccessible, tronquée, challengée, en timeout, révoquée ou au périmètre changé ne peut pas fermer des offres par silence.
5. Zéro explicitement prouvé dans le bon périmètre doit avoir un contrat sûr ; zéro silencieux reste non probant.
6. Revalider les conditions courantes sous les verrous d'écriture, après les attentes pertinentes. Couvrir révisions A → B → A, décisions remplacées, expiration de preuve et nouvelle tentative concurrente.
7. Une réattestation plus récente, une autre publication encore disponible ou un retrait administratif protégé ne doivent pas être écrasés.
8. Une fermeture doit expliquer sa cause : absence prouvée, échéance native qualifiée dépassée ou autre événement natif explicite. Un retrait faute de preuve ou hors périmètre reste un retrait distinct.
9. Une échéance déjà prouvée n'a pas nécessairement besoin d'une nouvelle capture de disparition : préserver le contrat de l'échéance native, de son identité et de sa priorité temporelle. Ne fusionne pas expiration et absence en une règle imprécise.
10. Toute mutation est bornée, prévisualisable, revalidée, idempotente et auditée. Aucun ancien écrivain alternatif ne doit permettre de contourner le nouveau contrat.
11. Le nettoyage de génération ne doit pas devenir un deuxième moteur de fermeture sans preuve. Décide de son remplacement ou de sa suppression avec ses appelants, tests et docs. Ne monte pas `PIPELINE_VERSION` pour forcer un nettoyage destructif.
12. Les historiques sans preuve suffisante restent historiques/non certifiants ; aucune migration ne leur fabrique une capture ou une admission.

Choisis une architecture réutilisant captures, validations et journal immuable existants. Si une entité supplémentaire est nécessaire, justifie sa responsabilité, ses contraintes SQL et sa rétention. Évite un protocole distribué ou une refonte globale sans besoin démontré.

### 10.4. Vérifications et contre-épreuves attendues

- Collecte complète positive, puis disparition prouvée ; collecte réellement vide ; source ne produisant que des retenues.
- Pagination incomplète, page répétée, trou d'ID, détail en échec, rejet identifiable et rejet anonyme.
- Même quantité mais ensemble d'offres différent ; IDs de liste différents des IDs de publication.
- Révocation ou changement de configuration entre collecte, préparation du plan et écriture.
- Qualification expirant pendant un verrou ; nouveau run plus récent ; horodatage futur ; preuve falsifiée ou liée à une autre capture.
- Offre réapparue après la preuve ; groupe avec deux publications dont une seule absente/expirée ; représentation en quarantaine.
- Arrêt au milieu de la collecte et au milieu de la publication ; reprise sans double événement ni fausse absence.
- Manifestes vides, source hors allowlist, bornes de volume et refus de fermeture massive.
- Archive froide valide et archive corrompue/absente, sans repli réseau caché.
- Tests positifs réels avec PostgreSQL et chaîne de preuve, pas seulement mocks des fonctions qui décident l'autorisation.
- Mutations volontaires ciblées qui retirent chaque garde critique, rouges attendus, restauration exacte puis vert.

### 10.5. Sortie du lot et passage au lot 6

Le lot est terminé quand chaque fermeture exécutée par les chemins concernés a une preuve vérifiable et actuelle selon son contrat, et que l'absence de preuve refuse l'action. Les sources non qualifiées restent empêchées d'utiliser ces chemins ; un statut ACTIVE historique ne leur donne aucun droit.

Livrer : code, migrations éventuelles, suppression des chemins remplacés, tests, contre-épreuves, répétition sur base neuve et clone si le schéma/stock est touché, audit de préservation, documentation de fonctionnement à jour et bilan avec limites.

Ensuite, avance au lot 6. Ne prétends pas que toutes les sources du catalogue sont certifiées. Les travaux restant en section 11 demeurent à traiter avant la release correspondante ; une exclusion prouvée et documentée est acceptable, une omission silencieuse ne l'est pas.

## 11. Qualification restante des sources et du stock

Cette liste est un point de départ d'audit, pas un inventaire figé de tous les futurs problèmes.

### 11.1. Identité, accès et exploitation

- Étendre les contrats natifs de relation officielle aux familles encore non qualifiées, domaines ATS personnalisés et pages de groupes : suite historique 5G2C.
- Compléter les rôles employeur, groupe, éditeur et intermédiaire. Un portail de groupe n'autorise pas à attribuer toutes ses annonces au nom du groupe.
- Définir et vérifier la réouverture d'une source RETIRED avec des preuves fraîches, sans réutiliser une ancienne certification hors contexte.
- Auditer `CompanyAlias` et les usages d'empreinte de configuration lorsqu'une révision exacte doit faire autorité.
- Couvrir les nombres et sérialisations JSON historiques : ne pas arrondir un identifiant ou une valeur native sous prétexte qu'une comparaison JSON semble équivalente.
- Achever la provenance du transport navigateur : réponses observées seulement, sous-ressources et requêtes échouées non exhaustives, amorçage WAF encore à examiner. Aucun contournement d'un refus d'accès.
- Paramètres privés de sources : une configuration contenant `apiKey` a été identifiée dans l'audit. Retrouver son statut, isoler les secrets derrière une référence privée, ne pas les exposer, traiter une rotation si nécessaire et autorisée.
- `CATALOGUE_API_KEY` absent a été signalé comme chemin potentiellement ouvert. Reproduire et corriger le comportement réel, avec les consommateurs, avant release.
- Qualification tenant par tenant ; réussite d'un adaptateur ≠ certification de tous les portails de cette famille.

### 11.2. Contenus natifs encore insuffisants

Le relevé 4I a notamment identifié Workday, SmartRecruiters en marque blanche, SuccessFactors, Avature, Eightfold, génériques, Phenom, WTTJ sectoriel, FashionJobs, WTTJ employeur et DigitalRecruiters parmi les populations à examiner. Les comptes exacts sont dans `preuves/lot-4i-scope.json`, à remesurer après corrections.

Défauts particulièrement établis :

- Eightfold lisait les détails et alimentait les colonnes dérivées sans conserver ces détails dans le RAW. Une projection historique ne peut pas réparer rétroactivement la preuve perdue.
- WTTJ enrichissait la description depuis un détail non conservé dans le RAW. Les résumés/profils réellement stockés restent valides comme contenus partiels, pas comme preuve d'un descriptif complet.
- Des publications historiques sont sans RAW ou sans source au registre. Les 441 représentations hors registre relevées étaient inactives ; ne pas les activer automatiquement.
- Ba&sh : travaux utilisateur sur dates et expérience à qualifier, notamment repli sur date de listing en cas d'échec du détail.
- Le script `verif:couverture` du package renvoie à un fichier absent dans l'état relevé. Vérifier sa nécessité et retirer/réparer la référence dans le lot approprié, en préservant le travail utilisateur.

Pour chaque cas : inspecter le RAW de façon récursive, qualifier les vrais chemins, capturer à nouveau ce qui a été perdu si l'accès le permet, conserver l'historique, mesurer l'effet sur le stock. Ne pas généraliser une conclusion depuis quelques clés racines ni additionner des familles pour inventer un nombre de postes distincts.

Chaque source doit finalement avoir un verdict daté et explicite : qualifiée pour un usage donné, bloquée, non vérifiable pour l'absence, en attente d'accès, exclue du périmètre ou retirée. L'exclusion ne doit pas masquer un défaut interne corrigeable.

## 12. Lot 6 : recherche par pays et deux origines

Objectif : une recherche commune réellement bornée par marché pour résultats, totaux, facettes, suggestions de titres/employeurs et localisations.

Points d'entrée à inspecter : `A/apps/api/lib/jobs.ts`, `job-search-query.ts`, `lieu.ts`, endpoints de suggestions, registre partagé ; `W/src/lib/emplois/`, URLs de recherche, client API, sélecteurs et composants ; publication/export et candidatures de B.

Travail attendu :

1. Contrat public versionné d'une offre directe, limité aux champs publiables. Aucun CV, compte candidat, contact privé ou mandat interne dans l'agrégateur.
2. Transfert durable des versions publiques. L'architecture cible est une outbox écrite dans la transaction de publication/modification/retrait, puis consommée de façon idempotente.
3. Reprise initiale complète et paginée, au-delà du plafond historique de 500 offres. Détecter les retraits et gérer doublons/désordre d'événements sans ressusciter une version ancienne.
4. Projection commune avec espaces d'identifiants distincts et `ApplicationAction` explicitant candidature Catwalks ou URL externe validée.
5. Pays obligatoire dans le périmètre SQL. Aucun pays absent/invalide transformé en recherche mondiale. Front et API doivent partager le même contrat.
6. Offres multi-lieux et recrutement distant : compatibilité pays démontrée, lieux préservés et présentation cohérente avec le marché.
7. Suggestions d'intitulés fondées sur le stock actif du pays ; référentiel géographique fiable pour les lieux, disponibilité des offres distinguée de l'existence d'un lieu.
8. Un contrat de facettes locales versionné et partagé ; ne pas maintenir une seconde liste manuelle divergente dans le website.
9. Filtres combinés en ET entre dimensions et OU à l'intérieur d'une dimension ; inconnus non assimilés à une correspondance ; facettes recalculées de manière cohérente, en excluant leur propre sélection selon le contrat retenu.
10. Priorité Catwalks, recherche et filtres avant pagination ; candidature existante préservée et éligibilité recontrôlée côté API de candidature.

Témoins : FR/US/CN et tous les marchés existants, Paris Texas/France, France tapée dans le contexte US, codes postaux, BE/FR transfrontalier, télétravail sans pays prouvé, code inconnu, changement de marché avec anciens filtres, back/forward, deux origines sous les mêmes filtres, plus de 500 offres natives, événements désordonnés/rejoués, totaux/facettes/pages identiques en périmètre.

Le défaut historique `marche=US` renvoyant le total mondial de 83 431 est un témoin à reproduire avec les données pertinentes ; 83 431 n'est pas un résultat actuel à figer artificiellement dans un test.

## 13. Lot 7 : pertinence et performance

Conserver les titres et noms originaux tout en permettant une recherche robuste : Unicode, accents, casse, langues sans espaces, mots multiples, apostrophes et jokers littéraux. Toute expansion de synonymes/traduction de requête est mesurée sur un corpus de requêtes attendu, pas supposée meilleure.

Prévoir le classement Catwalks/externe, puis pertinence et fraîcheur, une pagination stable et des caches qui n'échangent jamais leurs pays/langues. Un curseur doit définir son comportement en cas d'insertion, modification ou retrait concurrent.

Commencer par PostgreSQL et mesurer les plans SQL/index. Introduire un moteur externe uniquement si les mesures le justifient. Définir les objectifs de latence, précision et ressources avant l'optimisation, sur une capacité réellement disponible ; ne pas annoncer un p95 inventé.

Tester des volumes réalistes de 100 000 puis 1 million de documents, la concurrence, les facettes coûteuses, l'usage mémoire, les timeouts, le pool de connexions et le coût d'indexation/reconstruction. Un test de charge ne doit pas être envoyé à une production protégée.

## 14. Lot 8 : pays, langue, domaines et traduction

### 14.1. Domaine public

Loïc a cité `fr.catwalks.fr` et `en.catwalks.fr` pour décrire le comportement recherché, puis demandé de vérifier le fonctionnement d'Indeed. Il n'a pas validé un changement DNS concret. L'architecture de travail recommande des sous-domaines **par pays**, par exemple `fr`, `us`, `gb`, `ca`, sur le domaine racine réellement retenu.

`en` est une langue, pas un pays : il ne distingue pas US, GB et CA. Le dossier a aussi historiquement utilisé `catwalks.io`. Ne transforme donc ni `.fr` ni `.io` en décision de migration approuvée. Vérifie domaines existants, configuration, SEO et autorisations avant bascule.

Préparer ensemble : priorité URL/choix mémorisé/IP de confiance, pays multilingues, cookies et sessions, CORS, retours d'authentification, URL partagées, cache CDN/RSC, redirections sans boucle, canonical et hreflang. Ne rends pas tout le site dynamique en appelant `headers()` partout sans examiner le coût et l'ISR.

### 14.2. Internationalisation et traduction

Le propriétaire préfère le système de traduction d'Indeed si un service est nécessaire. Il a proposé comme hypothèse un i18n maison, catalogues par locale et messages de type gettext/ICU, dans React/SSR. **Ni le fournisseur de traduction ni le moteur interne précis d'Indeed n'ont été établis.** Ne présente pas cette hypothèse comme un fait.

Une bibliothèque i18n d'interface et un service qui traduit du contenu sont deux choses différentes. Vérifie les éléments externes sur sources primaires à jour avant de choisir ; si l'information fournisseur n'est pas publique, dis-le et retiens la solution adaptée aux exigences de Catwalks.

La décision de travail locale est de migrer l'interface vers `next-intl` et des catalogues ICU versionnés, cohérents dès le rendu serveur, puis de retirer le moteur maison remplacé. Cela n'est pas encore livré. Une ancienne version de next-intl inutilisée a été retirée historiquement ; ne confonds pas ce nettoyage avec l'interdiction d'introduire la future implémentation complète.

FR/EN sont les catalogues existants. Un registre CN ou des labels allemands ne prouvent pas une interface zh-CN/DE traduite. Ne déclare aucune langue disponible, aucun `hreflang` et aucun parcours complet avant sa validation réelle.

Les annonces conservent leur langue native par défaut. Une traduction éventuelle est un dérivé explicite, traçable, lié au hash/version de l'original et invalidé lorsqu'il change. Ne traduis pas automatiquement noms propres, entreprises, devises ou unités. Évaluer tout fournisseur sur un corpus réel, son coût et sa qualité ; ne pas engager un service payant illimité par défaut.

## 15. Skill Catwalks et validation UX/UI

**Obligation du propriétaire : toute refonte ou correction UX/UI utilise le skill Catwalks.**

Chemin exact retrouvé :

`/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-backend/docs/dev-skill/SKILL.md`

Lis le skill et ses références pertinentes avant tout travail UI : `references/design-tokens.md`, `components.md`, `page-patterns.md`, puis `product-patterns.md` et `product-inventory.md` pour les écrans applicatifs ; `backoffice-patterns.md` pour l'ATS/back-office. Consulte les composants réels avant de créer des doublons.

Annonce brièvement son utilisation. Les instructions produit récentes du propriétaire priment sur les anciennes formulations du skill présentant tout le site comme un lookbook immersif : ne force pas des sections 100vh sur un moteur de recherche Indeed-like. Applique la direction artistique et les composants de façon adaptée à la tâche.

Repères à préserver : noir/blanc/gris, fond listing `#F8F8F8`, bordure `#E1E1E1`, police réelle `catwalks_font`, poids 400 par défaut, pas de titres 300 ni de letter-spacing négatif, pills `100vmax`, cartes offres 1rem, transitions définies par les références, pas d'assets de police renommés vers leur origine. Les incohérences internes du skill doivent être résolues avec ses références et le code, sans bloquer une décision déjà autorisée.

Vérifie le navigateur réel sur desktop/tablette/mobile, clavier, focus, lecteur d'écran, chargement, liste vide, erreur, texte long et langues. Aucun texte ou KPI inventé pour meubler une maquette. Contrôle la règle D-319 sur le cadratin dans les textes d'interface ; ne l'applique pas aveuglément en falsifiant les citations ou le RAW des offres.

Maintenir les parcours `/reset-password`, `/mes-jobs`, `/maisons/[slug]`, la modale de candidature, l'inscription et les retours d'authentification. Les tests et builds ne remplacent pas cette vérification UX réelle.

Les pages légales FR/EN existantes portent un statut de travail non validé juridiquement. Préserver les marqueurs et ne pas annoncer une validation juridique au terme d'un test technique.

## 16. Lot 9 : SEO du catalogue

Brancher la chaîne entière : éligibilité → fiche → HTML → JobPosting → sitemap → mise à jour/retrait. Un validateur inutilisé n'est pas une livraison.

- Métadonnées et balisage conformes au contenu réellement affiché et aux preuves natives.
- Dates non inventées, salaire réel seulement, lieux multiples correctement représentés.
- Traitements distincts d'actif, expiré/fermé, retiré faute de preuve, fusionné/redirigé et inconnu.
- Identifiants et URL historiques conservés ou redirigés de façon vérifiée.
- Canonical/hreflang uniquement pour les versions réelles ; pas d'indexation de langues fantômes.
- Sitemap paginé du seul stock éligible, sans explosion de combinaisons de recherche pauvres.
- JSON-LD échappé correctement ; contrôle de l'HTML sans JavaScript et des réponses HTTP.
- Notifications de changement/retrait durables et rejouables si elles font partie de la chaîne retenue.

Pas d'ouverture large d'indexation avant stabilisation du catalogue et autorisation de bascule du website. Vérifier les exigences actuelles des moteurs dans leur documentation officielle au moment de l'implémentation.

## 17. Journal, CRON, matching et `/offres`

### 17.1. Journal, lot 11

Le Journal appartient au dépôt M, séparé de Catwalks website. L'audit initial a observé la migration 025 déjà appliquée en production et des fichiers de traduction transférés dans un conteneur sans image reproductible depuis le commit déployé. Les fichiers runtime ont été récupérés en lecture seule et sauvegardés au lot 0 ; leur moteur diffère du local et la console déployée ne déclenchait pas la traduction après publication dans le chemin contrôlé.

Mesure historique du 15 septembre : 142 articles FR publiés, 60 EN publiés, 22 échecs et 60 manquants. **À remesurer, pas à annoncer comme état actuel.**

Travail à clore localement : réconcilier/versionner les différences utiles, rendre la traduction durable à chaque publication/modification, retries bornés, annulation/timeouts, empreinte couvrant tous les champs traduits, statut d'une ancienne EN périmée, slug et liens réciproques, absence honnête de traduction, reprise après interruption. Résoudre sans falsifier les citations la tension entre règle D-319 et citation littérale.

La preuve finale est l'équation FR publiés = EN à jour + exceptions identifiées, pas un « 142/142 » déduit d'un ancien compteur. La mutation de production media reste un périmètre explicitement protégé.

### 17.2. CRON, lot 10, phase suivante

Préparer et tester les mécanismes de reprise nécessaires à cette phase : tâches durables, leases expirables, checkpoints, retries classés, file d'échecs inspectable, limites par hôte/tenant partagées entre processus, séparation collecte/projection/indexation, fraîcheur et observabilité.

Une interruption de worker, une panne DB ou une vague de 429 ne doit ni perdre du travail, ni multiplier les propriétaires d'une tâche, ni déclencher des fermetures en masse. Plusieurs cycles complets de répétition isolée, des alarmes testées et une restauration réelle sont nécessaires avant activation future.

**Ne pas activer maintenant les CRON de production.** Ce point est une décision du propriétaire, pas un oubli. Les règles de reprise indispensables à une release présente doivent cependant être vérifiées dès maintenant.

### 17.3. Matching et nouvelle promesse de `/offres`

Ces sujets viennent ensuite. Préserver leur fonctionnement existant et leurs données pendant la recherche commune. Ne pas inventer la nouvelle promesse de `/offres` ni lancer une refonte de matching sous couvert du nettoyage. Une redirection ou convergence de route techniquement nécessaire doit être explicite, testée et compatible avec les anciens liens et candidatures.

## 18. Lot 12 : suppression du legacy et documentation

Objectif systématique du propriétaire : **zéro code mort, zéro ancien circuit de secours, zéro fichier parasite.**

Après remplacement validé, supprimer réellement anciens écrivains, chemins de lecture, scripts, alias de commandes, imports, dépendances, options d'environnement, copies de registre, composants et tests obsolètes. Mettre à jour leurs appelants et leurs docs au même lot. Pas de `legacyFallback`, d'option de contournement ni de feature flag sans plan de retrait pour faire passer des cas historiques.

« Zéro legacy » ne signifie pas supprimer les données historiques, migrations appliquées, preuves d'audit, plans de réparation ou lecteurs nécessaires à leur interprétation. Ces éléments ont encore une fonction. Isoler les archives du runtime et conserver l'historique utile dans Git/sauvegardes ; distinguer clairement procédure courante et preuve datée.

Ne supprime pas un module seulement parce qu'il n'est pas importé directement : vérifier chargement dynamique, CLI, tests, packaging, opérations de reprise et déploiement. Inversement, un commentaire « utilisé plus tard » n'est pas une justification suffisante pour conserver du code sans usage.

Le registre des sources doit offrir un seul parcours clair pour ajouter et qualifier de nouveaux candidats. La découverte ne doit pas modifier leur statut de certification. Aucun compteur `verified`, avis textuel ou note d'accès historique ne doit remplacer les preuves natives.

Audit final des fichiers `.md` : supprimer/actualiser ceux devenus trompeurs, conserver les audits datés identifiables, réparer liens et commandes, éviter de multiplier les passations concurrentes. Ce prompt est une photographie de reprise, pas une deuxième documentation opérationnelle permanente.

## 19. Environnements, sauvegardes et preuves

### 19.1. Checkout de vérification

```text
/tmp/catwalks-lot0-verification-20260915
```

C'est un worktree détaché historiquement à `9504c9f`, avec les fichiers courants synchronisés depuis A pour les tests. **Son HEAD seul n'identifie pas le code exécuté.** L'empreinte du runtime et les fichiers synchronisés font foi pour les validations précédentes.

Le dépôt principal contient les changements utilisateur et ses dépendances ne servent pas aux campagnes de tests. Utiliser une copie/worktree isolé avec installation reproductible. Avant réutilisation, vérifier qu'aucun test, mutant ou capture ne tourne.

**Ne jamais synchroniser, générer du code, installer des dépendances ou modifier ce runtime pendant une suite, une mutation défensive ou une capture native.** Une capture est liée au lecteur exact. Sérialiser synchronisation → génération/migrations → tests → mutations/restauration → preuve native. Si plusieurs campagnes sont nécessaires, utiliser des environnements réellement séparés.

Les anciens scripts de copie ne sont pas une garantie d'élimination des fichiers supprimés : comparer l'ensemble exact des fichiers runtime et retirer seulement les résidus identifiés du checkout jetable. Ne jamais appliquer ce nettoyage au dépôt utilisateur.

### 19.2. PostgreSQL jetable ciblé

```text
État privé : /tmp/catwalks-audit-20260915/lot1-test-state.json
Base : catwalks_lifecycle_test
Conteneur : catwalks-lot1-test-af360608c8
Port observé : 127.0.0.1:32776
PostgreSQL 18, tmpfs 1 GiB, schéma 69 au dernier contrôle
```

Le fichier privé contient `container`, `endpoint`, `url`. Lire l'URL dans l'environnement du processus, sans l'imprimer. Vérifier le nom exact de la base et le conteneur avant une opération destructive. Les fixtures peuvent tronquer leurs tables ; ne jamais les pointer vers le clone de stock ni Railway production.

### 19.3. Clone complet de répétition du stock

```text
État privé : /tmp/catwalks-audit-20260915/lot4e3-state.private.json
Base : catwalks_rehearsal_20260915
Conteneur PG : catwalks-stock-rehearsal-dc2bef22be
Proxy local : catwalks-stock-rehearsal-dc2bef22be-local
Port observé : 127.0.0.1:32805
Schéma : 69
Statut privé : HISTORICAL_WITHDRAWAL_APPLIED_AND_AUDITED
PGDATA : A/backups/reprise-20260915-lot4e3/postgres-data
```

Clone isolé, réseau sans sortie selon sa configuration de création, ressources bornées. Il contient les reprises historiques déjà appliquées et auditées. **Ne pas le réinitialiser pour faire passer une suite de tests.** Préparer une nouvelle base si un test doit être destructif.

Migration 68 → 69 : comptes et empreintes des sept tables contrôlées identiques avant/après :

| Table | Lignes |
|---|---:|
| Job | 87 607 |
| JobSource | 90 764 |
| SourceObservation | 141 933 |
| Source | 536 |
| SourceRevision | 536 |
| SourceIdentityReview | 112 |
| PostingScopeDecision | 224 |

536 notes historiques `SourceAccessArchive` conservées exactement ; aucune capture ni admission fabriquée sur ce clone lors de cette migration. Les 112 revues anciennes ne sont pas certifiantes au regard du nouveau contrat.

Pour les lectures d'audit, imposer `default_transaction_read_only=on`, timeout de requête et de verrou. Les gros calculs d'empreintes peuvent nécessiter un timeout documenté plus long. Pour une migration ou réparation locale, identifier explicitement la cible, figer un avant et recontrôler l'après ; ne pas simplement enlever une garde parce que la commande échoue.

Image PG fixée :

```text
postgres@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2
```

### 19.4. Sauvegardes

Sauvegarde complète connue du schéma 60 :

```text
A/backups/reprise-20260916-lot5d/after-source-validation-schema60.dump
Taille : 1 133 726 720 octets
SHA-256 : ddadd1e51b45515e1134e547a3f737bb2ffbbf75a2f4c757ff23790dc14deca6
```

Elle exige les migrations **61 à 69** pour rejoindre le schéma de passation. Les nouvelles migrations s'y ajouteront. Une restauration complète n'a pas été répétée au dernier lot 5G3B3B ; ne pas annoncer le contraire.

Dump initial de production conservé dans les sauvegardes du lot 4E3, retrouver son chemin depuis l'état privé : 561 610 102 octets, SHA-256 `4bb0021b7edf820d4ce86d8645804e07a015aa7166cf366e6086c2244790a8f6`.

Sauvegarde du dernier lot :

```text
A/backups/reprise-20260916-lot5g3b3b/
  manifest.json
  post-commit.json
  working-files.tar.gz
  validation-material.tar.gz
```

Le répertoire est privé 0700 et ses archives/manifestes 0600. Le reçu post-commit identifie le commit complet et les fichiers du lot. L'archive de validation contient scripts et logs utiles : les fichiers `/tmp` peuvent disparaître, ce n'est pas l'unique copie de ces preuves. Restaurer les outils dans un nouveau dossier de lecture, jamais par-dessus une base ou le travail utilisateur.

### 19.5. Railway de test

```text
Projet : 0eae47d0-598d-4cf0-bb3f-b38921eafa7e
Environnement de test : 917b9a0b-6ec0-475d-b101-7cebcff9a5d8
Nom : capture-validation-20260915
Bucket : 49ae6211-e181-4877-acc7-1c6fe5b80e37
Nom : catwalks-capture-validation
Localisation : Amsterdam
Préfixe de preuve utilisé : validation/20260915
```

Identifiants S3 privés : `/tmp/catwalks-audit-20260915/lot2-s3.private.json`, mode 0600. Champs : endpoint, accessKeyId, secretAccessKey, bucketName, region, urlStyle. Ne jamais les afficher/copier dans le prompt, Git ou un log public. Le transport de test utilisait `forcePathStyle=false` ; vérifier avec l'outil existant.

L'environnement Railway **production** est `e66b019c-d280-41dc-85d8-25ed86bdd101`. Ce n'est pas la cible des expériences de capture. Le service API s'appelle `catwalks-api`, pas `web`.

Dernier contrôle daté du gel au 15 septembre : workers avec `PIPELINE_PAUSED=1`, CRON gelés à `0 0 29 2 *`. Ne déduis pas leur état actuel de ces seules valeurs historiques ; relire avant toute livraison, préserver le gel et ne pas « corriger » cette expression comme si c'était le CRON quotidien attendu.

### 19.6. Autres services locaux

Des conteneurs Supabase `*_dix` tournent sur la machine. Ils ne sont pas les bases de tests de l'agrégateur. Ne les arrêter ni les supprimer. Des serveurs locaux API/site peuvent également être ouverts ; identifier leurs processus et ports avant de lancer un nouveau service, sans tuer un serveur utilisateur pour libérer un port.

## 20. Commandes et discipline de validation

### 20.1. Reproduction minimale de la validation globale

Après installation reproductible dans une copie isolée propre et synchronisée, avec Docker local vérifié :

```sh
# Dans le checkout isolé, jamais dans un shell configuré pour opérer la production.
npm run test:local
npm run api:build
```

Lis `A/apps/aggregator/scripts/validate-local.mjs` avant de l'utiliser. Le programme crée sa propre base PostgreSQL jetable, ignore les URL DB héritées pour les tests, vérifie le socket Docker local, applique toutes les migrations, génère Prisma, vérifie layout/types, lance suites agrégateur/API et tests Python, puis retire son propre conteneur. Il n'accepte pas de cible DB en argument.

Le build API est séparé ; l'exécuter avec une configuration locale de test explicitement choisie, sans importer aveuglément un `.env` de production. Les builds website/backend/media suivent leurs propres scripts et environnements lorsque leurs fichiers changent.

Node doit respecter `package.json` et le lockfile. Ne lance pas une mise à jour générale des dépendances pour contourner une incompatibilité de machine. Une mise à jour nécessaire est un changement à valider et à documenter. L'audit npm à zéro du lot 0 est une preuve historique, pas une garantie de sécurité actuelle.

Pour tests ciblés : utiliser la base jetable identifiée, injecter `DATABASE_URL` et `DIRECT_URL` depuis le fichier privé sans affichage, vérifier l'identité DB avant fixtures. `READ_ONLY_CORPUS_TEST=0` était utilisé sur les bases de test. Les deux tests corpus facultatifs demandent leur propre cible en lecture seule ; leurs sauts doivent rester visibles.

### 20.2. Scripts du dernier lot : ne pas relancer aveuglément

Dossier : `/tmp/catwalks-audit-20260915/`, copie durable dans `validation-material.tar.gz`.

| Script | Usage réel et précaution |
|---|---|
| `lot5g3b3b-check.py` | Synchronise le checkout, génère Prisma, migre la base ciblée et typecheck. Modifie le runtime de vérification ; ne pas lancer pendant une autre campagne. |
| `lot5g3b3b-full.py` | Synchronise puis exécute validation complète et build. Produit des logs du lot passé : préférer un nouveau script/nom de lot pour la suite. |
| `lot5g3b3b-target.py` | Tests ciblés sans synchronisation. Son ancien log intermédiaire n'est pas la preuve finale globale. |
| `lot5g3b3b-counterproofs.py` | Mutations du checkout de vérification et de gardes SQL dans la base de test, restauration en `finally`. À lire et adapter avant exécution ; ne pas partager son runtime avec une autre suite. |
| `lot5g3b3b-runtime-proof.py` | Comparaison du runtime selon l'algorithme réel de hash de capture. Vérifier ce qu'il inclut/exclut. |
| `lot5g3b3b-live.mts` / `lot5g3b3b-run-live.py` | Ancienne expérience native + archive S3 ; nouvelle exécution = nouvelle capture/qualification et nouveaux identifiants. |
| `lot5g3b3b-fresh-migrations.py` | **Ne pas relancer tel quel** : contient une opération ponctuelle de renommage de migration qui a déjà été faite avant stabilisation. |
| `lot5g3b3b-stock-migration.py` | **Ne pas relancer tel quel** : suppose un schéma initial 68, alors que le clone est maintenant en 69. |
| `lot5g3b3b-package.py` | **Ne pas relancer après commit** : empaquetage/staging du lot terminé, sauvegarde déjà scellée. |
| `lot5g3b3b-report.py` / `lot5g3b3b-edit.py` | Outils historiques de génération/édition du lot ; ne pas réécrire le bilan ou le code du lot passé par commodité. |

La migration 69 avait temporairement un autre préfixe pendant son développement local. Le renommage du SQL identique et des métadonnées de la base jetable a été vérifié avant sa version finale. Cette opération ponctuelle n'est pas une procédure de migration à généraliser.

Utiliser `PYTHONDONTWRITEBYTECODE=1` pour éviter les fichiers parasites. `rg` était indisponible sur cette machine ; utiliser `git grep`, `git ls-files` et Python, ou `rg` s'il est devenu disponible. Ne pas bloquer le travail pour installer un outil de recherche.

### 20.3. Tests adaptés, sans théâtre de validation

- Pour une correction métier : témoin reproduisant le vrai défaut, intégration pertinente, puis suite globale appropriée.
- Pour une garde de sécurité des données : contre-épreuve qui retire cette garde et doit échouer pour la bonne raison.
- Pour SQL : vraie base PostgreSQL, vraie migration, contraintes/verrous et concurrence réellement exercés.
- Pour capture : comparaison des octets, de la configuration, du lecteur et du résultat, replay sans réseau, stockage froid si concerné.
- Pour UI : build/types/tests et navigateur réel, pas uniquement screenshot synthétique.
- Pour documentation seule : vérifier code cité, liens, état Git et absence de changement runtime ; pas besoin d'inventer une nouvelle campagne de milliers de tests.
- Ne pas relancer indéfiniment une suite déjà verte sans modification ou incertitude nouvelle.

## 21. Méthodologie de chaque lot

1. **État avant.** Identifier HEAD, fichiers utilisateur, schéma, environnement, preuve de données et périmètre. Sauvegarder ce que le lot va réellement modifier.
2. **Contrat de lot.** Décrire problème concret, invariants, chemins concernés, critères de sortie et limites. Donner un numéro lisible sans créer des sous-lots pour chaque fichier.
3. **Vérification du défaut.** Lire producteurs et consommateurs, tester ou mesurer. La documentation indique une piste, pas un fait garanti.
4. **Implémentation complète.** Corriger le chemin réel ; supprimer le chemin remplacé ; inclure schéma, types, API, scripts et docs nécessaires.
5. **Tests utiles.** Cas positifs, cas négatifs et frontières ; PostgreSQL/réseau synthétique/natif selon la propriété à prouver. Pas de mock qui neutralise précisément la garde annoncée comme testée.
6. **Audit défensif.** Chercher contournements, autres appelants, concurrence, vieilles révisions, réattestations, données absentes, ordres temporels, preuve froide et interruptions. Réintroduire les défauts critiques dans un environnement isolé.
7. **Restauration et revalidation.** Restaurer exactement chaque mutation, vérifier les empreintes et le vert final. Ne pas certifier des fichiers différents de ceux testés.
8. **Répétition des données.** Migrations base neuve et clone si concerné ; plan borné preview/apply, audit avant/après, reprise idempotente et rollback adapté. Conserver RAW et identités.
9. **Hygiène et preuves.** `git diff --check`, appelants/deps morts, docs, logs privés, mesures datées, compte des tests réellement exécutés et sauts, limites explicites.
10. **Commit et conservation.** Stage du seul périmètre, commit cohérent, reçu post-commit, sauvegarde vérifiée. Pas de travail utilisateur absorbé par accident.
11. **Suite autonome.** Si les critères passent, avancer. Si une réserve reste, la traiter ou la borner explicitement avec un blocage effectif ; ne pas écrire « terminé » puis cacher un trou dans une note.

Tu n'as pas à redemander la permission pour lire, tester, corriger, documenter et faire des commits locaux dans le périmètre autorisé. Préviens brièvement le propriétaire de ce qui a été appris, du prochain point à résoudre et d'un éventuel vrai blocage. Ne noie pas le bilan dans la chronologie des commandes.

## 22. Release et définition de fin

« 100 % production-ready » est une exigence de qualité, pas un résultat que l'on déclare parce que les tests sont verts. La phase se clôt sur un dossier de preuves et une livraison réellement vérifiée dans les limites d'autorisation.

### 22.1. Conditions techniques de release

- Source de vérité conservée ; pas de publication nouvelle sans capture/projection directe légitime et provenance vérifiable.
- Aucun écrivain ne contourne les admissions, décisions de périmètre, preuves d'absence et gardes de cycle de vie.
- Sources activables recensées et qualifiées individuellement ; sources non qualifiées explicitement exclues avec raison et effet technique. Pas d'inférence de certification depuis un compteur ou un ancien ACTIVE.
- Stock historique à servir préparé, réparé ou exclu selon des règles explicites ; URLs historiques, retraits, groupes et quarantaines contrôlés.
- Recherche commune, pays, deux candidatures, facettes et suggestions cohérents de bout en bout.
- Langues réellement livrées, contexte serveur/client/cache cohérent, UI validée selon le skill.
- SEO connecté au stock éligible ; aucune ouverture publique anticipée de pages trompeuses.
- Installation reproductible à partir du **commit exact de release**, pas uniquement d'un worktree enrichi de fichiers non commités.
- Audit des dépendances/secrets/configurations, builds des périmètres affectés, migrations neuves et sur clone, charge et bornes de ressources mesurées.
- Sauvegarde/restauration démontrée à un niveau de schéma connu ; séquence d'évolution documentée. Une migration de schéma n'est pas à confondre avec un plan de réparation des données.
- Retour arrière préparé : image précédente, compatibilité schéma, bascule des lecteurs, conservation/rejeu d'événements et preuves. Ne pas promettre un rollback SQL destructif automatique.
- Anciennes branches/PR utiles réconciliées, aucun code mort ni doc opérationnelle trompeuse, aucune disparition de travail utilisateur.
- Observabilité et alarmes pertinentes vérifiées ; santé HTTP distincte de fraîcheur/qualité/couverture des données.

### 22.2. Exécution et limites d'autorisation

Avant toute bascule autorisée, identifier explicitement dépôt, branche, image, service, environnement, base et migrations. Ne pas utiliser un simple label `production` non relié à des IDs vérifiés.

Pour l'agrégateur, préparer la release et effectuer les opérations déjà autorisées après contrôle des garde-fous, sans exiger un nouveau « go » par habitude. Éviter le déploiement accidentel d'une API nouvelle contre un stock non préparé, ou l'activation d'un worker par un push.

Pour website/backend/media/DNS encore protégés, fournir une release prête à appliquer et demander uniquement la levée précise de la restriction restante. Ne pas contourner celle-ci pour pouvoir annoncer « tout est déployé ».

Après une livraison autorisée : vérifier révision réellement servie, migrations, endpoints, parcours de recherche/candidature, absence d'offres hors pays, lifecycle, erreurs, latences et gel des CRON. Un succès de build ou une réponse 200 ne prouve pas le résultat produit.

La phase est totalement clôturée quand chaque critère applicable est satisfait et que les livraisons autorisées sont vérifiées. Si une bascule externe reste interdite ou impossible, dire exactement : prêt localement/testé, production correspondante non livrée, blocage précis. Ne pas qualifier le projet entier de terminé tant qu'un travail autorisé reste exécutable.

## 23. Traitement des blocages et compte rendu

Pour chaque blocage réel :

1. Nommer le périmètre et l'action impossible.
2. Donner la preuve, la date et les tentatives raisonnables déjà faites.
3. Expliquer l'effet sur la livraison et le comportement sûr actuel.
4. Distinguer défaut corrigeable, preuve native indisponible, décision produit réellement nouvelle, droit/secret manquant et autorisation explicitement exclue.
5. Demander uniquement l'information ou l'autorisation indispensable, après avoir rendu le résultat concret et révisable.
6. Continuer les travaux indépendants.

Un captcha, un 403 ou une absence de preuve officielle n'autorise pas un contournement. Une source peut rester exclue avec un dossier clair pendant que le produit progresse. Une panne de test locale ou un fichier temporaire manquant n'est pas immédiatement un blocage utilisateur : reconstruire l'environnement avec les scripts maintenus et sauvegardes.

Format conseillé pour chaque bilan :

```text
Lot / commit / périmètre
Problème corrigé et comportement obtenu
Preuves : tests, contre-épreuves, migration, mesure/replay, navigateur si concerné
État des données et de la production
Legacy supprimé et documentation mise à jour
Limites réelles, blocages éventuels
Prochaine étape exécutée
```

Conserver une liste unique des écarts ouverts avec statut, preuve et lot de résolution. Ne pas disséminer un problème connu dans dix « limites » sans propriétaire ni échéance de phase. Les rapports doivent permettre à quelqu'un d'autre de vérifier les affirmations sans relire toute la conversation.

## 24. Tes premières actions

**Commence maintenant le travail de reprise ; ne réponds pas uniquement par une reformulation de ce prompt.**

1. Vérifier les cinq HEAD/branches/états et les sauvegardes contre la photographie ci-dessus. Préserver tout travail nouveau apparu depuis cette passation. Ne pas supposer qu'un processus ou une base est encore dans son état du 16 septembre.
2. Lire les instructions locales applicables, le bilan 5G3B3B et les contrats actuels ; comparer les limites documentaires au code.
3. Vérifier que le checkout isolé et les bases de test sont les bons, et qu'aucune campagne ne les utilise. Ne pas lancer d'anciens scripts ponctuels de migration/empaquetage.
4. Cartographier tous les producteurs de `SourceRun`/preuves d'énumération et tous les chemins de fermeture, purge, retrait, réouverture et réconciliation.
5. Reproduire les défauts de liaison restant entre exécution, capture et fermeture. Définir le contrat minimal cohérent avec les garde-fous déjà livrés.
6. Implémenter le lot absence/fermetures, retirer les chemins remplacés, valider et auditer selon les sections 10 et 21.
7. Passer au lot 6 après sa validation ; poursuivre ensuite l'ensemble de la feuille de route et des qualifications restantes jusqu'aux critères de la section 22.

**Principe de conduite : avance en autonomie, conserve les preuves, refuse les actions non démontrées, supprime les anciens circuits après remplacement et ne laisse aucun travail autorisé inachevé derrière une promesse de reprise.**
