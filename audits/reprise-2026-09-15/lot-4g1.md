# Lot 4G1 — Présentations reconstruites et plans conservés sans arrondi

**Validé le 16 septembre 2026 sur la copie locale complète. Aucune écriture de production.**

## Reconstruction depuis le RAW

La réparation de groupes relit désormais chaque RAW avec le lecteur actuel, y compris lorsqu'une ancienne sortie d'adaptateur est archivée. La capture prouve la provenance ; elle ne prouve pas que l'ancien lecteur était correct. Une retenue d'origine, un adaptateur incohérent ou un RAW insuffisant restent bloquants. Le plan version 3 distingue l'empreinte du corps archivé (`captureOutputHash`) et celle de la reconstruction actuelle (`outputHash`). L'ancienne fonction de réhydratation devenue inutilisée est supprimée.

Le chargement d'archives reste antérieur aux verrous d'écriture. Si un autre processus termine le plan pendant qu'une lecture froide échoue, la réparation vérifie le journal de complétion avant de déclarer l'échec. Le rejeu d'un plan terminé ne dépend plus de la disponibilité de l'archive.

## Cohorte revue

La prévisualisation complète traite les 51 661 groupes dont tous les membres sont reconstructibles. Elle produit **2 446 plans**, couvrant **51 392 groupes et 51 847 publications**. Elle refuse **269 groupes** dont le rapprochement historique n'a pas de preuve native compatible entre chaque paire. La cohorte appliquée ne déplace aucune publication et ne crée aucune redirection. La prévisualisation contient 191 fermetures fondées sur les échéances natives déjà prouvées et reprises par les lots 4F1/4F2. L’application en compte **192**, après revue d’une échéance Luhta passée entre les deux étapes.

Chaque nouvelle version de plan est comparée à l'empreinte de sa prévisualisation précédente en neutralisant uniquement les métadonnées de version du plan et du lecteur. Les valeurs et identités doivent rester identiques. Un passage d’échéance exige la revue restreinte décrite ci-dessous ; les autres changements de disponibilité restent refusés. Le plan complet est écrit et synchronisé sur disque avant son application.

## Défaut révélé par le stock réel

La première répétition s'est arrêtée après 276 plans terminés : le plan suivant contenait la latitude `48.775130000000004`, arrondie à `48.77513` pendant sa conversion JSON par Prisma. La comparaison d'empreinte a refusé ce plan avant toute modification de ses offres.

Les plans sont maintenant transmis comme texte JSON paramétré à PostgreSQL puis relus et comparés. Les réparations de groupes et de faits utilisent le même principe pour leurs caches et leur journal. Les coordonnées SQL sont écrites depuis leur représentation textuelle. Le miroir RAW de la Job est copié directement depuis sa publication en base. Le réparateur de faits relit les coordonnées SQL en texte pour éviter qu'un arrondi de lecture propose continuellement la même correction. Ces changements ne modifient pas la fonction d'empreinte ni les octets des captures natives.

Une deuxième garde a arrêté un plan dont l'échéance Luhta est passée entre la prévisualisation et l'application : `2026-09-15T23:59:59+03:00`, soit `20:59:59Z`. La revue retrouve l'empreinte initiale en remettant uniquement `CLOSE` à `KEEP` et `isActive` à `true` ; tous les autres champs et toutes les empreintes d'entrée correspondent. Le RAW et le cache d'expiration concordants sont relus avant de sauvegarder le nouveau plan. Toute autre différence reste refusée. Le nombre final de fermetures inclut ce seul passage d’échéance explicitement revu.

Les 277 plans sauvegardés et 276 relevés de correction de la tentative interrompue sont conservés dans une archive privée. La copie locale a été restaurée depuis la sauvegarde précédant les présentations : **168 199 ms**, empreintes initiales retrouvées. Les tables immuables n'ont pas été déverrouillées ni réécrites pour contourner leur protection.

## Contrôles de sortie

