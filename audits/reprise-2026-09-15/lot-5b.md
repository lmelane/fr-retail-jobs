# Lot 5B : configuration stable, budgets séparés et suppression des curseurs morts

16 septembre 2026. Validé localement, répété sur le clone complet et sur le stockage Railway de test. Aucune écriture de production ni activation de cron.

## Problème et changement livré

L’ingestion ajoutait une date limite et un objet de progression à la configuration du portail. L’empreinte mélangeait ainsi réglages durables et contrôles temporaires. Une ancienne date limite pouvait aussi arrêter un rejeu avant ses premières pages.

La collecte utilise maintenant une copie JSON immuable de la configuration. Elle refuse les contrôles temporaires et les valeurs que JSON ne préserve pas, avec des bornes de taille et de structure. L’ingestion remet réellement cette copie au lecteur. Les délais appartiennent au contexte commun d’exécution ; leur provenance est conservée séparément dans `CaptureBatch.executionBudget` et affichée par la commande de rejeu.

Les limites coopératives de Lever et du lecteur générique agissent sur les collectes réelles. Le rejeu consomme les réponses enregistrées indépendamment de l’ancienne horloge ; la limite ferme du contexte appelant continue de protéger son transport. Les comparaisons strictes du lot 5A restent obligatoires.

La validation des candidats et la lecture des preuves officielles partagent désormais l’annulation commune. La lecture de preuve inclut aussi le corps, avec sa limite de taille. L’ancien `withHardDeadline`, qui abandonnait une promesse sans annuler sa requête, est supprimé avec ses tests remplacés.

## Legacy supprimé

La vérification des appelants montre que la pagination tournante ne concernait que FashionJobs, déjà exclu du circuit d’offres. Le module `sourceCursor`, son branchement dans l’ingestion, le type `CrawlProgress`, les tests de curseur et de cadence, ainsi que la table `SourceCursor`, sont supprimés.

Le refus explicite de collecter des offres FashionJobs reste actif, ainsi que la découverte d’acteurs. Les anciens commentaires décrivant FashionJobs comme un collecteur d’offres opérationnel ont été retirés.

Sur le clone, l’unique curseur retiré portait la valeur `nextPage=81`, datée du 7 septembre. Ce repère opérationnel est archivé dans la preuve du lot. Aucune annonce, aucun RAW et aucune observation ne sont supprimés.

## Validation et audit défensif

- **3 228 tests réussis** : 2 397 unitaires, 567 intégration, 259 API et 5 Python. Deux tests API optionnels restent explicitement ignorés.
- **65 tests ciblés** ; TypeScript et build API réussis.
- **Sept contre-épreuves rouges puis restauration verte** : rendre la configuration mutable, accepter les contrôles temporaires, polluer son empreinte avec le budget, perdre la provenance du budget, couper le rejeu sur un délai périmé, ignorer le délai coopératif et omettre l’annulation du transport.
- Le test de transport vérifie une réponse dont les en-têtes sont reçus mais dont le corps reste bloqué : annulation réelle et retour après règlement du transport.
- **Nouvelle collecte réelle Polène/Ashby de 80 offres** avec budget ferme de 30 s et coopératif de 27 s, enregistrés séparément. Relecture de 82 blocs archivés et rejeu exact sans réseau du lecteur. Un seul bloc, le nouveau manifeste, nécessitait un transfert chaud ; les autres archives étaient réutilisables.
- Commande ops vérifiée depuis l’archive, avec refus d’une configuration différente.

## Répétition sur le stock complet

Une sauvegarde privée de **1 133 623 276 octets**, SHA-256 `74a8e0f8c00eb32e5a953eadba2467d7c5e7e9c6dbeecad9961b109c5c811ee9`, précède la migration. Son catalogue a été relu avec `pg_restore`.

Les migrations 57 et 58 passent sur le clone. Les empreintes SQL de toutes les colonnes sont identiques avant et après pour :

| Table | Lignes inchangées |
|---|---:|
| Job | 87 607 |
| JobSource | 90 764 |
| SourceObservation | 141 933 |
| Source | 536 |

Les présentations, RAW, dates, identifiants et états de ces lignes font partie de cette comparaison complète. Le clone n’avait aucune collecte native ; son compteur reste zéro. La table de curseur a disparu comme prévu.

Preuves : [validation](preuves/lot-5b-validation.json), [contre-épreuves](preuves/lot-5b-counterproofs.json), [collecte et archive](preuves/lot-5b-live-s3-replay.json), [migration et intégrité](preuves/lot-5b-stock-migration.json), [sauvegarde](preuves/lot-5b-backup.json), [commande ops](preuves/lot-5b-cli.json), [révision vérifiée](preuves/lot-5b-runtime-match.json), [préservation](preuves/lot-5b-preservation.json).

## Limites et suite

Ce lot sépare les paramètres et supprime leurs anciens chemins d’exécution. L’historique immuable des configurations du registre et la certification des sources restent à livrer. Le compteur manuel de promotion ne constitue toujours pas une preuve suffisante.

Le budget commun annule les opérations coopératives ; il n’isole pas chaque lecteur dans un processus séparé. La capacité et l’isolation opérationnelle restent dans les contrôles prévus avant release. Aucun statut global « production-ready » n’est déduit de ce lot.
