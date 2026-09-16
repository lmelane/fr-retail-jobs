# Lot 5G3B3A — admission native des ingestions

**16 septembre 2026. Validé localement, schéma 68. Aucun push, déploiement, changement de production ou activation du CRON.** Ce lot couvre l’admission des collectes liées au registre et leurs contrôles de publication. La fermeture des anciens écrivains sans capture reste au lot suivant ; le produit entier n’est pas déclaré prêt à déployer.

## Résultat

ACTIVE ne suffit plus pour lancer une collecte d’ingestion. Avant le transport, le système vérifie la révision, les paramètres, l’adaptateur et les dernières décisions valides d’accès, d’identité et de qualification technique. Le batch et son `SourceIngestionAdmission` sont créés atomiquement sous les verrous de source. L’admission conserve les décisions exactes, avec une politique versionnée, et ne peut être modifiée ni supprimée.

SQL refuse une admission ajoutée à une capture antérieure, même encore dépourvue de reçus. Le batch doit appartenir à la transaction courante, être lié à une source ACTIVE et aux décisions courantes, sans résultat déjà enregistré. Aucune admission n’est fabriquée pour l’historique.

La nouvelle collecte est ensuite rejouée et validée hors réseau avant le traitement des offres. Le contrôle couvre aussi les flux vides. Chaque publication liée au registre exige la même décision d’accès, la même décision d’identité et une qualification valide de cette capture précise. Une décision négative, une expiration, un changement de révision ou une tentative plus récente bloque le parcours.

Les démarrages concurrents sont sérialisés avant le réseau : un second démarrage ne peut emprunter la calibration que la première tentative vient de rendre insuffisante. Une collecte échouée ou interrompue doit être requalifiée. Une validation réussie du nouveau résultat permet le démarrage suivant.

`source-onboard status` expose les identifiants d’admission, sans dossier privé. Le parcours de qualification conserve son rôle : collecter et valider une source sans publier ni lui inventer une admission d’ingestion. Les messages des portes partagées ne les présentent plus comme réservées à la promotion.

## Défaut reproduit pendant l’audit

Un objet d’appel mutable pouvait changer `requireActive` pendant l’attente SQL et transformer une demande d’ingestion en sonde. Le test a reproduit un appel réseau et une collecte réussie au lieu du refus attendu. Le choix et la révision demandée sont maintenant copiés et figés avant la première attente asynchrone. Le journal RED avant correction et les tests GREEN après correction sont conservés dans la sauvegarde privée.

Les tests de réparation conservent leurs exigences sur les publications et la quarantaine. Leurs nouvelles collectes utilisent un contrat Ashby qualifié, des réponses natives synthétiques et le véritable parseur, l’archive, la revue, le rejeu et les gardes SQL. Aucune porte n’est neutralisée pour faire passer ces scénarios.

## Validation

La [validation complète](preuves/lot-5g3b3a-validation.json) compte **3 588 tests réussis** : 2 585 unitaires, 733 d’intégration, 259 API et 11 Python. Deux tests API optionnels restent ignorés. Types, build API et **68 migrations depuis une base neuve** passent.

Les [14 contre-épreuves](preuves/lot-5g3b3a-counterproofs.json), dix applicatives et quatre SQL, sont toutes détectées. Elles couvrent notamment l’objet d’appel mutable, l’admission sans qualifications, l’expiration, l’ordre des tentatives, la validation d’une autre capture, le changement d’identité, l’absence d’admission, la validation du nouveau résultat, le flux vide révoqué et les références SQL étrangères ou rétroactives. **64 tests repassent après restauration du code et des gardes.**

Les [281 fichiers du runtime](preuves/lot-5g3b3a-runtime-match.json) sont identiques entre le répertoire de travail et la copie exécutée :

`local-sha256:14538ade0d43b17317a3d76240c25863cb1a748b2fdd518d4de180b80ddeb404`

Cette empreinte inclut les travaux utilisateur conservés localement ; elle ne certifie pas une image de release construite depuis le seul commit Git.

## Parcours réel et stockage Railway

La [preuve native Polène/Ashby](preuves/lot-5g3b3a-live-admission.json) utilise la page officielle archivée, son lien vers le board exact, le feed public et son document robots. La collecte de qualification et la collecte admise observent chacune **80 offres**, toutes qualifiées, avec rejeu exact et énumération complète déclarée. Aucun périmètre SINGLE_BRAND n’est déduit automatiquement.

Dans la base de test uniquement, la source passe par la promotion, l’admission et le contrôle de publication, puis revient en PAUSED. **Aucune offre n’est publiée.** Les trois décisions gouvernant le démarrage sont exactement celles conservées dans l’admission et le batch.

Dix blocs natifs nécessaires aux inspections sont archivés sur le bucket Railway isolé puis retirés du stockage chaud. La nouvelle capture est validée deux fois depuis le stockage froid, avec un rapport identique et **zéro appel HTTP au portail**. Le SDK S3 lit le bucket normalement. Les sorties dérivées individuelles des offres ne font pas partie de cette purge ; le rejeu reconstruit leurs empreintes à partir des réponses natives.

## Migration et préservation

La [migration 67 → 68](preuves/lot-5g3b3a-stock-migration.json) conserve exactement les lignes et colonnes existantes de six tables : 87 607 Job, 90 764 JobSource, 141 933 SourceObservation, 536 Source, 536 SourceRevision et 112 SourceIdentityReview. Les 536 notes archivées restent identiques. Zéro admission historique créée, zéro source activée ; les deux nouveaux déclencheurs SQL sont actifs.

La restauration complète du dump de schéma 60 n’a pas été répétée dans ce lot. Elle avait été validée au lot 5D ; sa reprise exige les migrations 61 à 68. La copie du stock ne contient pas de capture native historique : elle ne prouve pas la compatibilité d’une capture qu’elle ne possède pas.

Les [travaux utilisateur](preuves/lot-5g3b3a-preservation.json) restent préservés : 82 des 86 fichiers initiaux inchangés, quatre exceptions documentées, 83 configurations initiales conservées. Les trois fichiers modifiés et les 25 fichiers non suivis initiaux restent hors du commit. La sauvegarde privée du lot conserve les modifications et les journaux de validation.

Les guides [ingestion](../../docs/architecture/source-ingestion.md), [onboarding](../../docs/architecture/source-onboarding.md), [accès](../../docs/architecture/source-access.md) et [capture](../../docs/architecture/native-capture.md) décrivent les appelants réellement maintenus.

## Suite : 5G3B3B

Fermer les chemins historiques qui acceptent encore une offre sans capture ou une capture non liée au registre, sans confondre ingestion et réparation historique auditée. La désactivation consécutive à une observation retenue utilise encore une transaction distincte et doit revérifier l’admission à cette frontière. Les attestations d’absence et les rapports de run doivent aussi être liés à leur capture ; la publication d’un flux entier n’est pas atomique.

Les contrats d’identité ATS/domaines non encore qualifiés, le transport navigateur, les certificats du lecteur de release et l’exploitation restent des travaux distincts. Ce lot n’active aucune source de production et ne masque pas ces écarts par une certification globale.
