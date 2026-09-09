# Lot 0 — Observabilité des workers

## État du lot

Correctif livré : PR36, code `2c3bc9a`, merge `817ed7d6dcdb7a93aa959d32b8de5ad7cb0fd29e`, migration appliquée et trois images workers disponibles sur Railway. Trois exécutions réelles ont validé le rapport volumineux, une source puis trois sources en parallèle. Aucun run mondial complet des 424 sources n’a été relancé : la preuve runtime est ciblée, et la borne de sortie est commune à tous les producteurs des workers. Les crons restent en pause, conformément au chantier en cours. Les données métier ne font l’objet d’aucune réparation manuelle dans ce lot.

## Cause prouvée, et limites de la preuve

Incident du 8 septembre, déploiement `7b17182e-b713-4bbb-ab25-5f506201ca11`, commit `030a101602d78a0470db05f4a84b6f08e650ec63`. Le build avait réussi. La collecte termine à 22:49:47 UTC ; l'erreur L'Oréal HTTP 406 explique le statut de collecte en échec, pas la saturation des logs.

Le `console.log(JSON.stringify({ … orchestration … }, null, 2))` du CLI imprime ensuite tous les incidents imbriqués. Les logs récupérés montrent 542 lignes dans la seconde 22:49:54, dont 541 fragments JSON. Railway signale 2 925 messages supprimés à 22:50:06. Hors rapport final, le pic observé est 41 lignes/seconde. Les messages supprimés sont irrécupérables : leur contenu exact n'est pas revendiqué.

[before.json](before.json) : inventaire de 1 744 lignes conservées, après déduplication des fenêtres de récupération qui se chevauchent. Producteurs : 433 résumés/erreurs ingest, 424 annonces de source, 244 refus de purge, 69 offres retenues, 541 fragments JSON, autres événements 33. Les refus de purge sont des protections, pas des logs à supprimer sans preuve.

Le correctif antérieur PR31 avait borné le résumé `ingest-all`. Restait un défaut transversal : autres commandes multiligne, absence de débit borné et de journal corrélé, erreurs d'écriture/indexation limitées aux trois premières, exceptions d'indexation simplement comptées. Aucun logger Prisma SQL/query n'est activé sur le client du worker ; son `log: []` évite une seconde émission indépendante des erreurs déjà capturées.

[before-database.json](before-database.json) lit les derniers SourceRun de toutes les clés historiques, y compris retirées. Aucune source n'y dépasse trois erreurs d'écriture : le plafond ancien est un risque démontré dans le code, pas une affirmation que des erreurs supplémentaires se sont produites dans ce run.

## Correction générale

- Un `PipelineRun` par invocation ; `SourceRun.runId` pour relier la santé de chaque source. Les anciennes lignes restent sans runId : aucun rattachement historique inventé.
- Chaque événement info/warn/error est attendu et enregistré dans `PipelineEvent` avant toute réduction de console. Les erreurs gardent message, stack, cause et métadonnées ; secrets filtrés. `connectorId` désigne le type d’adaptateur, et `sourceKey` la clé du portail dans le registre. `jobId` désigne ici l'identifiant amont de l'offre, à interpréter avec `sourceKey`, et non nécessairement Job.id.
- JSON sur une seule ligne ; espacement minimal 25 ms entre émissions du processus (40 lignes/s nominales). Les sorties de démarrage Prisma et de la plateforme sont distinctes, peu nombreuses ; ce mécanisme ne contrôle pas les logs de Railway lui-même.
- Diagnostics warn/error identiques regroupés uniquement pour la console. Chaque occurrence possède son eventId et reste en base. Les causes distinctes ne sont pas confondues. Au plus 256 groupes en mémoire ; vidage par source et à la fin.
- Gros documents : journal intégral, pointeur eventId et aperçu borné sur stdout. Pas de document JSON multiligne. Pas de limite arbitraire au nombre d'erreurs conservées.
- Compteurs HTTP (tentatives, réponses, retries, redirections) plutôt qu'un log par requête. Les compteurs couvrent `fetchWithRetry` ; un SDK ou un appel fetch indépendant n'est pas faussement compté. Résumés par source, durée et compteurs réels de collecte/écriture ; résumé du run.
- Debug désactivé en production. Un problème de journal durable déclenche des fragments de secours explicites, cadencés et reconstructibles, puis l'arrêt des travaux. Aucun mode silencieux qui prétendrait conserver les diagnostics malgré la panne.
- Pas de file d'attente indépendante qui laisserait le scraping avancer sans attendre l'observation. Les appels au logger sont attendus. Garde AST des dépendances des commandes planifiées : interdit console brut et appels de logging non attendus. Les outils manuels de découverte/audit ne sont pas couverts par cette promesse runtime.