La suite complète passe : **3 102 tests** (2 317 unitaires, 526 d’intégration, 254 API et 5 Python), deux tests API optionnels ignorés. Le typage et le build API passent. Les **224 tests ciblés** et **neuf contre-épreuves** couvrent l'ancien lecteur erroné, le mauvais hash d'archive, les retenues, le type d'adaptateur, une complétion concurrente et les arrondis de persistance/lecture. Le contrôle final exhaustif relit **2 446 plans, 51 392 groupes et 51 847 présentations**, sans écart, en **110 518 ms**. Les neuf publications issues des archives natives Ashby, Lever et Volcanic sont également reconstruites et rejouées avec le lecteur actuel.

L’essai avec trois employeurs concurrents a épuisé le budget de trois tentatives sérialisables (`40001`, erreur observée à l’insertion du journal). Les plans terminés ont été conservés ; la répétition complète est passée en série. Ce test ne valide pas le débit en parallèle.

Une interruption réelle par `SIGTERM` après **120 plans et 2 986 groupes** est suivie d’une reprise depuis les plans synchronisés sur disque. La dernière invocation reconnaît **666 plans déjà appliqués**, puis termine les 2 446 plans. Chaque plan est rejoué sans écriture supplémentaire. Les RAW, identités, dates d’attestation, observations immuables et offres hors périmètre gardent leurs empreintes. Aucune capture, décision de rattachement ou redirection n’est créée ; seuls les 192 événements de fermeture prévus sont ajoutés.

La vérification finale compare chaque présentation, ses faits et chaque champ projeté au plan sauvegardé. Toutes les présentations publiques sont lisibles et les 51 392 miroirs RAW correspondent à leur propre publication. Les champs natifs des publications sont également identiques dans les journaux avant/après. Les coordonnées sont comparées à leur valeur SQL exacte ; **51 conversions Float de lecture Prisma** arrondissent la valeur, sans différence dans le stockage SQL vérifié. Les snapshots de Job lus par Prisma restent soumis à cette limite de lecture ; le contrôle des autres parcours numériques demeure ouvert.

La base passe de **3 089 028 799 à 6 345 414 335 octets**. Les journaux complets avant/après contribuent à ce coût : leur capacité et leur rétention devront être mesurées avant la release. Aucun débit parallèle n’est déclaré validé.

## Preuves

- [Tests, contre-épreuves et contrôles de sortie](preuves/lot-4g1-validation.json)
- [Application et rejeu des 2 446 plans](preuves/lot-4g1-stock-apply.json)
- [Vérification exhaustive en lecture seule](preuves/lot-4g1-stock-verification.json)
- [Interruption réelle](preuves/lot-4g1-controlled-interruption.json) et [reprise exacte](preuves/lot-4g1-resumption.json)
- [Revue de l’échéance passée](preuves/lot-4g1-elapsed-deadline-review.json)
- [Restauration après le défaut numérique](preuves/lot-4g1-restoration-proof.json)
- [Essai concurrent non qualifié](preuves/lot-4g1-concurrency-probe.json)
- [Conservation des travaux locaux d’origine](preuves/lot-4g1-preservation.json)

## Limites conservées pour la suite

- Les 269 groupes non prouvés exigent une qualification d’identité supplémentaire ou une répartition justifiée. La comparaison native trouve 222 groupes Workday portant le même tenant et identifiant de réquisition, 24 groupes Workday contenant des réquisitions distinctes, et 23 groupes Teamtailor sur deux domaines dont la relation reste à qualifier. Ce constat n’est pas une autorisation automatique de fusion. Les publications reconstructibles appartenant à des groupes mixtes restent hors de cette cohorte.
- Les formats insuffisants, les anciennes pertes de contenu, les 3 051 échéances non qualifiées et les 441 publications historiques sans registre restent à traiter.
- Les 59 redirections historiques sont préservées. Aucun alias ou pays n'est inventé pour augmenter artificiellement la couverture.
- La vérification de précision numérique des autres parcours de collecte et de persistance reste un critère de release ; cette correction ne certifie pas tous leurs accès Prisma.
- Les requêtes de recherche, filtres, coexistence des offres natives, UX/UI, contrats pays/langue, sécurité et déploiement restent dans les lots suivants. Le stock local réparé n'est pas une bascule de production.
