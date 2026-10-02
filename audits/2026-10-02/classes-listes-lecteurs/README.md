# D-520 : liste non prouvée, régression de volume, qualification rejetée — par classe

Mesures en lecture seule de la production le 02/10/2026 entre 14:55 et 15:04 UTC (hors fenêtre du RUN), collecte locale réelle et bornée le même jour à 15:12 et 15:14 UTC. Code : `6fad1df` (Workday) et `b1afa2c` (classes) sur la branche du lot, puis `development`. Rien n'est en production.

## Fichiers

| Fichier | Contenu | Rejeu |
|---|---|---|
| `catalogue.csv` | export de `../remediation-auto/catalogue.sql`, les 8 RUN du 24/09 au 01/10 | `db.py readonly`, commande dans le `.sql` |
| `detail.sql` → `detail.csv` | chaque occurrence des trois classes avec sa famille et son `SourceRun` | idem |
| `sourceruns.sql` → `sourceruns.csv` | l'historique des collectes de ces sources, 22/09 → 02/10 | idem |
| `familles.sql` → `familles.csv` | par famille, l'état de preuve de la dernière collecte de chaque source | idem |
| `configs.sql` → `configs.csv` | la configuration des sources concernées | idem |
| `qualification-rejets.sql` → `.csv` | chaque `SourceValidation` des 7 sources « qualification rejetée » | idem |
| `rejeu-instable.sql` → `.csv` | toutes les validations `REPLAY_RESULT_CHANGED` depuis le 22/09 | idem |
| `ganni-rejeu.sql` → `.csv` | le rapport et le journal de la validation rejetée de GANNI le 01/10 | idem |
| `troncatures.sql` → `.csv` | la terminaison scellée de chaque collecte tronquée | idem |
| `rejeu.py` → `rejeu.out` | les 8 RUN rejoués, par classe : bloquantes avant / après, ce qui reste | `python3 rejeu.py > rejeu.out` |
| `collecte-workday-plafond.mts` → `collecte-knitwell-avant.out`, `collecte-knitwell-apres.out` | collecte locale réelle de knitwell-us-retail, liste seule, avec le code d'avant puis celui du lot | commande en tête du `.mts` |
| `temoins-sur-cd85f41.out` | les témoins du lot lancés sur le code d'avant le lot (`cd85f41`) : 16 échecs | voir plus bas |
| `knitwell-effet.sql` | l'effet en production de la fausse preuve de knitwell — **non lancé** (fenêtre du RUN) | `db.py readonly` après 18:30 UTC |

## Causes racines, par famille

**Liste non prouvée (56 occurrences).**
- *generic-listing, page d'accueil* (attaquer, kastner-ohler, lumentee, et marc-o-polo avant son lecteur dédié) et *flux RSS* (picard) : 32 occurrences. Le lecteur ne lit ni total, ni fin de liste, ni plan du site. Reste à chercher si l'éditeur publie une liste complète. Pour kastner-ohler, le point de départ est une fiche d'offre : sa configuration est à revoir.
- *Workday, plafond de l'API* (knitwell, tapestry) : 9 occurrences. `total` ne dépasse jamais 2 000. Au-delà, l'API ressert une page déjà lue (sondé le 02/10 : offsets 2 000, 3 000, 3 500 et 3 520 identiques). Les facettes, elles, comptent tout le tableau : 3 515 chez knitwell.
- *Workday, tri instable ou total changé pendant la lecture* (mango, nordstrom) et *Phenom, identifiants répétés* (hugo-boss, skechers) : 13 occurrences. Corrigés le 30/09 (`898ffb5`, D-482), prouvés depuis.
- *swatch-group* (25/09) et *foot-locker-france* (28/09) : un cas chacun. foot-locker est revenue seule. swatch-group est traitée par un autre lot (D-493, D-508).

**Régression de volume (63 occurrences).** Elle était une classe fourre-tout : tout incident de santé sans nom devenait `SOURCE_HEALTH_REGRESSION`, lu « volume anormal ».
- *24/09, retenues sans motif natif* : 21 occurrences. Ces retenues sont non bloquantes depuis D-453 §1 (25/09).
- *Troncatures*, soit des pertes de lecture et non des baisses du marché : 18 occurrences. pandora (fiches en 403 pendant 50 s), gemmyo (carte join.com), crocs et sephora (total changé en cours de lecture), ulta (même cause), douglas-sf (revenue seule).
- *Retenue à instruire* (fiche illisible, identité contredite) : 5 occurrences, soit nordstrom, parfums-chanel, swarovski et urbn-hub (2).
- *Descriptions manquantes* d'on-running (D-480) : 8. *Liste réfutée*, sous l'ancien libellé du 24/09 : 8. *Saut de retenues* (nike-nke2) : 1.
- *Baisses réelles du marché* : Aigle, confirmée par l'éditeur le 29/09 (122 → 60 annoncées, D-484 §2), et Indiska (3 → 1, D-491). Deux occurrences sur 63.

**Qualification rejetée (26 occurrences).** Des lecteurs précis, tous corrigés :
- Eightfold, descriptions vides natives et pare-feu (estee-lauder, kering) : D-481 §3, D-482.
- Lecteur JSON-LD sans employeur (pvh) : bascule Phenom, D-481 §4.
- Altamira (zegna) et Talentsoft (chantelle) : D-482, `898ffb5`.
- SuccessFactors (sephora) : D-482.
- talentrecruiter (ganni, 01/10) : le rejeu donnait les mêmes 20 offres, mais 10 motifs `DESCRIPTION_MISSING` venaient dans un autre ordre. Corrigé par `55018b6`. Depuis le 22/09, seules 6 validations sont tombées en `REPLAY_RESULT_CHANGED`, dont 5 le 23/09 sous un ancien code.

