# Publier et exploiter une taxonomie métier

Le serveur charge la version active depuis `OccupationState`. `packages/db/data/occupations-v1.json` est le point de départ historique et la définition des anciennes heuristiques figées ; modifier ce fichier ne publie pas une nouvelle version en production.

## Ajouter des métiers ou des variantes sans déploiement

1. Exporter le manifeste actif et créer un fichier JSON avec un **nouvel ID de version**. Conserver les identifiants des concepts existants et leurs parents. Ajouter labels, alias et règles littérales contextuelles ; fournir les références de preuve. Ne pas faire d'une ressemblance une preuve de métier.
2. Lancer `node --import tsx apps/aggregator/src/cli.ts occupation-preview --file=<manifeste.json> --output=<revue.json>` contre la base cible. Le preview est en lecture seule et mesure tous les intitulés canoniques réellement présents, actifs et clos.
3. Examiner les changements, témoins de règles, absences de témoins et ambiguïtés. Un nombre de correspondances n'est pas une mesure de précision. Vérifier les entrées natives et le parsing avant de conclure à une absence d'information.
4. Activer avec `occupation-activate --file=<manifeste.json> --review=<revue.json> --commit=<SHA-40-caractères-du-code-déployé> --apply --output=<reçu.json>`. Une revue périmée est refusée ; la refaire et l'examiner. Le reçu conserve la version précédente, les empreintes et les métriques.
5. Rejouer `classify-jobs --expected-release=<id>` puis `classify-jobs --expected-release=<id> --all`. La première exécution doit finir avec `remaining=0`. À corpus inchangé, la seconde doit avoir `written=0`. Le front signale le reclassement tant qu'il n'est pas complet.
6. Vérifier compteurs, résultats et empreintes de conservation ; archiver les preuves de cette publication.

Les commandes demandent un `DATABASE_URL` injecté par l'environnement sécurisé. Ne jamais copier les identifiants dans des rapports ou commandes partagées. L'activation est une opération explicite d'administration, pas une action publique du front.

## Investiguer les cas non résolus

`occupation-review-queue --output=<file.json> --limit=500` produit les variantes prioritaires, leur volume et un témoin cohérent (offre, titre, contexte, URL et provenance de la même ligne). Le total global est distinct du nombre de variantes exportées ; le plafond est de 10 000 variantes. `FAMILY_ONLY`, `NO_RULE`, `AMBIGUOUS` et `INPUT_REVIEW` sont des états d'investigation. Aucune de ces offres n'est masquée par la recherche générale.

`rawTitle` est renseigné lors de l'observation avant le nettoyage de l'intitulé. Un historique qui ne l'a pas conservé reste explicitement `STORED_TITLE_ONLY`. Ne pas fabriquer le raw à partir du titre nettoyé. `OccupationObservation` conserve les transitions avant/après ; les suppressions et modifications sont bloquées en base.

## Reprise et retour à une règle antérieure

Un backfill interrompu reprend sur les offres n'ayant pas encore la version cible. Les changements concurrents sont comptés et non écrasés. Ne jamais modifier une release publiée ni effacer son historique. Pour revenir à des règles antérieures, publier leur contenu sous un nouvel ID, avec revue du corpus courant et le même protocole. Les concepts déjà publiés doivent rester identifiables ; un changement de leur sens ou de leur parent exige une migration explicitement revue.

Les payloads et valeurs hors classification ne sont pas touchés par `classify-jobs`. Contrats, employeurs, pays, cycle de vie, IA et compétences ne doivent pas être réparés subrepticement dans ce backfill.
