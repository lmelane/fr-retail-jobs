# S2 — compréhension et preuves natives, prototype mesuré

## État

**Prototype amélioré et vérifié sur le snapshot S1 ; pas encore branché à l'API publique.** La décision PostgreSQL enrichi V1 est maintenue. Aucune collecte, modification de données de production, activation de taxonomie ou bascule Railway n'a été effectuée pour ce lot.

Le [résultat JSON](search-s2.json) contient empreintes, métriques, dénominateurs et paramètres de mesure. Le snapshot est identique à S1 ; le jeu de requêtes est désormais connu : cette itération est un test de régression, pas une nouvelle évaluation indépendante.

## Ce qui change

- Les clauses métier + Maison restent obligatoires ensemble. Une absence de code métier n'empêche pas une correspondance sur le titre natif et les missions.
- Le vocabulaire de recherche complète les intitulés réellement observés (`Footwear Developer`, `Watch Technician`, `Financial Control Intern`) et les formulations FR/EN des familles. Il ne modifie pas le titre affiché ni la release de classification.
- Les rôles explicites du titre contribuent aussi à leur famille. Une famille n'exige plus forcément un `jobFunction` déjà calculé.
- Les requêtes métier/famille utilisent le titre et les passages décrivant le poste ; les mentions historiques dans la présentation de l'entreprise ne sont plus des équivalents automatiques du métier. Les étapes de recrutement restent distinctes des missions.
- Les recherches Maison utilisent l'identité, le titre et des liens explicites avec une enseigne, par exemple « pour nos points de vente Nocibé ». Une citation libre en fin de description ne suffit plus.
- Les termes larges `controlling` / `financial control` établissent le rôle dans un intitulé ; ils ne transforment pas automatiquement un responsable de boutique qui contrôle ses coûts en contrôleur de gestion.
- Les marques courtes ambiguës restent contextuelles. `product developer On` résout la Maison ; `On` seul conserve une recherche textuelle avec priorité aux emplois de cette entreprise, sans filtre irréversible caché.
- Les caractères chinois/japonais partagent des positions de recherche dans le titre dérivé. `销售顾问` est reconnu dans `资深销售顾问上海` sans nécessiter de code métier. Les textes originaux restent intacts.

L'extraction des passages est déterministe et limitée ; ce n'est pas une compréhension universelle de toutes les descriptions. Le texte complet reste disponible pour les mots-clés libres.

## Mesures finales

73 833 documents, 115 intentions, 234 formulations et 702 recherches. Les deux candidats ont reçu les mêmes données enrichies et les mêmes clauses. 299 groupes supplémentaires ont été annotés depuis les titres natifs et les descriptions nécessaires, trois abstentions conservées. Les labels S1 restent figés dans leur fichier ; le supplément est explicite.

Après la dernière correction, les nouveaux résultats ont une couverture d'annotation de **98,0 % pour PG** et **99,7 % pour ES**. Les scores appariés ci-dessous portent sur **193 formulations communes entièrement annotées** avec un positif connu ; les inconnues ne sont pas comptées comme négatives.

| Mesure | Actuel | PG enrichi S2 | ES enrichi S2 |
|---|---:|---:|---:|
| Précision sur résultats disponibles, jusqu'à 20 | 58,2 % | **89,4 %** | **89,4 %** |
| Pertinence forte uniquement | 52,7 % | 84,2 % | 84,4 % |
| nDCG@20 | 0,594 | 0,851 | 0,861 |
| Rappel@100 dans le pool | 53,1 % | 73,5 % | 74,2 % |
| Stabilité des formulations, Jaccard@20¹ | 35,4 % | 92,9 % | 92,8 % |
| Zéro résultat malgré un positif fort connu¹ | 37 | **0** | **0** |
| Résultat hors marché indexé¹ | 0 | 0 | 0 |
| p95 local¹² | 31,5 ms | 59,8 ms | 41,7 ms |

¹ Mesuré sur les 234 formulations. ² Les candidats mesurent identifiants + total, l'actuel inclut les facettes. Une passe locale, concurrence 1 : aucun SLO API de production démontré. Le pool et les formulations appariées diffèrent de S1 ; ne pas soustraire aveuglément les deux scores nDCG.

Le rappel des positifs sans code métier reste partiel (PG 49,7 %, ES 51,4 % à 100 sur ce pool élargi). **Zéro recherche vide connue ne signifie pas exhaustivité**, et l'enrichissement natif doit encore progresser sur des intitulés non présents dans les alias.

Reconstruction finale de la projection : PG **50,5 s**, ES **18,9 s**. Relation + index PG **948 985 856 octets** ; segments ES **306 319 398 octets** au relevé initial. Les tables temporaires d'import sont retirées après succès ; snapshot privé et preuves conservés.

## Vérifications

- **11 tests TypeScript ciblés PASS**, **4 tests Python des métriques PASS**, typecheck API PASS.
- **36 vérifications de régression sur les résultats réels PASS**, deux moteurs : zéro sortie de marché, zéro recherche vide avec positif connu, maintien des offres La Prairie/Nocibé, Typology, Shinola et de la famille optique ; exclusion des exemples d'ascenseur Gucci, fondateur couturier Dior, recruteur chargé du processus de candidature et manager de lounge avec contrôle budgétaire.
- Les assertions d'inclusion portent sur les cent premiers résultats. Pour une famille large, on exige un positif natif connu, pas le rang arbitraire d'une annonce particulière.
- Aucune nouvelle interface, aucun parcours de candidature ni code `/offres` ou matching modifié.

## Travail restant avant livraison

1. Terminer S2 dans le chemin public : même compréhension pour recherche/suggestions, version des curseurs et du cache, limites explicites de saisie. Le code actuel tronque encore après huit termes ; le nouveau parseur ne le fait pas, mais il n'est pas encore branché.
2. S3 : qualification entreprise par `SectorReview`, preuves et abstention, alimentation initiale/incrémentale ; retrait de l'ancien enum seulement après remplacement de ses consommateurs.
3. S4 : intégration transactionnellement cohérente du document de recherche PG, disponibilité/fermetures, deux origines, facettes et pagination ; E2E `/emplois`, puis retrait du filtre Métier avec le skill Catwalks. Mesurer la vraie API sous charge.
4. S5 : comparaison avant exposition, suppression du code réellement remplacé, release agrégateur et validation explicite avant publication du site.

La meilleure précision du prototype n'autorise pas à sauter ces étapes. Les preuves d'ingestion/restauration précédentes restent acquises : elles ne sont pas rejouées pour ce travail aval.
