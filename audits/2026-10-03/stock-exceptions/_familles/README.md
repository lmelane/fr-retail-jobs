# D-522 §6, groupe « familles » (03/10/2026)

Sources ACTIVE dégradées au RUN `9022fc4b-1b96-431d-bee9-86ed244ef4f1` (02/10, release r5). Code : branche
`d522-6-familles`, base `d522-6-stock-exceptions` (r6, `ed333f2`). Rien n'est en production. Base lue en lecture seule.

## Fichiers

| Fichier | Contenu |
|---|---|
| `sourceruns-0210.sql` → `.out` | état AVANT en production : les huit collectes du 02/10 |
| `rejeu-preuve.mts` | rejoue HORS RÉSEAU une capture du 02/10 avec le lecteur du worktree, dit le verdict du normaliseur |
| `../<clé>/rejeu-capture-0210-apres.out` | sortie de `rejeu-preuve.mts` après correctif, par source |
| `rejeu-39-autres-sources-apres.jsonl` | les 39 autres sources ACTIVE SmartRecruiters et WTTJ, même rejeu : 39 PROVEN |
| `temoins-sans-correctif.out` / `temoins-avec-correctif.out` | `listProof.test.ts` : 8 rouges sans le correctif, verts avec |
| `../tapestry/facettes-0310.out` | sommes des facettes de Tapestry, page 0 lue le 03/10 (1 requête) |
| `../tapestry/hors-partition.mts` → `.out` | les 7 offres hors facette Brand, rejouées depuis la capture du 02/10 |
| `../knitwell-us-retail/liste-r6.mts` | lecture en direct, liste seule, avec le lecteur r6 (voir knitwell) |

## Constats

1. **Énumération inconnue (lvmh, wttj-sector, hm-group, marella, b-s-international, funky-buddha).** Défaut des
   lecteurs : `lvmhAlgolia.ts`, `wttj.ts`, `wttjSector.ts` et `smartrecruiters.ts` ne déclaraient jamais `complete`,
   alors que la source publie un total à chaque page (Algolia `nbHits`, `nbPages`, `exhaustiveNbHits` ; SmartRecruiters
   `totalFound`) et que les douze collectes depuis le 23/09 lisent exactement ce total. Le statut DEGRADED vient de la
   retenue native (candidature spontanée, non bloquante) ; l'étiquette « énumération inconnue » vient du lecteur.
   Correctif `ca9e05f` : `listProof`. Rejeu des captures du 02/10 : les six passent PROVEN (`SHORT_PAGE` pour lvmh,
   `DECLARED_TOTAL_REACHED` pour SmartRecruiters, terminaisons déjà probantes pour le refresh).
   Une preuve qui manque laisse l'énumération inconnue, comme avant : aucune collecte ne devient bloquante.
2. **wttj-sector** : prouvée (`ORGANIZATIONS_RECONCILED`) mais la terminaison n'est pas probante pour le refresh
   (`DECLARED_BUT_NOT_PROVING`, `refreshPlan.ts`) : la promouvoir est une lecture D-492 à écrire.
3. **tapestry, `CANONICAL_ID_CONTRACT_BROKEN`** : défaut du lecteur. La page `#facets` de la lecture partitionnée
   était archivée sans `canonicalIds` : contrat partiel, preuve tombée au normaliseur (`canonicalContractDeclared:
   false` au 02/10). Correctif `42f685a`, témoin dans `workday.partition.test.ts`. Rejeu : 220 pages sur 220 déclarent.
4. **tapestry, `UNPARTITIONED_POSTINGS=7`** : pas un défaut du lecteur. 7 offres réelles sans valeur Brand chez
   l'éditeur (intérims en boutique Coach et Kate Spade, un poste en Indonésie, une ligne « Coach @ Graduan »), lues
   par le site plafonné. Aucune facette ne s'accorde avec une autre le 03/10 (Brand 2 368, Department 2 369,
   workerSubType 2 371, timeType 2 354) : la preuve par facette de D-520 §4 a (deux facettes d'accord) ne tiendrait pas.
   Limite réelle sous le plafond de 2 000.
5. **knitwell, `ROWS_WITHOUT_EXTERNAL_PATH`** : donnée de l'éditeur, pas un défaut du lecteur. Une ligne par jour,
   chaque jour une réquisition différente, servie sans titre ni chemin (`{"bulletFields":["R-2034394"]}` le 02/10) ;
   son numéro n'apparaît dans aucun identifiant de la liste. Le lecteur refuse à raison d'en fabriquer un identifiant.
6. **knitwell avec r6** (`../knitwell-us-retail/liste-r6.out`, lu en direct le 03/10 à 07:13 UTC, liste seule, 281
   requêtes, après une indisponibilité du tenant Workday de 06:16 à 07:09 UTC) : liste PROUVÉE
   (`COVERING_FACET_RECONCILED`, 3 529 offres + 1 ligne sans chemin = 3 530, 4 facettes d'accord). L'absence reste
   inattestable ce jour-là (`canonicalAbsenceProofUsable: false`, ligne `R-2029816`) : le refresh ne fermera rien
   sur une collecte qui porte une telle ligne. `ENUMERATION_REFUTED` disparaît avec r6.

## Effet attendu après livraison (mesuré, lecture seule, 03/10)

41 sources SmartRecruiters ACTIVE (5 087 offres) et lvmh (5 978) deviennent attestantes. Au premier refresh probant,
environ 3 493 offres actives dont la seule représentation lvmh ou SmartRecruiters n'est plus revue depuis plus de
48 h seraient fermées, sur 90 739 offres actives (3,9 %, sous le frein de 5 % du refresh, mais il s'additionne aux
fermetures des autres lots du même RUN).
