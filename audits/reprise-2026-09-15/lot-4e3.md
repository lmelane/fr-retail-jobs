# Lot 4E3 — Répétition sur une copie complète du catalogue

**Migration et audit du stock validés localement. Aucune reprise des échéances appliquée : l’audit révèle un contrôle d’identité à ajouter avant cette étape.**

## Copie cohérente et environnement séparé

Un export PostgreSQL complet, obtenu avec une connexion distante forcée en lecture seule, a été restauré dans une base locale dédiée. L’archive privée fait **561 610 102 octets** ; son empreinte est conservée dans les preuves. Le catalogue contient **87 580 offres**, **90 764 représentations**, **85 327 représentations actives** et **137 324 observations**.

La base de répétition possède un nom distinct des bases de tests jetables. PostgreSQL utilise un réseau interne et un stockage sur le disque hôte, car le disque interne Docker ne disposait que d’environ 4,9 Go libres. Un relais SQL lié à `127.0.0.1` permet les contrôles locaux. Aucun worker applicatif n’est lancé sur cette copie. Les conteneurs préexistants sont conservés.

Les captures natives des validations précédentes, dont les 34 pages Fenwick, ont également été sauvegardées dans une archive locale privée séparée. Elles ne sont pas confondues avec le catalogue distant. [Sauvegarde des captures de validation](preuves/lot-4e3-native-backup.json).

## Migration du stock historique

Les **11 migrations en attente** s’appliquent : la copie passe de 44 à **55 migrations**. Les empreintes SHA-256 du contenu, des identités et des horodatages contrôlés sont identiques avant/après pour `Job`, `JobSource` et `SourceObservation`. Les volumes sont identiques. Le contrôle Prisma ne trouve aucune dérive de schéma. [Avant](preuves/lot-4e3-before-migrations.json), [après](preuves/lot-4e3-after-migrations.json).

La conversion des salaires en décimal prend **59,8 secondes** dans cette configuration locale. Les autres migrations prennent chacune moins de 2,1 secondes. Cette mesure impose de prévoir le verrouillage de table et la fenêtre de déploiement ; elle ne prédit pas la durée sur Railway. [Durées par migration](preuves/lot-4e3-migration-timings.json).

## Inventaire complet, historiques inclus

Le rejeu hors réseau de chaque représentation trouve **52 189 présentations reconstructibles**, dont les **50 128 actives** déjà identifiées dans le snapshot initial. **50 236 groupes** ont tous leurs membres reconstructibles, dont **49 132 groupes actifs**. Cette propriété ne vaut pas validation de leur déduplication : les preuves de rapprochement et les changements de cycle de vie restent à examiner avant réparation. [Inventaire complet](preuves/lot-4e3-stock-inventory.json).

Les **441 représentations sans entrée dans le registre** appartiennent à la clé historique `iwc-schaffhausen-3` ; elles sont toutes inactives. Les **60 offres sans représentation** sont également inactives ; **59 sont des redirections**. Elles ne doivent donc pas être supprimées en bloc : les anciennes URLs ont une fonction de résolution à préserver. Aucune source retirée du registre ne possède de représentation active dans cette copie. [Restes historiques](preuves/lot-4e3-legacy-remainder.json).

## Garde-fou manquant révélé sur les échéances

Le lecteur trouve **6 149 déclarations d’échéance** dans l’ensemble historique, dont 254 passées à l’instant de référence du 15 septembre à 00:00 UTC et 158 hors plage de stockage.

Parmi ces déclarations, **2 934** appartiennent à une publication entièrement reconstructible ; **5** autres passent les contrôles d’identité mais manquent de texte. Les **3 210 restantes** ne passent pas encore la vérification complète de leur identité native ou de leur état :

- 1 533 nœuds génériques sans URL native conservée ;
- 1 511 pages iCIMS dont la relation entre hub et domaine de détail reste à qualifier ;
- 159 détails Workday sans correspondance d’URL actuellement reconnue ;
- 6 correspondances Phenom refusées ;
- 1 publication Workday retenue hors publication.

Ces nombres ne prouvent pas que les dates sont fausses. Ils montrent qu’un chemin de date qualifié ne suffit pas, à lui seul, à rattacher cette date à la bonne publication.

La prévisualisation du moteur 4E2, exécutée en lecture seule sur les 536 sources connues, parcourt **90 323 lignes en 362 pages** et propose les 6 149 écritures, sans demande d’examen. Elle ne couvre pas les 441 lignes sans registre. **Aucun de ces plans n’a été appliqué.** Cette contre-vérification sur données réelles révèle la limite à corriger : la reprise doit lier l’échéance à une preuve d’identité, distincte de la seule extraction du champ. [Prévisualisation non appliquée](preuves/lot-4e3-expiry-preview.json).

## Suite et validation

Le sous-lot suivant ajoutera cette liaison aux captures natives ou aux identités vérifiables dans le RAW conservé. Les formats et relations de domaines non qualifiés devront produire une demande d’examen explicite. La répétition reprendra ensuite sur la même copie, avant réparation des groupes et remplissage des présentations.

Ce sous-lot ne modifie aucun code d’exécution. La suite complète de **3 043 tests** reste celle du lot 4E2 ; elle n’est pas présentée comme ayant été relancée ici. Les nouveaux contrôles portent sur l’export/restauration, les 11 migrations, les empreintes, le schéma et l’inventaire exhaustif. [Validation et empreintes des journaux](preuves/lot-4e3-validation.json). Le lot 4 reste ouvert ; aucune bascule de production n’est autorisée par le seul succès de la migration locale.
