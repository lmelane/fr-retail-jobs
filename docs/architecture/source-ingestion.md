# Admission des collectes d’ingestion

État du lot 5G3C, 16 septembre 2026. Ce contrat couvre les collectes, les écritures d’ingestion, la fin d’ingestion et les preuves d’absence qui en découlent. Il complète la [qualification](source-onboarding.md) et le [contrat d’accès](source-access.md).

## Avant le premier appel réseau

Le statut ACTIVE est une disponibilité opérationnelle, pas une preuve. `captureExtraction` avec `requireActive: true` prend les verrous de source, contrôle la révision, les paramètres et l’adaptateur, puis exige :

- la dernière décision d’accès valide pour la révision et le lecteur courants ;
- la dernière décision d’identité native positive, liée à cette révision et encore récente ;
- la dernière qualification technique positive, calculée avec le lecteur courant depuis une capture de moins de 24 heures, sans tentative d’offres plus récente.

Le choix ingestion/qualification et la révision demandée sont copiés et figés avant la première attente asynchrone ; une mutation de l’objet appelant ne peut pas les remplacer. Le batch et sa ligne `SourceIngestionAdmission` sont créés dans la même transaction. Cette ligne conserve les identifiants de la revue d’identité et de la qualification ayant justifié le démarrage ; le batch porte déjà l’identifiant de décision d’accès. Elle est immuable. Une absence de décision ou un refus annule l’allocation avant tout transport.

SQL exige une source ACTIVE, les dernières décisions liées à sa révision, leurs politiques et leur fraîcheur. Le batch doit avoir été créé dans la transaction courante et ne doit contenir aucun reçu ou résultat. Une sonde antérieure ne peut donc pas devenir rétroactivement une ingestion admise. La migration ne fabrique aucune admission historique.

Les verrous sont libérés avant le réseau. Deux démarrages simultanés ne peuvent pas emprunter la même qualification : le second voit la nouvelle tentative et doit attendre sa validation ou une nouvelle collecte de qualification. Une collecte échouée ou interrompue demeure un témoin ; son absence de résultat positif ne laisse pas une ancienne qualification réutilisable.

## Après la collecte

L’ingestion relit ses nouvelles archives hors réseau et enregistre une validation technique avant de traiter les offres. Une validation REJECTED conserve les preuves mais interrompt ce parcours. Ce contrôle est aussi effectué pour un flux vide, où aucun écrivain d’offre individuel ne serait appelé.

Toute publication exige une sortie native archivée, liée à une capture du registre. Les sondes non enregistrées restent lisibles mais ne peuvent pas publier. Sous les verrous de source, avant le traitement d’identité puis à nouveau après l’attente des verrous d’écriture :

- la source doit toujours être ACTIVE sous la même révision ;
- la décision d’accès doit toujours être celle qui gouvernait la collecte ;
- une admission doit exister sous la politique courante ;
- la décision d’identité doit toujours être celle de cette admission ;
- la dernière qualification valide doit porter sur cette capture précise, sans tentative plus récente.

Une nouvelle décision d’identité positive impose elle aussi une nouvelle collecte : le résultat ne s’attribue pas implicitement un périmètre d’employeur changé pendant son exécution. Une validation plus ancienne ne qualifie pas les nouveaux octets. Les requêtes déjà parties restent conservées ; une révocation ne peut les rappeler rétroactivement.

## Fin d’ingestion

Chaque sortie scellée du manifeste a un devenir nommé par la boucle de publication : publiée, retenue (motif natif ou décision de périmètre), refusée à l’écriture (classe d’erreur seulement, jamais un message pouvant porter une URL ou un paramètre) ou écartée par le filtre sectoriel d’un jobboard. Après le dernier écrivain, l’ingestion enregistre `SourceIngestionCompletion` : une ligne immuable par collecte admise, liée à son batch et à un rapport haché conservé comme bloc RAW, avec les compteurs publiées/retenues/échecs/écartées, le lecteur et une politique versionnée (`native-ingestion-completion/1`).

SQL refuse ce rapport pour une sonde de qualification, pour une capture sans résultat EXTRACTED et lorsque les compteurs ne couvrent pas exactement toutes les sorties. La ligne prend le verrou partagé de la source comme les autres écrivains ; elle ne peut être ni modifiée ni supprimée. Une répétition du même rapport est idempotente ; un rapport différent pour la même collecte est refusé. Les blocs de rapport sont protégés par la rétention comme les manifestes, et relisibles depuis l’archive froide vérifiée.

