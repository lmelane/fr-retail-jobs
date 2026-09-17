# Lot 5D : validation technique native et porte de promotion

16 septembre 2026. Validation locale, clone complet et archive Railway isolée. Aucune écriture de production, aucun push et aucun cron activé.

## Changement livré

Une décision `SourceValidation` est liée à une révision immuable du registre, une collecte de format 2 scellée, son manifeste, le lecteur actuel et une politique explicite. Son rapport compte les offres observées, qualifiées, retenues et rejetées. Les compteurs proviennent du rejeu des réponses natives ; aucun argument de volume fourni par un opérateur ne crée cette décision.

Le validateur rejoue le véritable adaptateur hors réseau, compare toutes ses sorties et métadonnées, puis contrôle le RAW propre à chaque publication avec son lecteur qualifié. Il refuse notamment les résultats tronqués, les identifiants dupliqués, les lignes rejetées masquées par un sous-ensemble lisible, les contenus insuffisants et les archives devenues inaccessibles. Les erreurs enregistrées ne recopient ni configuration ni secrets contenus dans une exception.

Un résultat vide exige une preuve native distincte. Le protocole actuellement qualifié est le flux public Ashby : réponse complète HTTP 200, version 1, tableau natif `jobs` vide et rejeu exact. Un simple `jobs: []` produit par un autre lecteur reste insuffisant. La présence d’offres qualifiées ne constitue pas une preuve d’exhaustivité : le rapport conserve `UNKNOWN` lorsque nécessaire et **n’accorde jamais de droit d’attester une absence**.

La promotion requiert maintenant la dernière décision native valide de la révision courante. Le lecteur et la politique doivent correspondre ; la capture doit dater de moins de 24 heures. Revalider une ancienne capture ne la rajeunit pas. Un rejet ultérieur invalide le succès précédent pour cette porte. L’ordre SQL d’enregistrement évite de départager deux décisions par une horloge de précision milliseconde ou un UUID aléatoire.

Le compteur manuel n’autorise plus la promotion : le témoin à **9 999** est refusé sans capture qualifiée ; celui à **0** peut être promu avec une preuve native suffisante. Les contrôles d’identité et d’accès demeurent distincts et obligatoires. Une tentative de collecte plus récente, même échouée ou inachevée, interdit aussi de réutiliser un succès antérieur. La migration 61 donne aux nouvelles tentatives un ordre SQL indépendant des corrections d’horloge ; aucune chronologie n’est inventée pour les anciennes captures, qui exigent une recollecte avant promotion. L’écriture d’une validation et la promotion prennent les verrous du registre ; une modification SQL concurrente doit attendre.

La commande maintenue `raw-capture.mts` permet désormais de collecter une source enregistrée et de la qualifier, ou de revalider une capture archivée. Elle demande un mode d’écriture explicite, refuse les options ambiguës et retourne un code d’erreur sur rejet. La source demeure dans son état initial. Une collecte vide conserve son identifiant ; cet identifiant ajouté après scellement ne modifie pas les métadonnées du manifeste.

## Validation et audit défensif

- **3 290 tests réussis** : 2 409 unitaires, 617 d’intégration, 259 API et 5 Python ; deux tests API optionnels ignorés.
- **98 tests ciblés**, TypeScript et build API réussis ; migrations 60 et 61 vérifiées depuis une base vide.
- **13 mutations applicatives détectées** : suppression de la porte native, du verrou de promotion, de la comparaison exacte, de la qualification du contenu, des contrôles de troncature et de doublons ; zéro inventé ; lecteur/politique ignorés ; capture périmée acceptée ; ancien succès sélectionné malgré un rejet ; ordre fondé sur l’horloge ; tentative plus récente ignorée ; ancienne capture sans ordre connu acceptée. Après restauration : **44 tests réussis**.
- **5 contre-épreuves SQL** : modification et suppression d’une décision, capture d’une autre révision, capture non scellée et falsification de l’ordre d’une tentative. Désactiver chaque trigger rend l’écriture interdite possible. Les modifications des lignes et les changements de triggers sont annulés par transaction. Les séquences PostgreSQL peuvent conserver des trous après une tentative annulée ; leurs valeurs servent à ordonner les tentatives, jamais à compter des offres.
- Cas A → B → A, capture future, rejet plus récent avec horodatage antérieur, lecture d’archive impossible, collecte vide et verrou de promotion concurrent couverts.

