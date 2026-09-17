# Captures natives, sorties d’extraction et rétention

Contrat des lots 2 et 5A à 5G3B2A, actualisé le 16 septembre 2026. L’implémentation est validée localement et le transport d’archive sur un environnement Railway isolé. Les services de production n’utilisent pas encore ces migrations. Les preuves et les limites de livraison figurent dans le [bilan du lot](../../audits/reprise-2026-09-15/lot-2.md).

## Ce qui fait foi

Une réponse HTTP est enregistrée **avant** le traitement de son statut, le décodage JSON ou le parsing HTML. Les octets conservés sont ceux de l’entité délivrée par `fetch`, après décompression HTTP éventuelle. Leurs espaces, champs inconnus et tableaux restent intacts. Ce ne sont pas les octets chiffrés ou compressés circulant sur le réseau.

Le navigateur conserve séparément les réponses document/XHR/fetch et le DOM rendu. Un préfixe reçu avant une coupure porte `complete=false` ; il ne peut pas être rejoué comme une réponse complète. Une erreur de stockage arrête toute l’extraction, y compris lorsqu’un adaptateur intercepte l’erreur après avoir lu d’autres pages.

| Entité | Responsabilité |
|---|---|
| `SourceValidation` | Décision technique immuable, révision du registre, collecte scellée, lecteur, politique, ordre d’enregistrement et rapport dérivé |
| `SourceRevision` | Configuration privée native du registre, empreinte SQL, numéro de transition et date de première observation |
| `CaptureBatch` | Source, révision du registre si connue, but JOBS/SOURCE_IDENTITY/SOURCE_ACCESS, ordre SQL des nouvelles tentatives d’offres, début de capture, empreinte des réglages effectifs, version du lecteur et format |
| `RawCapture` | Une tentative, ordre de réception, clé logique de rejeu, référence privée de provenance des requêtes, statut et référence des octets de réponse |
| `RawBlob` / `RawBlobBody` | Identité SHA-256, taille, empreinte et taille gzip ; octets locaux compressés |
| `SourceExtraction` | Une sortie complète d’offre par collecte et position, conservée avant les transformations communes |
| `CaptureOutcome` | Résultat immuable : EXTRACTED, SOURCE_EVIDENCE ou FAILED ; manifeste du résultat d’offres (format 2) ou des réponses de page (format 3) |
| `SourceIngestionAdmission` | Décisions d’identité et de qualification vérifiées avant le transport d’une collecte d’ingestion, immuables |
| `SourceIngestionCompletion` | Fin immuable d’une collecte admise : devenir de chaque sortie scellée (publiée, retenue, refusée, écartée), rapport haché, lecteur et politique |
| `SourceObservation` | Sortie RAW de l’adaptateur et disposition interne séparées ; historique antérieur conservé |
| `RawBlobArchive` | Localisation distante et empreinte gzip vérifiées, immuables |

Deux collectes identiques partagent les blocs mais conservent des identités d’observation distinctes. `JobSource` référence sa dernière sortie et sa collecte ; les sorties anciennes restent consultables indépendamment des mutations du catalogue. La contrainte de base interdit de combiner une sortie et une autre collecte. Le writer vérifie aussi la source et l’identifiant d’offre. Les faits et présentations issus des lots 3 et 4 tracent séparément les décisions de projection.

Les champs `publicationHold` et `annotationHash` ne sont plus injectés dans le payload source. La migration reconnaît les anciennes enveloppes uniquement lorsqu’elles contiennent explicitement `sourcePayload` ; elle préserve leur contenu et leur empreinte historiques. Un ancien `SourceObservation` sans capture reste marqué comme tel : les réponses natives perdues ne sont pas reconstituées artificiellement.

## Provenance des requêtes

`requestHash` conserve le contrat historique du lecteur : format, méthode, URL originale, corps haché et en-têtes de négociation fournis par l’appelant. Cette clé de rejeu ne prétend pas décrire les en-têtes ajoutés par le transport.

