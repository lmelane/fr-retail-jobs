# P8 · T1 CORRIGÉ — le même corpus, sous la protection par tenant

> 2026-09-13, commit déployé `85ce223`, crons gelés, `P8_STOP_ON_FIRST_429=1` armé.
> Passe 1 : run `5a5cc452`, 12:59:03 → 13:08:43 UTC. Passe 2 : run `8dd68ca2`, 13:15:47 → 13:22:29 UTC.
> Les deux : `COMPLETED`, `validForCapacity: true`, `problems: []`, 9/9 sources `OK complete=true
> truncated=false errors=0`.

## Ce que cette reprise mesure

T1 (référence) a tourné **avant** la protection par tenant : la porte de politesse voyait les huit
sous-domaines iCIMS d'URBN comme huit hôtes distincts et leur accordait **huit budgets séparés** pour un
tenant unique. La reprise mesure le même corpus, aux mêmes clés, sous `tenant:urbn.icims`.

## Le résultat, et pourquoi il ne conclut PAS

| Run | Mur | `urbn-hub` | Part d'URBN |
|---|--:|--:|--:|
| T1 référence, passe 1 | 452,7 s | 440,0 s | 97,2 % |
| T1 référence, passe 2 | 424,6 s | 411,4 s | 96,9 % |
| **T1 corrigé, passe 1** | **580,8 s** | 556,0 s | 95,7 % |
| **T1 corrigé, passe 2** | **401,6 s** | 389,4 s | 97,0 % |

| | Avant protection | Après protection |
|---|--:|--:|
| Moyenne des deux passes | 438,6 s | 491,2 s |
| **Étendue entre passes** | 28,1 s (**6,6 %**) | 179,2 s (**44,6 %**) |

**Aucune conclusion de coût n'est recevable sur ces données.** La passe 2 corrigée (401,6 s) est plus RAPIDE
que les deux passes de référence. Deux passes dont l'étendue vaut 44,6 % ne peuvent pas départager un écart de
moyenne de 12 % : l'intervalle des deux mesures corrigées **contient** entièrement celui de la référence.

### L'erreur de méthode, nommée

Après la seule passe 1, j'ai conclu « la protection coûte +28,3 % de mur ». **C'était faux**, et faux d'une
manière instructive : la passe 1 était l'extrémité haute d'une distribution que je prenais pour une valeur.

J'avais étayé cette conclusion par une « signature de budget partagé » — les huit sous-domaines ralentissant
ensemble de 17 à 29 %. La passe 2 réfute la lecture : entre les deux passes corrigées, **tous** les hôtes
voient leur `requestsPerSecond` monter d'environ 45 %, **y compris ceux qui n'ont rien à voir avec URBN**,
alors que leur latence est inchangée :

| Hôte | p50 passe 1 | p50 passe 2 | req/s passe 1 | req/s passe 2 |
|---|--:|--:|--:|--:|
| `stores-na-urbn.icims.com` | 523 ms | 504 ms | 1,59 | 2,30 |
| `mecca.wd3.myworkdayjobs.com` | 243 ms | 348 ms | 0,33 | 0,48 |
| `careers.groupe-rocher.com` | 83 ms | 84 ms | 0,12 | 0,18 |
| `www.beiersdorf.com` | 152 ms | 155 ms | 0,21 | 0,31 |
| `lagardere-recrute.talent-soft.com` | 125 ms | 122 ms | 0,17 | 0,25 |

**`requestsPerSecond` est calculé sur la fenêtre du RUN, pas sur l'activité de l'hôte.** Un run plus court
relève mécaniquement le taux de tous les hôtes. Le « ralentissement solidaire des huit sous-domaines » était
donc un artefact du mur, pas la preuve d'un budget partagé — la même grandeur bouge pareillement sur des
hôtes qu'aucune clé de tenant ne regroupe.

*La règle qui en sort : une grandeur dérivée du mur ne peut pas servir à expliquer le mur.*

## Ce qui est réellement établi

