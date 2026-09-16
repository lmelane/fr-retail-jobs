# Captures natives, sorties d’extraction et rétention

Contrat des lots 2, 5A et 5B, actualisé le 16 septembre 2026. L’implémentation est validée localement et le transport d’archive sur un environnement Railway isolé. Les services de production n’utilisent pas encore ces migrations. Les preuves et les limites de livraison figurent dans le [bilan du lot](../../audits/reprise-2026-09-15/lot-2.md).

## Ce qui fait foi

Une réponse HTTP est enregistrée **avant** le traitement de son statut, le décodage JSON ou le parsing HTML. Les octets conservés sont ceux de l’entité délivrée par `fetch`, après décompression HTTP éventuelle. Leurs espaces, champs inconnus et tableaux restent intacts. Ce ne sont pas les octets chiffrés ou compressés circulant sur le réseau.

Le navigateur conserve séparément les réponses document/XHR/fetch et le DOM rendu. Un préfixe reçu avant une coupure porte `complete=false` ; il ne peut pas être rejoué comme une réponse complète. Une erreur de stockage arrête toute l’extraction, y compris lorsqu’un adaptateur intercepte l’erreur après avoir lu d’autres pages.

| Entité | Responsabilité |
|---|---|
| `CaptureBatch` | Source, début d’extraction, empreinte de configuration, version du lecteur et format |
| `RawCapture` | Une tentative, ordre de réception, empreinte de requête, statut, métadonnées et référence des octets |
| `RawBlob` / `RawBlobBody` | Identité SHA-256, taille, empreinte et taille gzip ; octets locaux compressés |
| `SourceExtraction` | Une sortie complète d’offre par collecte et position, conservée avant les transformations communes |
| `CaptureOutcome` | Résultat immuable : EXTRACTED ou FAILED, compteur, empreinte des offres et manifeste intégral du résultat pour le format 2 |
| `SourceObservation` | Sortie RAW de l’adaptateur et disposition interne séparées ; historique antérieur conservé |
| `RawBlobArchive` | Localisation distante et empreinte gzip vérifiées, immuables |

Deux collectes identiques partagent les blocs mais conservent des identités d’observation distinctes. `JobSource` référence sa dernière sortie et sa collecte ; les sorties anciennes restent consultables indépendamment des mutations du catalogue. La contrainte de base interdit de combiner une sortie et une autre collecte. Le writer vérifie aussi la source et l’identifiant d’offre. Les faits et présentations issus des lots 3 et 4 tracent séparément les décisions de projection.

Les champs `publicationHold` et `annotationHash` ne sont plus injectés dans le payload source. La migration reconnaît les anciennes enveloppes uniquement lorsqu’elles contiennent explicitement `sourcePayload` ; elle préserve leur contenu et leur empreinte historiques. Un ancien `SourceObservation` sans capture reste marqué comme tel : les réponses natives perdues ne sont pas reconstituées artificiellement.

## Rejouer sans réseau

Le lecteur rejoue les réponses correspondant à l’empreinte de requête : méthode, URL exacte, corps haché et en-têtes de négociation autorisés. Une requête absente, une réponse incomplète ou une archive corrompue fait échouer le rejeu, même si le lecteur intercepte cette erreur. Toutes les réponses enregistrées doivent être consommées. Les cookies WAF du rejeu sont isolés des sessions réelles et aucun navigateur n’est lancé pour les amorcer.

Le temps de référence de l’extraction est conservé pour les dates relatives et les décisions datées produites par les lecteurs concernés. Chaque reçu natif garde en plus sa propre date de capture. L’outil compare chaque sortie rejouée, son ordre et son identifiant aux empreintes des octets enregistrés. Il compare aussi toutes les métadonnées du résultat, notamment `complete`, `truncated`, les compteurs, les périmètres et les lignes rejetées. Un écart fait échouer la commande.

Le rejeu complet exige la configuration originale et la version compatible du lecteur. La configuration est hachée, pas copiée avec ses secrets. Conserver sa version privée dans le dossier de preuve du run. La lecture d’un corps par identifiant reste possible sans cette configuration. Les requêtes concurrentes strictement identiques sont consommées dans l’ordre enregistré ; un lecteur dépendant de leur ordre d’arrivée doit être qualifié sur son propre corpus.

## Manifeste et clôture de collecte

