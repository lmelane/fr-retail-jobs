# S1 — benchmark réel de la recherche

## Décision

**Retenir PostgreSQL enrichi pour l'implémentation V1 de S2/S4.** Le modèle partagé améliore nettement les résultats ; sur ce premier jeu, Elasticsearch n'apporte pas de gain de pertinence net. Il a une meilleure latence de queue locale, mais imposerait dès maintenant un second stockage, la propagation des retraits, les reprises et l'exploitation d'un nouveau service. Ce coût n'est pas justifié par un gain produit démontré à ce stade.

Cette décision ne signifie ni « PostgreSQL suffira à toute taille », ni « V1 prête à déployer ». Avant exposition : corriger les échecs connus, tester la vraie route avec facettes et pagination, puis mesurer sous charge documentée. Si PostgreSQL ne tient pas le budget API après optimisation, le comparateur Elasticsearch reste rejouable. Aucun changement Railway, route publique ou UI n'est livré par S1.

## Corpus et méthode

- Snapshot public en lecture seule au **23 septembre 2026, 21:53:35 UTC** : **73 833 offres agrégées**, **0 offre directe publique**. La preuve native reste inchangée, la projection est dérivée.
- Empreinte SHA-256 : `d549eef3720fa98970be96294781ad578fea821b73945f821bd9a7ae400854bd`.
- Taxonomie réellement active : `catwalks-occupations-20260909-v1` ; le fichier de release suivant n'a pas été activé pour favoriser les candidats.
- **115 intentions, 234 formulations**, les 27 familles, les requêtes métier/Maison, langues croisées, fautes, accents, négation, hiérarchie et écritures chinoises. Marchés FR/US/CA/CH/BE/DE/GB/CN. Ce jeu n'est pas une preuve de couverture de toutes les langues ni de tous les métiers mondiaux.
- **702 recherches**, avec rotation de l'ordre des moteurs. Le candidat PostgreSQL a ensuite été optimisé pour servir son prédicat par un seul GIN : les **234 listes de 100 identifiants et les totaux sont identiques** avant/après optimisation. Les temps retenus sont ceux de cette version optimisée.
- Même document enrichi et même interprétation de requête pour PostgreSQL et Elasticsearch. Les classements propres aux moteurs restent différents.
- **3 129 groupes annotés**, trois abstentions (description insuffisante ou marque non affectée explicitement), neuf positifs natifs ajoutés au pool. Annotation par un seul agent, masquée sur moteur/rang/code métier ; aucune validation humaine indépendante revendiquée.
- 17 intentions réservées avant les mesures. Leurs annotations n'ont été lues qu'après gel des prototypes ; ce jeu est désormais connu et devient un jeu de régression.
- Les annotations versionnées, scripts, empreintes et [résultats JSON](search-s1.json) constituent la preuve maintenue. Corpus et descriptions restent privés hors dépôt. [Mode de rejeu](../../apps/api/scripts/search-benchmark/README.md).

## Résultats comparables

Qualité sur **209 formulations communes**, dont 29 du jeu réservé, avec top 20 entièrement annoté et au moins un positif connu. Les recherches vides ayant un positif connu comptent comme un échec. Une annotation absente n'est jamais transformée en résultat non pertinent.

| Mesure | PostgreSQL actuel | PostgreSQL enrichi | Elasticsearch enrichi |
|---|---:|---:|---:|
| Précision sur les résultats disponibles, jusqu'à 20 | 58,7 % | **79,2 %** | 78,8 % |
| Pertinence forte uniquement, jusqu'à 20 | 53,2 % | **72,4 %** | 71,9 % |
| nDCG@20, qualité du classement | 0,601 | **0,803** | 0,799 |
| Rappel@100 dans le pool annoté | 55,3 % | 70,8 % | **71,6 %** |
| Stabilité des variantes, Jaccard@20¹ | 35,4 % | **77,9 %** | 77,7 % |
| Recherches vides malgré un positif fort connu¹ | 37 | 12 | 12 |
| Résultats hors pays indexés du marché¹ | 0 | 0 | 0 |

¹ Sur les 234 formulations. Deux variantes toutes deux vides sont exclues de la stabilité et comptées séparément. La précision utilise le nombre de résultats disponibles : ce n'est pas un `P@20` divisant toujours par vingt. Le rappel est limité au pool, pas un rappel absolu du catalogue. Les scores des deux candidats sont proches ; cette étude ne démontre pas une supériorité statistique de l'un d'eux.

