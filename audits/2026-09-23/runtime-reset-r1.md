# Runtime reset — contrôle R1, 23 septembre 2026

Candidate **`c3613a1d7b2a3c709f68fb18801eed3277a2302b`** sur `development`.
Contrat SHA-256 : `ba9fbd873305c50357c93c2cc3662af88d64d5f62b025ed7065e4883f3770bbf`.

| Contrôle | Résultat |
|---|---|
| Typo du témoin `witness/fail` | Corrigée, tests PASS |
| Garde, pause, egress et identification du lecteur | Tests ciblés PASS |
| CI API + agrégateur, intégration sur DB jetable | [PASS](https://github.com/lmelane/fr-retail-jobs/actions/runs/35823451131) |
| Deux images construites une fois, AMD64, SHA/contrat embarqués | PASS |
| API démarrée sans réseau | PASS |
| Worker démarré sans réseau, pause, zéro travail, sortie 0 | PASS |
| Visibilité privée exigée par la cible | **FAIL : les deux packages sont publics** |
| Services Railway, Postgres et volume | Inchangés ; workers historiques sous pause |

Images conservées, jamais déployées sur Railway :

- API : `ghcr.io/lmelane/catwalks-catalogue-api@sha256:3457d652ade426fda8459a189e0eee2ee46d482bc2887cfc6f9fa274edf7b1a0`.
- Worker : `ghcr.io/lmelane/catwalks-ingestion-worker@sha256:55a9e6d008b21f8060a10b6f2bf1fd0d49d0dd81ece757bedb9e687ac174a240`.

Le contrôle anonyme du manifeste API rend HTTP 200. Le [contrôle authentifié via GitHub Actions](https://github.com/lmelane/fr-retail-jobs/actions/runs/35824045363) confirme `visibility: public` pour les deux packages, chacun avec une seule version. Leur création date de cette publication (05:47 UTC), pas d'une ancienne configuration supposée. Le dépôt source est public. La publication n'a reçu aucun secret applicatif, dump ou fichier local non suivi ; la visibilité ne correspond néanmoins pas à la cible approuvée. Le workflow refuse maintenant un package public avant publication et vérifie la visibilité réelle après publication. Le workflow ponctuel d'inspection a été retiré ; ses résultats restent dans le run GitHub.

**R1 non clôturé ; R2 → R5 non exécutés.** Ne pas contourner le contrat privé par un pull anonyme sans décision explicite. La demande de PAT `read:packages` ne résout pas à elle seule ce défaut de visibilité.

Deux autres prérequis sont documentés sans modifier les données :

- Le clone restauré contient des preuves Oh My Cream liées à `git:0f22b49eb65ea8d6bf98a183e078276fa47c8b9e`, capture du 20 septembre. Le garde exige le lecteur courant et une capture de moins de 24 h. Le renouvellement borné des seules preuves de qualification/accès a été soumis à décision ; aucune réécriture historique ni assouplissement du garde.
- Healthchecks `/start`, `/fail`, succès : acquittés par le module commun exécuté localement (05:13 puis 05:18 UTC), URL jamais affichée. Livraison de l'alerte non confirmée ; absence d'API d'administration non bloquante pour la construction.

Reçus privés : `~/.catwalks/runtime-reset-20260923/images/`, `heartbeat-controlled.json`, `clone-source-preflight.txt`, `r1-current-environment.private.json`. La candidate ne modifie aucune migration. Aucun changement dans les autres dépôts Catwalks.
