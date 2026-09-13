# P8 · H1 — la contention par hôte partagé, mesurée

> 2026-09-13, commit `5339b73`, run `81e659cc`. Quatre sources réelles du tenant `fastretailing.wd3`.

## La question, et sa réponse

*Plusieurs sources distinctes sur un même tenant obtiennent-elles chacune leur cadence, ou partagent-elles une
seule limite ?* Si la limite était posée par worker, quatre sources vaudraient quatre clients pour le portail.

**Réponse : la limite est bien partagée par hostname.**

| | |
|---|--:|
| Sources lancées | 4 |
| **Hôtes sortants observés** | **1** — `fastretailing.wd3.myworkdayjobs.com` |
| Requêtes | 515 |
| **Débit vers le tenant** | **7,39 req/s** |
| Débit par hôte mesuré en T1 (hôtes distincts) | 7–8 req/s **par hôte** |

Quatre sources sur un hôte ne donnent **pas** 4 × 7 ≈ 28 req/s : elles donnent **7,39 req/s**, exactement la
cadence d'un hôte unique. **Ajouter des sources ne multiplie pas la cadence autorisée** — la porte agit sur le
hostname, pas sur le worker. C'est la propriété que D25 promettait ; elle est maintenant démontrée sur le
terrain plutôt que lue dans le code.

## Trois HTTP 429 — les premières du lot, et ce qu'elles enseignent

| Statut | Nombre |
|---|--:|
| 200 | 512 |
| **429** | **3** |
| Retries | 3 |
| Timeouts | 0 |
| Offres perdues | **0** |

Chaque 429 a été suivie d'une re-tentative qui a abouti : 515 requêtes, 515 réponses, 486 offres collectées,
**aucune perte**. Le mécanisme de recul fonctionne.

**Mais le fait brut est plus important que sa bonne gestion** : c'est le **seul** corpus de P8 qui déclenche un
refus du portail. T0 (239 req), T1 (2 077 req) et leurs passes n'en ont produit aucune. La différence n'est
pas le volume — T1 fait quatre fois plus de requêtes — c'est la **concentration sur un tenant unique**.

## Aucune famine : les quatre sources progressent

| Source | Durée | Offres | Débit |
|---|--:|--:|--:|
| `uniqlo-us-retail` | 69,6 s | 345 | 4,96 /s |
| `uniqlo-stores` | 18,4 s | 111 | 6,02 /s |
| `uniqlo-headquarters` | 4,3 s | 19 | 4,44 /s |
| `uniqlo-graduates` | 3,5 s | 11 | 3,12 /s |

Les trois sources légères terminent en 3,5 à 18 s **pendant** que la lourde tourne 69,6 s : aucune n'attend la
fin de `uniqlo-us-retail`. La source lourde **ne monopolise pas** le tenant.

Phases : collecte **83,3 %**, écriture 15,9 %, orchestration **0,8 %** — cohérent avec T0 et T1.

## La conséquence qui change la recommandation

T1 a désigné `INGEST_SOURCE_CONCURRENCY = 4` comme goulot. La correction évidente serait de l'augmenter.

**H1 montre pourquoi ce serait imprudent tel quel.** Augmenter la concurrence de sources fait travailler plus
de sources en parallèle — donc, quand plusieurs partagent un tenant, **plus de pression sur ce tenant**. Or
c'est exactement la configuration qui vient de produire trois 429.

Et T1 a montré le symétrique : `urbn-hub` éclate en **8 sous-domaines iCIMS** d'un même tenant, que la porte
traite comme **8 budgets séparés**. Là, la protection est trop faible ; ici, elle tient mais sature.

**Les deux constats se répondent** : la porte protège correctement un *hostname*, et un *tenant* n'est pas
toujours un hostname. La concurrence de sources et le regroupement par tenant doivent donc être décidés
ensemble, jamais l'un sans l'autre.

## Idempotence

9 créations (offres réellement nouvelles), 477 ré-attestations, 0 erreur, 0 write failure.
