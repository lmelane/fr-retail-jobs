# Lot 2 — Métiers : audit, remédiation et preuves

## ÉTAT AVANT

Mesure du 9 septembre 2026 sur la production, sauvegardée puis restaurée intégralement dans une base locale isolée : **77 352 lignes Job, 77 329 offres canoniques, 74 124 actives**. Parmi les actives : **68 820 familles renseignées**, 5 304 sans famille, 41 770 titres distincts, **53 557 valeurs MID**. Il n'existait pas de métier précis ni de registre de décisions métier par offre.

La France compte **10 947 offres actives** dans ce périmètre. Ce lot ne change ni pays, ni employeurs, ni contrats, ni sources. Il ne prétend pas corriger les autres lots.

## CAUSE RACINE

Les règles étaient une suite de motifs et de priorités dans `normalize/taxonomy.ts`, avec 25 familles, une deuxième liste dans le front et un défaut MID en l'absence d'indice. Une famille large était présentée comme un métier. Ajouter un concept ou un synonyme nécessitait une modification applicative. Le titre nettoyé ne distinguait pas explicitement l'intitulé original et les preuves de classification.

La reprise a également révélé deux défauts dans la nouvelle implémentation, corrigés **avant production** :

- une pagination avec curseur et `skip: 1` sur un ensemble que les écritures modifiaient sautait une ligne par lot ; le premier essai laissait 154 offres. La pagination utilise maintenant une borne d'identifiant, avec un test de régression sur des lots d'une ligne ;
- mélanger les synonymes et les prédicats textuels dans un même OR provoquait un balayage complet des descriptions. Les candidats textuels indexés et les correspondances sémantiques sont maintenant sélectionnés séparément, puis réunis sans doublons.

## MODIFICATIONS

Un manifeste de données versionné contient les groupes, familles, métiers, labels, alias, spécialisations et règles contextuelles. Le premier registre contient **61 métiers, 27 familles, 4 groupes et 66 règles de métier précis**. La coiffure et les prestations beauté ont leur propre famille dans les services, distincte du conseil beauté en retail. Les identifiants internes restent stables ; les labels français sont distincts. Le registre est stocké en base, avec une empreinte et une version immuables.

Le parcours est : titre original si disponible → titre normalisé → règles correspondantes et exclusions → métier/famille/spécialisations/séniorité → décision avec version, entrées, provenance et niveau de confiance. Les anciennes heuristiques de familles restent explicitement des indices larges. Une absence de règle ou une ambiguïté conserve l'offre et son intitulé dans la recherche générale.

Les règles nouvelles utilisent des expressions déclaratives de données, sans code exécutable ni expressions régulières arbitraires. Les anciennes expressions régulières migrées sont figées ; les nouvelles variantes passent par le langage de règles littérales. Les correspondances contradictoires ne sont pas départagées par l'ordre d'une liste. Les changements de parent d'un identifiant existant sont refusés sans migration dédiée.

Une publication se prépare par un replay en lecture seule du corpus réel. L'activation refuse un rapport périmé. Les écritures prennent un verrou partagé sur la version active ; un run commencé sur une ancienne version adopte la version courante avant d'écrire. Le backfill est borné, reprenable et conserve une décision avant/après pour chaque modification. Les écritures concurrentes divergentes ne sont pas écrasées.

Le contrôle mobile a également détecté un débordement de la liste avec un nom long d’employeur. La colonne de grille mobile peut maintenant rétrécir sans être élargie par son contenu. Le front et le pipeline lisent le même registre. Un changement de label publié sur la base de test a été observé immédiatement via l’API, sans redémarrage du serveur ni changement de code (preuve distincte sur fixtures). Les recherches par synonymes enrichissent les résultats littéraux ; les termes supplémentaires, par exemple Paris, restent des contraintes. Le filtre « Métier à préciser » rend les offres non résolues accessibles. Les comparaisons historiques de métriques métier ne mélangent pas silencieusement deux méthodes de classement.

## PREUVES ET MÉTRIQUES

