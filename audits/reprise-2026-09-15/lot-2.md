# Lot 2 — captures natives et archive vérifiée

**Validé localement le 15 septembre 2026 ; stockage S3 vérifié sur Railway dans un environnement isolé. Migrations et ingestion de production non basculées.**

## Résultat

Les nouveaux appels de collecte enregistrent les réponses natives avant leur lecture. Les corps JSON et HTML restent disponibles même si le parsing échoue, si le writer du catalogue échoue ou si une maintenance déplace ensuite leur contenu vers l’archive.

Une collecte et chacune de ses sorties d’offre ont une identité immuable. Les contenus identiques partagent des blocs, mais les attestations successives restent distinctes. La publication conserve le lien vers sa dernière sortie. Les dispositions internes sont séparées du RAW. Le [contrat maintenu](../../docs/architecture/native-capture.md) décrit précisément les garanties et les commandes.

## Suppressions et corrections

- Suppression de `observationArchive.ts`, de ses tests remplacés, de `retention-observations.mts` et de `bloc0-snapshot.mts`.
- Remplacement de la signature S3 et du parseur XML faits à la main par le SDK officiel ; suppression des opérations head/list sans appelant.
- Un seul parcours de lecture pour une observation historique, qu’elle soit en base ou en archive. Conservation de son identité après transfert.
- Suppression des copies d’archivage dispersées dans le writer du catalogue. Une observation reçue avant une erreur du catalogue est désormais conservée.
- Mise à jour des requêtes de disposition et des documents obsolètes. Le rapport historique de retenues ne compte plus toutes les observations comme des retenues.
- Alignement du schéma Prisma sur quatre règles déjà présentes dans les migrations : index de secteur et de subdivision administrative, et absence de cascade de mise à jour sur les références de fusion et de revue sectorielle. Le contrôle final ne présente plus de dérive.
- Validation locale utilisable avec l’image PostgreSQL exacte déjà en cache ; une panne DNS du registre Docker ne force plus l’abandon du test.

## Validation

| Contrôle | Résultat |
|---|---:|
| Migrations depuis une base PostgreSQL neuve | 50 appliquées |
| Tests unitaires agrégateur | 2 197 réussis |
| Tests d’intégration agrégateur | 455 réussis |
| Tests API | 245 réussis ; 2 corpus optionnels ignorés |
| Tests Python des outils ops | 5 réussis |
| Total exécuté | **2 902 réussis** |
| TypeScript et build API | Réussis |
| Schéma migrations ↔ Prisma | Aucune dérive |
| Cinq contre-épreuves suivies de restauration exacte | Rouge attendu, puis vert |

Les contre-épreuves retirent successivement la capture avant parsing, la vérification distante avant purge, l’arrêt après panne d’archive en cours d’extraction, le contrôle sortie/collecte et la protection d’une référence récente. Les 19 tests de capture/rétention repassent après restauration. Les témoins couvrent aussi le navigateur, le WAF hors ligne, les corps interrompus, les données inconnues et les lieux multiples.

Une migration exécutée contre des tables temporaires contenant un ancien pointeur refuse leur suppression et conserve le pointeur. Le même garde accepte des tables vides. L’application des 50 migrations complètes est testée séparément depuis zéro.

## Répétition réelle sur Railway

Environnement **`capture-validation-20260915`**, bucket privé à Amsterdam, aucun service applicatif déployé dans cet environnement.

| Source lue | Offres extraites | Réponses natives | Blocs vérifiés | Rejeu hors ligne |
|---|---:|---:|---:|---|
| Polène / Ashby | 79 | 1 JSON | 80 | Identique |
| Amiri / Lever | 39 | 1 JSON | 40 | Identique |
| Globus | Lecture d’entité HTML seulement | 1 HTML | 1 | Octets identiques |

Les 121 blocs ont été relus après retrait de leur copie locale. Un scénario CLI supplémentaire a archivé une observation historique, relu son contenu, puis repris le même plan avec zéro suppression supplémentaire. La commande de rejeu a retrouvé les 79 sorties Polène. Le bucket contient 122 objets, 567 415 octets au contrôle final ; une lecture anonyme d’un objet existant reçoit HTTP 403.

Les corps, les configurations d’origine et les identifiants d’accès restent dans des fichiers privés. Les rapports versionnés ne contiennent que des métadonnées et compteurs. Les trois crons de production restent gelés et `PIPELINE_PAUSED=1`. Aucun déploiement de production ni écriture dans la base de production n’a été effectué pour ce lot.

## Stockage mesuré et limites de release

La mesure du stock historique couvre 85 327 sorties et environ 206 Mo gzip. La répétition réelle mesure environ 201 ko gzip natifs et 366 ko gzip de sorties. Il serait incorrect de les présenter comme le poids quotidien complet du catalogue mondial. Le [contrat](../../docs/architecture/native-capture.md#mesures-de-capacité-et-limites) donne le tarif consulté, les plafonds techniques et la méthode de mesure à appliquer pendant la qualification des sources.

Les captures anciennes absentes restent absentes. Les lots suivants doivent encore traiter les faits champ par champ, la réattestation, l’identité, la qualification complète des sources et la charge. Le rejeu complet nécessite sa configuration originale ; sa compatibilité est vérifiée par les empreintes, pas supposée. Les réponses navigateur de taille inconnue sont bufferisées par Playwright avant le contrôle final et doivent être incluses dans la mesure mémoire du lot performance.

Le test Railway valide le transport du stockage choisi. La création du bucket de production, la configuration des services et les migrations distantes appartiennent à la release contrôlée. Le budget global devra être recalculé sur un cycle de qualification réel. Aucun statut « production-ready » global n’est attribué à la fin du lot 2.

## Preuves

- [Validation et empreintes des journaux](preuves/lot2-validation.json)
- [Contre-épreuves](preuves/lot2-counterproofs.json)
- [Mesure des sorties historiques](preuves/lot2-raw-storage-measurement.json)
- [Inventaire distant en lecture seule](preuves/lot2-storage-inventory.json)
- [Rejeu réel après archivage](preuves/lot2-live-s3-replay.json)
- [Isolation et accès privé Railway](preuves/lot2-railway-storage-proof.json)
- [Préservation des travaux préexistants](preuves/lot2-preservation.json)
