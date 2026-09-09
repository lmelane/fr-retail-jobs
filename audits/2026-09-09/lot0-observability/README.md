# Lot 0 — Observabilité des workers

## État du lot

Correction implémentée et vérifiée localement. Validation Railway et déploiement encore à effectuer à ce stade du rapport. Aucun run massif relancé. Les données métier ne sont pas corrigées par ce lot.

## Cause prouvée, et limites de la preuve

Incident du 8 septembre, déploiement `7b17182e-b713-4bbb-ab25-5f506201ca11`, commit `030a101602d78a0470db05f4a84b6f08e650ec63`. Le build avait réussi. La collecte termine à 22:49:47 UTC ; l'erreur L'Oréal HTTP 406 explique le statut de collecte en échec, pas la saturation des logs.

Le `console.log(JSON.stringify({ … orchestration … }, null, 2))` du CLI imprime ensuite tous les incidents imbriqués. Les logs récupérés montrent 542 lignes dans la seconde 22:49:54, dont 541 fragments JSON. Railway signale 2 925 messages supprimés à 22:50:06. Hors rapport final, le pic observé est 41 lignes/seconde. Les messages supprimés sont irrécupérables : leur contenu exact n'est pas revendiqué.

[before.json](before.json) : inventaire de 1 744 lignes conservées, après déduplication des fenêtres de récupération qui se chevauchent. Producteurs : 433 résumés/erreurs ingest, 424 annonces de source, 244 refus de purge, 69 offres retenues, 541 fragments JSON, autres événements 33. Les refus de purge sont des protections, pas des logs à supprimer sans preuve.

Le correctif antérieur PR31 avait borné le résumé `ingest-all`. Restait un défaut transversal : autres commandes multiligne, absence de débit borné et de journal corrélé, erreurs d'écriture/indexation limitées aux trois premières, exceptions d'indexation simplement comptées. Aucun logger Prisma SQL/query n'est activé sur le client du worker ; son `log: []` évite une seconde émission indépendante des erreurs déjà capturées.

[before-database.json](before-database.json) lit les derniers SourceRun de toutes les clés historiques, y compris retirées. Aucune source n'y dépasse trois erreurs d'écriture : le plafond ancien est un risque démontré dans le code, pas une affirmation que des erreurs supplémentaires se sont produites dans ce run.

## Correction générale

- Un `PipelineRun` par invocation ; `SourceRun.runId` pour relier la santé de chaque source. Les anciennes lignes restent sans runId : aucun rattachement historique inventé.
- Chaque événement info/warn/error est attendu et enregistré dans `PipelineEvent` avant toute réduction de console. Les erreurs gardent message, stack, cause et métadonnées ; secrets filtrés. `jobId` désigne ici l'identifiant amont de l'offre, à interpréter avec `sourceKey`, et non nécessairement Job.id.
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

Voir [diagnostics.sql](diagnostics.sql). `PipelineEvent.id` correspond à `eventId` dans Railway. `PipelineEvent.runId` relie un événement au run ; `SourceRun.runId` relie ses résultats santé. Les anciennes exécutions sans runId utilisent encore leurs timestamps et sourceKey, avec cette limite explicite.

Un processus tué brutalement ne peut pas signer sa fin : un PipelineRun sans finishedAt demeure RUNNING et doit être rapproché du statut du déploiement Railway. Cela ne prouve pas qu'il travaille encore. Une fin COMPLETED prouve seulement la fin de la commande ; COMPLETED_WITH_ERRORS distingue un run achevé avec incidents ; FAILED un échec de commande. Une panne simultanée de PostgreSQL et de stdout ne permet aucune garantie de conservation : le worker échoue au lieu de continuer. Le système ne prétend pas garantir zéro perte physique lors d'une panne totale d'infrastructure.

Référence : [Railway, logs structurés et limite de 500 lignes/seconde par replica](https://docs.railway.com/observability/logs).

Vérifications locales du lot : 1 459 tests unitaires agrégateur, 206 tests d'intégration, typecheck agrégateur et web. CI complète et mesures Railway seront ajoutées après la livraison.
