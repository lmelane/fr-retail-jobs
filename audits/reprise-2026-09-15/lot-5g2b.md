# Lot 5G2B — décisions d’identité reliées aux captures natives

Validation locale du 16 septembre 2026 : **3 407 tests passent**, build API réussi, douze mutations applicatives détectées et onze protections SQL démontrées par contre-épreuve. Une décision isolée a été enregistrée depuis les archives Railway de test. Aucun déploiement, aucune écriture en production et aucun changement de cron.

## Contrat livré

`source-onboard.mts identity revue.json` reçoit uniquement la décision humaine : source, révision, capture, verdict, domaine examiné, statement, auteur, date et éventuel périmètre. L’option `--artifact` et les champs supplémentaires sont refusés. Le [guide d’exploitation](../../docs/architecture/source-onboarding.md) fournit le dossier exact.

L’écrivain relit le manifeste et les octets de la capture, puis refait l’inspection de la relation officielle. Une certification positive exige un lien natif vers le portail configuré. Les anciennes méthodes documentaires ne servent pas de raccourci. Les contrats positifs couvrent actuellement Ashby, Recruitee et les sites Workday qualifiés ; leur extension reste un lot distinct.

Les décisions `CONTRADICTED` et `UNRESOLVED` désignent elles aussi une capture d’identité réelle, récente et liée à la bonne révision. Elles peuvent s’appuyer sur une réponse de refus ou une absence de lien et ne peuvent attribuer aucun périmètre. Un HTTP 403 ne devient pas automatiquement une contradiction d’identité : la décision et son explication restent explicites.

La lecture de l’archive précède les verrous d’écriture. La source est ensuite verrouillée et sa révision revérifiée. Une archive indisponible ne déclenche aucun appel de secours vers le portail. Les mutations de l’objet transmis par l’appelant pendant les opérations asynchrones n’altèrent pas le dossier en cours.

## Autorité, historique et coût de lecture

La migration 65 ajoute `evidenceCaptureBatchId` et `relationReport`. Les nouvelles décisions sont liées au dernier corps d’une capture `SOURCE_IDENTITY` complète de la même source et de la même révision. SQL contrôle également empreintes, URL expurgée, date observée, politique et forme du témoin positif. Le parseur applicatif établit le lien HTML ; SQL ne prétend pas analyser le DOM à sa place.

La promotion et la lecture du périmètre utilisent la même projection compacte. Elles n’importent plus le texte intégral historique à chaque contrôle. Aucun nouveau corps HTML n’est dupliqué dans les revues : il reste dans le stockage natif existant. Le champ historique conserve ses anciens octets pour audit ; il ne fournit plus d’autorité et tout nouveau texte y est refusé par SQL.

Les décisions restent immuables et ordonnées sous le verrou de source. Leur identifiant dépend du dossier explicite, sans l’heure changeante de réinspection. Une relance identique ne peut donc pas passer devant une contradiction ultérieure. La capture et la décision expirent après trente jours ; l’antériorité du dossier est contrôlée avec une tolérance d’horloge de cinq minutes.

La politique d’inspection versionnée doit correspondre au contrat courant. L’empreinte de l’inspecteur est conservée pour audit ; une modification de code sans rapport avec cette politique ne force pas une nouvelle décision humaine. La validation technique des offres conserve son propre contrat, lié au lecteur courant.

Les fonctions de lecture exacte du registre sont déplacées dans un module inférieur commun aux captures, rapports et décisions. Tous les consommateurs sont mis à jour, sans ancien alias d’import ni dépendance circulaire entre archivage et certification.

## Vérifications

| Contrôle | Résultat |
|---|---:|
| Tests unitaires agrégateur | 2 461 |
| Tests PostgreSQL | 676 |
| Tests API | 259 ; 2 tests optionnels de corpus séparés |
| Tests Python | 11 |
| Première suite ciblée | 301 |
| Types et build API | PASS |
| Migrations depuis zéro | 65 |
| Mutations applicatives détectées | 12 sur 12 |
| Tests restaurés après mutations | 80 |
| Protections SQL démontrées | 11 sur 11 |

La suite complète couvre aussi les deux tests de concurrence ajoutés après la première suite ciblée. Les contre-épreuves applicatives réintroduisent notamment le texte historique comme autorité, une politique ancienne, le mauvais board, la capture périmée, le dossier mutable, la relance réordonnée et la sélection d’un ancien VERIFIED malgré une contradiction.

Chaque contre-épreuve SQL vérifie que l’écriture frauduleuse est d’abord refusée. Elle retire ensuite le contrôle concerné dans une transaction isolée et démontre que cette même écriture passerait. La transaction est annulée et l’empreinte de la fonction restaurée vérifiée. Les témoins couvrent source étrangère, mauvais but, corps manuel, empreinte ou URL substituée, mauvaise réponse, ancienne politique, date falsifiée, HTTP 403, document texte et périmètre accordé à un verdict négatif.

Preuves : [validation](preuves/lot-5g2b-validation.json), [mutations applicatives](preuves/lot-5g2b-counterproofs.json), [contre-épreuves SQL](preuves/lot-5g2b-sql-counterproofs.json) et [runtime testé](preuves/lot-5g2b-runtime-match.json).

## Clone et archive réelle

La migration a été répétée sur le clone local contenant 87 607 groupes, 90 764 publications natives, 141 933 observations, 536 sources et 112 revues historiques. Les empreintes de toutes les anciennes colonnes de ces six tables restent identiques. Aucun rattachement à une capture ni rapport d’inspection n’a été inventé pour les anciennes revues. Voir la [comparaison de migration](preuves/lot-5g2b-stock-migration.json).

La [page officielle Levi Strauss & Co.](https://www.levistrauss.com/work-with-us/) répond HTTP 200 et fournit 64 432 octets. Une source de validation isolée reprend son tenant Workday et son site `External`. La décision examine explicitement cette relation et ne certifie aucun périmètre de marque ni exhaustivité.

Les deux blobs nécessaires sont accessibles sur Railway ; le corps, identique à la capture précédente, était déjà archivé par empreinte. Seul le nouveau manifeste nécessitait une purge locale pendant cette vérification. Avec zéro corps restant localement, la décision est enregistrée puis répétée sans requête vers le portail. La répétition conserve le même identifiant et n’ajoute aucune revue. Une réinspection avec le runtime final, après nettoyage de mise en forme, confirme aussi ce comportement : la décision initiale reste inchangée et sa version d’inspecteur est conservée séparément de la nouvelle inspection. La source reste DRAFT, sans activation ni publication. Voir le [reçu de validation à froid](preuves/lot-5g2b-live-s3-identity.json).

## Préservation et travaux suivants

Les 86 fichiers utilisateur sont contrôlés : 82 identiques et les quatre exceptions déjà documentées conservées. Le témoin de catalogue initial dans `sourceStore.test.ts` reste intact ; seuls les fixtures de promotion sont adaptés au nouveau contrat natif. Voir la [preuve de préservation](preuves/lot-5g2b-preservation.json).

Les fichiers sont sauvegardés dans `backups/reprise-20260916-lot5g2b/`. La sauvegarde complète au schéma 60 reste la référence de restauration, suivie des migrations 61 à 65 ; aucune nouvelle restauration complète n’est revendiquée.

L’extension des contrats d’inspection, les décisions d’accès immuables, les rôles de source, le traitement des libellés natifs explicites et le contrôle des ingestions déjà actives restent à livrer. Ce lot ne constitue pas une certification globale de préparation à la production.