Les nouvelles collectes utilisent le format 2. Le manifeste est un bloc RAW dérivé et borné : métadonnées complètes de `AdapterResult`, identifiants et empreintes des sorties dans leur ordre. Les corps des offres restent dans leurs blocs individuels ; ils ne sont pas dupliqués dans le manifeste. Un résultat vide conserve ainsi la différence entre zéro explicitement énuméré, parcours incomplet et absence de preuve.

La clôture immuable interdit tout ajout ultérieur aux journaux des réponses et des sorties, y compris après échec. Les écritures et la clôture sérialisent leur accès à la collecte. Une réécriture identique de sa ligne avance sa version transactionnelle sans modifier ses métadonnées ; PostgreSQL refuse ainsi les instantanés périmés, y compris en `REPEATABLE READ`. Le verrou est pris une fois par collecte et par instruction SQL, plutôt que pour chaque offre d’un insert groupé. Une clôture réussie exige un manifeste, une empreinte et des positions de sortie contiguës correspondant au compteur. La lecture vérifie le manifeste contre le journal immuable.

**Ce manifeste enregistre ce que le lecteur a produit. Il ne certifie pas à lui seul la justesse du lecteur ou l’exhaustivité du portail.** La qualification d’une source doit ensuite vérifier ces éléments contre les réponses natives et sa configuration.

Les anciennes collectes de format 1 restent inchangées et consultables. Elles n’ont pas de manifeste complet : la commande de comparaison certifiante échoue explicitement pour elles. Aucune métadonnée manquante n’est reconstituée. Le rejeu technique des réponses reste disponible pour inspection.

## Configuration et budget d’exécution

L’ingestion remet au lecteur une copie JSON immuable de la configuration dont l’empreinte est enregistrée. Elle est bornée à 1 MiB, 10 000 valeurs et 32 niveaux. Les nombres non finis et les valeurs que JSON ne conserve pas exactement sont refusés. `deadlineMs`, `startPage` et `progress` ne peuvent pas entrer dans une nouvelle configuration de capture.

Les délais appartiennent au contexte d’exécution commun. `CaptureBatch.executionBudget` conserve séparément le début, la limite ferme et, si présente, la limite coopérative. Une collecte hors de ce contexte reste explicitement sans budget enregistré. Changer le budget ne change pas l’identité de configuration du portail.

Le délai coopératif peut interrompre proprement la pagination réelle. Il ne coupe pas les pages d’un rejeu selon une ancienne horloge ; ce rejeu reste soumis à la consommation intégrale des réponses et à la comparaison exacte du résultat. Une limite ferme posée par l’appelant continue d’annuler le transport et d’empêcher les écritures après annulation.

Les commandes de validation et de lecture de preuve officielle utilisent ce mécanisme commun. La lecture du corps fait partie du budget et conserve la limite de taille HTTP. L’ancien `Promise.race` qui abandonnait une promesse sans annuler son transport a été supprimé.

Le curseur de collecte tournante, son modèle et ses tests ont été retirés : son seul consommateur était l’ancienne collecte d’offres FashionJobs, déjà interdite par la décision produit. La découverte d’acteurs et le refus explicite de réintroduire des offres FashionJobs sont conservés. Les anciennes lignes de curseur sont sauvegardées avant la migration de reprise ; elles ne contiennent aucune publication ni RAW.

## Stockage et garde de rétention

- Corps bornés à **20 000 000 octets** ; gzip niveau 6, identité sur les octets décompressés. Sorties sauvegardées par transactions de 25, avec ordre de verrous stable. Une collecte contient au plus 100 000 sorties ; le manifeste respecte aussi la limite de 20 Mo. Un dépassement arrête la collecte explicitement.
- Fenêtre chaude de **14 jours**. Un bloc déjà archivé et de nouveau référencé reste réutilisable depuis son archive ; la déduplication ne recrée pas une copie locale inutile.
- Conservation distante d’au moins **12 mois** ; aucune suppression automatique des preuves référencées. Cette durée minimale n’est pas une promesse de purge à douze mois.
- Une page de plan contient au plus 1 000 observations et 1 000 blocs ; taille par défaut 250 de chaque. Périmètre de sources et empreinte exigés à l’application.
- Envoi distant, **relecture complète**, vérification taille + SHA-256 gzip, pointeur immuable, puis retrait des octets locaux. Les lectures décompressent et vérifient également la taille et le SHA-256 natifs.
- Les références récentes des réponses, observations, sorties et manifestes protègent les blocs lors du contrôle sous verrou avant purge. Une panne distante laisse les octets disponibles en base. Le même plan peut être repris sans double suppression.
- Les anciennes lignes `SourceObservation` restent en base avec leur identité et leur contenu ou pointeur ; elles ne sont plus remplacées par une seconde table de références.