Les reçus JSON de ce dossier distinguent copie locale et production. Après replay, 69 331 offres actives ont une famille (dont les 35 035 avec métier précis) ; 6 conflits inter-familles supplémentaires restent volontairement sans famille depuis la séparation des prestations beauté. Les sauvegardes complètes, corpus sources et journaux détaillés restent dans le répertoire privé `backups/lot2-20260909`, exclu de Git et des images.

Le replay final classe **35 035 offres actives dans un métier précis (47,27 %)** ; **34 289** restent au niveau famille ; **4 736** sans règle ; **64** ambiguës. **59 des 61 métiers** sont représentés ; **14 647 variantes normalisées** sont rattachées, avec **310 alias déclarés** dans le registre. Il ne faut pas annoncer la couverture des familles comme un taux de métiers précis. Les 39 089 offres sans métier précis sont conservées et mises en investigation.

Deux règles de métier précis n'ont pas de témoin dans le corpus courant : `sales-advisor-client-consultant-context` et `lash-technician-title`. Leur présence dans le registre n'est pas une couverture mesurée.

**6 offres actives** indiquant explicitement un niveau intermédiaire conservent MID, contre 53 557 valeurs MID stockées auparavant. Un titre sans indice n'hérite plus de MID. « Junior/Senior » ou « mid-level to senior » conserve un niveau indéterminé avec justification. Les autres niveaux issus d'heuristiques sont marqués comme tels ; ce ne sont pas des attestations fournies par l'employeur.

## TESTS ET RÉGRESSIONS VÉRIFIÉES

- 1 489 tests unitaires agrégateur ; 229 tests d'intégration ; 109 tests web et 18 parcours navigateur desktop/mobile. Deux tests supplémentaires sur corpus réel sont exécutés séparément sur la copie de production.
- Typecheck des deux applications et build Next.js.
- Inconnus conservés, règles ambiguës, alias multilingues, ajout de données sans changement de code, revue périmée refusée, version active suivie par un ancien run, historique A→B→A conservé.
- Transactions, ligne empoisonnée, concurrence, pagination du backfill et second passage sans écriture.
- Comparaison des identifiants de résultats de neuf recherches avant/après : aucun résultat littéral perdu. Comparaison base/API/somme des facettes pour le monde et FR/US/GB/DE/IT.
- Empreintes exhaustives des IDs, champs hors métier, événements, liens sources, payloads sources et entreprises avant/après. Aucun effacement d'offre, de preuve ou d'historique autorisé par ce lot.

Aucun test de charge. Sur une requête réelle « Sales Advisor » de la copie, le plan SQL initial mesurait 7,25 s, puis 2,34 s après correction. Ce résultat ne constitue ni un SLA de production ni une preuve de capacité à des millions d'offres.

## RESTANT À FAIRE

La précision sémantique n'est pas égale au taux de couverture. La file d'investigation doit confronter chaque variante à son payload natif et à son contexte avant d'ajouter une règle. Aucun statut non résolu ne prouve à lui seul une limite de l'ATS. La clé source conservée dans la décision identifie le propriétaire canonique du posting ; elle ne constitue pas une attestation indépendante de chacun de ses champs, notamment d’un département historiquement conservé. Les entrées exactes du calcul sont enregistrées. Les titres historiques ne disposant pas de valeur originale attestée sont marqués `STORED_TITLE_ONLY` ; aucune valeur brute n'est inventée, et les payloads historiques restent conservés.

Les algorithmes de matching et de recommandation ne sont pas refondus dans ce lot ; leur exploitation de ce référentiel devra être validée à son tour. Ce registre initial n'est pas une traduction exhaustive de tous les métiers du monde ni une correspondance ESCO validée. Les publications sur des corpus beaucoup plus volumineux devront respecter les budgets opérationnels : lots bornés pour les écritures et durée mesurée de la revue transactionnelle. La migration des heuristiques larges ne prouve pas leur exactitude sémantique exhaustive.

## ÉTAT APRÈS

