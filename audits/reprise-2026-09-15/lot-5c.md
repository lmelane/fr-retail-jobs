# Lot 5C : révisions immuables des sources et collectes liées à leur configuration

16 septembre 2026. Validé localement, sur le clone complet et sur le stockage Railway de test. Aucune écriture de production ni activation de cron.

## Changement livré

Chaque modification réelle du périmètre d’une source crée un instantané SQL immuable de sa configuration native. Le registre pointe vers cette révision. Les notes et métriques opérationnelles ne modifient pas cette identité. Le retour A → B → A conserve deux instantanés de contenu identique avec des identités de transition distinctes : une validation ancienne ne devra pas redevenir valable par simple égalité des paramètres.

Le premier instantané décrit l’état observé lors de la migration. Il ne prétend pas reconstituer les configurations passées. Les clés de registre restent stables et l’historique survit à la suppression d’un brouillon. Les captures anciennes ou non enregistrées gardent une référence nulle, sans provenance inventée.

Le moteur charge directement le JSON natif du registre et sa révision. Le détour hérité par `CatalogSource.entryUrl`, avec sérialisation puis reparsing, est supprimé du chemin d’ingestion. Les réglages effectifs sont résolus au même endroit pour collecter et pour contrôler la collecte. Leur lecture SQL en texte évite l’arrondi numérique du pilote.

Avant toute requête réseau, une collecte enregistrée doit correspondre à sa configuration, son lecteur et sa révision chargée. L’ingestion exige une source active. Cette vérification et la création de collecte prennent un verrou partagé sur la ligne du registre dans la même transaction. Les configurations différentes ne peuvent pas être rattachées silencieusement à la révision courante.

La transaction de publication reprend le contrôle de révision et de statut. Une collecte terminée reste consultable dans l’historique si sa source change ou passe en pause ; elle ne peut plus créer, rafraîchir ou libérer une publication dans ce nouveau contexte. Le verrou reste détenu jusqu’à la fin de l’écriture.

## Validation et audit défensif

- **3 252 tests réussis** : 2 397 unitaires, 591 intégration, 259 API et 5 Python ; deux tests API optionnels ignorés.
- **157 tests ciblés**, contrôle TypeScript et build API réussis. Migration 59 également appliquée depuis une base vide.
- Sept suppressions volontaires de contrôles détectées par les régressions : révision chargée, réglages, lecteur, état de collecte, contrôle dans la transaction de publication, validité de la révision et verrou de publication. Restauration : **71 tests réussis**.
- Trois contre-épreuves SQL : désactivation temporaire de l’immutabilité, de l’enregistrement des transitions et du lien source/collecte. Les écritures interdites deviennent possibles lorsque leur garde disparaît ; toutes ces mutations et leurs témoins sont annulés par transaction.
- Couverture des modifications concurrentes, instantanés mal formés avec empreinte pourtant correcte, pointeurs falsifiés, A → B → A, sources supprimées, retrait explicite et activation combinée à un changement de configuration.

Deux défauts ont été corrigés pendant l’audit : le premier brouillon transformait un retrait explicite en pause ; un premier test de révision périmée était masqué par le contrôle de configuration. La migration finale préserve le retrait et la contre-épreuve utilise maintenant des paramètres redevenus identiques. Le brouillon SQL n’avait été appliqué qu’à la base de test isolée. Le clone a reçu uniquement la version finale ; la production reste inchangée.

Une nouvelle collecte réelle **Polène/Ashby de 80 offres** est liée à la révision 1 de sa source de validation. Les **82 blocs** sont relus depuis l’archive, puis le lecteur est rejoué sans réseau : sorties et métadonnées identiques. La commande ops confirme le rejeu depuis l’archive et refuse une configuration différente. Les réglages et reçus restent dans une sauvegarde privée.

## Migration du stock et préservation

La migration 58 → 59 produit **536 instantanés exactement conformes au JSONB du registre**, empreinte incluse. La comparaison SQL de toutes les anciennes colonnes conserve intégralement :

| Table | Lignes inchangées |
|---|---:|
| Job | 87 607 |
| JobSource | 90 764 |
| SourceObservation | 141 933 |
| Source | 536 |

Le clone conserve zéro collecte native : aucun lien historique n’est fabriqué. La sauvegarde complète du lot 5B reste le point de reprise des données ; son SHA-256 est revérifié. Elle contient le schéma 56, puis nécessite les migrations 57 à 59. Les empreintes du stock démontrent que ses anciennes valeurs sont toujours celles précédant ce lot.

Les 86 fichiers initiaux de l’utilisateur restent préservés : 85 identiques, avec l’exception déjà documentée des dépendances du package. Ses trois scripts et ses autres modifications restent hors de ce commit.

Preuves : [validation](preuves/lot-5c-validation.json), [mutations applicatives](preuves/lot-5c-counterproofs.json), [gardes SQL](preuves/lot-5c-sql-counterproofs.json), [collecte et rejeu](preuves/lot-5c-live-s3-replay.json), [commande ops](preuves/lot-5c-cli.json), [stock](preuves/lot-5c-stock-migration.json), [sauvegarde](preuves/lot-5c-backup.json), [runtime vérifié](preuves/lot-5c-runtime-match.json), [préservation](preuves/lot-5c-preservation.json).

## Conditions restantes avant release

Une révision n’est pas une certification. Le compteur manuel de promotion, la validation liée au lecteur et au manifeste, les preuves d’accès et d’identité, ainsi que la fermeture par absence dans un périmètre identique restent à finaliser. Les anciennes captures sans révision restent explicitement historiques et ne suffisent pas à certifier une nouvelle source.

La configuration privée du registre peut déjà contenir des paramètres d’accès. Leurs références et leur cycle de rotation doivent être traités avant release ; ces paramètres ne sont ni imprimés ni copiés dans les preuves publiques. Le rejeu CLI exige encore le fichier privé des réglages effectifs. Aucun statut global « production-ready » n’est déduit de ce lot.