| Fait | Statut |
|---|---|
| Les deux passes corrigées sont saines : 9/9 `complete`, non tronquées | **PROUVÉ** |
| **0 · 429**, **0 timeout** sur les deux passes | **PROUVÉ** |
| 0 erreur, 0 échec d'écriture, 0 offre retenue, 0 rejet | **PROUVÉ** |
| 0 création d'identité sur les deux passes (`firstSeenAt`, immuable) | **PROUVÉ** |
| Volumes stables : 1 976 / 1 977 offres, 2 076 requêtes, 19 hôtes | **PROUVÉ** |
| Aucun portail sur-sollicité sous la clé de tenant | **PROUVÉ** |
| **Coût en temps de la protection par tenant** | **NON ÉTABLI** — variance trop élevée |
| Débit par tenant `tenant:urbn.icims` | **NON MESURABLE** avec l'instrument actuel |

La protection est **sûre** — elle ne casse rien, ne perd rien, ne déclenche aucun 429. Son **coût** reste
inconnu. Ces deux verdicts sont distincts et ne se remplacent pas l'un l'autre.

## Ressources — non limitantes à ce palier, à revalider en T2

| Grandeur | Passe 1 | Passe 2 |
|---|--:|--:|
| RSS pic | 651 Mo (2,7 % de 24 Go) | 599 Mo |
| Connexions DB (pic) | 15, dont 1 en attente | 15 |
| **Requête la plus longue** | **2,85 s** | **0,047 s** |
| Échecs de persistance | 0 | 0 |
| `oomObserved` | `null` *(non observé ≠ aucun)* | `null` |

**La requête à 2,85 s de la passe 1 ne se reproduit pas** : 0,047 s en passe 2, soit soixante fois moins. Un
événement unique, pas une tendance — et un de plus qui montre que la passe 1 était atypique. Le point reste
ouvert pour T2, où le volume est cinq fois supérieur.

## Écritures — et la contamination que la garde a détectée

| | Créations | Ré-attestations |
|---|--:|--:|
| Passe 1, lue **avant** la passe 2 | 0 | 1 976 |
| Passe 1, relue **après** la passe 2 | 0 | **1 977** ← contaminé |
| Passe 2 | 0 | 1 977 |

La relecture de la passe 1 rend maintenant 1 977 au lieu de 1 976 : **une écriture de la passe 2 s'est
ajoutée au compte de la passe 1**. `reattestationValidity.attributable` vaut désormais `false` pour la passe 1
et nomme le run fautif (`p7-bounded-ingest-20260913T131018Z`).

C'est exactement le défaut qui avait fait attribuer à H1 345 écritures appartenant à T2 — sauf qu'ici la garde
l'a **détecté au lieu de le laisser passer**, sur un écart d'une seule ligne qu'aucune relecture humaine
n'aurait remarqué.

**`created` survit à la contamination** : il dérive de `firstSeenAt`, immuable. 0 création sur les deux
passes est un fait solide.

**Limite d'exploitation, assumée** : la garde n'est pas déployée (commit `85ce223` la précède ; elle vit sur
`p8-ab-concurrency`). Les compteurs de la passe 2 n'ont donc **pas** été qualifiés à chaud, et le seront à la
prochaine lecture — après un run qui les aura contaminés à leur tour. Pour T2, la lecture du rapport doit se
faire **entre les deux passes**, pas après.

## Verdict de T1 corrigé

La protection par tenant est **sûre et sans perte**, sur deux passes saines. Son **coût en temps n'est pas
mesurable** avec deux passes d'une telle variance, et la « preuve » que j'en avais tirée après la passe 1
était un artefact de calcul.

Mesurer ce coût exigerait soit plus de passes, soit un instrument de débit indépendant du mur. **Aucun des
deux n'est nécessaire pour P8** : ce que le lot doit établir, c'est que la capacité réelle est soutenable —
et l'absence de 429, de timeout et de perte sur quatre passes le dit déjà. Le coût exact de la protection est
une question ouverte, pas un préalable.
