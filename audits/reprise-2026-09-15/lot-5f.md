# Lot 5F — parcours unique des sources et retrait des anciennes orchestrations

Validé localement le 16 septembre 2026. **3 335 tests passent**, le schéma est construit depuis zéro et le build de l’API réussit. La migration 63 est répétée sur le clone conservé. Aucune écriture en production, aucun déploiement ni activation de cron.

## Résultat

[source-onboard.mts](../../apps/aggregator/scripts/ops/source-onboard.mts) est désormais l’entrée unique pour `register`, `profile`, `identity`, `collect`, `validate`, `status` et `promote`. Le [guide maintenu](../../docs/architecture/source-onboarding.md) décrit les dossiers, effets et limites de chaque commande.

- L’enregistrement et la revue d’identité restent des aperçus sans `--apply`. Les collectes, revalidations et promotions exigent une écriture explicite. Les options inconnues, dupliquées et incomplètes sont refusées avant tout travail.
- Un candidat doit contenir uniquement les champs admis et une configuration JSON finie indépendante des paramètres d’exécution. Répéter le même dossier ne réécrit pas le registre ; modifier sa configuration ou son motif d’URL exige une décision distincte.
- La collecte appelle le véritable adaptateur, archive les réponses natives puis les rejoue. Un rejet conserve sa décision et rend un code de sortie non nul. Elle ne publie aucune offre et ne change pas le statut de la source.
- Le statut lit le registre, les décisions et la dernière tentative de capture dans un instantané cohérent. Une panne de base n’est pas transformée en manque de preuve. Les rapports indiquent explicitement que l’accès actuel reste non lié à la révision.
- La promotion exige la révision choisie par l’opérateur et revérifie les portes sous verrou. Répéter une activation déjà terminée ne réécrit pas la ligne ; une contradiction ou une preuve expirée reste bloquante.
- Les fichiers privés sont bornés, lus sans suivre de lien symbolique et écrits en mode `0600`. Les exceptions ne sont pas recopiées dans les erreurs publiques de la commande : elles peuvent contenir une URL privée, des paramètres de base ou un extrait du dossier.

## Suppressions et découverte

**20 fichiers remplacés ont été supprimés** : orchestrations concurrentes P3/B6, chaînes de mutation datées, validation par volume saisi, générateur de preuve par sous-chaîne, modules associés et tests de ces anciens contrats. Les alias de la CLI générale et les mutations de `raw-capture.mts` ont été retirés ; ce dernier reste un lecteur et outil de rejeu des archives.

Un témoin synthétique a reproduit un défaut du générateur retiré : un commentaire HTML contenant un hôte Workday était déclaré `PROVEN`, sans lien ni site ATS configuré. Le [constat archivé](preuves/lot-5f-obsolete-portal-proof.json) identifie le code concerné. Sa suppression ne constitue pas une certification de remplacement.

[source-discovery.mts](../../apps/aggregator/scripts/ops/source-discovery.mts) conserve l’inspection en lecture seule. Les noms, domaines et groupes produisent des indices séparés ; ils ne bloquent plus automatiquement un dossier ni ne déclarent une marque couverte. Les branches de faux verdicts d’admission ont été supprimées. Les domaines sont résolus avec leurs suffixes publics et privés, afin de distinguer notamment les employeurs sous `co.uk`.

La colonne `Source.verifiedJobCount` et ses consommateurs ont disparu. Le planificateur utilise uniquement le résumé opérationnel `lastRunJobs` pour l’ordre de passage ; ce résumé n’accorde aucune qualification. Les colonnes manuelles `job_count` et `verified` du seed ont été supprimées, avec les **83 configurations originales préservées**. L’import crée toujours des brouillons sans preuve datée.

## Validation et audit défensif

| Contrôle | Résultat |
|---|---:|
| Tests unitaires agrégateur | 2 431 |
| Tests d’intégration PostgreSQL | 634 |
| Tests API | 259, plus 2 tests de corpus explicitement séparés |
| Tests Python des outils | 11 |
| Types et build API | PASS |
| Migrations depuis zéro | 63 |
| Mutations de code détectées | 11 sur 11 |
| Tests après restauration des mutations | 79 |

Le test de la **commande réelle** exécute l’enregistrement en aperçu puis appliqué, le profil, une revue synthétique en aperçu puis appliquée, la collecte native, le rejeu sans réseau, le statut, la promotion avec bonne et mauvaise révision, la répétition, une contradiction, un rejet technique et un retrait. Seul le transport externe est remplacé par deux réponses Ashby synthétiques ; les fonctions métier, l’archive, l’adaptateur, le lecteur et PostgreSQL sont réels. La fixture d’accès est installée séparément et ne vaut pas autorisation réelle d’un portail.

Les contre-épreuves réintroduisent une écriture pendant chaque aperçu, une promotion sans bonne révision, une réécriture lors de sa répétition, un succès de commande malgré un rejet, l’acceptation d’options ou de preuves fabriquées, le suivi d’un lien symbolique, le blocage par un indice de groupe, la fuite d’une exception privée et le masquage d’une panne de base. Toutes rendent les tests rouges, puis la restauration repasse au vert. Le témoin de panne a été renforcé pour couvrir une indisponibilité transitoire, que sa première version ne distinguait pas correctement.

Preuves : [validation](preuves/lot-5f-validation.json), [contre-épreuves](preuves/lot-5f-counterproofs.json) et [concordance du runtime local testé](preuves/lot-5f-runtime-match.json). Les empreintes décrivent l’arbre local vérifié, avec les travaux utilisateur conservés ; elles ne décrivent pas une release Railway déployée.

## Migration et préservation

Le clone passe de 62 à 63 migrations. Les empreintes de toutes les lignes et colonnes conservées sont identiques avant/après : **87 607 offres, 90 764 publications, 141 933 observations, 536 sources, 536 révisions et 112 revues d’identité**. Seule la colonne explicitement retirée est exclue de la comparaison de `Source`. Aucun lien ni ordre historique n’est inventé. Voir la [comparaison complète](preuves/lot-5f-stock-migration.json).

Sur les 86 fichiers utilisateur suivis depuis le début, 82 restent strictement identiques. Les quatre exceptions sont expliquées dans le [contrôle de préservation](preuves/lot-5f-preservation.json) : dépendances déjà ajustées, test de taille du catalogue intégré au lot 5D, retrait des deux colonnes manuelles du seed et retrait du seul affichage de ce compteur dans le diagnostic de collisions. Les originaux de ces deux derniers fichiers sont conservés intégralement en sauvegarde privée.

La sauvegarde complète au schéma 60, déjà restaurée et contrôlée au lot 5D, reste disponible ; une reprise à l’état courant exige ensuite les migrations 61, 62 et 63. Aucune nouvelle restauration complète n’est revendiquée ici. Les fichiers de travail et leur manifeste sont sauvegardés sous `backups/reprise-20260916-lot5f/`.

## Prochaines portes de sortie

L’unification est livrée ; la certification complète du catalogue reste ouverte. Il faut encore vérifier la relation officielle vers le tenant et le site exacts, rendre la preuve d’accès immuable et liée aux cibles réellement appelées, distinguer employeur/groupe/éditeur, contrôler les sources déjà actives à l’ingestion et lier les preuves d’absence au périmètre immuable. Les captures d’identité et d’accès ne devront jamais compter comme de nouvelles collectes d’offres. La réouverture explicite d’une source retirée et le déplacement des paramètres d’accès vers des références privées restent également à traiter.