Depuis la migration 66, chaque nouvelle `RawCapture` référence aussi un `RawBlob` privé par `requestDataHash`. Le bloc contient la requête logique et une trace bornée des appels effectués à la frontière du transport : URL exacte sérialisée sans fragment, méthode effective, hash du corps, User-Agent et en-têtes Accept/Accept-Language/Content-Type. Les redirections ajoutent leur statut et les en-têtes Location/Retry-After/Content-Type observés. Les valeurs des corps, cookies, Authorization et autres en-têtes d’authentification ne sont pas copiées. Les URL exactes et leurs paramètres restent privés.

Le transport rend explicites ses en-têtes de représentation et d’identité par défaut. Une redirection POST → GET garde les deux requêtes et leurs hash de corps distincts. Chaque nouvelle tentative conserve sa propre trace. Le relevé se fait immédiatement avant l’appel à fetch, après la file d’attente : une annulation préalable ne devient pas une tentative HTTP observée. L’observation n’acquiert pas une deuxième fois la porte de concurrence déjà détenue par l’extraction.

Les quatre origines sont explicites : `HTTP_TRANSPORT`, `BROWSER_TRANSPORT`, `RENDERED_DOM`, `UNOBSERVED_TRANSPORT`. Le navigateur relève les en-têtes via Playwright ; une indisponibilité arrête le rendu exploitable et conserve un reçu incomplet sans identité inventée. Une requête refusée avant envoi et un document rendu ne sont pas présentés comme une réponse HTTP observée.

Le lecteur privé vérifie la taille (512 000 octets), le schéma fermé, la continuité des redirections, les changements de méthode/corps et la liaison avec le reçu immuable. La rétention et le rejeu vérifient les mêmes empreintes gzip et natives que les corps. Les anciennes lignes restent `requestDataHash = NULL` : leur corps peut être inspecté ou rejoué, mais leur identité de collecteur passée reste inconnue.

**Portée exacte :** cette preuve décrit les appels du transport instrumenté, pas une capture réseau TLS. Les extractions HTTP ordinaires conservent la trace de tous les sauts mais seulement le corps final ; les captures de page d’identité/d’accès conservent chaque corps. Le navigateur conserve les réponses document/XHR/fetch observées, pas l’ensemble des sous-ressources ni les requêtes échouées sans réponse. L’amorçage WAF reste à intégrer au contrôle complet d’accès. Une trace technique n’est jamais une autorisation.

## Rejouer sans réseau

Le lecteur rejoue les réponses correspondant à l’empreinte de requête : méthode, URL exacte, corps haché et en-têtes de négociation autorisés. Une requête absente, une réponse incomplète ou une archive corrompue fait échouer le rejeu, même si le lecteur intercepte cette erreur. Toutes les réponses enregistrées doivent être consommées. Les cookies WAF du rejeu sont isolés des sessions réelles et aucun navigateur n’est lancé pour les amorcer.

Le temps de référence de l’extraction est conservé pour les dates relatives et les décisions datées produites par les lecteurs concernés. Chaque reçu natif garde en plus sa propre date de capture. L’outil compare chaque sortie rejouée, son ordre et son identifiant aux empreintes des octets enregistrés. Il compare aussi toutes les métadonnées du résultat, notamment `complete`, `truncated`, les compteurs, les périmètres et les lignes rejetées. Un écart fait échouer la commande.

Le rejeu complet exige la configuration originale et la version compatible du lecteur. Les réglages effectifs du lecteur sont hachés. Pour une source enregistrée, la révision conserve aussi la configuration native du registre dans la base privée. Les captures historiques ou les sondes non enregistrées restent sans révision ; aucune configuration passée ne leur est attribuée artificiellement. La commande actuelle de rejeu exige encore le fichier privé des réglages effectifs. La lecture d’un corps par identifiant reste possible sans cette configuration. Les requêtes concurrentes strictement identiques sont consommées dans l’ordre enregistré ; un lecteur dépendant de leur ordre d’arrivée doit être qualifié sur son propre corpus.

