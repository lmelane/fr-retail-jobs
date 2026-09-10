# Architecture actuelle et règles de livraison

Relecture du code : **10 septembre 2026**, révision `6ac43ec` et modifications locales de nettoyage. Ce document décrit l’implémentation et les procédures ; il ne certifie pas un déploiement ni la couverture mondiale. L’état de travail, les chiffres datés et les priorités restent dans le [README de l’agrégateur](../../apps/aggregator/README.md). Les règles détaillées d’identité sont dans [Identité des employeurs et des sources](../employer-identity.md).

## Organisation et autorité des données

Le projet est un monorepo modulaire : collecte dans `apps/aggregator`, interface et API dans `apps/web`, schéma et fonctions partagées dans `packages/db`. PostgreSQL porte le catalogue opérationnel, les offres et leurs historiques. Les workers et le web sont des processus séparés ; le code du dépôt ne démontre pas à lui seul leur capacité à absorber des millions d’offres.

| Sujet | Référence dans l’implémentation | Limite à respecter |
|---|---|---|
| Catalogue des sources | Table `Source`, [sourceStore.ts](../../apps/aggregator/src/connectors/sourceStore.ts) | Un CSV historique n’est pas l’état de production ; `ACTIVE` ne prouve pas une certification |
| Employeur canonique | `Company.id`, `canonicalKey`, alias et revues | Une source, un ATS, un groupe et une Maison sont des objets distincts |
| Représentation native | `JobSource`, identité `(sourceKey, externalId)` | Les IDs de deux tenants ne sont pas interchangeables |
| Offre canonique | `Job`, représentations associées, redirections et événements | Une fusion d’employeurs n’autorise pas automatiquement une fusion d’offres |
| Métier | [Moteur d’occupation](../../packages/db/occupation-engine.ts), releases dans [le schéma](../../packages/db/prisma/schema.prisma) | Un intitulé non reconnu reste une donnée à enrichir, pas une raison de supprimer l’offre |
| Contrat et rythme | `employmentTerm`, `workTime`, `programType`, `engagementType`, attributs associés | « Temps plein » et « CDI » ne sont pas la même dimension ; les labels sont distincts des valeurs internes |
| Secteurs | `Company.sectorCodes`, `SectorConcept`, revues de secteurs | Plusieurs secteurs par entreprise ; `Company.sector` et le CSV de Maisons subsistent dans des chemins historiques |
| Preuves et historique | `SourceObservation`, `EmployerObservation`, `JobEvent`, revues et `DataCorrection` | L’absence de preuve historique ne se répare pas en inventant une observation native |

Le [schéma Prisma](../../packages/db/prisma/schema.prisma) est la référence exacte pour les champs, relations et contraintes. Les nombres d’entreprises, adaptateurs ou migrations ne sont pas des constantes de cette documentation.

## Chemin d’une source et d’une offre

1. La recherche produit des candidats, avec provenance et preuves officielles. FashionJobs sert à découvrir des acteurs ; ce chantier n’autorise pas la collecte de ses offres.
2. [registerSourceCandidate](../../apps/aggregator/src/connectors/sourceCandidate.ts) crée une source nouvelle en `DRAFT`. Il vérifie la configuration, le kind et les collisions de tenant ; il ne certifie pas l’appartenance du portail.
3. La revue d’identité et les autres préconditions permettent une promotion explicite par `promoteSource`. Une source existante ne doit pas être écrasée ou réactivée par un import historique.
4. L’adaptateur énumère le flux mondial configuré. Les réponses, identifiants, rejets, détails manquants et limites doivent être mesurés. Un total déclaré par l’éditeur ne remplace pas une liste d’identifiants réconciliée.
5. Le pipeline conserve le RAW, résout l’employeur, normalise les dimensions puis écrit la représentation et l’offre canonique. Certaines erreurs d’identité ou retenues de publication bloquent l’admission et conservent des preuves : elles doivent rester visibles dans les écarts.
6. Les contrôles rapprochent les IDs natifs, les écritures en BDD et les résultats publics. Une collecte complète d’un flux ne prouve ni l’identité, ni tous les portails d’un groupe, ni la visibilité en front.

Le front lit l’ensemble mondial. **Aujourd’hui, la France utilise `isFrance` dans [jobs.ts](../../apps/web/lib/jobs.ts)** ; les autres pays passent par les correspondances de `countryCode`. Ne pas supposer que `isFrance=true` et `countryCode='FR'` sont deux comptages identiques sans les mesurer. Les compteurs et résultats doivent être comparés sur les mêmes filtres, IDs et instant.

Les valeurs inconnues restent explicites et investigables. Une date de découverte technique ne devient pas une date de publication native pour obtenir un balisage Google Jobs. La conservation d’une offre et son éligibilité au balisage sont deux contrôles distincts.

## Cycle de vie et concurrence

