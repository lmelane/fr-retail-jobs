# Lot 1 — identité employeur

État de ce dossier au premier commit : audit mesuré en production, correctif développé et répété sur copie restaurée. Les corrections de production ne sont pas encore appliquées. Le journal de livraison ci-dessous sera complété après déploiement et vérification.

## Mesures initiales

| Mesure | Production avant |
|---|---:|
| Fiches Company | 1 571 |
| Fiches avec au moins une offre, active ou fermée | 1 228 |
| Fiches avec des offres actives | 1 047 |
| Offres, tous états | 77 322 |
| Offres actives | 74 113 |
| Représentations JobSource | 80 348 |
| Alias enregistrés | 6 |
| Alias consommés par la résolution d’ingestion | 0 |
| Fiches avec un chiffre dans le nom | 24 |
| Paires candidates à examiner | 418 |
| Paires candidates avec des offres actives des deux côtés | 51 |
| Paires rapprochées par l’ancien normaliseur | 349 |
| Types d’entreprise UNKNOWN | 1 534 |
| Relations parent sous forme de texte | 163 |

582 libellés RAW distincts ont été retrouvés sur neuf chemins de champs explicitement inventoriés, dans 79 sources. **C’est une borne inférieure mesurée, pas le nombre exhaustif des libellés historiques.** Le détail Workday n’était pas conservé ; certains autres RAW utilisent des structures différentes. L’inventaire conserve le rôle du champ : une organisation de groupe ne devient pas une marque par simple renommage.

Les 418 paires sont des **candidats**, pas 418 doublons prouvés. Un domaine partagé peut désigner un groupe et plusieurs Maisons. Une partie importante des rapprochements concerne des fiches historiques sans offre active. Voir `before.json`, `companies-before.csv` et `raw-label-inventory.json`.

## Causes établies

1. **Les quatre exemples numériques ne sont pas stockés ainsi.** Les Company s’appellent Promod, Jules, Baccarat et La Redoute. Aucune occurrence exacte de « Promod 53 », « Jules 73 », « Baccarat 19 », « La Redoute 5 » dans ces noms. L’API publique sépare `name` et `jobCount`; le composant les rend dans des éléments séparés. La provenance exacte des anciens nombres fournis n’est pas établie : ne pas inventer un bug DOM pour justifier leur suppression.
2. **La fragmentation Promod est réelle.** Promod porte 19 offres actives et PROMOD - MAGASIN 2. Le site officiel Promod lie `promodjob.talentview.io`; son RAW porte `entity.id=598`, `entity.name="Promod - magasin"`. Le RAW historique FashionJobs porte « PROMOD - MAGASIN ». Le suffixe est un libellé amont, pas un compteur.
3. **Aubade est fragmentée.** AUBADE (5 actives) et Aubade Paris (24 actives) ont des représentations WTTJ avec la même organisation `reference=rx9Ax61`, `slug=aubade`. Le site officiel Aubade lie ce profil carrière.
4. **La normalisation historique fusionne des mots sans preuve.** Elle supprime formes juridiques, pays, Retail/Stores/International et des préfixes Groupe/Maison. Le helper de clé supprime aussi FRANCE/SA/SAS et les écritures non latines. Une telle clé ne constitue pas une identité prouvée.
5. **Le nom canonique était réécrit à chaque offre.** Deux variantes produisant la même clé pouvaient changer le libellé partagé. Les alias en base n’étaient pas utilisés.
6. **Une clé de cluster était traitée comme une preuve d’entreprise.** L’ingestion et la réconciliation pouvaient comparer des offres d’entreprises différentes partageant un cluster historique. La vérification de `companyId` est désormais obligatoire.
7. **Certains nombres viennent réellement de l’ATS.** Les réponses Workday relues sur les offres réelles donnent `Coach Shanghai Limited 2` et `30360 CONDE NAST (INDIA) PVT LTD - 30360` / `30361 ... - 30361`. Aucun de ces nombres n’est supprimé comme un compteur. Le détail et la transformation de son champ sont désormais archivés.
8. **L’identité et le groupe étaient insuffisamment modélisés.** Le type est très majoritairement UNKNOWN et le parent est un texte. Le nouveau FK ne transforme pas rétrospectivement ces valeurs en preuves.

