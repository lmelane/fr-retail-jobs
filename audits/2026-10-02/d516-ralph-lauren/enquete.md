# D-516 §1 — Ralph Lauren : le « jeton refusé » en cours de collecte, enquête

État au 02/10/2026 : enquête en lecture seule de la production (`db.py readonly`, 11:05–11:35 UTC), sans aucun essai
réseau. Le renouvellement unique du jeton (D-516 §1) est construit sur `development` (voir la fin). Rien n'est en
production et la source reste en pause.

Chaque requête de ce dossier a sa sortie à côté d'elle (`*.out`, et `*.decode.out` pour les corps décodés par
`enveloppes.py`, qui n'imprime jamais une valeur de cookie ni de jeton). L'invocation est en tête de `collectes.sql`.

## Ce qui s'est passé le 02/10 (`collectes.out`, `corps-et-enveloppes.decode.out`)

| Collecte | Rôle | Requêtes | Issue |
|---|---|---|---|
| `da424ede` 09:56:05 → 10:05:03 | qualification (`source-campaign`, sans décision) | 1 362, dont 5 du navigateur | EXTRACTED, 1 160 offres, aucun refus |
| `c81e14a5` 10:05:35 → 10:05:43 | ingestion (`ingest`, sous décision), 32 s après | 9, dont 5 du navigateur | FAILED, `HttpStatusError` 406 |

L'ingestion a fait **son propre amorçage** : 5 requêtes inscrites, jeton obtenu en 3 s. Ensuite, page 0 (`jobOffset=0`)
200, page 1 (`jobOffset=6`) 200, puis page 2 (`jobOffset=12`) **406**, archivé 127 ms après la page 1 et 4,2 s après
l'amorçage. C'est la 1 365e requête vers careers.ralphlauren.com en 9 min 38 s, sans compter les 6 requêtes vers
`*.awswaf.com`.

## Ce que montrent les refus (`entetes.out`, `cadence.decode.out`, `avature-406.decode.out`)

- **Le corps du 406 est la page d'erreur native de nginx** (`<body bgcolor="white">`, `<hr><center>nginx</center>`),
  et la réponse ne porte pas `x-amzn-waf-action`. Le défi AWS, lui, répond `202` avec `x-amzn-waf-action: challenge`.
  La requête refusée était donc passée sans défi. C'est très probablement le serveur d'Avature, derrière le pare-feu,
  qui l'a refusée : ce point est déduit des en-têtes et du corps, il n'a pas été observé directement.
- **Le 403 du 19/09 (`55847bbb`) a un autre corps** : `403 Forbidden` sans signature nginx. Qu'il vienne du
  pare-feu AWS est probable, mais non prouvé.
- **L'Oréal Professionnel**, autre portail Avature, sans défi AWS (derrière Cloudflare), reçoit **le même 406 nginx** :
  3 924 réponses du 19/09 au 01/10.

## Toutes les collectes Avature depuis le 01/09, refusées ou non (`avature-toutes-collectes.out`)

44 collectes JOBS : 30 de L'Oréal Professionnel, 14 de Ralph Lauren.

- **Lectures complètes** (plus de 1 000 requêtes) : 18, dont 16 de L'Oréal Pro et 2 de Ralph Lauren. Les 18 sont
  EXTRACTED. 13 ont reçu des 406 en cours de lecture, à partir de la 1 003e à la 1 676e requête. Ces 406 tombent
  dans la phase des fiches, que le lecteur avale, ce qui laisse des offres sans description. 5 n'ont reçu aucun
  refus, avec 1 362 à 1 780 requêtes.
  **Aucun seuil de volume ni de cadence ne sépare les deux groupes** : de 2,1 à 3,3 requêtes/s, et de 962 à 1 387
  requêtes au pic sur 300 s, dans l'un comme dans l'autre. Une lecture complète isolée suffit à être refusée. Par
  exemple, `7b16d898` (Ralph Lauren, 19/09) a commencé 139 min après une collecte de 5 requêtes et a été refusée à la
  1 003e. Les 12 lectures refusées de L'Oréal Pro venaient de 7 h à 73 h après la lecture complète précédente, sauf
  deux : l'une 46 min après, l'autre sans lecture complète avant elle.
