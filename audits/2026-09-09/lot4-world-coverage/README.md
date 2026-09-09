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
