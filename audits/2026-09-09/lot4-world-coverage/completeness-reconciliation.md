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

## Premier dossier instruit : DigitalRecruiters (Lacoste, Aigle, Gant, The Kooples)

Les 38 dossiers partagent un trait : leur dernier reçu vient de la révision de code la plus ancienne (`b8c153f`) et ne porte **aucune preuve d'énumération** (`method` absent). Un re-sondage complet des 38 avec le code actuel a été lancé ; en parallèle, le premier dossier a été instruit sur son modèle natif.

**Lacoste** : l'API publique liste des **diffusions**, pas des annonces — `count = 460`, `id = <job_ad_id>-<diffusion>`, 453 `job_ad_id` distincts. Les 7 lignes en plus sont la même annonce diffusée pour plusieurs lieux (« Japan » / « Tokyo » / « Shinjuku City » ; Aventura deux fois). Ce n'est **ni un bug de compteur ni 7 offres perdues** : l'adaptateur gardait la première diffusion par annonce et jetait les autres en silence, sans rien prouver. Correction universelle (PR 58) : une offre par annonce (identité inchangée), toutes les diffusions et leurs lieux conservés dans le RAW, la localisation la plus précise affichée, et une preuve d'énumération à **deux compteurs séparés** — diffusions (le compteur éditeur) et annonces (les offres).

| Tenant | Annonces | Diffusions (compteur éditeur) | Complet | Annonces multi-lieux |
|---|---:|---:|---|---|
| Lacoste | 452 | 459 | oui | 4 (Japon ×3, Aventura) |
| Aigle | 109 | 110 | oui | 1 (Paris / Île-de-France) |
| Gant | 108 | 112 | oui | 4 (Holzwickede / Düsseldorf ; Uppsala) |
| The Kooples | 69 | 69 | oui | 0 |

Mesuré en direct le 2026-09-09 (`digitalrecruiters-live-check.json`). Reste pour clore ces 4 dossiers : reçu à la nouvelle révision, run de production borné qui ré-atteste les offres avec leurs diffusions en RAW, puis mise à jour du tracker.

**Production DigitalRecruiters (18:00 UTC, PR 58 mergée `2031fe3`, workers redéployés, web inchangé — diff vide)** : run Railway borné `562185a0-aedf-4006-aae1-e77aa979e29b` sur `lacoste,aigle,gant,the-kooples` : Lacoste 452 / 459 diffusions, 3 créées, 449 mises à jour ; Aigle 109 / 110, 2 créées ; Gant 108 / 112 ; The Kooples 69 / 69 ; **0 erreur, 4 énumérations complètes**, 26 lignes Railway, 25 événements durables, 0 perte (`dr-production-delivery-proof.json`). Après run (`dr-production-after.json`) : toutes les offres ré-attestées portent leurs diffusions en RAW (452 / 109 / 108 / 69), 9 annonces multi-lieux tracées ; parité API : Aigle 109 = 109, GANT 108 = 108 ; Lacoste 464 actives (12 non re-listées ce run, à la charge du refresh) et The Kooples 71 (2 idem). **Quatre dossiers sur 38 clos au niveau adaptateur et vérifiés en production ; 34 restent.**

## Deuxième et troisième dossiers : Talentsoft (Lagardère) et iCIMS (URBN, Aéropostale)