Les observations et événements servent à distinguer première détection, dernière observation, modification, fermeture, réouverture, retrait administratif et fusion. Un timeout, un 403 ou une indisponibilité de source ne prouvent pas une fermeture employeur.

Les [règles d’attestation](../../apps/aggregator/src/pipeline/attestation.ts) et les reçus `SourceRun` gouvernent le droit d’attester une absence. Le [nettoyage de génération](../../apps/aggregator/src/pipeline/purge.ts) passe par la désactivation des représentations ; la commande ancienne qui supprimait tous les jobs et entreprises a été retirée du CLI. Ne pas confondre ces deux mécanismes.

Les [verrous d’écriture](../../apps/aggregator/src/lib/writeLocks.ts) coordonnent les mutations concernées. Les redirections conservent les anciennes identités et URLs. La correction doit être répétée sur clone et vérifier les propriétés des lignes, pas uniquement l’égalité d’un total avant/après.

## Limites encore présentes dans le code relu

| Point | Constat actuel | Conséquence opérationnelle |
|---|---|---|
| Sources héritées | `loadActiveSources()` charge les lignes ACTIVE sans appeler le validateur strict d’identité | Ne pas lancer tout le catalogue en supposant toutes ses sources certifiées |
| Périmètre de portail | `certifiedPortalScope()` ne réexécute pas tous les contrôles de `assertIdentityReview()` | Âge, artefact et sujet doivent être unifiés avant une certification automatique générale |
| Mono-marque | Le résolveur peut rattacher un nouveau libellé explicite au propriétaire du portail | Une contradiction explicite ne doit pas être absorbée sans revue |
| Reporting | Les défauts de sélection des reçus et de configuration courante sont documentés dans le README | Ne pas présenter les anciens ratios comme une preuve actuelle |
| Livraison | Certains outils opérationnels sont encore privés dans `backups/` | Ne pas prétendre que toute la procédure est reproductible depuis Git seul |

Ces points sont documentés, pas corrigés par cette mise à jour de documentation. La lecture du code n’est pas une nouvelle mesure de leurs effets en production.

## Migrations, déploiement et reprise

**La liste de six migrations du document précédent était obsolète.** La procédure courante doit partir du répertoire complet [prisma/migrations](../../packages/db/prisma/migrations), du commit à livrer et de l’état réel de `_prisma_migrations`.

- Préparer sauvegarde, restauration et répétition des migrations/corrections nécessaires sur clone. Vérifier les lecteurs et writers compatibles, ainsi que la durée et les verrous des opérations.
- Appliquer les migrations par une opération de release contrôlée. Les éventuels hooks Railway sont une configuration externe à vérifier ; ce document n’affirme pas leur état actuel.
- Ne pas appliquer de DDL depuis un cron. [start.sh](../../apps/aggregator/start.sh) sort immédiatement si `PIPELINE_PAUSED=1`, sinon vérifie `prisma migrate status` puis exécute une commande autorisée. Il ne migre pas la base.
- Traiter séparément DDL, backfill et index concurrents lorsque le SQL le demande. Ne pas envelopper un `CREATE INDEX CONCURRENTLY` dans une transaction. Examiner un échec avant tout `migrate resolve` ; aucun baseline automatique.
- Ne pas déployer pendant un run. Un arrêt correctement marqué `INTERRUPTED` ne rend pas le run complet et ne transforme pas ses absences en fermetures.
- Vérifier les révisions réellement déployées, les migrations, les réponses publiques et les témoins du lot. Ne pas revenir à un writer incompatible avec les nouvelles identités admises en base.

La [readiness web](../../apps/web/app/api/health/route.ts) vérifie la BDD, les migrations attendues avec leurs checksums et des colonnes requises. Le contrat est injecté au build par [next.config.mjs](../../apps/web/next.config.mjs). Un HTTP 200 prouve cette disponibilité au moment du contrôle, pas la justesse des offres ni la couverture mondiale.

## Vérifications locales et rangement

Depuis la racine du dépôt :

```sh
npm run check:layout -w @catwalks/aggregator
npm run typecheck
npm run test:unit -w @catwalks/aggregator
npm run build:local -w @catwalks/aggregator
```

Les tests d’intégration utilisent une base de test dédiée ; plusieurs suites y modifient les données. Aucun test destructif sur une copie utilisée comme preuve ou sur la production. Le build local vérifie l’espace hôte/Docker avant de démarrer ; la capacité et les mesures de la machine sont documentées dans le README, pas dans une seconde fiche d’état.

Le code et les tests restent dans `src/`, les outils maintenus dans `scripts/`, les références et entrées explicites dans `data/`. Preuves datées dans `audits/`, RAW et sauvegardes privés dans `backups/`. Aucun rapport, classeur ou export ne doit recréer un dossier de travail à la racine ou dans `data/discovery`.
