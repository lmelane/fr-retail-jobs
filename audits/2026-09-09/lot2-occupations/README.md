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

Ce registre initial n'est pas une traduction exhaustive de tous les métiers du monde ni une correspondance ESCO validée. Les publications sur des corpus beaucoup plus volumineux devront respecter les budgets opérationnels : lots bornés pour les écritures et durée mesurée de la revue transactionnelle. La migration des heuristiques larges ne prouve pas leur exactitude sémantique exhaustive.

## ÉTAT APRÈS ET GO / NO-GO

**Validation locale terminée ; livraison en cours.** Les résultats locaux ne constituent pas une preuve de déploiement. Le tableau de livraison et le reçu de production seront complétés après commit, CI, merge, déploiement et replay de production. Aucun GO global « 100 % production-ready » ne découle de ce lot.
