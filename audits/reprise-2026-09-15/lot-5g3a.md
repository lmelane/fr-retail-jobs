# Lot 5G3A — préserver l’employeur nommé par l’offre

Date : **16 septembre 2026**. Périmètre : résolution d’employeur et provenance JSON-LD, localement. Aucune écriture de stock, migration nouvelle, activation, relance CRON ou modification de production dans ce lot.

## Défaut et décision

Le chemin SINGLE_BRAND pouvait remplacer un nouveau libellé natif par le propriétaire du portail, sans preuve propre à ce libellé. Le lecteur JSON-LD gardait aussi `hiringOrganization` dans le RAW sans transmettre son nom au résolveur : la présence d’un employeur dans l’offre devenait artificiellement une absence.

La certification d’un portail ne suffit plus à assimiler un nom explicite à son propriétaire. Un nom natif inconnu garde une identité propre à la source et son nom complet ; une relation revue peut ensuite le rattacher à une marque. Les identités déjà connues conservent les contrôles de conflit. L’inférence depuis le propriétaire est réservée à un employeur absent, avec une certification actuelle SINGLE_BRAND.

## Point de départ natif

Lectures seules du clone historique `catwalks_rehearsal_20260915`, schéma 65 :

- **6 243** publications `generic-listing` portent un RAW racine `JobPosting` avec `hiringOrganization` objet ; **6 238** ont un nom chaîne non vide. La [requête](preuves/lot-5g3a-native-jsonld.sql) et le [résultat](preuves/lot-5g3a-native-jsonld.json) conservent le contrôle de lecture seule, l’horodatage et des échantillons Alberto, Attaquer et Beiersdorf.
- L’[échantillon Mango](preuves/lot-5g3a-native-employer-sample.json) montre notamment les libellés natifs `MANGO Nederland BV`, `MANGO FRANCE, S.A.R.L.` et `MNG-MANGO U.K. LIMITED`. Ces noms ne prouvent pas, seuls, une marque différente.
- Les [dernières observations Mango](preuves/lot-5g3a-native-employer-observations.json) comptent **1 701** correspondances `REVIEWED_ALIAS`, **28** inférences de portail et **4** affectations `LEGACY_UNREVIEWED`. Les alias revus sont conservés ; le défaut supprimé concernait notamment les nouveaux libellés sans revue.

Ces nombres incluent l’historique et les publications inactives. Ils ne mesurent ni les offres disponibles ni le nombre d’employeurs indépendamment certifiés. Aucune de ces lignes n’a été réattribuée par ce lot.

## Implémentation

- `certifiedPortalIdentity` lit ensemble le registre et la dernière revue dans une seule requête SQL. Le propriétaire, sa clé, la révision et la revue proviennent de ce même instantané. `certifiedPortalScope` conserve son usage de lecture du seul périmètre.
- Les origines de catalogue et d’inférence de portail passent par ce contrôle **avant** toute recherche d’alias. Un alias du nom de catalogue ne prouve pas l’employeur d’une offre qui ne le nomme pas.
- Une inférence valide enregistre `CERTIFIED_SINGLE_BRAND_PORTAL` et l’identifiant de revue. MULTI_BRAND, absence de revue et changement de révision sont refusés. L’inférence ne peut remplacer un employeur déjà attribué.
- Un nom explicite inconnu reçoit la règle `NATIVE_SOURCE_LABEL`. Sa clé contient la source et son libellé normalisé ; la suppression heuristique des suffixes juridiques n’altère plus son nom stocké et ne suffit plus à bloquer sa création.
- Le lecteur JSON-LD transmet `hiringOrganization.name`, son chemin et sa règle, sans modifier le RAW. `publisher` ne devient pas employeur. Une organisation déclarée mais non résolue reste retenue sous `JSONLD_EMPLOYER_NOT_RESOLVED`.
- Le module de complément d’employeur est déplacé dans `identity/portalEmployer.ts`. L’ancien chemin et son test sont supprimés sans réexport de compatibilité. Un nom natif présent empêche de lever une retenue contradictoire d’employeur absent.
- Le commentaire de schéma et les documents maintenus ont été corrigés ; aucune migration SQL n’est nécessaire.

## Validation

Les [preuves de validation](preuves/lot-5g3a-validation.json) enregistrent les résultats finaux et les empreintes des fichiers vérifiés. La suite ciblée passe **160 tests** dans dix fichiers, avec PostgreSQL réel et les vrais parcours de capture, archivage, inspection et décision d’identité ; seul le transport HTTP des fixtures est simulé. La fixture HTML Kering déjà conservée exerce aussi la lecture native JSON-LD.

La première suite complète a échoué sur six scénarios : un témoin LVMH ne déclarait aucun employeur et cinq scénarios de récupération JSON-LD rencontraient la perte de `hiringOrganization`. Le témoin LVMH déclare maintenant le champ réel `maison`. Les réponses de récupération déclarent l’employeur explicitement, que le lecteur corrigé transmet. Aucun garde-fou de production n’a été relâché pour faire passer les tests.

**Résultat final : 3 424 tests réussis**, soit 2 473 unitaires, 681 d’intégration agrégateur, 259 API et 11 Python. Deux tests API facultatifs restent ignorés comme auparavant. Contrôles de types et build API réussis ; les 65 migrations sont rejouées depuis une base vide isolée.

L’[audit défensif](preuves/lot-5g3a-counterproofs.json) réintroduit treize défauts, séparément dans la copie de vérification :

1. abandon du nom JSON-LD ;
2. disparition de la retenue d’organisation non résolue ;
3. utilisation de l’éditeur comme employeur ;
4. rattachement automatique d’un nom explicite au propriétaire ;
5. écrasement d’un nom malgré une retenue contradictoire ;
6. inférence sur un portail multimarque ;
7. inférence sans revue ;
8. retrait du suffixe juridique du nom stocké ;
9. retenue déclenchée par la seule simplification heuristique d’un nom inconnu ;
10. remplacement de l’employeur existant par inférence ;
11. perte de la revue ayant autorisé l’inférence ;
12. contournement de certification par alias du nom de catalogue ;
13. perte du marqueur distinguant une inférence d’un nom natif.

Les treize mutations sont détectées, puis les **35 tests** des trois fichiers concernés repassent après restauration. Les fichiers de runtime et leurs octets sont identiques entre travail et vérification : [empreinte](preuves/lot-5g3a-runtime-match.json). Les seuls ajustements après les contre-épreuves concernent l’indentation d’un test et les documents ; la validation complète porte sur l’état final.

## Conservation et limites

La [vérification de conservation](preuves/lot-5g3a-preservation.json) retrouve les 86 fichiers utilisateur initiaux, avec les mêmes quatre exceptions déjà expliquées par les lots précédents et 82 fichiers exactement identiques. La sauvegarde privée `backups/reprise-20260916-lot5g3a` contient les fichiers du lot, leurs empreintes et le matériel de validation. Les modifications Ba&sh et les trois scripts utilisateur restent préservés hors de ce commit.

Ce lot ne certifie pas toute la chaîne de sources. Les alias historiques restent liés à un hash de configuration ; les règles d’affectation historiques, les rôles complets d’éditeur/groupe/employeur et les structures JSON-LD d’organisation non qualifiées restent à traiter. Les décisions d’accès immuables, le contrôle des sources déjà actives et les autres familles ATS restent ouverts. La production n’a pas été déclarée prête ni déployée.
