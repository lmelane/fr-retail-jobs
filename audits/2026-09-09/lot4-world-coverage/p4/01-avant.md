# P4 — l'état AVANT, mesuré (2026-09-11 11:01–11:03 UTC, production, lecture seule)

Toutes les mesures viennent d'une transaction `RepeatableRead` unique dont le niveau est **asserté**, pas
supposé. Scripts : `apps/aggregator/scripts/coverage/lifecycle-reference.mts`, `hold-blast-radius.mts`.
Sorties : `lifecycle-reference.json`, `hold-blast-radius.json`.

> Un défaut trouvé en écrivant la mesure elle-même : `SHOW transaction_isolation` nomme sa colonne
> `transaction_isolation`, pas `level`. Lire la mauvaise clé faisait passer l'assertion pour vraie en
> n'assertant rien. Corrigé avant toute lecture. *(La référence P1 aliasait explicitement `AS level` — elle
> n'avait pas ce défaut.)*

## États du cycle de vie

| | Offres | Dénominateur |
|---|---:|---|
| Total `Job` | 83 070 | — |
| Actives | **78 932** | 95,0 % du total |
| Fermées (`closedAt`) | 2 772 | 3,3 % |
| Retirées (`withdrawnAt`) | 1 344 | 1,6 % |
| Inactives sans date | **22** | 0,03 % — *défaut : un état sans preuve ni date* |
| Actives ET portant `closedAt` | 0 | l'invariant tient |
| Ayant connu une réouverture | 212 | `reopenedCount` total 212 |

Motifs de retrait : `DISCOVERY_ONLY_SOURCE_NOT_A_POSTING_SOURCE` 584 (FashionJobs, P2) · `OUT_OF_SCOPE` 432 ·
`SOURCE_RETIRED` 316 · `IDENTITY_CONTRADICTED` 12. **Aucun retrait administratif n'est enregistré comme
fermeture employeur** — la séparation `closedAt` / `withdrawnAt` tient.

Événements enregistrés : `OPENED` 11 999 · `CLOSED` 1 528 · `WITHDRAWN` 970 · `REOPENED` 212.

## Fraîcheur des représentations actives

| Âge de la dernière observation native | Représentations | Part |
|---|---:|---:|
| < 24 h | 5 437 | 6,7 % |
| 24–48 h | 20 774 | 25,7 % |
| 48 h – 7 j | 54 618 | 67,6 % |
| **Total** | **80 829** | dénominateur explicite |

Aucune représentation au-delà de 7 jours. Les crons étant gelés depuis le 2026-09-09 (D57), l'ensemble du
catalogue vieillit ensemble : **ce n'est pas un défaut de fraîcheur, c'est l'effet du gel**, et il faut le dire
plutôt que présenter 67,6 % comme une dérive.

## Le défaut central : le DROIT D'ATTESTER est perdu par 224 sources sur 440

| Statut du dernier run | Sources | Peuvent attester | Ne peuvent pas |
|---|---:|---:|---:|
| OK | 311 | 213 | 98 |
| DEGRADED | 216 | **3** | **213** |
| NEW | 26 | 0 | 26 |
| BROKEN | 1 | 0 | 1 |

**224 sources portant 41 795 représentations vivantes** (sur 80 829, soit 51,7 %) ne peuvent pas attester
l'absence. Leurs offres ne se fermeront donc jamais par le silence — ce qui est la bonne règle — mais **rien ne
suit ces offres**, et c'est le défaut : elles restent actives indéfiniment sans état, sans motif, sans action
suivante.

### Trois causes distinctes, aujourd'hui confondues dans un seul drapeau

Parmi ces 224, **187 sources portant 20 796 représentations ont lu tout ce qu'elles déclaraient**, sans erreur,
sans troncature — et sont pourtant bloquées.

