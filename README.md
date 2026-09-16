# Catwalks — agrégateur mondial d’offres

Collecte des offres du luxe, de la mode, de la beauté et du retail. Les publications originales sont la référence ; interprétations, rapprochements et traductions doivent rester traçables et recalculables.

## Documentation maintenue

- [Architecture et contrats produit](docs/architecture/production-foundations.md) : deux origines d’offres, pays/langue, recherche et parcours de validation des sources.
- [Recherche bornée par marché](docs/architecture/recherche-marche.md) : périmètre obligatoire, champ lieu, filtres refusés explicitement, inconnues non confirmées, contrat de facettes et `GET /api/marches`.
- [Parcours unique des sources](docs/architecture/source-onboarding.md) : découverte, enregistrement, captures HTTP des preuves, collecte native et activation.
- [État vérifié et exploitation](apps/aggregator/README.md).
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

La CI vérifie aussi le build de l’API. `npm run api:build` permet de le reproduire. L’activation des crons, le matching et la nouvelle promesse de `/offres` viennent après cette phase de reprise.
