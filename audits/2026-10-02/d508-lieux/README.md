# « Paris (75) » en lieu libre et « Paris (75) » dans le filtre `ville` : le même périmètre (D-508 §5)

**Lecture seule.** Rejeu du 02/10/2026 (06:20 à 06:34 UTC) sur la base de PRODUCTION, par `db.py readonly`, avec le code
de l'API du catalogue de `development` (`getJobs` de `/api/jobs`, `examinerAlerte` de `/api/alertes/examen`), le
contrat de proximité du site et du backend (`proximite`, `comprendre`). Le serveur Next de l'API n'est PAS démarré :
son `instrumentation.ts` lancerait la boucle d'index de recherche (écritures) et la purge des requêtes tapées
(DELETE). Garde : une connexion (`connection_limit=1`) remise en `TRANSACTION READ ONLY` et vérifiée avant chaque appel
(au premier rejeu, la seule vérification a arrêté le script après un renouvellement de connexion : c'est pourquoi la
remise est faite à chaque appel).

## Résultat (`rejeu-deux-formes.json`)

Pour chaque cas, toutes les pages lues jusqu'au bout (curseur épuisé), lieu libre contre filtre `ville` seul :

| Marché | Recherche | Offres | Mêmes offres | Même ordre | Examen d'alerte (nouvelles, 7 j) |
|---|---|---|---|---|---|
| FR | Paris (75) | 6 143 | oui | oui | 1 016 = 1 016, mêmes 50 premières |
| FR | vendeur · Paris (75) | 987 | oui | oui | 179 = 179 |
| FR | Lyon (69) | 434 | oui | oui | 57 = 57 |
| FR | Annecy (74) | 167 | oui | oui | 22 = 22 |
| FR | Paris 15e (75) | 6 208 | oui | oui | 1 030 = 1 030 |
| FR | conseiller · Bordeaux (33) | 104 | oui | oui | 20 = 20 |
| CH | Genève (GE) | 381 | oui | oui | 62 = 62 |
| GB | London (ENG) | 1 615 | oui | oui | 361 = 361 |
| US | New York (NY) | 2 380 | oui | oui | 401 = 401 |

**Le moteur rend déjà les mêmes offres** : les deux formes passent par la même résolution (`resoudreVilles`, même
point) et des cercles équivalents (`proximite-sql.ts` : le lieu retient `dl <= rayon` ou une offre sans point au nom
de la ville ; le filtre, `dv <= rayon` ou la même offre sans point, `vt`). Aucun changement de l'agrégateur.

Ce qui différait, c'était la reconnaissance côté backend : la recherche « Paris (75) » en lieu libre ne trouvait pas
l'alerte dont « Paris (75) » vient du filtre `ville` (« Alerte active » absente, seconde alerte créée). Corrigé dans
le backend (`criteres.ts`, `villeSeuleCommeLieu` ; `service.ts`, `alerteEquivalente`).

Limites connues : seulement quand le filtre `ville` porte UNE ville et qu'il n'y a pas de lieu libre ; une ville nue que
le catalogue ne confirme pas ne passe pas en lieu (« Luxembourg » en lieu libre est un pays pour le moteur) ; les
marchés qui ne servent pas la facette Ville (SG, HU) refusent le filtre `ville` : la même alerte n'y rendrait pas les
mêmes offres que le lieu libre ; ces marchés n'affichent pas la facette, l'écran n'y crée donc pas de filtre `ville` (non mesuré en base).

## Rejouer

```sh
# depuis la racine du dépôt
TSX_TSCONFIG_PATH=apps/api/tsconfig.json python3 apps/aggregator/scripts/ops/db.py readonly npx tsx audits/2026-10-02/d508-lieux/rejouer-deux-formes.mts
```
