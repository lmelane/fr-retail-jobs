# Lot 4 — chantier en cours, premier lot de corrections qualifié

Point de contrôle du 9 septembre 2026. Ce document ne clôture pas le lot : une énumération complète du flux configuré ne certifie ni l'identité de l'employeur, ni tous ses portails mondiaux, ni la qualité de chaque champ.

## État avant

Photographie transactionnelle de production à 11:39:46 UTC : 77 352 offres conservées, dont 74 124 actives et 10 947 en France ; 1 571 lignes Company, dont 4 anciennes identités fusionnées ; 500 sources, dont 423 actives. Sauvegarde complète réalisée avant toute correction Lot 4, puis restaurée dans une base locale indépendante.

Les 423 sources actives ont toutes été réellement interrogées avec la version de référence : 305 flux déclarés complets, 118 incomplets ou non prouvés. Aucun test de charge. Les réponses sont conservées dans des archives privées avec reçus, horodatages et empreintes.

## Causes racines et corrections

- **Registre divergent** : la validation ne reconnaissait pas toutes les familles effectivement disponibles à l'ingestion. Le registre partagé couvre désormais les 43 types pris en charge ; 41 sources actives étaient omises par l'ancien chemin de validation.
- **Discovery trop anglophone** : lexique multilingue en données et lecture des liens dans `noscript`. Les noms, profils Unicode, alias et portails régionaux restent traçables. Une égalité de nom donne un candidat, jamais une certification.
- **Workable** : pagination native par curseur et comparaison des identifiants avec le widget. Les représentations multi-sites d'un même identifiant conservent leur RAW ; un conflit de contenu bloque la certification.
- **Recruitee** : validation stricte du flux public complet. Une erreur ou une ligne invalide ne devient plus silencieusement une liste vide.
- **Personio** : le flux XML public est lu sans filtre pays. Les fiches Next.js sont décodées sans exécuter leur JavaScript, y compris les références de textes et longueurs UTF-8. Seule la publication explicitement fournie est utilisée ; `created_at` ne devient pas une date de publication.
- **SAP SuccessFactors** : la fenêtre de pagination vient du composant natif, pas d'un incrément constant de 25. Les totaux par langue ne sont pas additionnés quand les mêmes offres sont traduites. Les locales vides explicites sont reconnues.
- **Compteurs SAP traduits** : le composant peut afficher « 101 à 100 sur 212 » ; son second nombre est un nombre de lignes, pas une borne absolue. Le parseur utilise `jobRecordsFound` et `jobRecordsPerPage`, indépendamment de la langue. Témoin réel : Aptar et Çalık.
- **Session SAP** : Adidas renvoyait des totaux et pages différents sans conservation de `JSESSIONID`. Une session RFC6265 isolée par source et par exécution stabilise la pagination. Aucun cookie n'est partagé entre sources ni enregistré dans les preuves métier.
- **Preuves d'énumération** : le pipeline conserve un événement structuré par source, avec les compteurs, identifiants et empreintes des pages disponibles. Les lignes rejetées sont également enregistrées. Le journal durable garde les détails ; la console reste bornée.
- **Coty / Puig** : des portails de groupe étaient rattachés à Escada Parfums et Jean Paul Gaultier. Le plan générique de changement de propriétaire garde les anciennes marques, les identifiants, les RAW et les historiques. Il impose une nouvelle certification et des alias attestés avant réactivation.
- **Stockage des corrections** : un document commun de preuve est conservé une fois, avec une référence dans chaque correction, au lieu de recopier tout le HTML des preuves pour chaque offre.

## Preuves après sur données réelles

Après superposition des nouvelles vérifications aux 423 sources initiales : **384 flux complets, 39 incomplets ou non prouvés**. Le détail avant/après, le commit et les limites sont dans `feed-qualification-checkpoint.json`. Ce sont des résultats sur plusieurs passes horodatées, pas un instantané simultané de tous les ATS.

Adidas : 1 093 identifiants uniques sur 1 093 annoncés avec la session conservée. Deux fiches restent sans description/date/localisation exploitable : l'exhaustivité de la liste ne masque pas leur qualité insuffisante.

Coty/Puig sur la copie fraîche : **386 offres réattribuées**, dont 377 actives ; les **77 352 identifiants** et les états actif/fermé sont conservés ; **386 représentations RAW inchangées** ; aucune fusion des deux marques avec leur groupe. Trois alias attestés sont ajoutés et les deux sources recertifiées. Les activités des groupes sont documentées séparément par la procédure de revue des secteurs.

La réingestion des deux sources récupère 357 offres et crée 7 offres nouvellement présentes à la source. Le rejeu suivant conserve 77 359 offres, sans identifiant perdu. Les deux passes terminent sans erreur d'ingestion. Ces preuves sont **locales**, pas des preuves de réparation en production.

