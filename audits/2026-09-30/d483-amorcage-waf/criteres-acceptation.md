# D-483 — Réouverture de Ralph Lauren : critères d'acceptation de la collecte ciblée

État au 30/09/2026 : **lot écrit et testé dans une copie de travail, rien n'est déployé.** La source
`ralph-lauren-avature` est `PAUSED` (D-483), aucune `SourceAccessDecision` n'existe pour elle, et la migration
`20260930120000_waf_bootstrap_access` n'est appliquée nulle part hors des bases jetables de test.

## Préalables, dans l'ordre (chacun sur go explicite)

1. Migration `20260930120000_waf_bootstrap_access` appliquée en production **avant** le code (additive : l'ancien
   code n'écrit ni `HTTP_WITH_WAF_BOOTSTRAP` ni la clé `bootstraps`, la base en avance lui reste compatible).
2. Image de l'agrégateur contenant le lot, hors de la fenêtre du RUN de 18 h.
3. Passage `PAUSED` → `ACTIVE` de `ralph-lauren-avature` (réouverture décidée par D-483 ; l'écriture reste un geste
   de production).
4. Collecte ciblée en production de la seule source (D-482 §2), avant le RUN quotidien.

## Critères de la collecte ciblée (tous requis, relus en lecture seule)

| # | Critère | Où le lire |
|---|---|---|
| 1 | Deux collectes `JOBS` du jour — qualification puis ingestion — `EXTRACTED`, `transportCoverage = HTTP_WITH_WAF_BOOTSTRAP`, chacune `VALIDATED` (rejeu exact) | `CaptureOutcome`, `SourceValidation` |
| 2 | Une décision d'accès `ALLOWED` courante dont le document porte `bootstraps = [{ vendor: AWS_WAF_CHALLENGE, origin: https://careers.ralphlauren.com, challengeHosts: [https://…token.awswaf.com] }]` et dont `report.bootstrapRequestCount` égale le nombre de lignes `BROWSER_RESPONSE` de la collecte de qualification | `SourceAccessDecision` |
| 3 | La collecte d'ingestion est liée à cette décision (`accessDecisionId`) | `CaptureBatch` |
| 4 | Lignes `BROWSER_RESPONSE` par collecte : la page défiée et les hôtes `*.awswaf.com` seulement (mesuré le 30/09 : 5) ; aucune autre origine | `RawCapture` + enveloppes |
| 5 | Aucun corps archivé pour `inputs` / `mp_verify` (`failure = CredentialNotArchived`) : le jeton n'entre pas dans l'archive | `RawCapture` |
| 6 | Après l'amorçage : **0** réponse 403, 406 ou 202 sur les pages de liste et de détail | `RawCapture.status` |
| 7 | Listes lues en entier : offres lues = total annoncé par Corporate + Retail (1 131 chez l'éditeur le 29/09 ; 225 annoncées pour Corporate le 30/09) | manifeste, `declaredTotal` |
| 8 | Descriptions non vides sur au moins 70 % des offres, avec marge (le lecteur garde la carte quand une fiche échoue) | sorties de la collecte |
| 9 | Aucune offre Ralph Lauren fermée par cette collecte (la source n'a jamais publié ; toute fermeture serait un défaut) | publication |

Un seul critère manqué : la source repasse en pause, le motif est consigné, rien n'est corrigé en production à chaud.

## Risque connu, non tranché : le jeton refusé en cours de collecte

Mesuré sur les trois collectes amorcées du 19/09/2026 (production, lecture seule) : **1 sur 3** a tout lu
(1 323 requêtes, 1 131 offres, `7b16d898`) ; une a reçu **403** trois fois dès la deuxième page après l'amorçage
(`55847bbb`) ; une a reçu **406** à la première requête munie du jeton (`abe33bc1`). Le 30/09, deux amorçages sur
deux ont rendu un jeton accepté (une page de liste relue chaque fois). Le lot échoue franchement dans ces cas
(aucune publication partielle, aucune fermeture) mais ne les résout pas.

La carte ci-dessous **n'est à soumettre au CEO que si la collecte ciblée reproduit ce refus** ; sinon elle reste ici.

```
🔷 DÉCISION — Ralph Lauren : que faire quand le jeton anti-robot est refusé en cours de collecte ?
Contexte  : 19/09, 3 collectes amorcées : 1 complète (1 131 offres), 1 refus 403 après une page, 1 refus 406.
            [à compléter avec la collecte ciblée : n refus sur n collectes, à quelle page]
Enjeu     : 1 131 offres jamais publiées ; un RUN rouge chaque jour de refus.
Options   : A. Réamorcer UNE fois dans la même collecte, sous la même autorisation, inscrit au journal
               (deux amorçages au plus par collecte au lieu d'un) — coût : 1 lot court ; réversible.
            B. Statu quo : la collecte échoue, la source reste en échec ce jour-là et se retente au RUN suivant
               — coût nul ; RUN rouge les jours de refus.
            C. Pause jusqu'à un contact avec l'éditeur — coût : offres absentes ; réversible.
Reco      : B tant que le taux de refus n'est pas mesuré sur plusieurs jours ; A si le refus se reproduit.
Impact si on ne tranche pas : B par défaut.
```