Le rappel@100 des positifs annotés **sans code métier** passe de 45,4 % à 53,0 % (PG) / 54,2 % (ES). Il reste insuffisant : supprimer la dépendance au code est nécessaire, mais ne suffit pas à retrouver tous les titres natifs.

## Temps et ressources locaux

Même hôte macOS ARM64 / 24 Gio, PostgreSQL **18.6** natif, Elasticsearch **9.5.4** natif. PG shared_buffers 256 Mio ; heap ES 512 Mio ; concurrence 1, une passe mesurée. Aucun SLO de production établi.

| Temps local | Actuel² | PG enrichi | ES enrichi |
|---|---:|---:|---:|
| p50 | 11,3 ms | 3,3 ms | 7,8 ms |
| p95 | 33,4 ms | 107,2 ms | 36,7 ms |
| Maximum | 111,8 ms | 622,8 ms | 301,8 ms |

² Le SQL actuel inclut les facettes et compteurs existants. Les deux prototypes renvoient identifiants + total : **ne pas comparer ces colonnes comme trois temps API équivalents**. Les mesures PG optimisées ont été reprises ultérieurement sur le même hôte ; cache et activité système ne sont pas contrôlés comme dans un test de charge dédié.

L'optimisation GIN a réduit le maximum PG de 1 487,3 à 622,8 ms sans changer un seul résultat. Taille locale finale : relation PG + index **813 899 776 octets** après compactage ; segments ES **240 456 680 octets** au relevé. Ce ne sont ni les disques complets des services ni leurs besoins avec replicas. Le chargement initial avait pris 52,0 s (PG) et 17,2 s (ES), mais le premier index PG ne contenait pas encore les lexèmes d'identité optimisés : ces temps ne justifient pas un comparatif de reconstruction de la version finale. RSS, débit sous charge et coût Railway restent non mesurés.

## Défauts concrets à corriger en S2

1. **Rappel natif** : `Senior Footwear Developer`, `Financial Control Intern`, `Watch Technician Artisan` ne sont pas retrouvés par toutes les formulations de leur rôle. Les métiers canoniques actuels ne doivent pas en décider l'existence.
2. **Familles et formulations** : `santé pharmacie optique` ou `coiffure prestations beauté` ne doivent pas exiger la présence littérale de tous ces mots dans une même offre.
3. **Maison réellement liée au poste** : `Gucci` dans des indications d'ascenseur chez Saks ne prouve pas un poste Gucci. À l'inverse, La Prairie peut explicitement recruter pour un point de vente Nocibé. Ni simple présence dans le texte, ni seul `companyId`, ne suffisent.
4. **Métier vs présentation d'entreprise** : « couturier » dans l'histoire du fondateur Dior n'est pas une mission de couture. Un vendeur de bijoux n'est pas automatiquement un joaillier artisan.
5. **Ambiguïtés et niveau** : `On`, groupe vs marque, adjoint vs responsable, senior/junior et négation doivent garder leur sens.

Les 12 zéros positifs, requête par requête, sont dans le JSON. Les 26 recherches vides ne sont pas toutes des défauts de moteur : certaines n'ont pas de positif établi dans le catalogue.

## Limites et suite effective

- Le contrôle marché porte sur le pays stocké ; il ne certifie pas la justesse géographique de chaque extraction native.
- Aucun DirectOffer public dans ce snapshot. Test unitaire du document direct effectué ; priorité, pagination et candidature deux origines restent à vérifier en intégration avant remplacement.
- Champ `lieu`, filtres, disponibilité/expiration, suggestions et curseurs : conservés dans le produit actuel ; leur nouveau chemin doit être vérifié en S4.
- Aucun LLM au runtime, aucun élargissement silencieux vers une autre Maison, aucune activation de taxonomie pour atteindre artificiellement 100 % de codes.
- **S1A–S1E réalisés pour la décision V1. S2 ouvert. S3, S4, S5 non livrés.** Le benchmark ne vaut pas autorisation de publier le site.

Validation du code S1 : six tests TypeScript ciblés, quatre tests des métriques Python et typecheck API. Les anciens protocoles d'ingestion, restore, canari et marchés ne sont pas rejoués pour ces scripts hors runtime.