## Ce que ce lot change

1. **Workday, plafond de l'API** (`6fad1df`, corrigé à l'audit).
   - **Défaut trouvé en mesurant.** Avec le code d'avant, la collecte locale de knitwell rend 1 999 offres et 1 ligne sans chemin, et déclare la liste prouvée (`collecte-knitwell-avant.out`). Les facettes comptent pourtant 3 515 offres. En production (`sourceruns.csv`), 7 collectes du 23 au 30/09 ont `complete` et `canAttestAbsence` vrais avec 2 000 offres lues sur 3 515 ; la dernière, le 30/09 à 19:12, est postérieure au correctif de la sonde (`898ffb5`). L'effet (retenues de disponibilité, fermetures) n'est **pas mesuré** dans ce lot (fenêtre du RUN) : `knitwell-effet.sql`, à lancer après 18:30 UTC.
   - Une facette qui compte plus d'offres que le total plafonné prouve désormais le plafond (`FACETS_COUNT_BEYOND_TOTAL`). La lecture n'est plus jamais prouvée à tort.
   - Le site plafonné est relu par sa facette couvrante. Collecte locale réelle (`collecte-knitwell-apres.out`) : **3 515 offres sur 3 515**, comptes concordants (4 facettes d'accord), aucun employeur tiré de la facette.
   - **La preuve est archivée mais pas adoptée.** La sortie reste `complete: false` avec `COVERING_FACET_PROOF_NOT_ADOPTED`, et la terminaison n'est pas probante. Transmise, cette preuve ouvrirait l'attestation d'absence, la chute confirmée de D-484 §2 et les retenues de disponibilité. Le décider revient au CEO (carte de décision). knitwell reste sous D-480 §1 : elle collecte tout et ne ferme rien.
   - Une erreur pendant la lecture couvrante ne coûte pas la source : `COVERING_FACET_READ_FAILED`.
2. **Classes exactes** (`b1afa2c`, corrigé à l'audit).
   - La troncature devient `ENUMERATION_TRUNCATED` (liste non prouvée) et la retenue à instruire `RETENTION_TO_INSTRUCT` (contenu incomplet).
   - Une liste non prouvée dont le lecteur nomme la raison (page d'accueil sans liste, flux RSS) devient `ENUMERATION_UNPROVABLE`, classe `LISTE_INDEMONTRABLE`, à réparer. **Elle reste bloquante** (D-453 §1, D-482 : aucune extension de D-480). Elle est non bloquante pour les quatre sources nommées par D-480 §1, sous ce code plus précis.
   - Rendre cette classe non bloquante pour toute la famille est une carte de décision, pas une décision d'architecture.
   - Un défaut de liste ne cache plus rien. Une retenue à instruire, une chute de 10 offres ou plus et une couverture de champ effondrée sont nommées et bloquent, y compris pour une source de D-480 (« tout autre défaut reste bloquant »).

## Rejeu des 8 RUN (`rejeu.out`)

| Classe | Occurrences | Bloquantes relevées | Avec les règles de development avant ce lot | Avec ce lot | Lecteur corrigé depuis | Revenue seule | Reste |
|---|---|---|---|---|---|---|---|
| Liste non prouvée | 56 | 45 | 15 | 16 | 13 | 1 | 2 (swatch-group le 25/09 ; knitwell le 29/09, retenue à instruire) |
| Régression de volume | 63 | 61 | 26 | 26 | 18 | 6 | 2 (urbn-hub les 28/09 et 01/10, retenue à instruire) |
| Qualification rejetée | 26 | 26 | 26 | 26 | 26 | 0 | 0 |

**Lecture honnête.**
- Les règles de ce lot ne retirent aucun blocage sur ces 8 RUN. Elles en ajoutent un : knitwell le 29/09, dont la retenue à instruire était cachée par D-480.
- Les blocages ont disparu grâce aux correctifs de lecteurs du 30/09 et du 01/10, déjà sur `development`. `READER_FIX` les attribue à la main, par source, sur la preuve des collectes suivantes. crocs, gemmyo, sephora et ulta étaient déjà prouvées certains jours avant leur correctif : leur défaut est intermittent, et une seule collecte prouvée depuis ne suffit pas à le dire levé.
- « Revenue seule » veut dire que la cause n'est pas établie. Ces sources reviendront peut-être, et demanderont alors une enquête.
- Ce que ce lot apporte :
  - chaque incident porte sa classe exacte ; « volume anormal » ne nomme plus que 1 occurrence sur 63 ;
  - knitwell est lue en entier, sans fausse preuve d'absence ;
  - un défaut de liste ne cache plus d'autre défaut.

## Témoins

Les fichiers source du lot sont remis à `cd85f41`, puis les témoins sont lancés. Les 16 témoins nouveaux ou modifiés échouent (`temoins-sur-cd85f41.out`) :
- `workday.covering.test.ts` : 8, dont « la page au-delà du plafond ressert des offres déjà lues ». L'ancien code y rend `complete: true`.
- `completenessContract.test.ts` : 5, dont la limite de liste, le plafond de 150 liens, la chute ou la couverture cachée, et la retenue à instruire à côté d'une limite.
- `sourceState.test.ts`, `nativeRetention.test.ts` et `confirmedDrop.test.ts` : 3.

Contrôles : `npm run typecheck`, `npm run check:layout` et `npm run test:local` sont verts sur l'état final.
