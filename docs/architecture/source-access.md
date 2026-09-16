# Observation des règles d’accès

État relu le **16 septembre 2026**, lot 5G3B2. Ce document décrit le lecteur maintenu ; il ne vaut pas certification d’accès de toutes les sources.

## Trois objets distincts

Le corps natif de `robots.txt`, l’observation calculée pour une requête et la décision d’accès sont distincts. Une autorisation déjà obtenue ne réécrit pas le document observé. La [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html#section-1) distingue elle-même ces règles d’une autorisation d’accès.

Les captures `SOURCE_ACCESS` gardent les réponses et redirections dans le journal natif ; leur lecture vérifie le manifeste et chaque empreinte, y compris depuis l’archive froide. Le [parcours de source](source-onboarding.md) les produit sans activer de source ni publier d’offre.

## Identité et règles

[crawlerIdentity.ts](../../apps/aggregator/src/lib/crawlerIdentity.ts) définit `CatwalksBot`, utilisé dans l’en-tête HTTP et dans le [lecteur de règles](../../apps/aggregator/src/lib/robotsVerdict.ts). L’identité HTTP reste `CatwalksBot/1.0 (+https://catwalks.io/bot)`.

Les groupes nommant exactement ce produit sont combinés sans distinction de casse. À défaut, les groupes `*` sont combinés. Les règles propres à un autre robot ne sont pas empruntées. Les enregistrements inconnus ne séparent pas les groupes ; la comparaison des chemins garde la casse, la requête, les octets UTF-8 et les échappements réservés. La règle la plus spécifique prévaut, avec Allow en cas d’égalité. Références : [RFC 9309, règles](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2), [exemples de comparaison de Google](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec#order-of-precedence-for-rules).

Le lecteur traite les jokers et ancres sans construire de regex depuis les données. Il accepte au moins 500 Kio de texte, borne le chemin à 16 Kio et partage un plafond de cinq millions d’étapes entre toutes les comparaisons. Une limite dépassée interrompt l’évaluation ; une lecture partielle ne rend pas `ALLOWED`.

Les chemins doivent être fournis sous la forme `pathname + query`, sans origine ni fragment. Le lecteur ne choisit pas les requêtes d’un adaptateur à sa place. Les tokens d’agent mal formés sont ignorés ; les variantes non standard contenant un numéro de version ne font pas partie du contrat qualifié.

## Observation HTTP

[robotsReading](../../apps/aggregator/src/lib/candidateChecks.ts) restitue une observation technique :

| Entrée | Observation |
|---|---|
| Réponse 2xx interprétable | `ALLOWED` ou `DISALLOWED` pour le chemin fourni |
| Réponse 404 ou 410 | `NO_ROBOTS` |
| Autre réponse non réussie ou erreur réseau | `UNREACHABLE` |
| Limite ou erreur de comparaison | `UNREACHABLE`, `ROBOTS_RULES_NOT_EVALUATED`, avec statut, taille et hash du corps reçu |

La politique locale est plus restrictive que la possibilité d’accès laissée par la RFC pour certaines autres réponses 4xx. Elle ne transforme pas une erreur en lecture favorable. Un hash identifie un contenu ; il ne date pas la lecture et ne prouve pas une autorisation.

La disponibilité de la page publique du robot doit être mesurée séparément. La fonction inutilisée qui prétendait la vérifier a été retirée, ainsi que les commentaires contradictoires 404/200 et le renvoi à une page supprimée de `apps/web`. Les tests de constantes n’affirment plus mesurer sa disponibilité.

## Décision immuable et périmètre

`source-onboard access revue.json` inspecte hors réseau une collecte JOBS et un document SOURCE_ACCESS par origine réellement interrogée. Le dossier humain nomme la source, sa révision, les captures, le réviseur, la date, la justification et les périmètres publics. Il ne fournit ni verdict robots ni compte de requêtes ni empreinte technique. L’inspecteur reconstruit ces faits depuis les archives vérifiées.

Chaque périmètre contient une origine HTTPS exacte, un chemin exact ou un préfixe de répertoire terminé par `/`, les méthodes GET/HEAD/POST admises, les paramètres fixes et les noms de paramètres variables. Le préfixe racine `/` est refusé. Toute requête et toute redirection doivent correspondre à exactement un périmètre ; aucun périmètre sans témoin observé n’est admis. Chaque méthode et chaque nom de paramètre variable doivent également apparaître dans la capture. Les paramètres supplémentaires, changements de tenant, ambiguïtés de chemin et recouvrements de règles sont refusés. Les valeurs privées restent dans le dossier et les blobs ; les rapports courants donnent uniquement identifiants, comptes et états.

Le contrat `native-http-access/1` certifie uniquement le transport HTTP observé, sous l’identité réelle du collecteur. Le lecteur de robots exige une réponse complète, les métadonnées de chaque requête et une révision identique. Une réponse 200 doit être `text/plain`, UTF-8 valide, bornée à 512 000 octets et sans page HTML ou challenge reconnu. 404/410 restent NO_ROBOTS ; les autres statuts restent UNREACHABLE. Une erreur du comparateur reste UNREACHABLE. Ces observations ne changent pas le fondement de l’autorisation sectorielle déjà donnée.

L’inspection est bornée à 64 périmètres, 64 documents robots et 100 000 requêtes physiques. Le journal est lu par pages de 100 reçus. Chaque corps et enveloppe référencés sont revérifiés depuis le stockage chaud ou froid. La validité expire trente jours après la plus ancienne des observations et de la revue, avec cinq minutes de tolérance pour une horloge légèrement en avance. Une nouvelle révision de source, une nouvelle politique ou un autre lecteur exige une nouvelle qualification. Le même dossier rejoué retrouve son identifiant ; il ne repasse jamais devant un refus ultérieur.

`SourceAccessDecision` est immuable. SQL contrôle la révision courante sous verrou, les références de captures, leur but, leurs résultats, leur lecteur, leur fraîcheur et les projections de couverture. L’inspection applicative vérifie les octets, les chaînes HTTP et les règles. Un refus explicite NOT_AUTHORIZED n’exige pas d’inventer une nouvelle capture : ses listes de périmètres et preuves restent vides.

## Collecte et publication

La promotion, `source-onboard status` et les rapports d’exploitation utilisent le même validateur. Une collecte d’ingestion liée à une source ACTIVE doit obtenir sa décision courante avant de créer le batch et d’effectuer le moindre appel HTTP. Le batch conserve cet identifiant. Chaque requête est ensuite contrôlée juste avant envoi, y compris les redirections ; un refus reste attaché au contexte même si l’adaptateur intercepte l’erreur. Les reçus déjà observés restent conservés.

La publication d’une capture liée au registre vérifie, sous verrou, que sa décision est toujours la dernière décision valide. Une révocation ou un changement de configuration pendant la collecte bloque sa publication. Une révocation ne peut rappeler les requêtes déjà parties : une collecte conserve son instantané de périmètre jusqu’au contrôle de publication. Une collecte de qualification sans décision préalable ne devient pas publiable par installation ultérieure d’un accord ; il faut une nouvelle collecte gouvernée par cet accord.

Les deux anciens champs modifiables ont été retirés de Source et du seed. La migration conserve leur contenu exact dans `SourceAccessArchive`, table d’historique verrouillée en écriture. Les notes nominales d’autorisation ne sont pas perdues et ne sont pas transformées artificiellement en preuve native. Le statut signale la présence de cet historique sans exporter son texte privé.

## Limites avant release

- Les collecteurs navigateur, le DOM dérivé et l’amorçage WAF n’ont pas encore une couverture de transport suffisante. Leur utilisation marque explicitement la capture UNSUPPORTED_TRANSPORT ; les captures historiques sans marqueur restent inconnues. Ils ne peuvent pas obtenir ce certificat HTTP.
- `requestTarget()` et `readRobots()` restent des diagnostics utilisés par les outils de découverte et cassette. Ils ne participent à aucune certification.
- La revue de surface est une décision explicite : une URL ou un MIME seul ne prouve pas qu’un endpoint appartient aux offres publiques. Le lecteur et la configuration sont liés à la décision ; les corps POST variables ne sont pas un nouveau périmètre libre.
- Les collectes admises exigent aussi les décisions d’identité et de qualification technique courantes, puis la validation de leur nouveau résultat. Le [contrat d’ingestion](source-ingestion.md) précise ces contrôles. Les anciens écrivains non liés au registre ont été supprimés en 5G3B3B ; depuis 5G3C, une preuve d’absence exige que la décision d’accès de la capture attestante soit encore la décision courante, en prévisualisation comme sous verrou.
- Les sources existantes doivent obtenir leurs preuves sous le lecteur de release. Le renouvellement automatique des preuves reste à traiter avec l’exploitation et le CRON ; aucune source n’est réactivée par cette migration.

Les [règles](../../audits/reprise-2026-09-15/lot-5g3b1.md) et la [provenance de transport](../../audits/reprise-2026-09-15/lot-5g3b2a.md) ont leurs bilans datés. Les commandes courantes restent dans le [parcours de source](source-onboarding.md).