**Code livré, mergé et déployé ; données de production effectivement reclassées.**

- Implémentation : `0116cd9` ; correction de grille mobile : `e87f54c`.
- [PR #44](https://github.com/lmelane/fr-retail-jobs/pull/44), mergée dans `main` : **`93c5d3fec247100b15d4031a199bba4eea036ad9`**. CI de la PR et du merge verte.
- Quatre services Railway sur cette révision, statut SUCCESS. La commande normale de l'agrégateur a été rétablie après le témoin natif. **Les crons restent en pause**, conformément à l'état de maintenance précédent ; aucun run mondial ni ajout massif de sources n'a été lancé.
- Première passe : **77 329 écritures**, zéro ligne restante. Deuxième passe : **77 329 vérifiées, zéro écriture**.
- L'empreinte des décisions en production est strictement celle du replay approuvé : `7749ddd937ff3fdc91ba1bcf1272a143da0979e6eb13c237f5cd001e1878bb2e`.
- Reçu durable `DataCorrection` : **`cmttyq1y100003nc10q7ze8qr`**. Les 77 329 transitions initiales ont chacune leur observation immuable.

La conservation exhaustive est démontrée **avant** le témoin d'ingestion. Ce témoin est ensuite enregistré séparément : une ingestion actualise légitimement ses observations et ses horodatages, contrairement au backfill métier.

## MÉTRIQUES

Périmètre : offres actives, sauf mention contraire. Mesure après backfill du 9 septembre 2026 à 10:34 UTC ; le témoin natif conserve les mêmes volumes.

| Mesure | Avant | Après production |
|---|---:|---:|
| Offres actives | 74 124 | **74 124** |
| Lignes Job, historiques et redirections inclus | 77 352 | **77 352** |
| Offres France | 10 947 | **10 947** |
| Métier précis attribué | Pas de modèle | **35 035 — 47,27 %** |
| Famille seule, sans métier précis | Non distingué | **34 289** |
| Sans règle métier | Non distingué | **4 736 — 6,39 %** |
| Ambiguïtés métier | Non distingué | **64 — 0,09 %** |
| Famille renseignée, métiers précis inclus | 68 820 | **69 331 — 93,53 %** |
| Valeurs MID | 53 557 | **6, explicitement motivées** |
| Séniorité non renseignée | 528 | **54 020** |
| Concepts métier définis / représentés | 0 / 0 | **61 / 59** |
| Alias déclarés / variantes normalisées rattachées | Pas de modèle | **310 / 14 647** |
| Résultats littéraux perdus, neuf recherches contrôlées | — | **0** |
| Écart base/API/somme des facettes, monde + FR/US/GB/DE/IT | — | **0** |
| Offres supprimées par le backfill | — | **0** |

L'absence de séniorité est visible et documentée ; elle ne remplace pas une information source existante par une estimation. Le taux de couverture métier **n'est pas une mesure de précision statistique** issue d'une annotation exhaustive.

## PREUVES DE PRODUCTION

- [Avant](production-before.json), [après](production-after.json), [décisions conformes au plan](production-decisions.json), [reçu durable](production-delivery-receipt.json), [deux exécutions](production-runs.json).
- [Déploiements Railway](production-deployments.json), [comparaison recherche/base/API](production-search.json), [pages HTTP et offre close 410](production-http.json), [contrôle mobile réel](production-mobile.json), [message public pendant le replay](production-during-replay.json).
- [Ingestion native BZB dans Railway](native-ingest.json), [témoins avec valeurs brutes et règles](native-witnesses.json).
- [Publication d'un label sans redémarrage sur fixtures](data-only-publication-test.json). Cette preuve est un test d'intégration, distinct du corpus réel.
- [Premier contrôle visuel](clone-ui.json) : le débordement détecté y reste visible. [Contrôle correctif ciblé](clone-mobile-final.json), puis contrôle de production ci-dessus : 390 px de contenu pour 390 px de fenêtre.

Témoin natif : **18 récupérées, 18 mises à jour, zéro erreur**, avec la version attendue. **14** ont un métier précis, **3** une famille seule et **1** reste sans règle ; toutes sont conservées. Les 18 titres bruts sont enregistrés et le recalcul donne exactement les mêmes décisions que l'ingestion. Les cinq événements applicatifs sont persistés ; Railway expose six lignes avec le démarrage du conteneur, pic mesuré de cinq lignes/seconde et aucune défaillance de persistance.

Le cas sans règle est « Responsable Développement H/F », département non renseigné dans la projection actuelle. Le [contrôle du payload natif](native-context.json) confirme que ces quatre entrées du feed ne fournissent ni département, ni tags, ni occupationalCategory : ces champs ne sont donc pas perdus dans cette projection. Ce constat prouve que le titre est conservé, **pas** qu'aucun contexte exploitable n'existe sur le portail. L'investigation du contenu natif reste nécessaire avant d'ajouter une règle. Même principe pour les trois familles seules.

**Point transmis au lot 6 :** le run BZB observe 18 offres, tandis que 22 liens BZB restent actifs en base. Les quatre liens non revus sont listés dans le reçu natif. Aucun total indépendant n'est déclaré par ce feed. Cela ne prouve ni une exhaustivité mondiale ni quatre offres fantômes : il faut confronter les URLs, la pagination et les preuves de fermeture. Aucune fermeture manuelle n'a été forcée pendant ce lot.

## TABLEAU DE LIVRAISON

Dans ce tableau, « données réparées » signifie que la correction mesurée a été appliquée ; cela ne signifie pas que chaque métier du marché est désormais couvert.

| Finding | Fixé ? | Commit | Main ? | Déployé ? | Données réparées ? | Preuve prod |
|---|---|---|---|---|---|---|
| Taxonomie codée en dur, sans métiers précis | Oui, architecture | 0116cd9 | Oui, 93c5d3f | Oui | 77 329 décisions | production-decisions.json |
| MID attribué par défaut | Oui | 0116cd9 | Oui | Oui | 53 557 → 6 MID actifs | production-after.json |
| Prestations beauté confondues avec conseil retail | Oui pour les métiers précis couverts | 0116cd9 | Oui | Oui | Famille services dédiée | production-decisions.json et registre déployé |
| Provenance et historique de classification absents | Oui pour les nouvelles décisions ; raw historique manquant explicite | 0116cd9 | Oui | Oui | 77 329 observations initiales + transitions natives | production-delivery-receipt.json |
| Front et pipeline utilisent deux référentiels | Oui | 0116cd9 | Oui | Oui | Registre partagé | production-search.json |
| Risque de perte des résultats non canonisés | Garde démontré | 0116cd9 | Oui | Oui | Aucune offre perdue | production-after.json, native-ingest.json |
| Débordement mobile avec noms longs | Oui | e87f54c | Oui | Oui | Sans objet | production-mobile.json |
| 39 089 offres sans métier précis | **Partiel : file d'investigation, pas fusion forcée** | 0116cd9 | Oui | Oui | Conservées ; résolution sémantique à poursuivre | production-after.json |
| 4 liens BZB actifs non revus dans le témoin | **Identifié, à investiguer au lot 6** | — | Rapport | Sans objet | Non, aucune fermeture forcée | native-ingest.json |

## GO / NO-GO POUR LE LOT SUIVANT

**GO pour le lot 3 sur les fondations techniques du lot 2** : registre de données commun, identifiants stables, règles traçables, abstention explicite, conservation des offres, replay reproductible et preuve native en production.

**Pas de validation « 100 % des métiers du monde canonisés » ni « système intégralement production-ready »**. La couverture précise reste à 47,27 %, les heuristiques de familles doivent continuer à être examinées, et la fraîcheur/complétude ATS relève des lots suivants. Le catalogue peut désormais être enrichi par des versions de données revues, sans modifier le backend ou le front pour chaque intitulé. Aucun lot suivant n'a été exécuté ici.
