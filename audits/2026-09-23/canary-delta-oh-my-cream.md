# Oh My Cream — validation différentielle du 23 septembre 2026

## CANARI VALIDÉ

La seule anomalie restante était la sonde `EGRESS_PROBE`. La candidate demeure **`72300c97586955536ee1f89b0a9b7b0273fbf8a9`**. Une seule ingestion directe a été exécutée, sans campagne, autre source, refresh ou géocodage global :

```sh
sh apps/aggregator/start.sh ingest --source=oh-my-cream --no-geocode
```

| Preuve | Résultat |
|---|---|
| Source exécutée | **PASS** — Oh My Cream uniquement, un run et une capture JOBS |
| Egress métier | **PASS** — uniquement `careers.ohmycream.com` dans les métriques HTTP et la provenance native ; **0 domaine métier hors périmètre**, aucun événement `egress.probe` |
| Pipeline | **PASS** — COMPLETED, 23 mises à jour, 0 création, 0 fusion, 0 erreur ; 27 blobs décompressés et leurs longueurs/SHA-256 vérifiés ; fin attestée et heartbeat présents |
| État final | **PASS** — API et navigateur réel `/emplois` : mêmes 21 offres FR, fiche et lien externe ; trois workers en pause, CRON inchangés |

Le navigateur utilise la preview website existante `76ddcb0` reliée à l’API Railway, sans nouvelle livraison du site. Les 23 identifiants et publications restent identiques, avec 21 FR et 2 pays inconnus. Le heartbeat est un appel d’exploitation, distinct de l’egress métier.

## Exécution et état sûr

- Worker exécuté de **04:40:30 à 04:40:34 UTC**, code 0.
- Run `1cdba5b9-403d-4f1c-a8a7-0491fe25bc61`.
- Capture `7f49003e-384f-4a26-8484-7551b9b6e9f5` ; fin attestée `1cd71aeedb0f8d90bc2b6b24b33856bb6718fea0bacefe8244a3366bca620c8c`.
- Relance de configuration explicitement autorisée, au même SHA : `f9648403-58bd-4e8d-a357-22ce4275f572`.
- Retour à `sh apps/aggregator/start.sh`, `PIPELINE_PAUSED=1`, `EGRESS_PROBE=0` : `3a1197ab-7954-47d3-a850-60d2130b8ab3`.
- Le vrai worker sous pause a émis `pipeline.paused`, `workStarted:false`, puis s’est arrêté. Ce témoin n’a créé aucune ingestion supplémentaire.
- API, refresh et reconcile : identifiants de déploiement inchangés. Aucun changement applicatif, aucune migration.

Restore, rollback, Golden Path, audit FK, CI complète et E2E marchés/locales **non rejoués**. Leurs preuves acquises restent celles du [bilan précédent](../2026-09-22/restorability-canary-final.md). Le présent delta clôt son seul critère non validé.

[Manifeste des preuves](canary-delta-oh-my-cream.json), fichiers privés sous `~/.catwalks/canary-delta-20260923/`.

## Passage au ramp-up contrôlé

Le canari est clos. La phase suivante commence par un lot de **trois sources explicitement choisies et qualifiées sous le lecteur courant**, traitées **une par une** : validation du périmètre HTTP, ingestion, captures/fins attestées et lecture `/emplois` avant passage à la suivante. Arrêt à la première erreur, divergence de périmètre ou duplication inattendue ; retour en pause entre lots. Les CRON, refresh global, `/offres` et matching restent gelés. Aucune ingestion multi-source n’a été incluse dans ce delta.