## Manifeste et clôture de collecte

Les nouvelles collectes d’offres utilisent le format 2 et le but `JOBS`. Le manifeste est un bloc RAW dérivé et borné : métadonnées complètes de `AdapterResult`, identifiants et empreintes des sorties dans leur ordre. Les corps des offres restent dans leurs blocs individuels ; ils ne sont pas dupliqués dans le manifeste. Un résultat vide conserve ainsi la différence entre zéro explicitement énuméré, parcours incomplet et absence de preuve.

La clôture immuable interdit tout ajout ultérieur aux journaux des réponses et des sorties, y compris après échec. Les écritures et la clôture sérialisent leur accès à la collecte. Une réécriture identique de sa ligne avance sa version transactionnelle sans modifier ses métadonnées ; PostgreSQL refuse ainsi les instantanés périmés, y compris en `REPEATABLE READ`. Le verrou est pris une fois par collecte et par instruction SQL, plutôt que pour chaque offre d’un insert groupé. Une clôture réussie exige un manifeste, une empreinte et des positions de sortie contiguës correspondant au compteur. La lecture vérifie le manifeste contre le journal immuable.

**Ce manifeste enregistre ce que le lecteur a produit. Il ne certifie pas à lui seul la justesse du lecteur ou l’exhaustivité du portail.** La qualification d’une source doit ensuite vérifier ces éléments contre les réponses natives et sa configuration.

Les anciennes collectes de format 1 restent inchangées et consultables. Elles n’ont pas de manifeste complet : la commande de comparaison certifiante échoue explicitement pour elles. Aucune métadonnée manquante n’est reconstituée. Le rejeu technique des réponses reste disponible pour inspection.

## Pages d’identité et d’accès

Le format 3 distingue `SOURCE_IDENTITY` et `SOURCE_ACCESS`. Ces captures réutilisent les blocs, journaux, protections de clôture et archives existants ; elles n’ont ni sortie d’offre ni ordre de tentative d’offres. La migration attribue le but `JOBS` aux captures antérieures, issues de ce seul parcours, sans leur inventer de nouvelles preuves ni un ordre historique.

Le reçu `SOURCE_EVIDENCE` signifie que la chaîne HTTP bornée est archivée. Il ne signifie pas que la page démontre une propriété ou une autorisation. Le manifeste privé v2 conserve l’URL initiale exacte, les réponses ordonnées et leurs références de provenance. Il exige une requête HTTP observée par réponse. Le manifeste v1 historique est relu selon ses champs d’origine, sans lui ajouter rétroactivement de hash de requête. La lecture compare ce manifeste au journal, vérifie chaque corps et reconstruit chaque redirection à partir de son en-tête `Location`. Elle refuse une chaîne incomplète, une attribution à une autre URL ou une archive corrompue, sans recours au réseau. Les cookies sont limités à leurs noms ; les paramètres d’URL et les destinations des redirections restent privés.

Une coupure conserve les octets déjà reçus ; une erreur réseau sans réponse conserve une tentative sans statut HTTP. Le résultat est alors `FAILED`. Les contrôles SQL et applicatifs interdisent de transformer ces pages en sorties d’extraction, validation native, publication ou observation d’offre. Capturer une page après une collecte d’offres n’invalide pas sa validation technique. Le [parcours des sources](source-onboarding.md) expose les commandes et leurs limites.

## Configuration et budget d’exécution

L’ingestion remet au lecteur une copie JSON immuable de la configuration dont l’empreinte est enregistrée. Elle est bornée à 1 MiB, 10 000 valeurs et 32 niveaux. Les nombres non finis et les valeurs que JSON ne conserve pas exactement sont refusés. `deadlineMs`, `startPage` et `progress` ne peuvent pas entrer dans une nouvelle configuration de capture.

