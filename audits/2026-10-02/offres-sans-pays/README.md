# D-520 — offres servies sans pays : mesure, résolution sur preuve, rattrapage à blanc

Écart 1 de `../pourquoi-offre/README.md` : 3 217 offres servies sans pays à 15:08 UTC, que la recherche ne trouve pas.
Toutes les lectures de production ont été faites en lecture seule par `apps/aggregator/scripts/ops/db.py readonly`, avant
15:30 UTC puis après 18:30 UTC, jamais pendant le créneau du RUN.

## Fichiers

| Fichier | Contenu |
|---|---|
| `01-par-source-et-lieu.sql` / `.out` | Par source : sans ville, ville connue d'un seul pays de GeoNames, ville ambiguë, ville inconnue, coordonnées. |
| `02-brut-par-source.sql` / `.out` | Les clés du RAW et ses champs de lieu, une publication par source. |
| `03-faits-et-bureaux.sql` / `.out` | `sourceFacts.locations` et le champ natif de lieu (bureaux Greenhouse, JSON-LD, cellules Talentsoft). |
| `04-coordonnees.sql` / `.out` | L'étendue des points natifs : Boots 1 960 sur 1 973, dont 202 dans la zone irlandaise (Boots est aussi en Irlande). |
| `05-marche-observe-des-sources.sql` / `.out` | Les pays des autres offres de chaque source (clé d'API publique de recherche masquée). |
| `06-instantane.sql` / `.jsonl.gz` | Les 3 217 offres, une ligne chacune, avec les pays où GeoNames connaît leur ville. |
| `mesure-a-blanc.mts` | La mesure à blanc : l'aperçu même de `resoudre-pays`, dans une transaction READ ONLY. |
| `07-apercu.json.gz` / `07-mesure-a-blanc.txt` | L'aperçu complet (18:45 UTC) et sa synthèse par motif, cause et source. |
| `08-relecture-30.txt` | 30 résolutions tirées au hasard après l'arbitrage, relues à la main : 30 justes. |

## Motifs mesurés (15:08 UTC)

- **Boots, 1 973** : la ville est dans l'adresse de rue (« Aberdeen, Bon Accord Centre »), sans champ pays, avec un point natif.
  1 128 villes sont ambiguës (Aberdeen existe dans six pays), mais le point les départage.
- **Bureau Greenhouse nommé par son pays**, que le lecteur ignorait : On 157 (« United States », « China »…) et Molton Brown 26.
- **État américain dont le code est aussi un pays** (« Atlanta, GA », « Chicago, IL ») : la chaîne s'abstient à raison.
  La ville et l'État le prouvent ensemble.
- **Communes françaises sans pays** : Lagardère, Nocibé, Chantelle.
- **Lieu absent ou inconnu** : codes magasin Talentsoft et Taleo (« Brown Thomas », « BT2 »), « JOBREQ00054977_JCP »,
  « Remote », lieu vide (Caudalie, PVH, Mecca).
- **Nike, 116** (absentes de la mesure de 15:08, présentes à 18:33 UTC) : champ pays natif Workday « China Mainland », absent de la table des
  libellés.

## Résolution (code, `development`)

La chaîne existante passe d'abord, sans changement. Puis :

1. **Lecteurs** :
   - le nom de bureau Greenhouse quand il est un pays (`ats/adapters/greenhouse.ts`) ;
   - « China Mainland » (`normalize/countryLabels.ts`).
2. **Preuve après la chaîne** (`geo/paysParPreuve.ts`, `publication/countryProof.ts`). Elle ne s'applique que si la chaîne ne
   retient aucun pays et ne s'abstient pas sur une contradiction. Deux motifs, chacun avec une preuve en plus de la ville :
   - **point natif et ville concordants** : même pays, une ville du même nom à 50 km au plus ;
   - **ville et subdivision** : la subdivision écrite dans un segment distinct du lieu (« Boston, MA », « AMILLY, 45200,
     Centre-Val de Loire »), deux lettres au moins, confirme la ville dans un seul pays du référentiel. C'est la structure
     « ville, État » que la chaîne lit déjà (R-125 §1, « structure du libellé »). Le motif est contraint par le marché observé
     de la source, qui ne peut que refuser.

   **R-125 §1, arbitrage du 02/10/2026** : une ville seule ou une subdivision seule, même connue d'un seul pays, ne donne
   jamais de pays (cause `VILLE_SEULE_R125`). Un point qui désigne un autre pays est une contradiction.
3. **Branchements** : ingestion et réparation relue.
4. **Rattrapage** : `resoudre-pays` (aperçu, puis `--apply --plan=` du seul fichier relu). Il écrit, sur l'offre et sur la
   présentation de sa publication canonique, le pays et la subdivision. Il journalise aussi le changement (`DataCorrection`,
   événement CHANGED). Les déclencheurs de D-496 posent ensuite la ville et le point, et ceux de l'indexation remettent
   l'offre en file.

## Mesure à blanc (18:45 UTC, 91 s, READ ONLY, après l'arbitrage R-125 §1)

**3 416 offres actives sans pays : 2 400 résolues, 1 016 restantes.** (Avant l'arbitrage, 18:33 UTC : 2 556 résolues, dont
126 par la ville seule et 30 par la subdivision seule, retirées.)

| Motif | Offres | Pays |
|---|---:|---|
| Point natif et ville | 1 920 | GB 1 803, IE 113, FR 4 |
| Lecture native (bureau Greenhouse, « China Mainland ») | 305 | CN 178, US 59, GB 23, KR 10… |
| Ville et subdivision | 175 | US 144, FR 29, CH 2 |

| Cause restante | Offres | Principales sources |
|---|---:|---|
| Ville seule (R-125 §1) | 288 | Lagardère 61, Lovable 43, On 31, Veronica Beard 28 (États seuls), Boots 25, Damiani 17 |
| Lieu inconnu du référentiel | 239 | Brown Thomas 81 (codes magasin), Printemps 28 (départements), Nocibé 17, Mejuri 15 |
| Ville ambiguë | 221 | Rivoli 31 (Doha, Dubaï), La Senza 22, Veronica Beard 22, Reformation 21 |
| Lieu absent | 145 | Caudalie 34, PVH 33, Mecca 10 |
| Point sans ville connue | 63 | Boots 59 |
| Publication illisible par le lecteur d'aujourd'hui | 28 | Chanel 21 |
| Point et ville discordants | 27 | Boots 25 (Fife, Kerry, Isle of Wight, Somerton…), Intersport 2 (point en Californie) |
| Contradiction déclarée (D-440) | 3 | Estée Lauder |
| Marché de la source inconnu | 2 | City Beauty, Cuyana |

## Écarts connus

1. **R-125 §1** : respectée ; les 288 offres dont seule la ville (ou la subdivision) désigne un pays restent sans pays.
2. **Le marché observé est déjà faux par endroits**, et ces erreurs sont antérieures au lot :
   - Boots NF : « Norfolk » est lu comme l'île Norfolk ;
   - Lovable BA, BS, FI : codes de province italiens lus comme des pays ;
   - Veronica Beard GE : « Georgia » est lu comme la Géorgie.

   Ce marché ne fait que refuser la ville et la subdivision ; aucune résolution de cette mesure n'en dépend à tort.
3. **Une offre à plusieurs publications** : seule la présentation canonique est rattrapée. Les autres le seront à leur
   prochaine observation.
4. **La provenance du pays prouvé n'est pas persistée sur l'offre** : `countryIntegrity` reste nul, et la cause des restantes
   n'est pas visible dans `pourquoi-offre` (SANS_PAYS). Le motif est journalisé au rattrapage seulement.