- **Lectures qui suivent une lecture complète de moins de 5 minutes** : 12, soit les 11 ingestions de L'Oréal Pro
  et `c81e14a5`. **Les 12 sont refusées dès leur début** : 10 à la première requête, Ralph Lauren à sa 9e,
  L'Oréal Pro le 30/09 à sa 64e. Elles le sont même quand la lecture précédente n'avait reçu aucun refus (le 23/09 à
  21:32, le 27/09). Une seule lecture a commencé plus tard : `da8bee7a`, 14 min après une lecture refusée, a tout
  lu sans refus.

## Hypothèses, classées

1. **La plus soutenue : la seconde lecture, enchaînée dans les minutes qui suivent une lecture complète, est refusée
   par Avature.** Elle est soutenue par 12 cas sur 12 et contredite par aucun. Le mécanisme exact n'est pas connu :
   ni le volume ni la cadence mesurés ne l'expliquent. Le RUN quotidien et la réouverture enchaînent justement deux
   lectures complètes (voir plus bas) : c'est la seule part identifiée de notre côté. Un nouveau jeton AWS ne change
   rien à ce que voit Avature, qui reçoit le même collecteur sous la même identité. Le renouvellement de D-516 §1 ne
   lèvera donc **probablement pas** ce 406.
2. **Indépendante, et fréquente : une lecture isolée est souvent refusée en cours de route** (13 sur 18). Elle
   l'est sur les fiches, pas sur la liste. La cause est inconnue et non résolue ici.
3. **Un seul cas : le jeton refusé par le pare-feu AWS.** Le 403 sans nginx de `55847bbb` (19/09, 10:14) est arrivé
   à la 2e requête munie du jeton, réessayée 3 fois avec le même. C'est le cas que couvre le renouvellement de
   D-516 §1. L'activité qui précédait n'est pas archivée.
4. **Facteur possible, non prouvé : nos cookies de session Avature sont perdus.** Chaque réponse pose
   `ScustomPortal-47` et `portalLanguage-47`, que le collecteur ne renvoie jamais. Le pot de cookies n'est installé
   que pour SuccessFactors (`httpSession.ts`, seul appelant `successfactors.ts`). Une lecture ouvre donc 1 362
   sessions là où un navigateur en ouvre une. Non appliqué : rien ne le démontre, et le changement modifierait les
   requêtes de toute collecte Avature.

**Écartées, avec leur preuve :**
- *Jeton non renouvelé ou non transmis* : chaque collecte a son propre amorçage, avec 5 requêtes navigateur inscrites
  dans chacune, et les pages 0 et 1 ont été acceptées avec ce jeton.
- *Jeton réutilisé entre qualification et ingestion* : le code l'exclut, puisque `getWafCookie` ne rend dans une
  collecte que le jeton de son propre amorçage. Le journal le confirme : l'ingestion a son propre amorçage.
- *Durée de vie du jeton* : la qualification a utilisé le sien 533,8 s ; l'ingestion a été refusée 4,2 s après le sien.
- *User-agent* : il est identique dans les collectes réussies et refusées (navigateur : Chrome 126 + `CatwalksBot/1.0` ;
  HTTP : `CatwalksBot/1.0`).

**Non mesurable :** un *changement d'adresse IP sortante*. L'archive ne note pas l'adresse IP.

**Correction d'affirmations écrites.** D-516 (contexte) dit que « le 19/09, sur 3 collectes amorcées, une seule était
allée au bout », et les critères D-483 disent « 1 sur 3 a tout lu ». **C'est faux.** `7b16d898` a reçu **319 refus 406**
sur ses fiches (séquences 1 003 à 1 323) : elle a extrait 1 131 offres, dont 319 sans leur fiche. Aucune collecte du
19/09 n'a tout lu.

## Le RUN quotidien lit deux fois Avature (`double-lecture.out`, `double-lecture-run.out`)

`runQualifiedIngest` appelle `maintainSourceAccess`. Celui-ci relance une collecte de qualification dès que la
validation native a plus de 24 h (`SOURCE_VALIDATION_MAX_AGE_MS`) ou qu'une tentative plus récente l'a remplacée
(`CAPTURE_SUPERSEDED`). Ensuite, `ingestApiSource` relit la source sous la décision d'accès. Le 01/10 : **411 sources
sur 411 requalifiées, 56 874 requêtes de qualification et 54 893 d'ingestion**. Chez L'Oréal Pro et Ralph Lauren, le
cercle s'entretient : l'ingestion refusée laisse une tentative plus récente que rien ne valide, donc le lendemain on
requalifie et on relit deux fois.