**Re-sondage des 38 avec le code actuel** (`source-probes-dossiers38`, 2026-09-09 17:5x–18:1x UTC) : 8 complets (Capri/Michael Kors 511/511, Gant, Kering 1 029/1 030 → complet au sens de l'adaptateur, Lacoste, Mango, The Kooples, URBN hub et stores), 30 non prouvés. Trait commun des 30 : **aucune preuve d'énumération publiée par l'adaptateur** (`method` absent) — 16 `generic-listing`, 2 `magnet`, `taleo`, `wordpress`, `radancy`, `eqwa`, `rituals` (1 122 / 1 250 déclarés), `swatchgroup` (248 / 249), `altamira`, `phenom` (Foot Locker 2 836 / 2 847), `workday` Nordstrom (1 307 / 1 309), `talentsoft` Lagardère (129 / 109).

**Talentsoft — cause racine mesurée (PR 59)** : le flux RSS de Lagardère lie `lagardere.com/nous-rejoindre/postuler/offre-2026-10266-502` (hors du board, redirigé vers l'accueil du groupe) sans `idOffre` ; l'identifiant retombait sur le lien entier et ne rencontrait jamais la carte `_10266.aspx` : **20 « offres » de plus aux URLs mortes, 129 pour 109 annoncées**. Correction universelle : identifiant lu dans `idOffre`, puis `_<id>.aspx`, puis la référence `<année>-<id>` ; URL du board conservée à la fusion ; item RSS hors board absent du listing retenu comme ligne rejetée, jamais publié ; preuve d'énumération sur le total annoncé (11 pages, page 12 = page 1). Reçu à la révision corrigée : **109 / 109, 0 rejet, complet** ; Lagardère Duty Free 9 / 9 complet. En production avant le run corrigé : 20 représentations fantômes actives (`externalId` non numérique, URL hors board) — backlog L5.

**iCIMS — preuve par nombre de pages (PR 59)** : le portail n'annonce pas un total d'offres mais « Page 1 of 28 » ; l'adaptateur le lit et le compare aux pages parcourues. Reçus : URBN hub **1 375 offres, 28 / 28 pages**, URBN stores **943, 19 / 19**, Aéropostale (1 page) — complets.

## Après re-sondage complet : 394 / 423 prouvées, 27 dossiers restants, par famille

Réconciliation recalculée avec les reçus des trois passes du soir (`source-probes-dossiers38`, `source-probes-dr`, `source-probes-current`, révisions datées par `git`) : **394 actives complètes au dernier reçu, 27 non prouvées, 13 des 38 dossiers résolus** (Aéropostale, Aigle, Capri ×2, Gant, Kering, Lacoste, Lagardère ×2, Mango, The Kooples, URBN hub et stores), 0 régression.

| Famille | Sources | Ce que le dernier reçu dit | Correction commune |
|---|---|---|---|
| `generic-listing` | 16 — 9 en **page de départ** (Alberto, Attaquer, Bevilles, Kastner & Öhler, Lumentee, Marc O'Polo, Oniverse, Oska, Psycho Bunny), 3 en **sitemap** (Boots 1 489, PVH 1 374, END 21), 4 en **liste paginée** (Pandora 903, Beiersdorf 108, LuxExperience 54, Globus 22) | aucune preuve publiée par le connecteur, quel que soit le chemin | livrée ce soir : terminaison nommée et détails comptés pour la liste paginée ; shards / URLs listées / pages sans JobPosting pour le sitemap ; la page de départ dit qu'elle ne peut rien prouver (→ ces 9 acteurs ont besoin d'un vrai listing ou sitemap : dossier par dossier) |
| `rituals` | 1 (1 122 / 1 250) | même poste servi dans plusieurs locales : le total déclaré compte des représentations | livrée : preuve locale par locale, union = offres |
| `phenom` | 1 (Foot Locker 2 836 / 2 847) | arrêt sur une page courte avant le total | livrée : lecture jusqu'au total, preuve d'énumération |
| `workday` | 1 (Nordstrom 1 307 / 1 309) | 2 offres de moins que le total déclaré | à instruire (Capri et Mango sont complets avec le même adaptateur : cas propre à Nordstrom) |
| `swatchgroup` | 1 (248 / 249) | 1 de moins | à instruire |
| `magnet` | 2 (Element 6 391, Eram 83) | pas de compteur | à instruire |
| `taleo`, `wordpress`, `radancy`, `eqwa`, `altamira` | 5 (Brown Thomas 70, Luxe Talent 478, NARS 53, Nocibé 285, Zegna 61) | pas de compteur | à instruire, une famille à la fois |

Les corrections « livrées » ne sont déclarées résolues qu'après un reçu complet **par source** à la révision qui les porte ; l'orchestrateur re-sonde chaque famille dès que l'adaptateur change.

## Après le merge de la PR 60 — re-sondages par famille (2026-09-09, 18:35 → 18:56 UTC)

Orchestrateur relancé automatiquement après le merge (`orchestration-plan-probes.json`, révision `d825f58`) : 35 sources re-sondées en quatre familles parallèles (Talentsoft/iCIMS 1 016 s, magnet/taleo/divers 116 s, Workday/Phenom/Eightfold 1 207 s, générique 686 s ; 11 requêtes évitées, 0 échec technique). Réconciliation (`completeness-reconciliation.py`, reçus classés par révision de code puis par heure) :

| | Avant (tracker v4) | Après |
|---|---|---|
| Sources actives | 423 | 423 |
| Dernier reçu complet | 394 | **395** |
| Dossiers restants | 27 | **26** |
| Résolus depuis la ligne de base | 13 | **14** (+ `rituals` : 1 122 offres = union des locales, 1 250 représentations déclarées) |
| Régressions | 0 | 0 |
| Sans reçu | 2 (`ganni-talentrecruiter`, `lindex-easycruit` : reçus produits par leurs runs de qualification dédiés) | 2 |

Restants par cause mesurée (à la révision `d825f58`) :
- **Compteur éditeur supérieur au board épuisé** : `foot-locker-france` 2 839 lues / 2 850 déclarées, terminaison `EMPTY_PAGE` (le board rend une page vide avant le total annoncé — le correctif Phenom couvre la page *courte*, pas un total surévalué) ; `pvh` 1 374 / 1 440, toutes les pages listées lues. Critère de résolution : une seconde énumération indépendante (sitemap, total relu à la fin) qui confirme le nombre réellement servi, sinon le dossier reste « non prouvé », jamais « complet ».
- **Workday à −1** : `nordstrom` 1 303 / 1 304, `swatch-group` 248 / 249 (déficit constant, chiffres qui bougent entre deux sondes : une offre comptée mais non servie). Même critère.
- Les 22 autres dossiers (générique 15 dont 9 pages de départ sans listing ni sitemap, magnet ×2, taleo, wordpress, radancy, eqwa, altamira) restent dans le backlog avec leurs témoins (`tracker-v5/`).

### Incident du run borné Talentsoft/iCIMS

Le run de validation (`99ae410d`, 5 sources) a été **interrompu à 18:35:11 UTC par l'auto-déploiement de la PR 60** sur le même service (détail, cause racine, corrections de code et de conduite dans `urbn-shared-hub.md` §1). État prouvé avant l'arrêt : `lagardere-travel-retail` 109/109 complet (identifiants RSS corrigés), `lagardere-duty-free` 9/9, `aeropostale` 20, `urbn-stores` 943 complet (DEGRADED : 23 nouvelles annonces refusées par la porte d'identité), `urbn-hub` énumération complète (1 375) mais écriture interrompue (563/1 449). Le run `urbn-hub` sera rejoué après la livraison URBN, avec la garde de non-déploiement.
