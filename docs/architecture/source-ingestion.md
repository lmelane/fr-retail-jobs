# Admission des collectes d’ingestion

État du lot 5G3B3B, 16 septembre 2026. Ce contrat couvre les collectes et les écritures d’ingestion. Il complète la [qualification](source-onboarding.md) et le [contrat d’accès](source-access.md).

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

## Qualification et limites

`source-onboard collect` garde son rôle de qualification : collecter et valider une source DRAFT ou PAUSED sans publier. Ses captures n’ont pas de ligne d’admission. Cette étape reste nécessaire pour rétablir une qualification après un échec ou un changement de lecteur. Les pages d’identité et d’accès restent des preuves séparées, sans admission d’ingestion.

Les écrivains d’ingestion n’acceptent plus de données sans capture. Une observation historique reste lisible et archivable à froid ; elle ne reçoit aucune provenance fabriquée. Les fonctions de réparation historique conservent leur contrat explicite de plan, preuves et audit.

La politique technique actuelle refuse aussi un flux non vide composé uniquement de retenues, sans publication qualifiée ; ce lot ne change pas ce critère. Les tests de retrait utilisent un flux mixte réellement validé. Les attestations d’absence, les rapports de run et la publication complète d’un flux restent à lier à leur capture. Le contrôle par écriture bloque une ancienne collecte après un démarrage plus récent ; il ne rend pas atomique la publication de toutes les offres d’un flux.

## Retenues et retraits

Les écrivains copient les données appelantes avant leur première attente. Une mutation ultérieure du RAW, du motif, de la date ou des pointeurs ne change pas la demande en cours. La lecture vérifie l’identité de la sortie, son SHA-256, son RAW et son URL. Une offre retenue ou retirée dans la capture ne peut pas être publiée en effaçant simplement ces annotations. L’exception existante d’employeur absent sur un portail Workday exige toujours le périmètre SINGLE_BRAND certifié courant.

`archivePublicationHold` archive l’observation sous contrôle d’admission. Un retrait passe ensuite par `deactivateCapturedPublication` : cette fonction dérive son périmètre et sa disposition de l’entrée vérifiée, puis revérifie l’admission et la politique dans chaque transaction qui modifie une représentation, attachée ou en quarantaine. Une révocation entre archivage et désactivation conserve la preuve mais refuse le retrait. Une attestation plus récente conserve la priorité. La fermeture et le retrait gardent leurs événements distincts et leur idempotence.

Un motif natif et sa date doivent correspondre exactement à la sortie capturée. Une exclusion interne de périmètre garde le RAW intact et exige la décision OUT_OF_SCOPE courante ainsi que sa date. Le contenu exact de la décision appliquée est conservé séparément dans le journal immuable `DataCorrection`, lié à la sortie native, avec les annotations avant/après. Une répétition est idempotente ; une révision ultérieure de la décision ne modifie pas cette preuve. Une défaillance de lecture du registre ne devient plus un périmètre vide. La migration 69 sérialise INSERT, UPDATE et DELETE de `PostingScopeDecision` avec les écritures de la source, même lorsqu’aucune ligne de décision n’existait ; elle ne réécrit aucune donnée historique.

`deactivateAdministrativeSources` est réservé au retrait administratif SOURCE_RETIRED et au nettoyage de génération. Il ne représente pas une observation native ni une autorisation d’ingestion. Les preuves d’absence et ce nettoyage de génération restent à auditer dans le lot suivant.

Les contrats d’identité non encore qualifiés restent refusés. Ce document ne certifie ni l’ensemble des sources existantes ni une release Railway différente du lecteur effectivement testé. Le CRON reste une phase distincte.