## Correctif : conception chiffrée, NON construite dans ce lot (trop gros)

**Voie retenue : l'ingestion adopte la capture de qualification du même RUN et la rejoue hors réseau, sans relire le
site.** Elle n'adopte cette capture qu'à cinq conditions :
- la capture est `VALIDATED` ;
- c'est la dernière tentative de la révision ;
- elle a été lue avec le même lecteur ;
- son journal entier est couvert par la décision courante (`scopeOutgrown` le calcule déjà) ;
- elle date de moins de N minutes.

Les chiffres la soutiennent : les 18 lectures complètes ont été EXTRACTED. L'Oréal Pro, qui ne publie rien aujourd'hui, ingérerait les quelque 1 710 à 1 735 offres que sa
première lecture extrait chaque jour, avec des fiches manquantes jugées par le critère 8 (publication non simulée). Ralph Lauren publierait le jour où sa
lecture passe. Le RUN économiserait environ 55 000 requêtes.

*Alternative* : espacer les deux lectures. Un seul point la soutient (`da8bee7a`, 14 min après, 0 refus), ce qui ne
suffit pas à la prouver. Elle allongerait aussi chaque source de 15 min au moins.

**Pourquoi ce n'est pas construit ici.** L'invariant d'admission est porté par la base. Le trigger de
`SourceIngestionAdmission` (`20260923110000_validation_policy_v3`) pose deux exigences :
- la capture admise doit être **plus récente** que la validation qui l'admet
  (`proof."attemptOrdinal" < b."attemptOrdinal"`) ;
- son `accessDecisionId` doit être posé à sa création. Or la qualification n'est pas collectée sous la décision.

Il faut donc, dans cet ordre :
1. une migration qui admet une capture sur sa **propre** validation, avec une liaison unique et vérifiée de la
   décision ;
2. `maintainSourceAccess` qui rend la capture de qualification ;
3. `ingestApiSource` qui la rejoue (`replayExtraction`) au lieu de collecter ;
4. un témoin rouge sur la version d'avant : une seule lecture réseau par source et par RUN, sur les formes réelles de
   Ralph Lauren et de L'Oréal Pro ;
5. un audit de sécurité, car on publierait depuis une capture contrôlée **après coup**. L'exposition reste la même :
   les requêtes de qualification partent de toute façon.

Estimation : 1,5 à 2 jours. La migration est additive mais touche le garde d'admission, et toutes les sources sont
concernées.

## Ce qui est construit (D-516 §1, sur `development`)

La collecte redemande le jeton **une seule fois** quand une réponse 403, 406 ou un nouveau défi le refuse **après au
moins une page acceptée avec lui**. Le renouvellement :
- ralentit d'abord l'hôte (`reportThrottle`) ;
- recharge la même adresse défiée, sous la même politique (la décision d'accès est réévaluée en mémoire) ;
- émet `waf.bootstrap_renewed`, puis la requête refusée est rejouée avec le nouveau jeton.

Les requêtes parallèles refusées avec l'ancien jeton partagent ce renouvellement. Aucune requête ne part vers l'origine
pendant un amorçage en cours. Une collecte conduit au plus 2 amorçages.

Si le jeton est refusé encore, la requête échoue comme avant, et `waf.token_refused` est émis une fois par collecte :
- une page de **liste** refusée fait échouer la collecte ;
- une **fiche** refusée garde l'offre sur sa carte, et le critère 8 en juge (arbitrage du 02/10/2026).

Un renouvellement sans jeton, ou refusé par la politique, reste l'échec collant de D-483. Un refus **avant** toute page
acceptée garde le comportement d'avant : c'est la forme du 19/09 à 14:28, `abe33bc1`. Le rejeu hors réseau ne refait
rien : il rejoue la requête refusée seulement si l'archive en porte la réponse suivante. Les rejeux sans amorçage
inscrit sont inchangés.

Témoins : `apps/aggregator/src/lib/wafRenewal.capture.test.ts`. Sur 14, 11 sont rouges sur le code d'avant. Les 3
autres sont la prémisse et deux non-régressions (406 et 403 avant toute page acceptée).
