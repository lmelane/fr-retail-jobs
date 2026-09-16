# Lot 5G3B3B — publication et retraits liés aux captures admises

**16 septembre 2026. Validé localement, schéma 69. Aucun push, déploiement, changement de production ou activation du CRON.** Le périmètre de ce lot est la frontière des écrivains d’ingestion ; le produit entier n’est pas déclaré prêt à déployer.

## Résultat

Les nouvelles observations d’ingestion exigent les deux pointeurs batch/sortie et vérifient les octets archivés. Les écrivains publics refusent une capture non enregistrée et une sonde de qualification dépourvue d’admission. Les anciennes observations sans capture restent lisibles et transférables en archive, sans provenance fabriquée.

L’entrée appelante est copiée avant la première attente : modifier ensuite son RAW, son titre, ses pointeurs ou sa date ne change pas l’écriture en cours. La révision est contrôlée avant le traitement d’identité ; l’admission est revérifiée après l’attente des verrous d’écriture pour détecter une expiration intervenue entre-temps. Une retenue native ne peut pas être effacée pour publier.

`archivePublicationHold` conserve l’observation admise. `deactivateCapturedPublication` dérive le périmètre et la disposition depuis l’entrée vérifiée, puis contrôle à nouveau admission et politique dans chaque transaction de désactivation, pour les représentations attachées comme en quarantaine. Une révocation après archivage bloque le retrait et conserve la preuve. Les motifs et dates natifs doivent correspondre à la sortie capturée. Les attestations plus récentes et les événements de fermeture/retrait gardent leur comportement et leur idempotence.

L’ancien écrivain générique devient `deactivateAdministrativeSources`, réservé au retrait SOURCE_RETIRED et au nettoyage de génération. Aucun alias de compatibilité n’est conservé. Les appelants exécutables et les documents de contrat ont été mis à jour.

## Périmètre produit et RAW

Une exclusion interne ne modifie plus le RAW. Le motif et la date sont comparés à la décision OUT_OF_SCOPE courante. Le contenu exact de cette décision est conservé dans le journal immuable `DataCorrection`, lié à `SourceExtraction`, avec les annotations avant/après et l’empreinte de sortie. Une répétition ne crée pas de doublon ; une révision ultérieure de la décision ne réécrit pas sa preuve. Les observations historiques restent inchangées.

La lecture du registre ne transforme plus une panne en liste vide d’exclusions. La migration 69 sérialise INSERT, UPDATE et DELETE de `PostingScopeDecision` avec les écritures de source, y compris lorsqu’aucune ligne n’existait auparavant. Elle ne réécrit aucune donnée.

## Validation et audit défensif

La [validation complète](preuves/lot-5g3b3b-validation.json) compte **3 616 tests réussis** : 2 585 unitaires, 761 d’intégration, 259 API et 11 Python. Deux tests API optionnels restent ignorés. Types et build API passent. Les [69 migrations depuis une base neuve](preuves/lot-5g3b3b-fresh-migrations.json) sont vérifiées avec les noms définitifs et les mêmes octets SQL que la suite complète.

Les 28 nouveaux scénarios de frontière utilisent les véritables captures, lecteurs, admission, rejeu, gardes SQL et écrivains ; seul le transport HTTP amont est synthétique. Les scénarios préexistants consacrés à la persistance de nombreux ATS isolent explicitement l’admission dans `publicationPersistenceFixture.ts` et conservent la vérification réelle des sorties archivées, de l’identité, des faits, de la déduplication et du cycle de vie. Cette fixture ne représente pas une qualification native et n’est importée par aucun chemin de production. Les tests d’admission, de capture et de réparation restent sans cette simulation. Le contrôle des sources retirées a été déplacé dans la suite de frontière réelle.

Les [22 contre-épreuves](preuves/lot-5g3b3b-counterproofs.json), 18 applicatives et quatre SQL, sont toutes détectées. Elles réintroduisent notamment l’ancien écrivain sans capture, l’absence d’admission, les retraits après révocation, les objets mutables, les motifs/dates/RAW/URL falsifiés, la suppression d’une retenue native, les décisions de périmètre ignorées, la perte ou la mutation de leur journal et les qualifications expirées pendant un verrou. **65 tests repassent après restauration exacte du code et des gardes.**

Les [282 fichiers du runtime](preuves/lot-5g3b3b-runtime-match.json) sont identiques entre le répertoire de travail et la copie exécutée :

`local-sha256:2863893eaaf12ec3719287d108d30b0f65b8f4edf88f692879900415f0a47edf`

Cette empreinte inclut les travaux utilisateur conservés localement ; elle ne certifie pas une image de release construite depuis le seul commit Git.

## Preuve native et Railway

La [preuve Polène/Ashby](preuves/lot-5g3b3b-live-admission.json) observe **80 offres** depuis la page officielle archivée, son lien vers le board exact, le feed public et son document robots. La calibration et la nouvelle collecte admise sont techniquement validées.

**90 blocs**, comprenant les sorties, sont envoyés au stockage Railway, relus puis retirés de la copie chaude. Deux validations identiques sont effectuées à froid, sans appel HTTP au portail. Les 80 tentatives d’écriture depuis les sorties froides sont refusées pour `PORTAL_OWNER_NOT_CERTIFIED` : le lien officiel certifie la relation au portail, sans inventer une revue SINGLE_BRAND. Les écritures positives avec périmètre certifié sont couvertes par les tests d’intégration réels sur transport synthétique ; cette expérience native est une preuve de lecture et de refus, pas une publication réelle réussie.

Le refus après remise en PAUSED est également vérifié. **Cette expérience native ne publie aucune offre**, dans la base de test comme en production. Seule la source isolée passe temporairement par ACTIVE puis PAUSED.

## Stock et préservation

La [répétition 68 → 69](preuves/lot-5g3b3b-stock-migration.json) conserve exactement comptes et empreintes des sept tables contrôlées : 87 607 offres, 90 764 représentations, 141 933 observations, 536 sources, 536 révisions, 112 revues d’identité et 224 décisions de périmètre. Les 536 anciennes notes d’accès restent identiques. Aucune capture, admission ou activation n’est fabriquée sur le clone.

La sauvegarde complète du schéma 60 et ses répétitions précédentes restent disponibles ; la restauration complète n’est pas répétée dans ce lot. La reprise exige les migrations 61 à 69. Les fichiers de ce lot et les journaux sont conservés dans `backups/reprise-20260916-lot5g3b3b`, avec répertoire 0700 et archives/manifeste 0600.

Le [contrôle des fichiers utilisateur](preuves/lot-5g3b3b-preservation.json) conserve 82 des 86 fichiers initiaux exactement, les quatre exceptions déjà documentées et les 83 configurations originales. Les trois fichiers utilisateur modifiés et les 25 fichiers non suivis initiaux restent hors commit. Les autres dépôts ne changent pas.

## Limites et suite

La politique technique existante refuse un flux non vide composé seulement de retenues, sans publication qualifiée ; les scénarios de retrait de ce lot utilisent un flux mixte validé. Ce critère et les fermetures doivent être examinés avec les preuves d’absence.

Les `SourceRun`, attestations d’absence et nettoyages de génération restent à rattacher aux captures. La publication d’un flux entier n’est pas atomique. Les contrats d’identité et de périmètre des autres sources, le transport navigateur, les secrets de configuration, les recherches/facettes par pays, la cohabitation native/externe et les essais de charge restent des travaux de la phase globale. Les audits historiques datés sont conservés comme preuves ; les documents de fonctionnement actuels renvoient au [contrat d’ingestion](../../docs/architecture/source-ingestion.md).
