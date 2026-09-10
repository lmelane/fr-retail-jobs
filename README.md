# Modecareers / Catwalks

Agrégateur mondial d’offres du luxe, de la mode, de la beauté et des secteurs associés. Les offres sont collectées à la source ; la France est un filtre du site. FashionJobs sert uniquement à découvrir des acteurs.

**Le document de référence à ouvrir est [apps/aggregator/README.md](apps/aggregator/README.md).**

Il rassemble l’état vérifié, le diagnostic de certification, les priorités, l’organisation du dépôt et les liens vers les preuves. Les historiques servent de pièces justificatives et ne remplacent pas cet état daté.

| Dossier | Rôle |
|---|---|
| `apps/aggregator` | Collecte, identité, normalisation, cycle de vie |
| `apps/web` | Recherche, filtres, pages et SEO |
| `packages/db` | Schéma et migrations partagés |
| `docs` | Documentation technique maintenue : architecture et identité |
| `audits` | Rapports et preuves historiques |
| `backups` | Archives privées locales, exclues de Git |

Les règles de travail et décisions historiques restent dans [CLAUDE.md](CLAUDE.md). L’ancien README est conservé dans [les archives](audits/legacy-aggregator-reports/project-readme-before-20260910.md).

Les anciens plans et le handoff sont rangés dans `audits/legacy-project-files/`. Les anciens rendus HTML, maquettes et exports ont été retirés de la racine et conservés dans une archive privée. Pour éviter leur retour : `npm run check:layout -w @catwalks/aggregator`.
