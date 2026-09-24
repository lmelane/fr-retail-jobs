# Dernier challenger linguistique, 24 septembre 2026

## Résultat avant validation de concurrence Railway

**PostgreSQL reste candidat V1. Le choix définitif attend la mesure ingestion + recherche sur Railway.** Elasticsearch présente un avantage de classement, rappel et latence ; ce test ne démontre pas son inutilité.

Même snapshot de 73 833 offres, même projection (empreinte `82e2e41bc3065a734f7f8b5ef063fbcdf8888b0fcc82de7a5b3a79c01907a76c`), même `SearchIntent`, mêmes synonymes et 234 formulations. Le SQL PG est celui du produit. Deux formulations « assistant store manager » ont une intention corrigée depuis S2 ; cette correction partagée s'applique aux deux moteurs. Les anciennes métriques S2 ne sont donc pas recopiées comme nouveau témoin.

ES 9.5.4, un shard, zéro replica, heap 512 Mio, loopback uniquement. Analyse linguistique par langue déclarée, phrases exactes favorisées, fuzzy borné sur texte résiduel. Les identités ne sont pas stemmées/corrigées. Aucun LLM, vecteur ou synchronisation runtime. [Profil et reproduction](../../apps/api/scripts/search-benchmark/README.md).

| Critère, 214 formulations appariées | PostgreSQL | Elasticsearch linguistique |
|---|---:|---:|
| Précision des résultats disponibles ≤20 | 89,12 % | 87,84 % |
| Pertinence forte uniquement | 84,08 % | 82,66 % |
| nDCG@20 | 0,8493 | 0,8610 |
| Rappel dans le pool @100 | 72,41 % | 75,09 % |
| Rappel sans code métier, ensemble des intentions | 49,40 % | 53,16 % |
| p95 local, seconde passe identique | 268,7 ms | 43,3 ms |
| p50 local, seconde passe identique | 7,4 ms | 12,4 ms |

Les nouvelles annotations couvrent 100 % des positions top20 des deux candidats : 160 groupes supplémentaires, aucun ancien label changé. Les 20 formulations sans idéal de classement exploitable sont exclues de la comparaison appariée. Un seul évaluateur, pas de validation humaine indépendante ; ce jeu connu mesure une régression, pas la généralisation à tous les métiers. Le rappel reste limité au pool. Le snapshot ne contient aucune offre directe publique.

Première passe : p95 PG 190,9 ms / ES 31,5 ms. Deuxième passe : mêmes intentions, totaux et identifiants dans le même ordre pour les 468 mesures. Les temps locaux varient ; aucun des chiffres n'est une capacité Railway. ES reconstruit son index en 37,6 s (516 Mo mesurés) ; la relation PG existante occupe 949 Mo, mais sa reconstruction n'a pas été rejouée dans ce delta.

## Correction défensive pendant l'essai

Le stemming des missions assimilait « financial control » à « financial controller ». L'élargissement linguistique d'un métier est désormais limité au titre ; les phrases exactes des missions restent possibles. Le dernier essai passe les **36 vérifications de régression**, sans résultat hors marché ni requête vide malgré un positif connu. Le premier essai interrompu/reconstruction incomplète est exclu ; le mesureur exige maintenant un index prêt lié à l'empreinte de la projection.

## Première mesure Railway (release 504d388)

240 recherches publiques, concurrence 4, p50 **274,8 ms**, p95 **515,4 ms**. Authentification, FR/US, Maison+métier, synonymes, faute de frappe, locales CA/CH/BE, pagination, offres sans code et facettes : PASS. Aucune offre retournée expirée, retirée ou hors marché. Ce contrôle ne démontre pas à lui seul une transition fermeture/expiration.

La projection réelle contient **76 077 documents**, `pending=0`, une génération prête. Les 90 migrations appliquées comprennent les deux migrations search. Aucun reset ni nouvelle migration nécessaire pour ce delta. Les métriques CPU/RAM sont accessibles mais différées ; leur interprétation finale et la charge simultanée restent à terminer.

## Décision restant à fermer

Le gain de rappel d'ES s'accompagne d'une baisse de précision, avec un avantage net de temps moteur local. PG est opérationnel ; il faut encore prouver l'absence de contention sous ingestion et fixer l'enveloppe mesurée. Si cette mesure est saine, la simplicité d'exploitation justifie PG V1 ; aucune affirmation de capacité mondiale n'en découle. Les limites et résultats complets sont dans [le reçu JSON](search-linguistic.json).