Le SDK officiel AWS gère la signature et le transport S3. Le préfixe d’environnement est obligatoire. Les opérations sont bornées en temps et en taille. Le stockage n’expose aucune opération de suppression distante. Les tables d’archive remplacées ne peuvent être supprimées par la migration si elles contiennent un pointeur : leur reprise doit alors précéder la migration.

### Métadonnées et accès

Cookies et Authorization ne sont pas conservés dans les métadonnées. Les valeurs des paramètres d’URL sont masquées dans l’URL d’audit. Les corps de requête ne sont pas copiés ; ils participent à une empreinte. Les corps natifs peuvent contenir des données présentes dans une page publique : ils restent privés et ne sont pas servis par l’API du catalogue.

Les fichiers de lecture et de configuration sont privés. Les identifiants S3 restent dans les variables d’environnement ou dans un fichier local d’accès protégé, jamais dans Git ni dans les rapports.

## Commandes maintenues

À exécuter depuis la racine du dépôt, avec la base ciblée explicitement dans l’environnement. En production, appliquer les [gardes et répétitions ops](../../apps/aggregator/scripts/ops/README.md).

```sh
npx tsx apps/aggregator/scripts/ops/raw-capture.mts --capture=<id> --out=<fichier-prive>
npx tsx apps/aggregator/scripts/ops/raw-capture.mts --output=<id> --out=<fichier-prive>
npx tsx apps/aggregator/scripts/ops/raw-capture.mts --observation=<id> --out=<fichier-prive>
npx tsx apps/aggregator/scripts/ops/raw-capture.mts --replay=<batch-id> --config=<configuration-privee.json> --out=<resultat-prive.json>
npx tsx apps/aggregator/scripts/ops/retention.mts --keys=<source1,source2> --out=<plan-prive.json>
npx tsx apps/aggregator/scripts/ops/retention.mts --plan=<plan-prive.json> --hash=<empreinte> --apply
```

Variables obligatoires : `OBSERVATION_ARCHIVE_S3_ENDPOINT`, `REGION`, `BUCKET`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `PREFIX` avec le même préfixe `OBSERVATION_ARCHIVE_S3_`. `FORCE_PATH_STYLE` accepte seulement `true` ou `false` ; utiliser `false` pour l’adressage virtuel Railway.

## Mesures de capacité et limites

Le stock analysé contient **85 327 sorties d’adaptateurs**, soit 723 892 072 octets JSON et 206 309 536 octets gzip par corps. Ce sont des sorties historiques, pas les réponses HTTP complètes. La mesure en production a trouvé les deux anciennes tables d’archive vides.

Le test réel a capturé 118 offres de deux API et une page HTML : **1 444 172 octets natifs**, **200 872 octets gzip natifs**, et **366 473 octets gzip de sorties**. Les 121 blocs ont été envoyés sur Railway, relus et vérifiés ; les offres ont été rejouées hors ligne à l’identique. Ce petit corpus valide le mécanisme et mesure son volume ; il ne représente pas la répartition mondiale des sources.

Railway facture le stockage objet 0,015 $/Go/mois au tarif consulté le 15 septembre 2026. Ainsi 100 Go conservés correspondent à 1,50 $/mois de stockage, avant les autres postes. Les sorties du service vers le bucket passent par le réseau public et peuvent générer des frais réseau. [Tarification officielle](https://docs.railway.com/storage-buckets/billing).

Le budget mondial doit être recalculé pendant la qualification des sources à partir des octets capturés et **des nouveaux blocs distincts par cycle**, puis testé sous charge. Une extrapolation des deux API vers tous les sites HTML serait trompeuse. Le lecteur navigateur contrôle la taille annoncée avant lecture, mais Playwright bufferise les corps sans taille annoncée avant le contrôle final : ce coût mémoire fait partie des mesures de charge à réaliser avant ouverture mondiale.
