# Recherche V1 — validation Railway du 24 septembre 2026

## Décision

**GO PostgreSQL enrichi pour la V1.** Un seul moteur de recherche en production. Elasticsearch reste un challenger dans le harness isolé ; aucun service, synchroniseur, fallback ou double lecture ES n'est livré.

Le [challenger linguistique](search-linguistic.md) montre un avantage réel d'ES : rappel dans le pool +2,67 points, nDCG +0,0116 et p95 moteur local nettement meilleur. Sa précision baisse de 1,28 point. Ce bénéfice mixte ne justifie pas aujourd'hui une seconde infrastructure : PostgreSQL satisfait la charge Railway mesurée et conserve la projection transactionnelle déjà intégrée. Il ne s'agit ni d'une supériorité générale de PG ni d'une preuve de capacité mondiale.

## Release réelle

- Code API et worker : `f10e1f2f38412abcf4072f6bea17d5ec1955ed7f`, promu de `development` vers `main` sans changement supplémentaire.
- CI de cette release : development `35974199919`, main `35974896600`, toutes deux SUCCESS ; images immuables et entrypoints vérifiés.
- Les commits suivants ne portent que sur l'outillage de mesure, ses tests et les preuves/documentation ; ils ne reconstruisent pas les images.
- PostgreSQL et son volume inchangés. 90 migrations appliquées, aucune nouvelle migration nécessaire pour ce delta ; aucun reset ni réparation historique.
- Reconstruction réelle de `search-3-20260924-v2` déjà effectuée de **06:34:05.993 à 06:37:58.562 UTC**, soit **232,569 s**. Une reconstruction identique n'a pas été relancée.
- **76 096 documents**, génération prête, **pending=0** après les ingestions. La différence avec les 73 833 documents du benchmark figé est explicitement conservée.
- Digests, commandes, réglages résolus et retour arrière : [reçu de production](../../docs/operations/railway/runtime-release.json).

## Fonctionnel réel

Authentification (401 sans clé), santé/SHA, FR/US, Maison + métier, synonymes, faute de frappe, offres sans code métier, pagination sans doublon, lieux/contrat, facettes et corpus inchangé entre locales CA/CH/BE : **PASS**. Aucune offre expirée, retirée ou hors marché dans les résultats mesurés.

Trois offres réellement fermées et trois réellement expirées (FR, US, NO) : **410 et absentes de la recherche**, avec pagination parcourue jusqu'à sa fin. Les trois expirées restaient `Job.isActive=true` et présentes dans `SearchDocument` : la disponibilité native prime donc effectivement sur la projection, sans mutation de témoin en production.

Le site reste sur sa branche de développement ; cette validation n'est pas une livraison du front. `/offres`, matching, onboarding et flux Direct Offers n'ont pas été modifiés. Aucune offre directe publique n'existe dans cet échantillon production : la coexistence des deux origines reste couverte par les tests d'intégration acquis, sans données artificielles en production.

## Charge et concurrence

Même lot de **300 recherches**, quatre requêtes simultanées, sans temporisation : 250 entrées de scénario, incluant les **234 formulations** communes aux deux moteurs et 16 cas fonctionnels. Toutes les entrées sont parcourues, certaines formulations se recoupent.

| Mesure HTTP publique | Au repos | Pendant publication |
|---|---:|---:|
| Requêtes | 300 | 300 |
| p50 | 162,56 ms | 158,49 ms |
| p95 | 384,37 ms | 400,09 ms |
| Erreurs HTTP / hors marché | 0 / 0 | 0 / 0 |

Hausse du p95 : **4,09 %**. Les temps incluent réseau public et JSON, pas seulement SQL.

La fenêtre de publication issue des événements DB est **08:42:40.899–08:44:09.202 UTC**. Les recherches se déroulent **08:43:03.746–08:43:22.609 UTC** : **300/300 commencent et finissent à l'intérieur de cette fenêtre**. Le reçu contient les horodatages par requête et les empreintes des preuves privées.

Une mesure préalable au repos de 480 recherches réparties sur deux minutes donne p50 184,33 ms / p95 404,74 ms. Les mesures préliminaires durant qualification et en fin du premier run ne sont **pas** présentées comme 480 publications simultanées : leur recouvrement était insuffisant, d'où le second relevé ciblé.

