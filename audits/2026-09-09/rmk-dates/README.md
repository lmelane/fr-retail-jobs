# Douglas : dates de publication localisées — 9 septembre 2026

## Avant : erreur reproduite, périmètre mesuré

Lecture PostgreSQL en transaction répétable et strictement read-only à 22:13 UTC le 8 septembre (00:13 Paris le 9). Sur les **192 représentations RMK** Douglas/Breitling : **13 dates erronées**, toutes Douglas `en_US`, et **179 inchangées** après rejeu. Les cinq dates futures n'étaient que la partie visible : huit dates inversées restaient dans le passé. Une des treize offres venait d'être créée par le run de minuit.

Exemples : `8/27/26` devenait 2028-03-08 ; `9/3/26` devenait 2026-03-09 au lieu de 2026-09-03. Les IDs, valeurs avant/après, URL et empreintes RAW figurent dans `measurement.json`. Le test avec les 13 témoins réels et les calendriers impossibles échoue avant le correctif : 21 échecs, 31 succès.

## Sens de la date et limites de la preuve

La ressource officielle `strings_en_US.js` déclare `common_dateformat: MM/dd/yyyy`. SAP explique que le tri Most Recent du **Unified Data Model** utilise la date de publication RCM : [KBA 3495707](https://userapps.support.sap.com/sap/support/knowledge/en/3495707). Ce portail utilise cette API et ce tri. Le champ `unifiedStandardStart` est donc traité comme la date de publication source, pas comme une date de prise de poste. L'affirmation contraire dans l'audit historique `apps/aggregator/data/audit-a1-canonicite.md`, I12, était non étayée et est remplacée par cette analyse sourcée.

Cette conclusion ne s'étend pas aux anciens sites RMK : SAP indique que leur date de référence peut être rafraîchie chaque mois ; le Unified Data Model est explicitement exclu de ce comportement ([KBA 2253054](https://userapps.support.sap.com/sap/support/knowledge/en/2253054)). La certification des dates de référence des autres sites SuccessFactors reste un chantier séparé. Nous ne reconstituons pas une première publication antérieure à un éventuel repost.

Le listing anglais américain courant expose **8 offres**, contre 13 représentations historiques encore actives en base. **Corriger leurs dates ne prouve pas l'ouverture des cinq autres offres.** Les réponses HTTP 200 de détail capturées peuvent être des coquilles HTML rendues côté client ; elles n'apportent pas de date indépendante. Ne pas assimiler absence d'un listing et fermeture de la réquisition sans revue des locales/liens de candidature.

## Correctif

- Locale enregistrée passée au parseur : formats explicitement observés `en_US`, `en_GB`, `de_DE`, `fr_FR`, `es_ES`, `pl_PL` ; format inconnu laissé non résolu.
- Validation exacte année/mois/jour : aucun débordement `Date.UTC` et aucune interprétation permissive d'une chaîne libre.
- Formats ISO explicites conservés, sans dépendance à l'heure courante ni à la locale de la machine.
- `rmkDateEvidence` conserve champ, valeur source, locale, version du parseur et résultat pour les prochaines ingestions. Le backfill ne modifie aucun RAW existant.

## Livraison et réparation

État à la préparation : correctif local, **1 421 tests unitaires réussis**, typecheck des deux applications réussi. Rejeu exhaustif des 192 RAW : 13 corrections, aucune nouvelle date inconnue. Aucun changement de production à ce stade.

`prepare-repair.mts` relit la production ou sa copie, exige le RAW archivé et la date avant attendue, refuse les représentations multiples non arbitrées, puis produit un plan atomique de **26 opérations** (13 Job et 13 JobSource). Les mécanismes de réparation existants verrouillent sources/entreprises, contrôlent toutes les avant-images, journalisent chaque correction et préservent les événements antérieurs. Une seconde application doit écrire zéro ligne.

La fusion, le déploiement et les preuves après production seront consignés ici une fois effectués. Aucun statut de fraîcheur ni offre active ne sera modifié par ce lot de dates.

## Répétition réalisée

Sauvegarde réelle : 298 512 153 octets, SHA-256 `a80d5ea438ec85a39c187034b28daa17622cb989a73e2421eac2c391bfec25c0`. Restauration sans erreur dans une nouvelle base locale dédiée. Plan appliqué : 26 écritures, 13 événements CORRECTED, aucun RAW ni événement historique modifié ; seconde application : zéro écriture. Voir `rehearsal-proof.json`, `rehearsal-receipt.json`, `rehearsal-idempotence.json`.

Commit applicatif `3231285`, PR https://github.com/lmelane/fr-retail-jobs/pull/29. Les deux contrôles CI du commit applicatif sont verts. Fusion volontairement différée tant que la collecte globale est en cours, pour ne pas déclencher son remplacement par un déploiement automatique. La production n'a pas encore été réparée.


## Réparation effectivement livrée le 9 septembre à 04:57 UTC

PR #29 mergée (`0f3f7e0`), puis PR #30 (`9763522`), image collecteur Railway `f96e7616-7db2-4da9-8819-e4277531a60e` construite avec succès. Aucune relance globale.

Après sauvegarde complète vérifiée de 358 928 504 octets (SHA-256 dans `production-backup.json`), le plan fraîchement reconstitué `ae45a23d59d75ed46f25986a04157bfc2b7f57b5eb21cf1874ef08604b443809` a réparé **13 Job + 13 JobSource**, avec **13 événements CORRECTED et 26 lignes de registre immuable**. RAW, historique original et autres champs métier préservés. Deuxième application : **0 écriture**.

Preuve SQL : `production-proof.json`, `production-receipt.json`, `production-idempotence.json`. Les offres actives portant une date future passent de **5 à 0** (`after-metrics.json`). Les 1 411 dates inconnues restent inconnues.

Preuve front : les pages ModeCareers des offres Douglas 1000 et 602 répondent 200 et exposent respectivement `datePosted=2026-09-03` et `2026-08-27` dans leur JobPosting (`front-proof.json`). Cette conformité de la date ne garantit pas l'indexation Google de chaque offre.
