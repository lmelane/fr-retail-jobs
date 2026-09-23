# Catwalks — agrégateur mondial d’offres

Collecte des offres du luxe, de la mode, de la beauté et du retail. Les publications originales sont la référence ; interprétations, rapprochements et traductions doivent rester traçables et recalculables.

## Dépôt et branches

- Dépôt GitHub : [lmelane/fr-retail-jobs](https://github.com/lmelane/fr-retail-jobs).
- Dossier de référence sur le poste de Loïc : `/Users/lmelane/Downloads/catwalks-job-aggregator`.
- `main` est réservée à la version livrée et vérifiée en production.
- `development` porte le travail en cours ; les pushes sur cette branche sont autorisés.
- La promotion de `development` vers `main` intervient après validation de la release. Un push de développement ne vaut pas autorisation de mise en production.

Aucun push sur `main` ni déploiement du site, backend, back-office ou média sans validation explicite de Loïc. Le GO de Loïc couvre la livraison et l’exploitation normale de l’agrégateur décrites dans le bilan courant, y compris sa promotion vers `main`. La mission post-RUN autorise les correctifs génériques, leurs migrations non destructives versionnées, la CI et la livraison de l’agrégateur. Aucun reset, réparation historique ou déploiement des autres produits n’est inclus.

### Transition des copies de travail

Les checkouts actuellement utilisés par Claude sont conservés tant que son travail est actif. Leur branche locale peut donc encore porter un ancien nom, y compris `main` : cela ne vaut ni validation ni autorisation de production. `development` distante reçoit les commits validés. La branche locale sera réalignée après coordination, sans perdre de fichiers modifiés ou non suivis. Le SHA réellement déployé doit être vérifié avant d’affirmer que `main` lui correspond.

Les règles de travail figurent dans [CLAUDE.md](CLAUDE.md). Préserver le travail unique avant toute suppression de branche ou de clone ; une copie utilisée par un processus actif reste en place jusqu’à coordination.

## Documentation maintenue

- [Architecture et contrats produit](docs/architecture/production-foundations.md) : deux origines d’offres, pays/langue, recherche et parcours de validation des sources.
- [Recherche bornée par marché](docs/architecture/recherche-marche.md) : périmètre obligatoire, champ lieu, filtres refusés explicitement, inconnues non confirmées, contrat de facettes et `GET /api/marches`.
- [Parcours unique des sources](docs/architecture/source-onboarding.md) : découverte, enregistrement, captures HTTP des preuves, collecte native et activation.
- [Validation multilingue `/emplois`](docs/architecture/emplois-e2e.md) : chaîne locale de répétition et tests navigateur.
- [Bilan PR-1 : préparation au canari](audits/2026-09-22/pr1-canary-readiness.md).
- [Runtime Railway](docs/architecture/railway-runtime-reset.md) : nouvelle API publique, anciens services retirés, le [bilan post-RUN](audits/2026-09-23/post-run.md) distingue la version livrée, les corrections et leur validation. Le RUN quotidien est configuré à 18 h Europe/Paris, avec changement d’heure pris en charge ; les images, SHA et preuves effectives figurent dans le reçu de release.
- [Canari Railway validé — delta egress](audits/2026-09-23/canary-delta-oh-my-cream.md) : quatre contrôles PASS, une ingestion Oh My Cream, workers revenus en pause ; [restaurabilité déjà acquise](audits/2026-09-22/restorability-canary-final.md).
- [Exploitation canari et retour arrière](docs/architecture/canary-operations.md) : worker unique, pause autoritaire, nouvelle source et répétition locale.
- [Golden Path nouvelle source](docs/architecture/golden-source.md) : base neuve, qualification, deux ingestions, rejeu et lecture API.
- [État vérifié et exploitation](apps/aggregator/README.md).
- [Stack locale complète](docs/stack-locale.md) : catalogue, API, backend et site de test sur ce poste (`npm run stack:prepare`, `stack:start`, `stack:verify`, `stack:stop`, `stack:reset`), données synthétiques isolées, aucune écriture de production.
- [Faits issus du RAW](docs/architecture/source-facts.md) : rémunérations exactes, diplômes natifs, modes de travail et localisations.
- [Identité des publications](docs/architecture/publication-identity.md) : clés natives et preuves de rapprochement ; reprise historique en cours.
- [Plan par lots et critères de validation](audits/reprise-2026-09-15/plan.md) ; chaque lot validé localement a son bilan daté (`audits/reprise-2026-09-15/lot-*.md`), du [lot 1](audits/reprise-2026-09-15/lot-1.md) au [lot 12](audits/reprise-2026-09-15/lot-12.md).
- [Audit du 15 septembre 2026](audits/reprise-2026-09-15/rapport.md) : mesures, défauts et preuves datées.
- [Audit de release du 16 septembre 2026](audits/reprise-2026-09-15/release-2026-09-16.md) : verdict, conditions de livraison, liste unique des écarts ouverts ; [qualification des sources](audits/reprise-2026-09-15/qualification-sources-2026-09-16.md) du même jour.
- Suite de mission (lots F0 à F8, `audits/reprise-2026-09-15/lot-f*.md`) : [audit du schéma du 16 septembre 2026](audits/reprise-2026-09-15/schema-inventaire-2026-09-16.md), décision par objet et migration de retrait du legacy.

| Dossier | Rôle |
|---|---|
| `apps/aggregator` | Collecte, preuves, identité des sources, cycle de vie |
| `apps/api` | API de recherche, filtres, suggestions et fiches |
| `packages/db` | Schéma, migrations et contrats partagés |
| `packages/runtime` | Contrôle au démarrage des deux runtimes Railway et attestation de l’image |
| `docs` | Architecture et documentation maintenues |
| `audits` | Mesures et preuves datées, exclues du runtime |
| `backups` | Sauvegardes privées locales, exclues de Git |

Le site candidat et le backend des candidatures vivent dans leurs dépôts privés. Les offres directes Catwalks et les offres externes doivent partager la recherche tout en gardant leurs parcours de candidature.

## Validation locale

Prérequis : Node 22 (≥ 22.12), Node 24 ou Node ≥ 26, npm, Python 3 et Docker local démarré.

```sh
npm ci --workspaces --include-workspace-root
npm run test:local
```

Cette commande crée une base PostgreSQL jetable depuis une image figée, applique les migrations, vérifie les types et exécute les suites agrégateur/API ainsi que les tests des outils Railway. Elle ignore les URL de base de l’environnement appelant et retire son conteneur en fin d’exécution. Les deux tests réservés au corpus réel restent explicitement séparés.

La CI vérifie aussi le build de l’API. `npm run api:build` permet de le reproduire. Le CRON d’ingestion est actif ; le matching et la nouvelle promesse de `/offres` restent gelés.