### Base et ressources

Pendant la fenêtre de publication, métriques Railway par pas de 30 s : CPU maximum observé **1,11 vCPU / 24**, RAM maximum **4,05 Go / 24**. Au repos, le court lot comparable observe 0,87 vCPU et 2,59 Go ; la mesure longue précédente observe au plus 0,66 vCPU. Les points absents/limites nulles sont exclus ; ces fenêtres et leurs durées différentes ne constituent pas une comparaison statistique de consommation. Unités CPU : [documentation Railway](https://docs.railway.com/guides/right-size-cpu-memory).

Douze sondes DB pendant les écritures, espacées de cinq secondes : aucun backend bloqué observé, `pending=0` à chaque sonde, delta deadlocks = 0. Cela n'exclut pas des attentes transitoires entre sondes. Le moniteur existant du worker relève ailleurs dans le run un pic de six sessions actives en attente (verrou ou I/O) et une requête de 10,95 s, sans attribution conservée ; on ne prétend donc pas que toutes les requêtes DB sont rapides ou qu'aucune attente n'existe. Aucun impact bloquant observé sur l'API ou l'achèvement du run.

## Ingestions réellement exécutées

Une seule source : **Boots**, par la commande normale bornée `ingest --source=boots --no-geocode`.

| Run | Qualification incluse | Offres extraites/publiées | Créations / réattestations | RAW capturés | Durée |
|---|---|---:|---:|---:|---:|
| `b98271b8-f223-4144-8afe-768d092aaf29` | Oui, accès périmé renouvelé normalement | 1 458 / 1 458 | 19 / 1 439 | 2 942, dont qualification et robots | 587,352 s |
| `5a2ce9eb-c1d1-4ee8-8b69-80b0b051ec50` | Non, décision encore valide | 1 458 / 1 458 | 0 / 1 458 | 1 470 | 231,925 s |

Les deux runs sont **COMPLETED**, SourceRun **OK**, zéro erreur d'ingestion, fusion, mise en attente ou échec de persistance. « Mise à jour » inclut une réattestation ; ce compteur ne signifie pas que le texte a changé. Les quatre pages listées sans JobPosting sont conservées dans les rejets explicites, sans offre inventée. Le premier run a rencontré un HTTP 502 suivi d'une reprise réussie ; le second a 1 470 réponses HTTP 200, zéro retry. Captures, corps RAW, extractions et fins d'ingestion sont rattachés dans le reçu.

Le CRON normal est rétabli : `scheduled`, `0 16,17 * * *` UTC, sélection de **18 h Europe/Paris une fois par jour**, pause globale à `0`. Les commandes temporaires Boots sont retirées. Aucun autre service n'a été créé.

## Seuils et nettoyage

Le [garde versionné](../../apps/api/scripts/search-benchmark/guard-policy.json) et son [mode d'emploi](../../apps/api/scripts/search-benchmark/README.md) déclenchent un nouveau benchmark sur latence, CPU, attente de projection, deadlock, ralentissement pendant ingestion, reconstruction, pertinence ou dépassement du volume mesuré. Suivi de cette tâche toutes les six heures, silencieux en l'absence de changement actionnable ; aucun changement automatique de moteur ni déploiement. Ce suivi dépend de Codex local, sans remplacement des alertes d'exploitation.

Retirés : cartes de présentation sans consommateurs et ancien chargeur SQL du benchmark. Le [tableau des dépendances conservées](../../docs/architecture/recherche-semantique.md#retrait-du-code-remplacé) identifie les champs partagés et le flux gelé ; aucune suppression aveugle. Les migrations, preuves et fonctions/colonnes historiques nécessaires à une reprise restent distinctes d'un deuxième moteur actif.

La qualification porte sur une source normale et une charge bornée à quatre requêtes simultanées. Elle ne couvre pas toute la concurrence du run mondial ni le trafic futur. Les corrections d'identité employeur et leur qualification source par source restent décrites séparément dans [l'audit RAW](employer-raw-audit.md) : ce GO recherche ne clôture pas tous les rejets du catalogue.

[Reçu détaillé et empreintes](search-railway.json).
