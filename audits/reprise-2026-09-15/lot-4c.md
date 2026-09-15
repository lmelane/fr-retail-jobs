# Lot 4C — une présentation cohérente par publication

**Validé localement. Aucun déploiement ni changement de stock distant. Le stock historique et la sélection SQL restent des conditions de release.**

## Changement

Chaque `JobSource` conserve une projection complète de sa propre observation : titre, description, géographie, vocabulaire d’emploi, langue et dates. Cette projection est une donnée dérivée, versionnée et reconstructible ; le RAW et les sorties d’extraction restent les preuves. Les champs optionnels absents ne sont plus remplis par une autre publication.

La création, la réattestation et la réparation utilisent `publication/content.ts`. Le remplacement par la publication sélectionnée inclut les valeurs nulles ; l’ancienne fonction de remplissage partiel et ses tests de ce comportement sont supprimés. Les tests maintenus passent par les écritures réelles et vérifient les effacements, les corrections de texte, la priorité des sources et la conservation des observations.

La migration 55 ajoute `JobSource.presentation`. Elle invalide automatiquement une ancienne projection lorsque son RAW, URL, titre, date ou lien de capture change sans nouvelle projection. Le lecteur valide le format, l’identité de publication, les références de capture, l’empreinte des faits lorsqu’ils existent, les types, dates et montants. Il sélectionne explicitement les champs admis et refuse les URLs de candidature invalides ou contenant des identifiants de connexion.

## Changements de source

- L’ingestion conserve la projection propre de chaque publication, y compris secondaire. Le groupe utilise la totalité du contenu de celle sélectionnée.
- L’expiration et le retrait changent ensemble URL, texte, géographie et faits. Les changements structurants et de classement sont journalisés dans la même transaction.
- Les plans de maintenance incluent les empreintes de la présentation du groupe et des projections de publications. Une projection changée après préparation impose une nouvelle revue.
- Le réparateur de groupes reconstruit désormais les projections de tous les membres de la répartition, depuis leurs propres sorties d’extraction, dans la transaction de réparation.

Les catégories de métier restent des enrichissements distincts du contenu de publication. Elles sont recalculées depuis le titre et le département de la publication retenue avec le catalogue actif. La lecture publique ne récupère pas le classement d’une ancienne source. Une indisponibilité du catalogue de métiers conserve le parcours de lecture des offres, avec enrichissement indisponible.

## Lecture publique

Les listes, fiches et résultats similaires utilisent le contenu de la publication sélectionnée, avec ses propres faits et échéance. Une publication restante peut fournir son texte avant le passage du worker d’expiration. Une fiche historique utilise une publication conservée du groupe ; aucun repli sur l’ancien contenu partagé n’invente une présentation.

La sonde de statut vérifie aussi que la publication active est lisible. Une erreur de catalogue ou une projection manquante produit une indisponibilité temporaire ; la route renvoie 503 et `no-store`, au lieu de répondre artificiellement « active ».

## Périmètre restant avant release

La migration de schéma ne remplit pas le stock historique. Les captures conservées peuvent être rejouées par le plan de groupes. Le RAW historique qui contient encore les champs nécessaires doit recevoir un lecteur qualifié ; une preuve perdue demande une recollecte. Aucune mise en production de ce lecteur n’est admise avant qualification et remplissage du stock à servir.

La sélection SQL, les facettes et les suggestions reposent encore sur la projection `Job`. Leur remplacement par le catalogue commun de publications et le filtre strict du pays appartient au lot recherche ; une lecture de fiche cohérente ne vaut pas validation de ces filtres. La localisation actuelle des noms de villes et les dimensions d’emploi dérivées doivent aussi être revues dans leurs lots.

Les reprises du stock ancien, les caches et redirections du website, les deux origines d’offres et les opérations de release restent à valider. Le drainage d’une source retirée doit être vérifié jusqu’à l’absence de publication résiduelle, notamment après interruption ; la qualification des sources porte ce contrôle.

## Validation et audit défensif

- Base PostgreSQL 18 vierge : 55 migrations, 2 171 tests unitaires agrégateur, 455 tests d’intégration, 254 tests API et 5 tests Python, soit **2 885 tests réussis**. Deux tests optionnels de corpus restent ignorés. TypeScript et build API réussis ; aucune dérive de schéma. [Preuve de validation](preuves/lot-4c-validation.json).
- Neuf défauts TypeScript réintroduits séparément provoquent les échecs attendus : emprunt à une source secondaire, conservation d’une ancienne description, changement partiel à l’expiration ou au retrait, présentation API mélangée, fait non lié au RAW, projection changée après préparation, membre non réparé, faux statut actif. Restauration suivie de suites vertes. [Contre-épreuves](preuves/lot-4c-counterproofs.json).
- La désactivation contrôlée de l’invalidation SQL rend le témoin rouge ; restauration de la fonction puis suite verte. [Contre-épreuve SQL](preuves/lot-4c-db-counterproof.json).
- Répétition sur **118 extractions réelles archivées** : 79 Ashby et 39 Lever, provenant du stockage Railway de test. Deux groupes volontairement corrompus dans la base locale sont séparés ; 118 contenus propres puis 118 lectures API vérifiés, **aucun écart**. Ce scénario ne prétend pas que ces regroupements existaient en production. Réexécution idempotente. [Répétition](preuves/lot-4c-shadow.json).
- Commande d’exploitation réelle : préparation, application et seconde application sans nouvelle mutation ; plan privé en mode `0600`. [CLI](preuves/lot-4c-cli-smoke.json).

Les 118 projections représentent 736 425 octets JSON, avec un maximum de 12 969 octets par publication dans cet échantillon. Ce n’est pas une mesure de capacité mondiale. Les 86 fichiers de travail initiaux sont contrôlés : 85 identiques, et le manifeste npm conserve les trois scripts utilisateur avec les seuls changements de dépendances et de commande déjà livrés. [Préservation](preuves/lot-4c-preservation.json).