| Cause | Cas mesuré | Ce que le drapeau dit | Ce qui est vrai |
|---|---|---|---|
| **(a) Une seule retenue non résolue bloque toute la source** | `tapestry` : 2 091/2 091 lues, 0 erreur, **5 retenues** → `complete:false` ; `vf-corporation` 1 273/1 273, **695 retenues** ; `intersport-france` 993/993, **63 retenues** | « collecte incomplète » | la collecte est complète ; 5 pages sur 2 091 sont défectueuses |
| **(b) L'adaptateur ne déclare rien** | `boots` (1 472 lues, `declaredTotal` **null**), `pvh` 1 358, `adidas` 1 069 | « collecte incomplète » | **inconnu** ≠ incomplet — 70 adaptateurs sur 101 ne déclarent pas de total |
| **(c) Une unité d'écart sur un total déclaré** | `kering` 1 025/1 026 ; `knitwell-us-retail` 1 999/2 000 | « collecte incomplète » | 99,9 % lu ; le seuil de 0,9 d'`isTrustedForAttestation` l'accepterait, mais `complete:false` court-circuite le seuil |

**Cause racine, une ligne** — `apps/aggregator/src/pipeline/ingest.ts:354` :

```ts
if (!publicationDisposition(job.publicationHold)) {
  stats.heldUnresolved = (stats.heldUnresolved ?? 0) + 1;
  stats.complete = false;          // ← une seule page défectueuse, et toute la source perd son droit d'attester
}
```

et `apps/aggregator/src/ats/index.ts:81`, où `complete` agrège trois questions différentes (le balayage
a-t-il atteint la fin ? le total déclaré est-il atteint ? chaque page a-t-elle été exploitable ?) en un booléen
dont la valeur par défaut est `false`.

**Contre-exemple qui doit rester bloqué** : `swatch-group`, `complete:true`, 61/61, 0 erreur — refusé par la
garde d'effondrement (275 → 61 offres). C'est le comportement voulu : une chute de 78 % n'est pas une journée
d'expirations. Toute correction doit le laisser bloqué.

## Les retenues : archivées, jamais suivies

Les retenues vivent dans `SourceObservation` (l'offre n'est **jamais** écrite comme `Job`), une table qui porte
`sourceKey`, `externalId`, `contentHash`, `raw`, `observedAt` — et **rien d'autre**. Pas d'état, pas d'ancienneté
exploitable, pas d'action suivante, pas de condition de résolution.

| Motif de retenue | Observations | Offres distinctes | Sources | Plus ancienne |
|---|---:|---:|---:|---|
| `WORKDAY_EMPLOYER_ABSENT_IN_DETAIL` | 760 | 728 | 4 | 2 j |
| `APPLICATION_EXPLICITLY_CLOSED` | 110 | 49 | 2 | 3 j |
| `SCOPE_OUT_OF_PERIMETER` | 38 | 38 | 1 | 1 j |
| `APPLICATION_TEMPLATE_EXPIRY_CONTRADICTION` | 24 | 12 | 1 | 3 j |
| `APPLICATION_HTTP_404` | 16 | 8 | 1 | 3 j |
| `WORKDAY_DETAIL_FETCH_FAILED` | 3 | 3 | 2 | 2 j |
| *(sans motif — observations ordinaires)* | 106 744 | 76 727 | 455 | 5 j |

**838 offres retenues, 766 d'entre elles bloquant 187 sources.** Aucune ne porte de date de première retenue
distincte de la dernière observation, d'action suivante ni de condition de levée : l'item 8 du cahier des
charges n'a aujourd'hui aucun support.

## Ce qui est déjà correct et ne doit pas être touché

- `deactivateJob` / `reactivateJob` (`pipeline/lifecycle.ts`) : `closedAt` et `withdrawnAt` mutuellement
  exclusifs, `reopenedCount` incrémenté **seulement** si l'offre avait un `closedAt` (une republication après un
  retrait administratif n'est pas une réouverture employeur). 0 offre active portant `closedAt`.
- `isTrustedForAttestation` (`pipeline/attestation.ts`) : la distinction santé / droit d'attester, le seuil de
  couverture 0,9, la garde d'effondrement 0,5.
- `runRefresh` : exclusion des sources sans droit d'attester, garde de fermeture de masse, orphelin →
  `WITHDRAWN ATTESTATION_MISSING` et non `CLOSED`.

Le défaut n'est pas dans ces règles. Il est dans **ce qui alimente `complete`**, et dans **l'absence de suivi**
des situations invérifiables.