Les délais appartiennent au contexte d’exécution commun. `CaptureBatch.executionBudget` conserve séparément le début, la limite ferme et, si présente, la limite coopérative. Une collecte hors de ce contexte reste explicitement sans budget enregistré. Changer le budget ne change pas l’identité de configuration du portail.

Le délai coopératif peut interrompre proprement la pagination réelle. Il ne coupe pas les pages d’un rejeu selon une ancienne horloge ; ce rejeu reste soumis à la consommation intégrale des réponses et à la comparaison exacte du résultat. Une limite ferme posée par l’appelant continue d’annuler le transport et d’empêcher les écritures après annulation.

Les commandes de validation et de lecture de preuve officielle utilisent ce mécanisme commun. La lecture du corps fait partie du budget et conserve la limite de taille HTTP. L’ancien `Promise.race` qui abandonnait une promesse sans annuler son transport a été supprimé.

Le curseur de collecte tournante, son modèle et ses tests ont été retirés : son seul consommateur était l’ancienne collecte d’offres FashionJobs, déjà interdite par la décision produit. La découverte d’acteurs et le refus explicite de réintroduire des offres FashionJobs sont conservés. Les anciennes lignes de curseur sont sauvegardées avant la migration de reprise ; elles ne contiennent aucune publication ni RAW.

## Révisions du registre et collecte en cours

Une modification réelle du nom, du lecteur, de sa configuration, du domaine, du motif d’URL, du rang de source ou de l’identité de tenant crée une révision immuable. Le retour A → B → A produit trois identités distinctes : retrouver les mêmes paramètres ne doit pas réactiver une ancienne validation. Les mises à jour de santé, de statut ou de notes ne créent pas de révision de configuration.

Le registre fournit directement son JSON et sa révision au moteur. La lecture utilise le texte JSONB natif pour éviter la conversion numérique du pilote. Le résolveur des réglages est commun à l’ingestion et au contrôle de capture. Avant toute requête, une source enregistrée doit correspondre au lecteur, aux réglages et, pour l’ingestion, à la révision active chargée. La création de collecte et ce contrôle partagent une transaction avec verrou de lecture sur la source.

Changer la configuration d’une source active la met en pause. Un retrait explicitement demandé reste un retrait. La transaction de publication vérifie à nouveau la révision et la verrouille jusqu’à son terme ; une collecte devenue obsolète reste archivée sans autoriser une publication dans le nouveau périmètre. L’inspection historique des archives reste indépendante de ce droit de publication. La [décision d’accès](source-access.md) est chargée avant le transport et conservée dans `CaptureBatch.accessDecisionId`. Le résultat porte HTTP_ONLY ou UNSUPPORTED_TRANSPORT ; les résultats historiques sans marqueur restent inconnus. Une amorce navigateur/WAF rend la couverture HTTP insuffisante, même si les seules réponses conservées ensuite sont HTTP. Un refus de périmètre bloque les appels suivants et la publication tout en conservant la trace des requêtes déjà parties.

Le premier instantané de migration décrit uniquement l’état constaté du registre. Les instantanés survivent au retrait d’un brouillon, sans lien en cascade qui effacerait leur histoire. Leur contenu est privé et peut contenir des paramètres d’accès déjà présents dans le registre ; il ne doit jamais être journalisé ou servi publiquement.

## Validation technique d’une source

`validateCapturedSource` relit une collecte de format 2 liée au registre. Les réglages sont reconstruits depuis le texte JSONB privé de sa révision. Le lecteur actuel rejoue toutes les réponses sans réseau, puis compare chaque sortie et toutes les métadonnées au manifeste scellé. Chaque publication proposée doit également passer le lecteur RAW qualifié de sa famille : identité native, contenu propre et état publiable. Les publications retenues restent comptées séparément.

