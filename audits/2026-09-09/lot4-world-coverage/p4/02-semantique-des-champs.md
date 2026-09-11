> Cette note est la référence du sens des champs de cycle de vie. Toute règle qui les lit ou les écrit doit s'y
> conformer ; un écart est un défaut, pas une variante.

# Le sens exact des sept champs, et qui a le droit d'y toucher

Trois natures, à ne jamais mélanger :

- **EMPLOYEUR** — un fait que l'employeur publie ou décide. On ne l'invente jamais.
- **OBSERVATION** — ce que notre pipeline a constaté, et quand. Un fait sur NOUS, pas sur l'employeur.
- **ADMINISTRATIF** — une décision de Mode Careers. Elle ne doit jamais se présenter comme un fait employeur.

| Champ | Nature | Ce qu'il signifie RÉELLEMENT | Ce qui peut le modifier | Ce qui ne doit JAMAIS le modifier |
|---|---|---|---|---|
| `postedAt` | **EMPLOYEUR** | La date de publication **déclarée par la source**. Absent = la source ne la donne pas. | Une lecture de la source qui porte la date, à la création comme à la ré-attestation. | Une date d'observation, une réparation interne, une canonicalisation, `now()`. Une offre sans date reste sans date : `published_at + 3 mois` inventerait une échéance *(arbitré 2026-09-11 : « ne pas dériver »)*. |
| `firstSeenAt` | **OBSERVATION** | Le premier instant où **nous** avons vu cette offre. Ce n'est pas une date de publication. | La création de la ligne, une seule fois. | Une ré-attestation, une fusion d'identité, un changement d'URL canonique, une réouverture. *(D22 : la stabilité de `firstSeenAt` est ce qui stabilise `datePosted` côté Google.)* |
| `lastSeenAt` | **OBSERVATION** | Le dernier instant où une source a **listé** cette offre. Sur `JobSource`, c'est la dernière observation NATIVE par cette source-là. | Une ré-attestation réussie par la source. | **Une tentative échouée.** Un run BROKEN, un 403, un timeout ne repoussent pas `lastSeenAt` : sinon un échec ferait passer une offre pour fraîche. |
| `updatedAt` | **OBSERVATION** | La dernière écriture sur la ligne, posée par le serveur. **Ne distingue pas « réécrit » de « modifié »** : une ré-attestation l'estampille même sans changer un champ. | Toute écriture, y compris une réparation interne. | — (mais ne jamais s'en servir pour prouver qu'une valeur a changé : comparer les valeurs). |
| `closedAt` | **EMPLOYEUR** | L'employeur **ne publie plus** cette offre, et un run **fiable** l'a constaté. | `deactivateJob(…, {kind:'CLOSED'})`, uniquement depuis un run qui a le droit d'attester l'absence. | Un échec de collecte, une troncature, un retrait administratif, un défaut de contenu. **Exclusif de `withdrawnAt`.** |
| `withdrawnAt` | **ADMINISTRATIF** | **Nous** ne publions plus cette offre : source retirée, hors périmètre, identité contredite, attestation manquante. | `deactivateJob(…, {kind:'WITHDRAWN', reason})` avec un motif nommé. | Être présenté comme une fermeture employeur. *(« Le retrait d'une source retire des attestations ; il ne prouve jamais une fermeture employeur. »)* **Exclusif de `closedAt`.** |
| `reopenedCount` | **EMPLOYEUR** | Le nombre de fois où une offre **fermée par l'employeur** est revenue. | `reactivateJob`, **et seulement si `closedAt` était renseigné**. | Une republication après un retrait administratif : il n'y avait pas de fermeture employeur à annuler → événement `REPUBLISHED`, compteur inchangé. |

## L'invariant qui tient, vérifié

`closedAt` et `withdrawnAt` sont mutuellement exclusifs, et une offre active ne porte ni l'un ni l'autre.
Mesuré en production le 2026-09-11 : **0 offre active portant `closedAt`** sur 83 070 lignes.

Reste **22 lignes inactives sans aucune des deux dates** (0,03 %) — un état sans preuve, antérieur à la
séparation des deux notions. Déclaré comme dossier ouvert, non réparé dans ce lot (aucune preuve ne permet de
décider rétroactivement laquelle des deux dates aurait dû être posée : en inventer une serait exactement ce que
la règle interdit).

## Les cinq dates à ne pas confondre (item 2 du cahier des charges)

Le défaut qu'elles évitent : **une tentative échouée qui écrase une observation réussie**.

| Notion | Où elle est lue | Ce qu'elle prouve |
|---|---|---|
| Dernière **tentative** de collecte | `SourceRun.ranAt` du dernier run, quel que soit son statut | Qu'on a essayé. Rien de plus. |
| Dernière collecte **terminée avec succès** | dernier `SourceRun` sans erreur et non tronqué | Que le balayage est allé au bout. |
| Dernière **observation native de l'offre** | `JobSource.lastSeenAt` | Que CETTE source listait CETTE offre à cet instant. |
| Dernière **observation complète de la source** | dernier `SourceRun` de verdict d'énumération `PROVEN` | Qu'on a vu la fin du listing. |
| Dernière fois vue dans un **périmètre fiable** | dernier `SourceRun` avec `canAttestAbsence = true` | Que l'absence y serait significative. |

Ces cinq colonnes sont distinctes dans le registre des invérifiables
(`scripts/coverage/unverifiable-register.mts`) : `lastAttemptAt` et `lastReliableObservationAt` y sont deux
champs séparés, et **le second reste nul quand il n'existe pas** — jamais rempli par le premier.