Une collecte réelle Polène/Ashby produit **80 offres qualifiées**. Les **82 blocs** sont relus depuis l’archive Railway ; le validateur hors réseau retrouve exactement le verdict obtenu avant archivage. Une seconde collecte réelle par la CLI qualifie également 80 offres sous la même révision, avec une nouvelle identité de capture. La CLI refuse le compteur manuel et les écritures sans mode explicite ; un fichier de sortie préexistant retrouve les permissions `0600` avant réception des données.

L’audit a aussi fermé le cas d’une nouvelle collecte échouée laissant un ancien succès disponible. Une première contre-épreuve de l’ordre historique a révélé un test trop permissif : le message Prisma recopiait l’extrait de code contenant le texte attendu. Les refus de cette porte ont maintenant des codes d’erreur explicites et les tests contrôlent ces codes, sans reconnaître du texte issu d’une autre erreur.

Le helper d’export des reçus avait employé `blobHash` au lieu du champ `RawBlobArchive.hash`, après réussite de la capture et des deux validations. L’export privé a été corrigé et récupéré depuis la preuve existante, sans modifier les captures. L’ordre SQL a également été ajouté au brouillon initial de migration sur la seule base de test ; le clone a reçu directement la version finale.

## Stock, sauvegarde et préservation

La migrations 59 → 61 n’altère aucune ancienne colonne des **87 607 offres**, **90 764 publications**, **141 933 observations** et **536 sources**. Les identifiants et payloads des 536 révisions restent exacts. Le clone conserve zéro collecte et zéro décision native : aucune qualification historique n’est fabriquée.

Une nouvelle sauvegarde complète du schéma 60 conserve aussi les révisions du registre, avec leur identité exacte. Elle est restaurée intégralement dans une base temporaire distincte ; les empreintes SQL du stock, du registre et de ses révisions sont comparées à l’original. La base temporaire est supprimée après vérification. La reprise depuis cette sauvegarde nécessite ensuite la migration 61, également vérifiée sur le clone complet et depuis une base vide. Les 9 025 captures antérieures de la base technique, dont trois collectes réelles archivées, conservent un ordre inconnu explicite après migration. La sauvegarde et les reçus natifs restent privés.

Sur les 86 fichiers initiaux de l’utilisateur, 84 restent strictement identiques. L’exception de dépendances du package reste celle des lots précédents. Le test `sourceStore.test.ts` est cette fois intégré volontairement : sa modification initiale qui calcule le volume attendu depuis le vrai catalogue est conservée textuellement, et sa copie originale exacte est sauvegardée avant adaptation des tests de promotion. Les autres modifications initiales restent hors de ce commit.

Preuves : [validation](preuves/lot-5d-validation.json), [mutations applicatives](preuves/lot-5d-counterproofs.json), [gardes SQL](preuves/lot-5d-sql-counterproofs.json), [collecte et archive](preuves/lot-5d-live-s3-replay.json), [CLI](preuves/lot-5d-cli.json), [stock](preuves/lot-5d-stock-migration.json), [sauvegarde](preuves/lot-5d-backup.json), [restauration](preuves/lot-5d-restore.json), [ordre historique non inventé](preuves/lot-5d-attempt-order-migration.json), [runtime vérifié](preuves/lot-5d-runtime-match.json), [préservation](preuves/lot-5d-preservation.json).

## Conditions restantes avant release

Ce lot ferme la porte de promotion fondée sur un compteur manuel. Il ne certifie pas les 536 sources existantes ni l’ensemble du cycle de publication. Le parcours unique d’ajout, la suppression des anciennes orchestrations et de leur colonne de volume, les preuves d’identité et d’accès liées à la révision, le contrôle des sources déjà actives à l’ingestion, la fermeture par absence dans un même périmètre et les références privées des secrets restent à terminer. Une empreinte locale ne vaut pas automatiquement qualification de la release Railway. Aucun statut global « production-ready » n’est déduit de ce lot.