Personio : la passe de 24 tenants, comprenant un tenant retiré, retrouve 263 offres. Trois dates demeurent absentes : deux détails répondent 404 alors que le XML les référence ; une candidature spontanée ne fournit pas de date de publication. Aucune date n'est inventée.

## Discovery et identité : restant à traiter

Le benchmark comporte **1 653 entrées / 1 670 libellés bruts**. Le rapprochement initial retrouve 630 candidats par nom ou alias et 695 candidats de site officiel dans les références disponibles. Ce ne sont pas 630 nouvelles identités certifiées.

L'investigation proactive a également extrait **275 observations de portefeuille dans huit groupes**, conservées dans `portfolio-observations-expanded.json`. Les relations peuvent être propriété, licence, participation ou activité ; aucune de ces observations n'active automatiquement une source. Le premier inventaire de 207 observations est conservé pour comparaison.

Les preuves de découverte sont encore en cours de qualification. Le suivi daté est dans `discovery-progress-checkpoint.json`. Il reste notamment la recherche des domaines non trouvés, l'examen des portails régionaux, les ATS non pris en charge et la validation métier des correspondances.

L'affirmation de l'employeur dans Personio révèle de mauvaises liaisons historiques possibles : Mateo / Mateo Estate, Hades / Hades Mining, Piña / Pina Earth, Samson / Samson & Partner, entre autres. Les 230 observations mises en revue comprennent aussi des variantes légales légitimes : elles ne représentent pas 230 erreurs prouvées. Le slug d'un tenant fonctionnel n'est jamais une preuve d'appartenance à une Maison.

Autres liaisons à revoir : le flux OTB actuellement rattaché à Maison Margiela et le flux Aptar Group à Aptar Beauty. Les localisations multiples sont conservées dans plusieurs RAW mais le modèle/front à pays unique peut encore omettre des pays secondaires. Ces fondations interdisent de déclarer le lot terminé ou de reprendre aveuglément toute l'ingestion.

## Tests et statut de livraison

1 547 tests unitaires, 235 tests d'intégration et 109 tests web passent. Les deux tests de corpus ignorés sur la base de test sont exécutés sur la copie réelle : les quatre contrôles SQL/corpus passent, y compris pays, contrats, secteurs multiples et réconciliation des agrégats. Typecheck agrégateur valide.

Au moment de ce point de contrôle : corrections commitées sur la branche Lot 4 ; **pas encore mergées ni déployées ; aucune donnée de production réparée**. Les preuves de déploiement et de réparation seront ajoutées séparément. **NO-GO pour clôture du lot et reprise mondiale sans qualification.**

## Sources primaires utilisées

