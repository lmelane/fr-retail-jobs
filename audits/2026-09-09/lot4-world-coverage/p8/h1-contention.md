# P8 · H1 — la contention réelle par hôte, figée avant exécution

> Sous-corpus figé le 2026-09-13. Aucune source dupliquée, aucun bombardement : quatre sources **réelles** du
> vivier P6, qui partagent un tenant **réel**, dans une passe bornée.

## Ce que T2 ne mesure pas, et qu'il faut mesurer quand même

T2 impose **un hôte par source** — c'est ce qui rend sa mesure de capacité générale honnête. Mais cette règle
efface précisément le cas que P9 rencontrera tous les jours :

```
plusieurs sources distinctes  →  même tenant  →  workers concurrents  →  une limite qui DOIT être partagée
```

Si la limite était posée par *worker* plutôt que par *hostname*, quatre sources sur un tenant obtiendraient
quatre fois la cadence autorisée — et le portail verrait quatre clients au lieu d'un. La porte par hôte (D25)
prétend l'empêcher ; H1 le vérifie sur le terrain plutôt que sur le code.

## Le corpus

Tenant : **`fastretailing.wd3.myworkdayjobs.com`** — 18 des 50 sources du vivier P6 y vivent.

| Source | Repr. | Dernier run | Rôle dans la mesure |
|---|--:|---|---|
| `uniqlo-us-retail` | 347 | NEW¹ | la lourde : elle domine la demande de créneaux |
| `uniqlo-stores` | 116 | OK | volume moyen |
| `uniqlo-headquarters` | 22 | OK | légère : sa latence d'attente révèle si la lourde monopolise |
| `uniqlo-graduates` | 11 | OK | très légère : témoin de famine |

**4 sources · 496 représentations · 1 seul hôte.**

Choisies pour leurs volumes **contrastés** : c'est l'écart entre la source lourde et les légères qui montre si
une seule peut accaparer le tenant. Quatre sources suffisent à saturer la concurrence par hôte (limite : 4) —
en prendre 18 n'apprendrait rien de plus et martèlerait le portail.

¹ `NEW` = aucun run antérieur, pas un échec (`health.ts:169`).

## Ce que H1 doit démontrer

| # | Propriété | Comment elle se lit |
|--:|---|---|
| 1 | La limite est partagée par **hostname** | débit total de l'hôte ≈ celui d'une source seule, pas 4× |
| 2 | Ajouter des sources **ne multiplie pas** la cadence | requêtes/s de l'hôte comparé à T0 sur un tenant équivalent |
| 3 | Aucune **429** | `statuses` de la télémétrie par hôte |
| 4 | `Retry-After` **respecté** s'il apparaît | retries et délais observés |
| 5 | Aucune source ne **monopolise** | les 4 sources progressent ; la légère n'attend pas la fin de la lourde |
| 6 | Les **autres hôtes** ne ralentissent pas | latences des hôtes hors tenant, inchangées |
| 7 | Aucune **double écriture** | créations/ré-attestations par identifiant, second passage |

## Ce que H1 n'est pas

Ce n'est **pas** une recherche du point de rupture. On ne monte pas la concurrence pour voir quand le portail
cède : c'est le service d'un tiers, pas un banc d'essai. On mesure un cas de production **tel qu'il se
produira**, avec les limites en vigueur, et on arrête immédiatement sur 429 ou comportement hostile.

## Risque accepté, et sa conduite

Quatre sources d'un même tenant lancées ensemble, c'est exactement la situation que la porte doit gérer. Si la
porte ne fonctionnait pas, la mesure produirait un pic de cadence vers Fast Retailing — borné par
`HOST_MAX_CONCURRENCY = 4` et l'écart minimum de 80 ms, soit **12,5 req/s au pire**, et interrompu à la
première 429. Le risque est donc borné par construction, et c'est la raison d'être de la mesure.
