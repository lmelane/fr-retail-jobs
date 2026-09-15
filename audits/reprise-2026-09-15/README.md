# Audit de reprise Catwalks

**15 septembre 2026. Audit initial terminé ; lots 0 à 3 et sous-lots 4A–4D4 validés localement, archive S3 vérifiée sur un environnement Railway isolé. Le lot 4 et les suivants restent en cours.**

Commencer par [le rapport A–J](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/rapport.md), puis [le plan en lots](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/plan.md).

État de la reprise : [lot 0 — résultats, validations et limites](lot-0.md). [Lot 1 — disponibilité et maintenance](lot-1.md). [Lot 2 — captures natives et rétention](lot-2.md). [Lot 3 — faits RAW et réattestation](lot-3.md). [Sous-lot 4A — identité des publications](lot-4a.md). [Sous-lot 4B — reprise réversible des groupes](lot-4b.md). [Sous-lot 4C — contenu propre à chaque publication](lot-4c.md). [Sous-lot 4D1 — reprise du RAW historique](lot-4d1.md). [Sous-lot 4D2 — JSON-LD, dates et texte Recruitee](lot-4d2.md). [Sous-lot 4D3 — lecteurs natifs et échéance Flatchr](lot-4d3.md). [Sous-lot 4D4 — XML et portails natifs](lot-4d4.md). Le rapport initial conserve ses constats datés ; les comptes rendus de lots décrivent les corrections ultérieures.

- [Inventaire Git / GitHub](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/inventaire-git.md)
- [Catalogue des 536 sources](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/sources.csv)
- [Profils des adaptateurs](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/adaptateurs.md)
- [Couverture des données par pays](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/couverture-marches.csv)
- [Inventaire exhaustif des chemins RAW actifs](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/raw-chemins.csv)
- [Signaux RAW qualifiés](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/raw-signaux.json)
- [Index des preuves par code](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/reprise-2026-09-15/preuves/code-index.md)

Les fichiers de preuve décrivent des snapshots datés, pas l’état permanent du service. Le rapport distingue les chiffres exacts, les reproductions, les interprétations et les vérifications qui restent à faire.

Aucun payload intégral d’offre, credential, cookie, clé API ou export d’environnement n’est inclus. Les captures affichent seulement le contenu de la page publique testée localement. Le dépôt de l’agrégateur étant public, **la présence de ce dossier local n’est pas une publication du rapport**. Aucun push n’a été réalisé pendant l’audit.

## Rejouer les contrôles

Les scripts de `scripts/` sont les scénarios d’audit utilisés, pas des commandes de production. Ils pointent vers les dépôts locaux inspectés. Les sorties de travail sont écrites dans `/tmp/catwalks-audit-20260915`.

- Le script ponctuel `witnesses.mts` a été retiré après remplacement des fonctions qu’il testait. Son résultat initial reste dans [witnesses.json](preuves/witnesses.json). Les témoins maintenus sont désormais les tests des lecteurs, de la réattestation et de l’API décrits dans le [lot 3](lot-3.md).
- `lifecycle-witness.mts` : écrit uniquement si DATABASE_URL désigne exactement `127.0.0.1:55452/catwalks_audit_test`. Scénario réservé au PostgreSQL local jetable de l’audit.
- `search-witness.mts` : utilise Prisma et refuse l’exécution si `default_transaction_read_only` n’est pas activé ; le lecteur employé pendant l’audit imposait ce réglage à chaque connexion et une limite de deux connexions.
- `coverage.sql` et `inventory.sql` : requêtes de lecture. À exécuter avec une connexion imposant READ ONLY dès son ouverture, dans une transaction READ ONLY et avec timeout.
- `raw-semantic.py` : traitement hors ligne du snapshot privé, n’accède pas à la base. Le fichier source compressé n’est volontairement pas versionné ici. Son empreinte est dans `preuves/raw-inventaire.json`.

Une simple variable de session posée sur une connexion Prisma de pool ne suffit pas à protéger toutes les connexions. Ne pas envoyer l’URL de production à Vitest, à Prisma migrate/reset ou à un script comportant un wipe.

## Lire les compteurs

Dans sources.csv, `representations` et `raw_representations` couvrent tout le stock historique de la source ; `active_representations` couvre ses représentations actives ; `public_linked` exige aussi une Job active, non fusionnée et non retirée. Ces populations ne s’additionnent pas en offres uniques. Les pays sont ceux des Job liées actives ; UNKNOWN indique une valeur absente.

`not_ok7d` compte les runs DEGRADED/BROKEN et autres états hors OK/NEW ; ce n’est pas une mesure de disponibilité quotidienne. `latest_canAttestAbsence` décrit la dernière preuve enregistrée, dont la fraîcheur doit encore satisfaire la règle de lifecycle. `risk_flags` est dérivé de ces états, pas d’un nouveau crawl. Les horodatages PostgreSQL sans fuseau sont conservés littéralement dans l’export récent pour éviter une conversion implicite par le fuseau du poste local.

Le build a temporairement ajouté son répertoire à tsconfig.json ; cette seule modification automatique a été retirée, avec diff nul. Le serveur local :3197 et le conteneur PostgreSQL de test ont été arrêtés après les contrôles. Colima, démarré pour l’audit, reste disponible ; aucun service préexistant n’a été arrêté.
