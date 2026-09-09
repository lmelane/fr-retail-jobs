# Complétude des flux — liste unique et réconciliation des chiffres (2026-09-09, soir)

## L'écart « 385 → 357 » expliqué, puis corrigé

Le tracker v3 annonçait 357 sources complètes « au dernier reçu » contre 385 dans la baseline, et listait 26 « régressions ». **Les deux chiffres étaient exacts mais ne mesuraient pas la même chose, et les 26 régressions n'existaient pas.**

| Mouvement | Sources | Explication |
|---|---:|---|
| Baseline du handoff | 385 / 423 | complète = **au moins un** reçu `FETCH_COMPLETE`, mesuré quand `ganni` et `lindex` étaient encore ACTIVE |
| Sources retirées depuis, ayant eu un reçu complet | −2 (`ganni`, `lindex`) | remplacées par `ganni-talentrecruiter` et `lindex-easycruit`, prouvées complètes par **run de production**, sans reçu de sonde (387 reçus complets au total, dont 4 sur des sources désormais inactives : + `saltrock`, `towa`) |
| « Régressions » | −26 → **0** | artefact de mesure : le v3 prenait le reçu le plus récent **à l'horloge**. Le 9 septembre, la passe de base tournait en série sur une révision **plus ancienne** du code (`b8c153f`, 12:01→12:53) pendant que des re-sondes ciblées tournaient en parallèle sur des révisions plus récentes (`d12380b`, `538ff33`, `bae127d`, `a12b757`…). Pour 26 sources, le reçu « le plus récent » était donc celui du code le plus ancien, qui ne savait pas encore prouver l'énumération (`declaredTotal` absent, `complete=false`). Exemple mesuré : Pepco, reçu 12:26 (code `bae127d`) **complet** 54/54, reçu 12:29 (code `b8c153f`) « non prouvé » 54/54 ; Valentino, 56/56 complet à 12:42 (`a12b757`) puis 26/26 à 12:52 (`b8c153f`, budget de pages de l'ancien code). |

Correction dans `qualify-tracker.py` : le reçu retenu est celui de la **révision de code la plus récente** (`git show -s --format=%ct`), puis le plus récent en temps. Après correction : **383 actives complètes au dernier reçu = 383 actives ayant jamais eu un reçu complet**, 0 régression ; avec les 2 sources prouvées par run, **385 / 423 complètes, 38 partielles** — le dénominateur convenu est retrouvé sans addition hasardeuse.

## Recouvrement avec les 38 dossiers précédents

Les 38 dossiers du handoff (§ 6) rapprochés par clé ou par Maison donnent **40 sources actives** (« Capri / Michael Kors » et « Lagardère » couvrent chacune deux clés) :

- **38 toujours partielles** : `aeropostale`, `aigle`, `alberto`, `attaquer`, `beiersdorf`, `bevilles-jewellers`, `boots`, `brown-thomas-taleo`, `capri-michael-kors`, `element-6`, `end-clothing`, `eram-3`, `foot-locker-france`, `gant`, `globus`, `kastner-ohler`, `kering`, `lacoste`, `lagardere-travel-retail`, `lumentee`, `luxe-talent`, `luxexperience`, `mango`, `marc-o-polo`, `nars`, `nocibe-eqwa`, `nordstrom`, `oniverse`, `oska`, `pandora-talenthub`, `psycho-bunny`, `pvh`, `rituals`, `swatch-group`, `the-kooples`, `urbn-hub`, `urbn-stores`, `zegna-altamira` ;
- **2 résolues depuis la baseline** : `capri-jimmy-choo`, `lagardere-duty-free` ;
- **0 nouvelle partielle** hors de cette liste ; **2 sans reçu de sonde** mais complètes par run de production : `ganni-talentrecruiter`, `lindex-easycruit`.

**La liste unique et actuelle à instruire compte donc 38 sources — exactement les 38 dossiers précédents**, avec pour chacune son dernier reçu (statut, date, `fetched` / ids uniques / total déclaré, écarts base ↔ source, révision de code, nombre de reçus) et son dernier run : `tracker-v3/completeness-to-investigate.csv` (40 lignes : 38 + les 2 sans reçu, étiquetées `NO_RECEIPT`). Les configurations restent dans le JSON privé (`backups/lot4-20260909/completeness-reconciliation.json`).

## Règle gravée

Un reçu de sonde n'est comparable à un autre qu'à révision de code égale ou plus récente. Le tracker ordonne désormais par révision puis par date ; l'ancien classement à l'horloge est la cause d'une fausse alerte de 26 sources, corrigée le jour même.