Les données sont écrites dans la base PostgreSQL déjà sauvegardée ; aucune purge automatique du journal dans ce lot. Les vues d'investigation sont bornées par run/source/event et indexées. Avant d'introduire une rétention, prévoir une archive vérifiée et une politique explicite. Ne pas exporter les payloads complets dans les logs publics ou une réponse utilisateur.

## Validation locale sur les données réelles

[real-data-replay.json](real-data-replay.json) : copie restaurée de production, 74 113 offres actives, 432 lignes de sources dans le rapport opérationnel (sources actives ou portant encore des offres).

Le rapport réel fait 149 069 octets et aurait produit **8 668 lignes** avec l'ancien pretty-print de `health-report`. Après correction : **une ligne de rapport**, trois lignes pour toute l'invocation ; document intégral retrouvé dans PipelineEvent, trois événements persistés et compteurs concordants. Durée locale 776 ms, activeJobs conservé à 74 113. Lecture métier sous transaction READ ONLY ; seules les nouvelles tables d'observation reçoivent des écritures.

Tests : persistance avant stdout, erreurs au-delà de la troisième, différences de causes, concurrence/contextes, cadence, payload volumineux, panne du journal, redaction, debug production, corrélation SourceRun et réconciliation des compteurs en vraie base PostgreSQL. Les tests unitaires de défaillance sont isolés ; aucun load test ni données fictives injectées en production.

## Investigation opérationnelle

Voir [diagnostics.sql](diagnostics.sql). `PipelineEvent.id` correspond à `eventId` dans Railway. `PipelineEvent.runId` relie un événement au run ; `SourceRun.runId` relie ses résultats santé. Les compteurs inclus dans le payload de `run.completed` sont photographiés avant cet événement ; les métriques finales de `PipelineRun.metrics`, écrites après son émission, le comptent aussi. La requête de réconciliation utilise ces métriques finales. Les anciennes exécutions sans runId utilisent encore leurs timestamps et sourceKey, avec cette limite explicite.

Un processus tué brutalement ne peut pas signer sa fin : un PipelineRun sans finishedAt demeure RUNNING et doit être rapproché du statut du déploiement Railway. Cela ne prouve pas qu'il travaille encore. Une fin COMPLETED prouve seulement la fin de la commande ; COMPLETED_WITH_ERRORS distingue un run achevé avec incidents ; FAILED un échec de commande. Une panne simultanée de PostgreSQL et de stdout ne permet aucune garantie de conservation : le worker échoue au lieu de continuer. Le système ne prétend pas garantir zéro perte physique lors d'une panne totale d'infrastructure.

