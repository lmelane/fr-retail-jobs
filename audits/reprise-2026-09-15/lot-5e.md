# Lot 5E : revues d’identité liées à la révision du registre

16 septembre 2026. Travail local et répétition sur clone. Aucune écriture de production, aucun push et aucun cron activé.

## Changement livré

Une revue de portail n’est valable que pour la révision exacte examinée. Le dossier doit fournir `sourceRevisionId` ; la commande ne le complète pas depuis l’état courant. L’écrivain prend le verrou de source, relit la configuration depuis le texte JSON SQL et compare la révision avant d’enregistrer la preuve. Le trigger de base refuse aussi une révision absente, étrangère ou remplacée lorsqu’une écriture SQL contourne l’application.

Chaque nouvelle revue reçoit un ordre SQL **après acquisition du verrou de source**. Une contradiction plus récente prime donc sur une validation, même avec un horodatage de dossier antérieur. L’appelant ne peut pas imposer son propre ordre. Une séquence allouée avant le verrou pouvait classer deux transactions concurrentes dans le mauvais ordre ; la contre-épreuve reproduit précisément ce défaut.

Un retour A → B → A ou un changement de `jobUrlPattern` invalide la revue ancienne, même lorsque le hash historique reste identique. Ce hash reste utilisé par les candidats et alias existants ; sa sémantique n’est pas changée silencieusement pour ces autres consommateurs. La preuve d’identité du portail est désormais liée à `SourceRevision`.

Le périmètre SINGLE_BRAND/MULTI_BRAND lit le registre et sa dernière décision dans une seule requête SQL, puis applique le validateur strict commun à la promotion. Les rapports opérationnels et les inventaires suivent le même contrat. Ils lisent également la configuration depuis son texte SQL pour éviter les différences de hash dues au décodage numérique du pilote. Les composeurs Python n’accordent plus de certification par repli sur le hash d’un ancien snapshot ; ils exigent le verdict strict, la révision exacte et l’ordre enregistré. Les séquences exportées en JSON sont des chaînes afin de conserver leur précision.

La CLI `identity-profile` expose la révision à examiner. `review-source-identity` conserve son mode prévisualisation ; `--apply` enregistre une revue sans activer la source. Les anciens dossiers dépourvus de révision échouent explicitement. La répétition d’un même dossier retrouve son identifiant déterministe sans créer de nouvelle décision. Elle ne peut pas remettre un ancien VERIFIED devant une contradiction plus récente ; le résultat indique si la décision est encore la dernière. Une régression reproduit ce défaut avant correction. Les anciennes orchestrations restent à remplacer par le parcours unique du sous-lot suivant.

## Vérification et audit défensif

- **3 310 tests réussis** : 2 410 unitaires, 630 d’intégration, 259 API et 11 Python ; deux tests API optionnels ignorés.
- **117 tests ciblés**, contrôles TypeScript, disposition des fichiers, build API et migrations depuis une base vide réussis.
- **9 mutations applicatives détectées** : révision ignorée, ordre historique inconnu accepté, dates utilisées pour départager les décisions, lecture de périmètre fondée sur ces dates, validateur de périmètre supprimé, verrou d’écriture supprimé, rattachement automatique d’un ancien dossier recherche limitée aux décisions VERIFIED et réinsertion d’un dossier identique. Après restauration : **19 tests réussis**.
- **7 contre-épreuves SQL** : révision manquante, étrangère ou obsolète ; modification de la révision ou de l’ordre ; suppression d’une revue ; ordre imposé par l’appelant. Désactiver le trigger concerné permet l’écriture interdite. Toutes les lignes et modifications de triggers sont annulées par transaction. Les trous de séquence restent possibles et ne sont pas un compteur métier.
- **Une contre-épreuve SQL concurrente supplémentaire** déplace l’allocation de séquence avant le verrou. Le test échoue ; la fonction SQL est restaurée exactement et le test repasse. Cette opération concerne uniquement la base technique jetable.
- La CLI réelle est exercée sur un témoin synthétique isolé : profil, prévisualisation sans revue, enregistrement, refus du dossier devenu obsolète et enregistrement explicite de sa nouvelle révision. La source reste DRAFT. Ce témoin ne certifie aucun portail réel.

La relecture initiale a corrigé deux affirmations obsolètes : les revues étaient **déjà immuables** en SQL, et `certifiedPortalScope` appelait **déjà le validateur strict**. Ce lot réutilise ces protections ; il ferme leur absence de liaison à la révision et leur dépendance à l’horloge pour départager les décisions.

## Conservation du stock

La migration 61 → 62 conserve les empreintes de toutes les anciennes colonnes des **87 607 offres**, **90 764 publications**, **141 933 observations**, **536 sources**, **536 révisions** et **112 revues d’identité** du clone. Aucune ancienne preuve ne reçoit de révision ou d’ordre inventé. Les 112 revues historiques restent consultables, avec ces deux champs `NULL`, et ne certifient pas le registre actuel.

Le trigger d’immutabilité existant reste actif. Le clone conserve zéro capture native, sans fabrication de qualification. La sauvegarde complète du schéma 60, restaurée et vérifiée au lot 5D, reste conservée ; sa reprise demande désormais les migrations 61 et 62. Aucune nouvelle restauration complète n’est revendiquée dans ce lot.

Les 84 fichiers initiaux non concernés restent exacts. Le package garde son exception de dépendances des lots précédents et ses trois scripts utilisateur hors commit. La modification utilisateur de `sourceStore.test.ts`, intégrée au lot 5D avec sauvegarde exacte, reste conservée textuellement.

Preuves : [validation](preuves/lot-5e-validation.json), [mutations applicatives](preuves/lot-5e-counterproofs.json), [gardes SQL](preuves/lot-5e-sql-counterproofs.json), [ordre concurrent](preuves/lot-5e-sql-order-counterproof.json), [CLI](preuves/lot-5e-cli.json), [stock](preuves/lot-5e-stock-migration.json), [runtime vérifié](preuves/lot-5e-runtime-match.json), [préservation](preuves/lot-5e-preservation.json).

## Limites et suite

La liaison à la révision ne prouve pas que la page officielle désigne le portail ATS exact. La validation de cette relation, les rôles employeur/groupe/éditeur, les preuves d’accès, le parcours unique et la suppression du compteur manuel restent à terminer. Il faut aussi contrôler les sources déjà ACTIVE à l’ingestion, l’ordre de collectes concurrentes et la fermeture par absence dans un même périmètre. Les sources historiques ne sont pas déclarées certifiées par cette migration ; ce lot ne constitue pas une validation globale de production.
