# Admission des collectes d’ingestion

État du lot 5G3B3A, 16 septembre 2026. Ce contrat couvre les collectes liées au registre. Il complète la [qualification](source-onboarding.md) et le [contrat d’accès](source-access.md).

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

Lors de chaque publication liée au registre, sous les verrous de source :

- la source doit toujours être ACTIVE sous la même révision ;
- la décision d’accès doit toujours être celle qui gouvernait la collecte ;
- une admission doit exister sous la politique courante ;
- la décision d’identité doit toujours être celle de cette admission ;
- la dernière qualification valide doit porter sur cette capture précise, sans tentative plus récente.

Une nouvelle décision d’identité positive impose elle aussi une nouvelle collecte : le résultat ne s’attribue pas implicitement un périmètre d’employeur changé pendant son exécution. Une validation plus ancienne ne qualifie pas les nouveaux octets. Les requêtes déjà parties restent conservées ; une révocation ne peut les rappeler rétroactivement.

## Qualification et limites

`source-onboard collect` garde son rôle de qualification : collecter et valider une source DRAFT ou PAUSED sans publier. Ses captures n’ont pas de ligne d’admission. Cette étape reste nécessaire pour rétablir une qualification après un échec ou un changement de lecteur. Les pages d’identité et d’accès restent des preuves séparées, sans admission d’ingestion.

Le lot suivant doit fermer les écrivains historiques acceptant des données sans capture ou une capture non liée au registre. Les fonctions de réparation historique conservent leur contrat explicite de plan, preuves et audit ; elles ne constituent pas une admission de nouvelle collecte. Les attestations d’absence, les rapports de run et la publication complète d’un flux restent à lier à leur capture. La désactivation consécutive à une observation retenue a encore sa transaction distincte et doit revérifier l’admission à cette frontière ; le contrôle de l’archivage ne suffit pas à fermer cette course. Le contrôle par écriture bloque une ancienne collecte après un démarrage plus récent ; il ne rend pas atomique la publication de toutes les offres d’un flux.

Les contrats d’identité non encore qualifiés restent refusés. Ce document ne certifie ni l’ensemble des sources existantes ni une release Railway différente du lecteur effectivement testé. Le CRON reste une phase distincte.
