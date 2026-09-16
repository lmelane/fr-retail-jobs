# Lot 5A : résultat de collecte complet et rejeu strict

16 septembre 2026. Validé localement et sur le stockage Railway de test. Aucune écriture de production, aucune activation de source et aucune modification du clone de stock dans ce lot.

## Problème et changement livré

L’archive conservait les réponses natives et les offres produites, mais perdait les métadonnées du résultat : complétude, troncature, périmètres, compteurs et rejets. Un rejeu pouvait aussi oublier une page enregistrée ou absorber une erreur sans échouer. Ces lacunes empêchaient une certification fiable des sources.

Le format 2 conserve désormais un manifeste intégral du résultat, lié à la clôture immuable. Les offres restent dans leurs blocs individuels, avec identifiant, ordre et empreinte. Le manifeste conserve toutes les métadonnées, y compris celles d’un résultat vide. Les anciennes collectes restent au format 1, sans métadonnées inventées.

La commande de rejeu compare les sorties ordonnées et toutes les métadonnées. Elle refuse une réponse oubliée, une requête absente, un corps incomplet ou une archive corrompue, même si le lecteur intercepte l’erreur. Un flux vide explicitement parcouru reste distinct d’un résultat vide sans preuve.

Les références des manifestes participent au périmètre et à la garde de rétention. Leur archivage suit les mêmes contrôles d’intégrité que les réponses et sorties.

## Audit défensif de la clôture

La migration 57 interdit les ajouts aux journaux après une clôture réussie ou échouée. Elle exige un manifeste et des positions contiguës correspondant au compteur pour une collecte réussie de format 2.

L’audit a reproduit une course absente des premiers tests : un verrou sans changement de version de ligne ne suffisait pas avec un ancien instantané `REPEATABLE READ`. Une sortie pouvait être ajoutée après une clôture qui en déclarait zéro.

La correction sérialise les écritures et la clôture en réécrivant à l’identique la ligne de collecte. Ses métadonnées restent immuables ; sa version transactionnelle avance, ce qui fait refuser les instantanés périmés par PostgreSQL. Le contrôle s’effectue par instruction SQL et par collecte, sans réécrire le parent pour chaque offre d’un insert groupé. Les deux sens de la course sont testés.

Le brouillon de migration, appliqué uniquement dans la base scratch, a été corrigé dans une transaction contrôlée. La migration finale complète a ensuite été appliquée depuis zéro par la suite locale. Aucun historique de migration de production ou du clone de stock n’a été réécrit.

## Validation

- **3 226 tests réussis** : 2 389 unitaires, 573 intégration, 259 API et 5 Python. Deux tests API optionnels restent explicitement ignorés.
- **38 tests ciblés** de capture, manifeste et rétention ; TypeScript et build API réussis.
- **Huit contre-épreuves rouges puis restauration verte** : ignorer les métadonnées, ignorer le contenu, oublier des pages, absorber une erreur de rejeu, purger un manifeste récemment référencé, ajouter après clôture, supprimer le contrôle de clôture, réintroduire l’ancien verrou vulnérable aux instantanés périmés.
- **Collecte réelle Polène/Ashby : 80 offres**, une réponse de 1 089 894 octets natifs. Les 82 blocs distincts, dont le manifeste, ont été relus dans l’archive Railway de test. Trois blocs nécessitaient encore un transfert depuis le stockage chaud ; les autres disposaient déjà d’une archive vérifiée.
- Rejeu de cette collecte avec le réseau du lecteur interdit : sorties et métadonnées identiques. La commande ops confirme aussi ce rejeu depuis l’archive et refuse une configuration modifiée.
- Métadonnées des reçus et configuration originale sauvegardées dans un dossier privé ; corps conservés dans le bucket de test. Les modifications utilisateur antérieures sont préservées.

Preuves : [validation](preuves/lot-5a-validation.json), [contre-épreuves](preuves/lot-5a-counterproofs.json), [collecte et archive](preuves/lot-5a-live-s3-replay.json), [commande ops](preuves/lot-5a-cli.json), [révision vérifiée](preuves/lot-5a-runtime-match.json), [préservation](preuves/lot-5a-preservation.json).

## Limites et suite

Ce manifeste prouve ce que le lecteur a produit ; il ne certifie pas à lui seul le portail ou l’exhaustivité du parcours. La certification des sources reste le chantier suivant, avec liaison à leur configuration, preuve d’accès, identité de l’employeur et qualification des publications natives. Le compteur saisi manuellement n’est pas encore supprimé de l’ancien parcours de promotion.

Le test réel porte sur un portail Ashby. Il ne démontre pas le rejeu de toutes les familles. Les paramètres temporaires ajoutés par l’ingestion, notamment les délais absolus et la progression mutable, doivent être séparés de la configuration durable au prochain lot.

La collecte est bornée à 100 000 sorties et chaque bloc à 20 Mo. Un dépassement est un échec explicite, jamais une troncature silencieusement certifiée. Le coût des verrous par collecte sera intégré aux essais de charge. Le contrat maintenu est dans [captures natives](../../docs/architecture/native-capture.md).
