# Premier lot de corrections locales — 8 septembre 2026

Réalisé après l'autorisation explicite de modifier le code. Ce lot accompagne le [plan de validation de production](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/2026-09-08/PLAN-VALIDATION-PRODUCTION.md). Aucun déploiement, changement de pays ou backfill de production. Les modifications sont dans le répertoire de travail, sans commit créé.

## Changements et vérification

| Sujet | Comportement livré | Preuve |
|---|---|---|
| Pays contradictoires | Les comparaisons de fusion examinent les pays de chaque offre ; l'upsert ne réutilise plus le pays du candidat pour représenter l'offre existante | Tests unitaires, écriture réelle en base et réconciliation : FR/US restent séparés |
| Responsable / adjoint | Une différence explicite de niveau sur les intitulés de direction de magasin empêche la fusion par similarité | Témoins Store Manager/Assistant/Deputy, français et non-régression des traductions commerciales |
| Publications éloignées | Le seuil existant de 45 jours s'applique aussi aux titres identiques lors du rapprochement | Publication à 180 jours séparée ; deux publications proches restent rapprochables |
| Identité source stable | La réattestation d'une même source et d'un même identifiant reste prioritaire à l'écriture | Correction pays/date rejouée trois fois : un seul Job et une seule JobSource |
| Fusions transitives | Le regroupement et la réconciliation conservent les incompatibilités des membres déjà absorbés | Une offre sans pays ne relie pas FR et US ; permutations de l'ordre d'arrivée testées |
| Réconciliation | Transmet pays et ville stockés ; applique les mêmes refus et vérifie les identifiants concurrents d'une source attachée | Tests de réconciliation, y compris conservation des sources et promotions existantes |
| Date d'expiration JSON-LD | Aucune échéance de rendu + 30 jours ; échéance absente omise, échéance connue conservée même passée | Tests du JSON sérialisé, du passé et de la date source future |
| Devise JSON-LD | Aucun salaire structuré n'est publié sans devise ; aucun remplacement implicite par EUR | Cas salaire minimum/maximum sans devise, salaire USD horaire conservé |
| Sélection CI | Les tests unitaires couvrent tous les fichiers hors pipeline/dedup, couverts par la commande d'intégration | 61 + 23 fichiers exécutés, soit les 84 fichiers du périmètre |
| Parcours mobile | Le scénario ouvre Filtres avant de vérifier Pays | 16 parcours navigateur réussis, dont les 8 mobiles |

Fichiers principaux : [règles de fusion](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/match.ts), [écriture](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/upsert.ts), [réconciliation](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/reconcile.ts), [JSON-LD](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/lib/job-posting-schema.ts), [commandes de test](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/package.json), [parcours E2E](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/web/e2e/critical-flows.spec.ts).

## Résultats exécutés

- PostgreSQL 18 isolé, base de test dédiée : 13 migrations appliquées.
- `npm run test:unit -w @catwalks/aggregator` : **61 fichiers, 1 314 tests réussis**.
- `npm run test:integration -w @catwalks/aggregator` après le dernier changement : **23 fichiers, 163 tests réussis**.
- Total agrégateur : **1 477 tests réussis**, dont 17 nouveaux cas par rapport aux 1 460 de l'audit initial.
- `npm test -w @catwalks/web` : **84 tests réussis, 2 ignorés**. Les deux tests de cohérence réservés à l'ancienne URL de copie locale restent à rendre portables ; les deux tests de fumée SQL s'exécutent et passent.
- Typecheck agrégateur et web : réussi ; agrégateur revérifié après modification de la réconciliation, web revérifié par le build final.
- `npm run web:build` : réussi.
- Playwright sur build local et fixtures isolées : **16/16 réussis**, ordinateur et mobile.
- `git diff --check` : réussi.

La base et le serveur créés pour ce lot sont arrêtés à la fin des vérifications. Aucune ressource existante de l'utilisateur n'est supprimée. Les données déjà modifiées dans le répertoire avant ce travail restent préservées.

## Limites et préparation au déploiement

**Ce lot ne clôt pas l'audit.** Les protections sont conservatrices : elles peuvent laisser davantage de doublons à examiner. Elles ne certifient pas une précision mondiale de fusion et ne réparent pas les anciennes fusions. La séparation entre deux pays s'appuie sur les valeurs disponibles ; elle ne prouve pas que chaque pays est géographiquement correct.

La concurrence entre travailleurs, les collisions de clés Job liées aux espaces d'identifiants des tenants, l'autorité de chaque champ et la qualité de la provenance restent des contrôles ouverts. Le lot ne rend pas tous les chemins de résolution d'identité transactionnels. Il ne transforme pas les gardes par paire en une garantie universelle sur un corpus déjà mal fusionné.

Le changement JSON-LD peut rendre inéligibles des offres dont la date source est déjà passée. C'est une conséquence explicite de la suppression de l'échéance inventée. Il faut résoudre les contradictions de validité à partir des sources et du cycle de vie, sans prolongation automatique lors du rendu. Aucun statut actif/inactif en base n'a été modifié par ce lot.

Avant déploiement : valider un échantillon représentatif de rapprochements et de dates ; prévoir les contrôles de contenu et le retour arrière ; traiter séparément le catalogue historique. L'inventaire AZ/AR/NH et le Health Score sont spécifiés dans le plan mais ne sont pas implémentés dans ce lot.

**État des constats initiaux :** A02 partiellement traité et testé localement ; A09 traité pour la fidélité JSON-LD, cycle de vie encore ouvert ; A16 traité pour la sélection des tests et le scénario mobile, reste de la CI ouvert ; A21 traité uniquement pour la devise JSON-LD. Aucun de ces sujets n'est déclaré validé en production.
