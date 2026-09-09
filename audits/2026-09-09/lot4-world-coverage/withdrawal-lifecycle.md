# Lot 4 — Retrait du catalogue et fermeture employeur

## État avant et cause racine

L’audit en production du 9 septembre a retrouvé 371 offres retirées pour identité employeur hors secteur. Leurs reçus immuables `P0_EMPLOYER_HOMONYMS` démontrent une transition administrative active → inactive, accompagnée à tort de `closedAt`, sans événement `CLOSED`. Le calcul des fermetures à partir de `closedAt` les incluait.

La cause n’est pas limitée à ce lot historique : `retireSource` utilisait le même écrivain que les fermetures attestées ; ingestion et refresh considéraient toute réactivation comme `REOPENED`. Deux scripts historiques écrivaient aussi des fermetures sans preuve. La reconstruction des snapshots substituait `lastSeenAt` à une fermeture manquante.

## Modifications

- État de retrait explicite : `withdrawnAt` + `withdrawalReason`, séparé de `closedAt`. Contrainte SQL empêchant un retrait actif, fermé simultanément ou sans motif.
- Écrivain commun avec décision explicite `CLOSED` ou `WITHDRAWN`. Retirer une source conserve une fermeture déjà attestée et les offres soutenues par une autre source.
- Réattestation : `REPUBLISHED` pour un retrait ; `REOPENED` et incrément du compteur uniquement pour une fermeture datée.
- Une offre orpheline est retirée pour attestation manquante ; l’absence de preuve ne devient plus une fermeture.
- Les snapshots distinguent fin de présence au catalogue et fermeture employeur. Suppression de la date inventée à partir du dernier passage. Les périodes historiques indémontrables ne sont pas affirmées.
- Les anciens raccourcis de fermeture sont bloqués avec une orientation vers les procédures vérifiées.
- Page publique : « Cette offre a été retirée de notre catalogue. », maintien du 410/noindex et absence de JobPosting pour une offre retirée.
- Réparation historique fondée sur les reçus de correction, vérification des sources retirées, refus d’une fermeture ultérieure ou d’une ligne modifiée. Conservation des anciens reçus et événements ; nouveau reçu de correction append-only. Aucune offre réactivée.

## Preuves et métriques sur copie réelle

77359 offres sur la copie isolée ; 74131 actives ; 10951 France. Ces volumes diffèrent légitimement de la production après une publication Coty intervenue entre les deux collectes.

371 lignes concernées : fermetures datées 371 → 0 ; retraits explicités 0 → 371 ; actives 0 → 0. Identifiants, RAW, premier/dernier passage et autres champs métier inchangés. Réexécution du plan : zéro écriture. Aucune suppression.

Voir `withdrawal-local-proof.json` et `withdrawal-ui-proof.json`.

## Validation

1547 tests unitaires, 241 tests d’intégration, 4 tests SQL/corpus réel réussis. Build web et typecheck réussis. Vérification du rendu sur copie réelle à 390 et 1440 pixels : 410, noindex, aucun JobPosting, aucun débordement horizontal. Les tests couvrent fermeture réelle/réouverture, retrait/republication, conservation des offres multisources, concurrence de retrait, refus des états contradictoires et conservation des reçus.

## Statut de livraison

**Livré et vérifié en production le 9 septembre à 13:43 UTC.** PR #50 fusionnée ; commit main `1ccf8cbe6fef5dc25c16f5f73a69a1cb62db80e5` ; les quatre services Railway sont en SUCCESS sur cette révision. Migration additive appliquée avant la nouvelle application. Crons globaux toujours en pause.

Production : 77360 offres, 74132 actives, 10952 France avant et après. Les listes complètes des identifiants globaux et actifs ont les mêmes empreintes. Fermetures datées 3206 → 2835 ; retraits 0 → 371. Les 371 lignes corrigées conservent exactement leurs RAW, autres champs, sources rattachées et événements antérieurs. 371 nouveaux reçus immuables. Rejeu : zéro écriture. Trois pages publiques passent du libellé erroné « Expirée » au retrait du catalogue, toujours en 410/noindex sans JobPosting.

Voir `withdrawal-production-proof.json` pour les empreintes, reçus, sauvegarde, révisions et URL témoins. Le précédent correctif Coty/Puig reste documenté dans `production-remediation-proof.json`.

## Restant à faire

Auditer séparément les anciens événements CLOSED produits par d’autres retraits, sans réécrire une histoire sur simple absence de preuve. Les snapshots live déjà enregistrés ne sont pas écrasés par cette correction. Poursuivre la qualification mondiale : homonymes Personio, propriétaires OTB/Aptar, 39 flux dont l’exhaustivité reste non démontrée, localisations multiples et les 1653 acteurs FashionJobs. Ce correctif ne constitue pas une clôture du lot 4.
