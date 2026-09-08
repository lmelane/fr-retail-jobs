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