Une interruption avant ce rapport laisse une collecte scellée mais sans fin d’ingestion : les offres déjà écrites sont conservées, rien n’est fabriqué, et cette collecte ne peut prouver aucune absence. L’ancien nettoyage de génération (`pipelineVersion` inférieur à la génération du lecteur, fermeture `CLOSED` sur des statistiques en mémoire) a été supprimé avec ses tests ; `PIPELINE_VERSION` reste une provenance d’écriture. Mesuré sur le clone de répétition le 16 septembre 2026, ce nettoyage ne couvrait aucune offre active.

## Preuves d’absence

Le refresh ne lit plus ni `SourceRun` (historique de santé élagué à dix jours) ni le journal `PipelineEvent`. Pour chaque source, il lit sa **capture attestante** (`pipeline/attestingCapture.ts`) : la dernière tentative d’offres de la révision courante, par ordre SQL, qui doit être admise, scellée avec son manifeste et achevée par sa fin d’ingestion, et qui doit encore passer la même porte que la publication (`requireCurrentCaptureRevision`). Une source non ACTIVE, une révision changée, un accès révoqué, une identité remplacée, une qualification périmée ou une tentative plus récente retirent le droit d’attester, en prévisualisation comme sous les verrous d’écriture.

Les faits d’attestation sont dérivés du manifeste scellé et du rapport de fin d’ingestion : complétude et terminaison du parcours, total déclaré, troncature, identifiants canoniques observés, lignes rejetées, échecs d’écriture, retenues, écartées, et la dernière collecte productive précédente de la source. Une première collecte n’a pas de passé et n’atteste rien ; un zéro explicitement déclaré et intégralement parcouru peut attester. Toute disposition doit porter sur un identifiant observé et tout identifiant observé doit avoir un devenir connu ; un rejet ou un échec sans identifiant rend la collecte non probante. Les seuils de couverture et d’effondrement ne servent qu’à refuser.

Une représentation n’est déclarée absente que si son identifiant ne figure pas dans l’ensemble observé de cette capture, et si elle n’a été ni retenue, ni refusée à l’écriture, ni rejetée, ni écartée pendant cette collecte. Le manifeste de refresh, version 4, nomme la capture attestante et l’empreinte de sa preuve ; l’application sous verrou relit la même preuve, et toute preuve changée ou disparue est journalisée comme omission dans `DataCorrection`, avant tout changement de conséquence. Une preuve scellée illisible, y compris une archive froide indisponible, ne provoque aucun repli : la source est non vérifiable.

Les adaptateurs qui n’archivent pas d’identifiants canoniques restent incapables de prouver une absence ; sur le stock actuel, aucune source n’a encore de capture attestante. Une fermeture par absence reste distincte d’une échéance native dépassée, d’un retrait natif capturé et d’un retrait administratif.

## Retenues et retraits

Les écrivains copient les données appelantes avant leur première attente. Une mutation ultérieure du RAW, du motif, de la date ou des pointeurs ne change pas la demande en cours. La lecture vérifie l’identité de la sortie, son SHA-256, son RAW et son URL. Une offre retenue ou retirée dans la capture ne peut pas être publiée en effaçant simplement ces annotations. L’exception existante d’employeur absent sur un portail Workday exige toujours le périmètre SINGLE_BRAND certifié courant.

`archivePublicationHold` archive l’observation sous contrôle d’admission. Un retrait passe ensuite par `deactivateCapturedPublication` : cette fonction dérive son périmètre et sa disposition de l’entrée vérifiée, puis revérifie l’admission et la politique dans chaque transaction qui modifie une représentation, attachée ou en quarantaine. Une révocation entre archivage et désactivation conserve la preuve mais refuse le retrait. Une attestation plus récente conserve la priorité. La fermeture et le retrait gardent leurs événements distincts et leur idempotence.

Un motif natif et sa date doivent correspondre exactement à la sortie capturée. Une exclusion interne de périmètre garde le RAW intact et exige la décision OUT_OF_SCOPE courante ainsi que sa date. Le contenu exact de la décision appliquée est conservé séparément dans le journal immuable `DataCorrection`, lié à la sortie native, avec les annotations avant/après. Une répétition est idempotente ; une révision ultérieure de la décision ne modifie pas cette preuve. Une défaillance de lecture du registre ne devient plus un périmètre vide. La migration 69 sérialise INSERT, UPDATE et DELETE de `PostingScopeDecision` avec les écritures de la source, même lorsqu’aucune ligne de décision n’existait ; elle ne réécrit aucune donnée historique.

`withdrawRetiredSource` est le seul écrivain sans observation native : il retire les attestations d’une source RETIRED, représentations attachées et en quarantaine comprises, sans fermeture employeur. Il ne représente ni une observation native ni une autorisation d’ingestion.

Les contrats d’identité non encore qualifiés restent refusés. Ce document ne certifie ni l’ensemble des sources existantes ni une release Railway différente du lecteur effectivement testé. Le CRON reste une phase distincte.