Une collecte tronquée, une énumération explicitement incomplète, des identifiants dupliqués, des lignes rejetées ou du contenu inexploitable produisent `REJECTED`. Une archive inaccessible ou corrompue ne conserve pas un ancien succès : la tentative produit un nouveau rejet explicite. Une entrée qui ne désigne pas une collecte enregistrée et scellée est refusée avant création d’une décision.

Un résultat vide ne suffit pas. Le protocole de zéro offre est actuellement qualifié pour Ashby uniquement : une réponse native complète HTTP 200, `apiVersion: "1"` et `jobs: []`, en plus du rejeu exact. Les autres familles vides restent à qualifier. La validation technique n’atteste aucune disparition : son rapport porte toujours `absenceAttestation: false`. Une complétude inconnue reste `UNKNOWN` et ne devient pas une preuve d’exhaustivité.

La promotion exige la dernière décision `VALIDATED` de la révision courante, émise avec le lecteur et la politique actuels, sur une capture observée depuis moins de 24 heures. Un rejeu récent ne rajeunit pas une capture ancienne. Une décision plus récente de rejet remplace la précédente pour cette porte. Une tentative d’offres plus récente, même échouée ou encore inachevée, empêche de réutiliser ce succès. Les nouvelles captures portent un ordre SQL indépendant de l’horloge ; les captures historiques sans ordre connu exigent une recollecte avant promotion. L’ordre SQL des décisions évite également les collisions d’horloge ; l’ajout d’une décision et la promotion partagent les verrous du registre. La colonne de compteur manuel `verifiedJobCount` a été supprimée ; un flux natif vide prouvé peut être activé sans inventer d’offre.

`source-onboard.mts` propose deux opérations explicites, sans activation automatique :

```sh
npx tsx apps/aggregator/scripts/ops/source-onboard.mts collect <clé> --apply --deadline-ms=30000 --out=<rapport-privé.json>
npx tsx apps/aggregator/scripts/ops/source-onboard.mts validate <capture-id> --apply --out=<rapport-privé.json>
```

La première lit la configuration courante du registre, capture et valide. La seconde revalide une capture, y compris depuis l’archive S3. Une collecte vide retourne elle aussi son identifiant de preuve ; cet identifiant ajouté après clôture ne fait pas partie des métadonnées natives du manifeste. Les options ambiguës, inconnues ou répétées sont refusées avant tout travail. Un rejet technique fait sortir la commande en erreur ; les rapports contiennent des identifiants et des comptes, sans configuration ni corps d’offre.

Cette validation ne certifie ni l’employeur, ni l’autorisation d’accès, ni l’absence d’offres. Les portes d’identité et d’accès restent distinctes. La [revue d’identité](../employer-identity.md) exige désormais la révision exacte du registre et un ordre SQL enregistré ; les preuves historiques non liées restent consultables sans certifier la configuration actuelle. Le [parcours unique](source-onboarding.md) remplace les anciennes orchestrations et leur colonne de volume. Le contrôle d’accès des captures d’ingestion déjà actives est désormais lié à une décision immuable, revérifiée lors de la publication. Les autres portes d’ingestion, les preuves d’absence liées au périmètre et les références privées des paramètres d’accès restent obligatoires avant release. Les empreintes locales et les identifiants de release Railway doivent être conciliés lors de cette qualification ; un certificat local n’est pas présenté comme un certificat de production.

## Stockage et garde de rétention

