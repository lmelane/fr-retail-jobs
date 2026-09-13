# P8 · T1 CORRIGÉ — le même corpus, sous la protection par tenant

> 2026-09-13, commit déployé `85ce223`, crons gelés, `P8_STOP_ON_FIRST_429=1` armé.
> Passe 1 : run `5a5cc452`, 12:59:03 → 13:08:43 UTC. Verdict terminal `COMPLETED`,
> `validForCapacity: true`, `problems: []`, 9/9 sources `OK complete=true truncated=false errors=0`.

## Ce que cette reprise mesure, et pourquoi elle existe

T1 (référence) a tourné **avant** la protection par tenant. La porte de politesse y voyait les huit
sous-domaines iCIMS d'URBN comme huit hôtes distincts et leur accordait **huit budgets séparés** pour un
tenant unique. La reprise mesure le même corpus, aux mêmes clés, sous la clé de tenant `tenant:urbn.icims`.

**Un ralentissement d'URBN n'est donc pas une régression** : l'ancienne vitesse tenait à un privilège
qui n'aurait pas dû exister. Ce qu'il faut vérifier n'est pas « est-ce plus rapide », mais « le coût est-il
localisé là où la protection agit, et nulle part ailleurs ».

## Le mur, et où il se déplace

| | T1 référence | T1 corrigé (passe 1) | Écart |
|---|--:|--:|--:|
| **Mur** | 452,7 s | **580,8 s** | **+28,3 %** |
| `urbn-hub` | 440,0 s | **556,0 s** | **+26,4 %** |
| Les 8 autres sources cumulées | ~95,7 s | ~158,5 s | — ¹ |
| Offres collectées | 1 978 | 1 976 | −2 ² |
| Requêtes HTTP | 2 077 | 2 076 | −1 |
| Hôtes observés | 19 | 19 | 0 |
| **429 · timeouts** | 0 · 0 | **0 · 0** | inchangé |
| Retries | 0 | 1 ³ | +1 |
| Erreurs · write failures · retenues | 0 · 0 · 0 | **0 · 0 · 0** | inchangé |

¹ Les durées par source se recouvrent (4 sources en parallèle) : leur somme n'est pas additive et ne se
compare pas au mur. Elle est donnée pour situer, pas pour conclure.
² 1 976 contre 1 978 : le board a bougé entre les deux mesures. Aucune offre n'est perdue — 0 rejet, 0 retenue,
0 échec d'écriture.
³ Un retry sur `www.beiersdorf.de`, 1 erreur réseau absorbée. Sans rapport avec la protection par tenant.

**L'essentiel du surcoût est dans `urbn-hub`, exactement là où la protection agit.**

## La signature d'un budget PARTAGÉ, sous-domaine par sous-domaine

| Sous-domaine iCIMS | Requêtes | T1 référence | T1 corrigé | Écart |
|---|--:|--:|--:|--:|
| `stores-na-urbn.icims.com` | 924 | 2,10 req/s | 1,59 req/s | **−24 %** |
| `homeoffice-na-urbn.icims.com` | 178 | 0,40 | 0,31 | −23 % |
| `stores-eu-urbn.icims.com` | 136 | 0,31 | 0,23 | −26 % |
| `supplychain-na-urbn.icims.com` | 60 | 0,14 | 0,10 | −29 % |
| `menusandvenues-na-urbn.icims.com` | 39 | 0,09 | 0,07 | −22 % |
| `homeoffice-eu-urbn.icims.com` | 30 | 0,07 | 0,05 | −29 % |
| `hub-urbn.icims.com` | 28 | 0,06 | 0,05 | −17 % |
| `supplychain-eu-urbn.icims.com` | 1 | — | — | échantillon de 1 |

**Les huit ralentissent ENSEMBLE, de 17 à 29 %.** C'est la signature recherchée : sous huit budgets séparés,
seul l'hôte saturé aurait ralenti. Le ralentissement solidaire est la preuve d'un budget unique.

**Limite de lecture, nommée** : chaque `requestsPerSecond` est calculé sur la fenêtre propre de son hôte. Ces
taux **ne s'additionnent pas** en un « débit tenant » — les sommes 3,17 → 2,40 req/s ne sont pas une grandeur
physique et ne sont pas utilisées ici comme telle. Ce qui porte la conclusion, c'est le mur et la solidarité
des écarts.

## Ce qui n'a PAS bougé — la protection est-elle restée locale ?

| Hôte hors URBN | Requêtes | p50 |
|---|--:|--:|
| `mecca.wd3.myworkdayjobs.com` | 191 | 243 ms |
| `www.beiersdorf.com` | 123 | 152 ms |
| `lagardere-recrute.talent-soft.com` | 101 | 125 ms |
| `lindex.easycruit.com` | 83 | 328 ms |
| `careers.groupe-rocher.com` | 71 | 83 ms |

**Aucun hôte hors URBN n'est affecté.** La clé de tenant regroupe ce qu'elle doit regrouper et rien d'autre :
`mecca` reste seule sous `tenant:mecca.workday`, les hôtes inconnus gardent leur repli conservateur par nom
d'hôte. Le coût est ciblé.

## Ressources — non limitantes À CE PALIER, à revalider

| Grandeur | Passe 1 | Marge |
|---|--:|---|
| RSS pic | 651 Mo | **2,7 %** de 24 Go |
| CPU (user + system) | 116,5 s sur 580,8 s de mur | **20 %** |
| Connexions DB (pic) | 15, dont 1 en attente | large |
| Requête la plus longue | 2,85 s | à surveiller ⁴ |
| Échecs de persistance | **0** | — |
| `oomObserved` | `null` *(non observé, pas « aucun »)* | — |
| Fenêtre de process couverte | `true`, 117 échantillons | — |

⁴ 2,85 s contre 0,72 s en T1 : la requête la plus longue a quadruplé. Sur un run 28 % plus long, ce n'est pas
proportionnel. **Ce n'est pas un verdict, c'est un point à revalider en T2**, où le volume est cinq fois
supérieur — c'est là que la question devient décidable, pas ici.

## Écritures — et la limite qui les rend lisibles

**Créations d'identité : 0. Ré-attestations écrites : 1 976.** Le corpus entier est ré-attesté, aucune identité
nouvelle n'est fabriquée. Ce n'est pas « zéro changement » : c'est un volume d'écriture quantifié.

`reattestationValidity.attributable: true` — vérifié en base au moment de la lecture : **aucun run postérieur
n'avait touché ces sources**. C'est la garde qui manquait quand H1 a été réconcilié à tort, en attribuant à H1
345 écritures qui appartenaient à T2. Le rapport la porte désormais comme une donnée, pas comme une précaution
de lecture.

## Verdict de la passe 1

La protection par tenant **coûte 28 % de mur sur ce corpus, et ce coût est entièrement localisé sur URBN**.
Elle n'a dégradé aucun autre hôte, n'a produit aucun 429, aucun timeout, aucune perte d'offre et aucune
création d'identité parasite. Le corpus reste complet : 9/9 sources `complete`, aucune tronquée.

**Ce n'est pas une régression de performance : c'est la restitution d'un budget que huit sous-domaines se
partageaient sans y avoir droit.** Le débit précédent n'était pas soutenable — il était emprunté à un tenant
unique qui ne nous l'avait jamais concédé.
