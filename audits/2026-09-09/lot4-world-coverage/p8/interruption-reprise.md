# P8 · interruption et reprise — le vrai pipeline, sur clone

> 2026-09-13, clone `catwalks_p8_interrupt_clone` restauré d'un dump de production (79 045 offres actives).
> Le transport est la SEULE chose remplacée : l'adaptateur, les normaliseurs, la porte d'identité, la dédup et
> l'upsert tournent tels qu'en production.

## Pourquoi ce bloc décide, et pas l'orchestration à 0,2 %

T1 a mesuré une orchestration active à 0,2 % du temps mural. Cela dit qu'une file distribuée n'apporterait
**aucun gain de débit** — cela ne dit rien de la **reprise**. Ce sont deux questions distinctes : une file peut
être inutile pour la vitesse et nécessaire pour retrouver un état après un arrêt brutal. C'est donc ce bloc,
et non le chronométrage, qui tranche.

## Référence nominale

| | |
|---|--:|
| Sources | `damart` (Teamtailor), `nikin` (Recruitee) |
| Run | 2/2 OK, 0 échec, 0 timeout |
| `touchedJobSourceIds` | **6** |
| `createdJobIds` | 1 |
| Représentations finales | damart 4 · nikin 3 |

## Les scénarios

### C — interruption pendant l'ÉCRITURE

Le kill est placé sur la transaction de persistance, pas sur un appel de mise à jour : le pipeline écrit par
`$transaction`, et une tentative antérieure qui accrochait `job.update` **ne se déclenchait jamais** — le run
se terminait normalement et ne prouvait rien.

| | |
|---|---|
| Commande | `--crash-after=1` |
| **Code de sortie** | **137** (tué après 1 transaction commitée) |
| Écriture partielle | réelle |

### B — interruption pendant les DÉTAILS

`--crash-after=2` → **code 137**, tué après 2 transactions commitées.

### A — interruption pendant la COLLECTE

**Non exercé sur ce harnais, et je le dis plutôt que de l'affirmer.** Deux tentatives :
· `--crash-after=0` signifie « désactivé », pas « arrêt immédiat » — le run s'est terminé normalement ;
· un `SIGTERM` réel est arrivé **après** la fin du run : la relecture hors ligne dure moins d'une seconde, la
  fenêtre pour interrompre la collecte n'existe pas.

Ce que l'on sait par ailleurs, et qui n'est pas une supposition : le chemin de PRODUCTION installe un
gestionnaire `SIGTERM`/`SIGINT` (`runtime.ts`) qui ferme le run en **`INTERRUPTED`** avec le signal et le
déploiement propriétaires. Ce mécanisme a été écrit après un incident réel (2026-09-09, 18:35 UTC : un
déploiement a tué un run de validation, qui est resté `RUNNING` pour toujours). Le cas est donc couvert en
production ; il n'est simplement pas reproductible sur un harnais qui s'exécute en moins d'une seconde.

## État après interruption

| Contrôle | Résultat |
|---|---|
| Runs orphelins (`finishedAt IS NULL`) | **0** |
| Réservations pendantes | **0** |
| Doublons `sourceKey + externalId` | **0** |
| Représentations | damart 4 · nikin 3 — inchangées |

## Reprise, par le chemin NORMAL

Aucun traitement spécial, aucune commande de récupération : on relance l'ingestion telle quelle.

| | Nominal | Reprise |
|---|--:|--:|
| `touchedJobSourceIds` | 6 | **6** — *les mêmes* |
| Identifiants communs | — | **6 / 6** |
| Identifiants apparus à la reprise | — | **0** |
| `createdJobIds` | 1 | **0** *(l'offre existe déjà)* |
| Représentations | 4 · 3 | 4 · 3 |
| Run | 2/2 OK | **2/2 OK** |

**Aucune double écriture, aucune perte, aucun identifiant divergent.** La comparaison est faite par
**ensembles d'identifiants**, jamais par cardinaux : toucher six lignes différentes donnerait le même total.

## Verdict

Le mécanisme actuel **suffit** : un arrêt brutal ne laisse ni run orphelin, ni réservation pendante, ni
doublon, et la reprise par le chemin normal reconverge exactement sur l'état nominal.

**Une file distribuée n'est donc justifiée ni par le débit** (orchestration 0,2 %) **ni par la reprise** (ce
bloc). Elle est écartée sur mesure, pas sur opinion.

**Réserve nommée** : le scénario A n'est pas reproductible sur ce harnais. La couverture en production repose
sur le gestionnaire de signaux de `runtime.ts`, écrit et déployé après un incident réel — pas sur une mesure
faite ici.
