# La base mondiale de lieux et la recherche de proximité (D-496, D-499)

*Statut au 01/10/2026 : construit sur `development`, **non livré**. Migrations écrites, non appliquées en production.*

D-496 (arbitrage CEO du 01/10/2026) : une ville cherchée donne les offres autour d'elle, triées de la plus proche à la
plus éloignée, dans des cercles invisibles de 15, 30, 50 puis 100 km tant qu'il y a moins de 20 offres. Même logique
pour `/emplois`, l'accueil de l'inscrit (filtre `ville`) et l'examen des alertes. D-499 : les suggestions sont des
lieux reconnus, comme Indeed (ville, arrondissement, commune, code postal, chacun avec sa subdivision), et chaque lieu
est un point : « Paris 15e » cherche autour du 15e.

## Les sources : GeoNames `cities500` et les codes postaux GeoNames

- Licence **Creative Commons Attribution 4.0** (`readme.txt` de https://download.geonames.org/export/dump/). Attribution
  exigée, enregistrée avec chaque chargement (`GeoCityRelease.attribution`) : « Données géographiques : GeoNames
  (geonames.org), CC BY 4.0 ». Elle doit apparaître sur le site (mentions légales) avant la mise en production des
  suggestions de villes : écart ouvert, voir D-496 dans `DECISIONS.md` du backend.
- `cities500` plutôt que `cities1000` : les petites communes du luxe et de la beauté (ateliers, manufactures) ont
  souvent moins de 1 000 habitants ; 236 000 localités contre 167 000, pour 13,9 Mo contre 11,1 Mo compressés.
- Volume en base, mesuré sur base jetable le 01/10/2026, index compris : `GeoCity` 197 Mo (avec les noms des régions),
  `GeoCityName` 209 Mo (1,13 million de noms sous leur clé), `GeoCityLabel` 14 Mo, `GeoPostalCode` 414 Mo (1,81
  million de codes), soit **environ 830 Mo**, pour un volume de production à 26 Go sur 50.
- `alternateNamesV2` (205 Mo compressés, lu en flux, jamais chargé tel quel) ne sert qu'aux libellés par langue de
  l'interface (« München », « Londres ») et aux noms des régions dans ces langues (« Bretagne », « Bayern »).
- Les codes postaux (D-499) : `export/zip/allCountries.zip` de GeoNames (19,7 Mo compressés, même licence), 1,81
  million de codes, 40 des 44 pays des marchés ; sans codes : Taïwan, Grèce, Viêt Nam, Arabie saoudite, et Hong Kong
  qui n'en a pas ; le Royaume-Uni n'a que la partie district (« SW1A »). Les 14 635 codes CEDEX français (un gros
  destinataire de courrier, pas un lieu) et les libellés d'entité administrative (« London Borough of Bexley ») ne sont
  pas chargés. Couverture par pays :
  `audits/2026-10-01/localisation/resultats/couverture-lieux-par-marche-2026-10-01.txt`.
- Les arrondissements (D-499) : GeoNames numérote ceux de Paris, Lyon et Marseille ; ils s'écrivent « Paris 15e »,
  avec leur point. Ailleurs, les quartiers de GeoNames (PPLX) sont des lieux reconnus sous leur nom.

## Ce qui est en base

| Objet | Rôle |
|---|---|
| `GeoCity` | une localité (ville, arrondissement, quartier) : nom affiché, pays, subdivisions, point, population, `suggestible` (faux pour un doublon de GeoNames ou une entité administrative) |
| `GeoPostalCode` | un code postal et le lieu qu'il dessert, sa subdivision affichée, son point |
| `GeoCityName` | chaque nom (principal, ASCII, variantes de toutes langues) sous sa clé `catwalks_lieu_cle` ; clé primaire en collation C, servie à l'égalité et au préfixe |
| `GeoCityLabel` | le nom d'usage par langue de l'interface, quand il diffère |
| `GeoCityRelease` | chaque chargement : fichiers, empreintes, licence, attribution |
| `Job.geo*`, `DirectOffer.geo*` | le point de recherche : coordonnées natives valides, sinon centre de la ville ; tenu par les déclencheurs `catwalks_geo_job*` et `catwalks_geo_offre_directe*` à l'insertion et quand la ville, le pays, la subdivision ou les coordonnées changent |
| `catwalks_ville_par_nom(pays[], nom, indice)` | la règle par nom : subdivision indiquée (exigée si le pays la connaît), ville avant quartier, nom principal avant variante, population |
| `GeoCityLearned` | les noms ambigus appris des offres qui ont des coordonnées (« Garden City » sans État → New York) : seulement les exceptions à la règle par nom |
| `catwalks_ville_resolue(pays[], nom, indice)` | la règle unique pour les offres (déclencheur, rattrapage) et les saisies : l'appris sans subdivision indiquée, sinon la règle par nom |
| `catwalks_geo_apprentissage()` | l'apprentissage du jour (lecture seule) |
| `catwalks_geo_rattrapage()` | ce que le déclencheur écrirait une fois l'apprentissage du jour écrit, pour chaque offre dont le point diffère |

## La release, dans l'ordre (sur GO, hors RUN 15:30-18:30 UTC)

Chaque étape est rejouable. Les commandes partent de la racine du dépôt.

1. **Migrations** (trois, additives ; les deux index sont construits `CONCURRENTLY`) :
   ```
   python3 apps/aggregator/scripts/ops/db.py production npx prisma migrate status --schema packages/db/prisma/schema.prisma
   python3 apps/aggregator/scripts/ops/db.py production npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
   ```
   Le déclencheur agit dès cet instant sur les offres écrites ; tant que la base de villes est vide, il n'écrit que
   le point natif. L'API en production (sans ce lot) tolère une base en avance.
2. **La base de villes**, préparée puis chargée à blanc (transaction annulée), puis écrite :
   ```
   python3 apps/aggregator/scripts/geo/villes.py preparer
   python3 apps/aggregator/scripts/ops/db.py production python3 apps/aggregator/scripts/geo/villes.py charger
   python3 apps/aggregator/scripts/ops/db.py production python3 apps/aggregator/scripts/geo/villes.py charger --ecrire
   ```
   Plusieurs minutes (2,9 millions de lignes avec les codes postaux) ; une seule transaction ; un second `--ecrire`
   n'écrit rien (répétition du 01/10/2026). Sur une base en mémoire de 4 Go partagée, la transaction a épuisé la
   mémoire : la base de production, sur disque, n'a pas cette limite, mais le chargement se lance hors RUN.
3. **Le rattrapage du point des offres**, à blanc (lecture seule) puis écrit :
   ```
   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f apps/aggregator/scripts/geo/rattrapage-a-blanc.sql'
   python3 apps/aggregator/scripts/ops/db.py production sh -c 'psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f apps/aggregator/scripts/geo/rattrapage-ecriture.sql'
   ```
   Le passage écrit remplace `GeoCityLearned` par l'apprentissage du jour (transaction courte, cette table seule), puis
   écrit le point des offres EN TRANCHES de 1 000 (`CALL catwalks_geo_rattrapage_ecrire(1000)`) : chaque tranche est
   validée à part et rend ses verrous de ligne ; `lock_timeout` 2 s, le script s'arrête plutôt que d'attendre une ligne
   tenue, et se relance. Il finit par `reste = 0`. Seules les colonnes `geo*` sont écrites : aucun déclencheur ne se
   déclenche. Répétitions sur base jetable :
   - lieux des 93 288 offres de production : 83 431 offres écrites, 67 noms appris, second passage sans écriture, et
     sur 5 000 offres le point écrit est exactement celui du déclencheur ;
   - 90 000 offres agrégées et 60 directes sans point : à blanc 88 s, écriture 104 s (calcul compris) ; une écriture
     concurrente toutes les 0,3 s sur une offre directe et une offre agrégée, 578 écritures, 63 ms au plus
     (`audits/2026-10-01/localisation/resultats/rattrapage-tranches-verrous-2026-10-01.txt`).

   **Verrous.** Le chargement de la base de villes (étape 2, 164 s sur base jetable) n'écrit que les tables `Geo*` :
   aucun verrou sur `Job` ni `DirectOffer`. Le rattrapage ne tient une ligne d'offre que le temps de sa tranche. La
   migration prend un verrou exclusif bref sur `Job` et `DirectOffer` (colonnes nullables sans défaut, déclencheurs,
   `lock_timeout` 5 s) ; les deux index sont construits `CONCURRENTLY`, sans bloquer les écritures.

   **Coût du déclencheur pour le RUN** : 0,27 ms par offre NOUVELLE (90 000 insertions : 44,6 s au lieu de 19,5 s),
   rien pour une offre observée dont le lieu ne change pas (mise à jour d'observation : mêmes temps), 0,23 ms par
   offre déplacée. Avec 300 à 7 500 offres nouvelles par jour (production, 24-30/09/2026), 0,1 à 2 s par RUN ; au
   pire, 90 000 offres toutes nouvelles, 25 s (`resultats/cout-declencheur-2026-10-01.txt`). Le calcul est gardé :
   une erreur laisse le point vide (WARNING `catwalks_geo`), jamais l'écriture de l'offre en échec.

4. **L'API** (promotion `development` → `main`, image `[runtime-images]`) : elle exige les migrations de son contrat
   (`/api/health`). **Elle ne change rien pour catwalks.io** : la proximité, les lieux « Paris (75) », l'ordre par
   distance et l'examen de proximité ne sont servis qu'au client qui envoie `x-catwalks-client: 2`
   (`apps/api/lib/contrat-client.ts`) ; sans lui, la réponse est celle d'avant le lot, à l'identique
   (`apps/api/lib/__tests__/contrat-v1-d496.test.ts`, témoin différentiel écrit par le code d'avant). La préversion du
   site de `development`, qui envoie l'en-tête, la teste alors sur la production.
5. **La bascule de catwalks.io** se fait à la promotion du site (D-490) : le site promu envoie l'en-tête. Le
   backend promu l'envoie sur l'examen des alertes, qui passent alors à la proximité. Aucun ordre n'est imposé entre
   l'API, le site et le backend.

Retour arrière : l'API précédente ignore les tables, colonnes et en-tête neufs ; aucune donnée existante n'est modifiée par
les étapes 1 à 3 en dehors des colonnes `geo*`.

## Après un nouveau chargement de GeoNames

Relancer l'étape 2 puis l'étape 3 : une ville retirée par la source laisse un `geoCityId` orphelin jusqu'au rattrapage.
L'étape 3 se relance aussi de temps en temps pour tenir l'apprentissage des noms ambigus à jour des nouvelles offres :
rien ne la planifie.

## Mesures

Dans `audits/2026-10-01/localisation/` : couverture obtenue par marché, justesse du rattachement, latences avant et
après rejouées en production en lecture seule.