- Corps bornés à **20 000 000 octets** ; gzip niveau 6, identité sur les octets décompressés. Sorties sauvegardées par transactions de 25, avec ordre de verrous stable. Une collecte contient au plus 100 000 sorties ; le manifeste respecte aussi la limite de 20 Mo. Un dépassement arrête la collecte explicitement.
- Fenêtre chaude de **14 jours**. Des octets fraîchement recapturés, identiques à un bloc déjà froid, rétablissent sa copie chaude sous verrou. L’identité native et gzip doit correspondre exactement ; un changement de représentation gzip est refusé sans réécrire la preuve historique. Les anciennes attestations et pointeurs distants restent inchangés.
- Conservation distante d’au moins **12 mois** ; aucune suppression automatique des preuves référencées. Cette durée minimale n’est pas une promesse de purge à douze mois.
- Une page de plan contient au plus 1 000 observations et 1 000 blocs ; taille par défaut 250 de chaque. Périmètre de sources et empreinte exigés à l’application.
- Envoi distant, **relecture complète**, vérification taille + SHA-256 gzip, pointeur immuable, puis retrait des octets locaux. Les lectures décompressent et vérifient également la taille et le SHA-256 natifs.
- Les références récentes des réponses, provenances de requête, observations, sorties, manifestes et rapports de fin d’ingestion protègent les blocs lors du contrôle sous verrou avant purge. Une panne distante laisse les octets disponibles en base. Le même plan peut être repris sans double suppression.
- Les anciennes lignes `SourceObservation` restent en base avec leur identité et leur contenu ou pointeur ; elles ne sont plus remplacées par une seconde table de références.

Le SDK officiel AWS gère la signature et le transport S3. Le préfixe d’environnement est obligatoire. Les opérations sont bornées en temps et en taille. Le stockage n’expose aucune opération de suppression distante. Les tables d’archive remplacées ne peuvent être supprimées par la migration si elles contiennent un pointeur : leur reprise doit alors précéder la migration.

### Métadonnées et accès

Les valeurs des en-têtes Cookie et Authorization ne sont pas conservées dans les métadonnées de requête. Les valeurs des paramètres d’URL sont masquées dans l’URL d’audit. Les corps de requête ne sont pas copiés ; ils participent à une empreinte. Les corps natifs peuvent contenir des données présentes dans une page publique : ils restent privés et ne sont pas servis par l’API du catalogue.

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

### Admission avant transport

Une collecte destinée à l’ingestion conserve une ligne immuable `SourceIngestionAdmission`, créée atomiquement avec son batch. Elle lie la revue d’identité et la qualification technique ayant permis de démarrer ; le batch lie déjà sa décision d’accès. Le statut expose ces identifiants sans dossier privé. Une sonde de qualification n’a pas d’admission, et SQL interdit de lui en ajouter après sa transaction d’allocation. Les anciennes captures ne reçoivent aucune admission inventée. Le [contrat d’ingestion](source-ingestion.md) décrit la validation du nouveau résultat et les contrôles de publication.

### Frontière de publication obligatoire

Depuis 5G3B3B, l’écrivain d’observation d’ingestion exige les deux pointeurs batch/sortie et vérifie le corps archivé. Les écrivains publics refusent les captures sans révision du registre et les sondes sans admission. Le [contrat d’ingestion](source-ingestion.md) décrit les retenues, les exclusions séparées du RAW et la revalidation transactionnelle des retraits. Les anciennes observations sans capture demeurent lisibles et transférables en archive ; aucun nouveau parcours d’ingestion ne recrée ce format historique.

### Fin d’ingestion et preuve d’absence

Depuis 5G3C, une collecte admise se termine par `SourceIngestionCompletion` : le devenir de chaque sortie du manifeste, scellé dans un rapport haché conservé comme bloc RAW. SQL refuse ce rapport pour une sonde, une capture échouée ou des compteurs qui laissent une sortie sans devenir ; la ligne est immuable. La preuve d’absence du refresh se lit exclusivement sur cette chaîne — capture admise, manifeste scellé, fin d’ingestion, porte de publication courante — jamais sur l’historique de santé `SourceRun` ni sur le journal `PipelineEvent`, qui ne portent plus que des enveloppes bornées de diagnostic. Le [contrat d’ingestion](source-ingestion.md#preuves-dabsence) précise les faits dérivés et les refus.