- [Workable : API et page carrière](https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page).
- [Recruitee : endpoint des offres](https://docs.recruitee.com/reference/offers) et [flux de recrutement](https://docs.recruitee.com/docs/feed). La migration de l'authentification annoncée pour 2027 reste à anticiper.
- [Coty : portefeuille et lien carrière officiel](https://www.coty.com/our-brands/all-brands).
- [Puig : portefeuille et activités](https://careers.puig.com/love-brands).
- [Tough Cookie : implémentation RFC6265 et isolation des jars](https://github.com/salesforce/tough-cookie).

## Livraison du premier lot — production vérifiée

La [PR 49](https://github.com/lmelane/fr-retail-jobs/pull/49) est mergée. Les quatre services Railway sont en `SUCCESS` sur **b09c942ff6d71e43fca263d591f1458339e19a4e**. La commande normale de l'agrégateur a été restaurée et `PIPELINE_PAUSED=1` est maintenu pour l'ingestion mondiale.

Le plan Coty/Puig est désormais appliqué en production : 386 offres réattribuées, dont 377 actives ; 776 corrections traçables ; identifiants, RAW et états d'ouverture inchangés immédiatement après réparation. Trois alias ont été enregistrés, les deux sources existantes recertifiées, et les secteurs des deux groupes documentés. Le rejeu des trois plans produit zéro écriture supplémentaire.

Le véritable worker Railway a ensuite récupéré **131 offres Coty et 227 offres Puig**, deux flux complets, sans erreur. Il conserve les **77 352 identifiants préexistants** et ajoute 8 offres : **77 360 offres conservées, 74 132 actives, 10 952 en France**. Les compteurs API et les pages HTML filtrées concordent : Coty 136, Puig 262, Escada Parfums 0, Jean Paul Gaultier 1. Les compteurs actifs de la base ne sont pas les seuls résultats de cette passe : ils comprennent les autres sources et les offres encore dans leur délai de vérification de fermeture.

Le run conserve ses 15 événements dans le journal durable, dont les deux preuves d'énumération ; aucune erreur de persistance. Railway rapporte 16 lignes, au maximum 7 par seconde, sans avertissement de messages supprimés sur cette exécution ciblée. Toutes les preuves sont regroupées dans `production-remediation-proof.json`.

| Finding | Code corrigé | Main | Déployé | Données réparées | Preuve |
|---|---|---|---|---|---|
| Registre ingestion/validation divergent | Oui | Oui | Oui | Sans objet | 423 sources réellement testées, registre partagé |
| Discovery multilingue / Unicode / portails régionaux | Oui | Oui | Oui | Investigation en cours | Reçus et inventaire datés ; aucune activation automatique |
| Dates et fiches Personio | Oui | Oui | Oui | Pas encore en production | 24 tenants testés ; revue des identités encore nécessaire |
| Énumération Workable / Recruitee | Oui | Oui | Oui | Pas encore en production | Passes réelles et rejeu local ; ingestion mondiale suspendue |
| Énumération SAP / sessions / compteurs traduits | Oui | Oui | Oui | Coty/Puig seulement | Run Railway c38dc263-691c-4e2a-a3a4-19638ac534b3 |
| Coty/Puig attribués à une seule marque | Oui | Oui | Oui | Oui, 386 offres | Plan, diff, conservation et compteurs publics vérifiés |
| Preuves d'énumération perdues entre adaptateur et journal | Oui | Oui | Oui | Nouvelles exécutions | Deux événements complets persistés pendant le run Railway |
| Pays secondaires des offres multi-sites | Non | Non | Non | Non | Analyse des structures RAW à poursuivre |
| Homonymes Personio et autres portails de groupe | Partiel : contradictions exposées | Oui | Oui | Non | Revue métier/identité indispensable avant reprise |
| Exclusion du catalogue assimilée à une fermeture | Non | Non | Non | Non | 371 corrections historiques avec `closedAt` sans événement CLOSED |

Dernière cause racine identifiée : le retrait d'une source et l'exclusion métier utilisent encore des champs de fermeture. Une lecture de production retrouve **371 offres exclues pour homonymie avec `closedAt` et sans événement `CLOSED`**. L'agrégat des fermetures se base sur `closedAt` : ces exclusions peuvent donc entrer dans les statistiques de fermetures. Il faut séparer retrait de publication et fermeture constatée, conserver les preuves historiques et corriger cette confusion avant clôture du lot. Aucun nouveau cas d'homonymie ne sera traité par cette ancienne procédure.


## Second correctif livré : retrait du catalogue ≠ fermeture employeur

PR #50, main `1ccf8cbe6fef5dc25c16f5f73a69a1cb62db80e5`, quatre services Railway SUCCESS. 371 exclusions administratives réparées en production ; aucune modification de visibilité ou perte d’offre. Les 74132 offres actives et les 10952 offres France sont inchangées. Rejeu à zéro écriture, empreintes RAW/historiques/sources identiques. Voir [le rapport](withdrawal-lifecycle.md) et [les preuves de production](withdrawal-production-proof.json).

| Finding | Fixé ? | Commit applicatif | Main ? | Déployé ? | Données réparées ? | Preuve prod |
|---|---|---|---|---|---|---|
| Retraits administratifs comptés comme fermetures ; republications comptées comme reposts | Oui pour les écrivains identifiés | 146e6b0 | Oui, 1ccf8cb | Oui, 4 services | Oui, 371 reçus | withdrawal-production-proof.json |

La qualification des autres homonymes, des portails manquants et des flux incomplets continue. Ce checkpoint ne clôture pas le lot 4.

## Nouveau point de contrôle — Talent Recruiter / GANNI

Voir [le diagnostic, la correction et les preuves sur copie fraîche](talent-recruiter-ganni.md). La première passe automatisée porte désormais sur les 1 653 acteurs ; 278 candidats ATS et 98 ensembles de liens carrière restent à qualifier. Les 1 277 autres lignes nécessitent encore une recherche de site officiel ou de portail. Ces états de discovery ne remplacent pas les preuves d’identité et d’activation.

## Nouveau point de contrôle — EasyCruit / Lindex (reprise du 9 septembre, soir)

Voir [le diagnostic, la correction et les preuves de production](easycruit-lindex.md). Faux tenant Teamtailor retiré (7 annonces de démonstration, RAW et identifiants conservés), source officielle EasyCruit qualifiée et ingérée en production (41 postes, 0 France), deux corrections universelles trouvées en la mesurant : variantes officielles de pays CLDR et vocabulaire d'emploi nordique/balte/tchèque. Production après : 77 447 offres, 74 198 actives, 10 957 France ; workers toujours en pause. Sport 1, OTB, Aptar, Personio/Jako/KENT, les 115 investigations interrompues et les 38 dossiers de complétude restent à traiter.

## Point de contrôle — tracker v3 et Sport 1 (9 septembre, soir)

Voir [tracker-qualification.md](tracker-qualification.md) (sept verdicts séparés, avant/après sur données réelles) et [sport1-reachmee.md](sport1-reachmee.md) (11 annonces de démonstration retirées en production, 0 fermeture, portail ReachMee documenté sans activation). Backlog qualité des champs : [backlog-data-quality.md](backlog-data-quality.md). Production après : 77 447 offres, 74 187 actives, 10 957 France ; workers toujours en pause.
