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
| `temoins-classes-sur-6fad1df.out` | les témoins du lot de classes lancés sur le code d'avant : 6 échecs | voir plus bas |
| `knitwell-effet.sql` → `.out` | l'effet en production de la fausse preuve de knitwell | `db.py readonly` après 18:30 UTC |

## Causes racines, par famille

**Liste non prouvée (56 occurrences).**
- *generic-listing, page d'accueil* (attaquer, kastner-ohler, lumentee, et marc-o-polo avant son lecteur dédié) et *flux RSS* (picard) : 32 occurrences. L'éditeur n'expose ni total, ni fin de liste, ni plan du site. Aucun lecteur ne peut le prouver : c'est une limite de la famille.
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

1. **Workday, plafond de l'API** (`6fad1df`).
   - **Défaut trouvé en mesurant** : la collecte locale de knitwell avec le code d'avant rend 1 999 offres et 1 ligne sans chemin. Elle déclare la liste prouvée (`collecte-knitwell-avant.out`). Le RUN du 30/09 l'a enregistrée `complete` et `canAttestAbsence`, soit une fausse preuve d'absence sur 1 515 offres en ligne : la forme exacte de l'incident du 27/09.
   - Une facette qui compte plus d'offres que le total plafonné prouve désormais le plafond.
   - Le site plafonné est relu par sa facette couvrante. Collecte locale réelle : **3 515 offres sur 3 515, liste prouvée** (`collecte-knitwell-apres.out`), aucun employeur tiré de la facette.
   - La terminaison n'est pas probante pour le refresh : aucune offre ne se ferme sur elle sans décision du propriétaire.
2. **Classes exactes** (`b1afa2c`).
   - La troncature devient `ENUMERATION_TRUNCATED` (liste non prouvée) et la retenue à instruire `RETENTION_TO_INSTRUCT` (contenu incomplet). Une retenue à instruire à côté d'un défaut de liste est nommée et bloque.
   - La limite de famille devient `ENUMERATION_UNPROVABLE` : classe `LISTE_INDEMONTRABLE`, non bloquante, jamais attestante. Le critère est la sortie du lecteur, jamais le nom de la source.

## Rejeu des 8 RUN (`rejeu.out`)

| Classe | Occurrences | Bloquantes relevées | Avec les règles de development avant ce lot | Avec ce lot | Lecteur corrigé depuis | Revenue seule | Reste |
|---|---|---|---|---|---|---|---|
| Liste non prouvée | 56 | 45 | 15 | 16 | 13 | 1 | 2 (swatch-group le 25/09 ; knitwell le 29/09, retenue à instruire) |
| Régression de volume | 63 | 61 | 26 | 26 | 18 | 6 | 2 (urbn-hub les 28/09 et 01/10, retenue à instruire) |
| Qualification rejetée | 26 | 26 | 26 | 26 | 26 | 0 | 0 |

**Lecture honnête.** Les règles de ce lot ne retirent aucun blocage sur ces 8 RUN : les quatre sources de page d'accueil et knitwell étaient déjà non bloquantes par D-480. Elles en ajoutent un : knitwell le 29/09, dont la retenue à instruire était cachée par D-480 (« tout autre défaut reste bloquant »). Les blocages ont disparu par les correctifs de lecteurs du 30/09 et du 01/10, tous déjà sur `development`. Ce lot apporte trois choses :
- la limite est classée par famille, et non plus par nom de source : une nouvelle Maison de la même famille ne bloquera pas ;
- « volume anormal » ne désigne plus que le volume : 1 occurrence sur 63 au lieu de 63 ;
- knitwell est lue en entier, et sa fausse preuve d'absence est fermée.

## Témoins

- `workday.covering.test.ts` : 11 témoins. Sur le code d'avant, les 6 qui ne sont pas des prémisses échouent, dont « la page au-delà du plafond ressert des offres déjà lues ». L'ancien code y rend `complete: true`.
- `completenessContract.test.ts` (limite de famille, plafond de 150 liens, retenue à instruire à côté d'une limite), `sourceState.test.ts` et `nativeRetention.test.ts` : 6 échecs sur le code d'avant (`temoins-classes-sur-6fad1df.out`).