## Correctif et première répétition

Le moteur applique des alias revus et limités à leur source, conserve les anciens IDs, journalise RAW → origine/règle → libellé normalisé → ID canonique → décision. Les nouvelles transformations d’identité non prouvées sont bloquées et archivées. Une affectation historique conservée reste explicitement non validée.

La procédure transactionnelle conserve les offres et leur historique, refuse les collisions d’identifiants ATS et compare toutes les lignes avant/après. L’ancienne fusion par deux noms est désactivée. Le front retrouve les alias et redirige les anciennes URLs. Voir `docs/employer-identity.md`.

Première répétition sur copie restaurée :

- **2 fusions d’entreprise** avec preuve : PROMOD - MAGASIN → Promod ; Aubade Paris → Aubade.
- **31 offres réattribuées**, dont **26 actives** ; aucune fusion d’offres.
- **8 alias revus** ajoutés pour ces deux entreprises.
- Promod : **21 actives** ; Aubade : **29 actives**, même résultat en base, annuaire, filtre et agrégations.
- **77 322 offres / 74 113 actives / 80 348 représentations**, inchangées.
- Chaque RAW et événement antérieur conservé ; 31 événements correctifs ajoutés.
- **4 liens canoniques vers SMCP**, avec preuve officielle, en conservant Sandro, Maje, Claudie Pierlot, Fursac et SMCP comme cinq identités distinctes ; 4 alias supplémentaires. Aucune offre déplacée pour ce plan.
- **0 nombre supprimé** : aucune suppression numérique n’est justifiée par les preuves examinées.

Les preuves locales sont dans `local-repair-proof.json`, `local-front-proof.json`, `local-query-timings.json`. Ce ne sont pas des preuves de déploiement. La copie restaurée contient moins d’observations historiques que la production courante ; seules ses propres valeurs avant/après sont comparées.

## Travail restant — lot non clôturé

- Examiner les autres paires : même domaine, proximité de nom ou ancien normaliseur ne prouvent pas une fusion. Aucun rapprochement non revu n’est appliqué.
- Migrer les affectations historiques et les six anciens alias vers des preuves explicites. La table d’alias du code reste un outil historique ; elle ne peut plus justifier une nouvelle transformation à elle seule.
- Classifier les 1 534 types historiques et étayer les relations parent, sans déduire le type du secteur ou du nom.
- Étendre la provenance RAW aux chemins des autres adaptateurs ; les données absentes de l’historique ne sont pas recréées artificiellement.
- Avant reprise massive : mesurer les libellés réellement bloqués par la nouvelle règle et produire leurs décisions. Une revue requise est une erreur explicite de run, qui interdit l’attestation d’absence.
- Valider en production le commit livré, les plans exacts et les compteurs du front.

Le lot ne justifie donc pas encore l’affirmation « toutes les identités mondiales sont validées ».

Validation du code avant livraison : 1 460 tests unitaires agrégateur, 215 tests d’intégration, vérifications de types des deux applications. Tests web avec base dédiée : 103 réussis, 2 tests nécessitant une autre photographie historique explicitement ignorés. Aucune simulation de charge. Les lectures du front ont été répétées sur la copie réelle.

Les relations `parentGroupId` et `mergedIntoId` exigent désormais une décision référencée par FK. Les cycles, un parent non GROUP et la mutation des preuves sont refusés par la base. Les profils intelligence résolvent également les anciens IDs, changent de version de cache à la correction et ne présentent pas une fusion de périmètres comme une croissance économique.