Référence : [Railway, logs structurés et limite de 500 lignes/seconde par replica](https://docs.railway.com/observability/logs).

Vérifications locales : 1 459 tests unitaires agrégateur, 206 tests d’intégration, typecheck agrégateur et web. [CI complète verte](https://github.com/lmelane/fr-retail-jobs/actions/runs/34316376985), comprenant aussi le build et les parcours E2E du front.


## Preuves après déploiement — 9 septembre 2026, UTC

[production-proof.json](production-proof.json), [railway-after.json](railway-after.json), [held-evidence.json](held-evidence.json).

| Vérification réelle | Résultat | Conservation vérifiée |
|---|---|---|
| Rapport de santé, 05:52 | 432 sources, 74 113 offres actives, 746 ms ; pic Railway 3 lignes/s | 149 069 octets complets en journal ; 3/3 événements retrouvés |
| Ingestion Blackstore, 05:53 | 54 annonces examinées, 48 offres mises à jour, 0 création, 6 annonces fermées retenues ; 93 tentatives HTTP ; 8,377 s ; pic 5 lignes/s | 12/12 événements ; six diagnostics individuels reliés à leur RAW ; stdout regroupe cinq répétitions |
| Orchestrateur, 05:56 | Blackstore + Intersport + Bellabeat, trois ATS ; 48 + 4 + 1 offres ; 96 tentatives HTTP ; 9,301 s ; pic 11 lignes/s | 23/23 événements, trois SourceRun corrélés ; six avertissements conservés ; toutes les causes/compteurs réconciliés |

Sur ces trois exécutions : **38 événements durables**, zéro événement inexpliqué après rapprochement des eventId et des répétitions, zéro panne de persistance, **zéro avertissement Railway de messages supprimés**. Les pics 3/5/11 sont des mesures réelles, pas une extrapolation à un run mondial. Le mécanisme commun cadence les émissions applicatives à 25 ms minimum ; un grand nombre de sources prolonge l'exécution sans autoriser une rafale non bornée.

La qualification Blackstore reste **DEGRADED** avec son motif explicite : six annonces fermées. Le run est achevé, la source n’est pas maquillée en source sans anomalie. `canAttestAbsence=true` reste justifié par l’énumération complète et les fermetures explicites ; ce lot n’a modifié aucune règle d’attestation.

Les deux collectes ont normalement réobservé les offres et ajouté leurs observations RAW. Elles ne constituent ni un backfill ni une correction de catalogue. Total actif inchangé à 74 113 ; France à 10 936 via l’API. [Contrôles web](web-after.json) : recherche France et annuaire `/entreprises` répondent 200 après déploiement.

[deployments-after.json](deployments-after.json) prouve les trois images au commit mergé, la restauration des commandes et le maintien de PIPELINE_PAUSED=1. Toutes les variables configurées sont identiques à celles sauvegardées avant les validations. Les commandes ciblées ont été temporaires ; aucune activation de source ou tâche massive ajoutée.

| Finding | Fixé ? | Commit | Main ? | Déployé ? | Données réparées ? | Preuve production |
|---|---|---|---|---|---|---|
| Rafale du rapport JSON et sorties non bornées | Oui | 2c3bc9a | 817ed7d | Oui | Sans objet | Rapport complet : 1 ligne utile, pic 3/s |
| Diagnostics limités aux trois premières erreurs / exceptions d’indexation perdues | Oui | 2c3bc9a | 817ed7d | Oui | Anciennes pertes irrécupérables | Journal actif ; conservation des répétitions prouvée sur 6 vrais diagnostics, exceptions testées en environnement isolé |
| Absence de corrélation run/source/diagnostic | Oui | 2c3bc9a | 817ed7d | Oui | Historique ancien non réattribué | 38 événements, 4 SourceRun, trois exécutions rapprochés |
| Erreurs de données, canonicité, exhaustivité des sources | Hors lot 0 | — | — | — | Non par ce lot | Les anomalies de santé restent visibles pour les lots suivants |

**Clôture stricte :** le correctif est livré et la validation ciblée est concluante. Le lot reste ouvert pour la vérification d’un cycle habituel complet avant de certifier l’exploitation quotidienne : le run mondial des 424 sources et les crons de refresh/reconcile n’ont pas été exécutés dans ce lot. Leurs images sont déployées et leurs chemins de logs contrôlés par les tests. Aucun résultat de cycle complet n’est revendiqué, et aucune relance massive implicite n’a été effectuée.
