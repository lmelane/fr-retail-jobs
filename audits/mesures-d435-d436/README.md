# Mesures D-435 / D-436 — dimensions du catalogue

Ce répertoire conserve les sondes et constats historiques des mesures de septembre 2026.
Les dates des fichiers définissent leur contexte ; leurs résultats ne décrivent pas à eux seuls
le catalogue actuel.

## Relecture et nouvelle exécution

Les sondes suivies et les fichiers `.sql` restent disponibles pour relire la méthode. Avant
une nouvelle mesure, vérifier leur compatibilité avec le schéma et la population visée, puis
utiliser un accès explicitement limité à la lecture.

L'ancienne commande `db.py readonly node …` ne garantit pas cette limitation avec Prisma :
`PGOPTIONS` ne contraint pas son moteur, et la cible historique utilise un rôle superutilisateur.
Elle ne doit donc plus être présentée ici comme une procédure de lecture seule sûre. Le
[constat du LOT 0](../../docs/audit-lot0/LOT0-RESTITUTION.md#11-la-protection-en-lecture-seule-nexistait-pas--confirmé)
conserve la preuve et ses limites.

## Six brouillons retirés du checkout le 23 septembre 2026

`q.mjs`, `d437-echantillon.mjs`, `d437-couverture-simulee.mjs`,
`d437-enum-cles-raw.mjs`, `d437-geo-plausibilite.mjs` et
`export-filtres-2026-09-17.mjs` étaient non suivis et sans consommateur applicatif.
Leur archive privée a été comparée octet pour octet avant retrait ; les constats historiques
JSON restent conservés.

Archive locale privée : `~/.catwalks/postrun-cleanup-20260923/untracked-before-cleanup.tar.gz`.
Dans le même répertoire, `drafts-final-removal-manifest.json` et `drafts-removal-receipt.json`
conservent les chemins et empreintes SHA-256. Ces brouillons restent consultables dans l'archive
pour vérifier leur provenance ; ils ne sont plus des sondes à lancer depuis ce dépôt.
