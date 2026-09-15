# Captures natives, sorties d’extraction et rétention

Contrat du lot 2, 15 septembre 2026. L’implémentation est validée localement et le transport d’archive sur un environnement Railway isolé. Les services de production n’utilisent pas encore ces migrations. Les preuves et les limites de livraison figurent dans le [bilan du lot](../../audits/reprise-2026-09-15/lot-2.md).

## Ce qui fait foi

Une réponse HTTP est enregistrée **avant** le traitement de son statut, le décodage JSON ou le parsing HTML. Les octets conservés sont ceux de l’entité délivrée par `fetch`, après décompression HTTP éventuelle. Leurs espaces, champs inconnus et tableaux restent intacts. Ce ne sont pas les octets chiffrés ou compressés circulant sur le réseau.

Le navigateur conserve séparément les réponses document/XHR/fetch et le DOM rendu. Un préfixe reçu avant une coupure porte `complete=false` ; il ne peut pas être rejoué comme une réponse complète. Une erreur de stockage arrête toute l’extraction, y compris lorsqu’un adaptateur intercepte l’erreur après avoir lu d’autres pages.

| Entité | Responsabilité |
|---|---|
| `CaptureBatch` | Source, début d’extraction, empreinte de configuration, version du lecteur et format |
| `RawCapture` | Une tentative, ordre de réception, empreinte de requête, statut, métadonnées et référence des octets |
| `RawBlob` / `RawBlobBody` | Identité SHA-256, taille, empreinte et taille gzip ; octets locaux compressés |
| `SourceExtraction` | Une sortie complète d’offre par collecte et position, conservée avant les transformations communes |
| `CaptureOutcome` | Résultat immuable : EXTRACTED ou FAILED, compteur et empreinte des offres produites |
| `SourceObservation` | Sortie RAW de l’adaptateur et disposition interne séparées ; historique antérieur conservé |
| `RawBlobArchive` | Localisation distante et empreinte gzip vérifiées, immuables |

Deux collectes identiques partagent les blocs mais conservent des identités d’observation distinctes. `JobSource` référence sa dernière sortie et sa collecte ; les sorties anciennes restent consultables indépendamment des mutations du catalogue. La contrainte de base interdit de combiner une sortie et une autre collecte. Le writer vérifie aussi la source et l’identifiant d’offre. Le lot 3 doit encore tracer les décisions champ par champ lors de la projection.

Les champs `publicationHold` et `annotationHash` ne sont plus injectés dans le payload source. La migration reconnaît les anciennes enveloppes uniquement lorsqu’elles contiennent explicitement `sourcePayload` ; elle préserve leur contenu et leur empreinte historiques. Un ancien `SourceObservation` sans capture reste marqué comme tel : les réponses natives perdues ne sont pas reconstituées artificiellement.

## Rejouer sans réseau

Le lecteur rejoue les réponses correspondant à l’empreinte de requête : méthode, URL exacte, corps haché et en-têtes de négociation autorisés. Une requête absente échoue. Les cookies WAF du rejeu sont isolés des sessions réelles et aucun navigateur n’est lancé pour les amorcer.

Le temps de référence de l’extraction est conservé pour les dates relatives et les décisions datées produites par les lecteurs concernés. Chaque reçu natif garde en plus sa propre date de capture. L’outil compare les sorties rejouées à l’empreinte enregistrée ; un écart fait échouer la commande.

Le rejeu complet exige la configuration originale et la version compatible du lecteur. La configuration est hachée, pas copiée avec ses secrets. Conserver sa version privée dans le dossier de preuve du run. La lecture d’un corps par identifiant reste possible sans cette configuration. Les requêtes concurrentes strictement identiques sont consommées dans l’ordre enregistré ; un lecteur dépendant de leur ordre d’arrivée doit être qualifié sur son propre corpus.

## Stockage et garde de rétention

- Corps bornés à **20 000 000 octets** ; gzip niveau 6, identité sur les octets décompressés. Sorties sauvegardées par transactions de 25, avec ordre de verrous stable.
- Fenêtre chaude de **14 jours**. Un bloc déjà archivé et de nouveau référencé reste réutilisable depuis son archive ; la déduplication ne recrée pas une copie locale inutile.
- Conservation distante d’au moins **12 mois** ; aucune suppression automatique des preuves référencées. Cette durée minimale n’est pas une promesse de purge à douze mois.
- Une page de plan contient au plus 1 000 observations et 1 000 blocs ; taille par défaut 250 de chaque. Périmètre de sources et empreinte exigés à l’application.
- Envoi distant, **relecture complète**, vérification taille + SHA-256 gzip, pointeur immuable, puis retrait des octets locaux. Les lectures décompressent et vérifient également la taille et le SHA-256 natifs.
- Une référence récente ajoutée pendant l’envoi protège le bloc sous verrou. Une panne distante laisse les octets disponibles en base. Le même plan peut être repris sans double suppression.
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
