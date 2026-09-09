# Alias d'entités juridiques et sitemaps d'éditeur — débloquer la création d'offres et prouver cinq sources génériques (2026-09-09, 20:15 → 20:30 UTC)

Deux réparations de données, un seul cycle : sauvegarde fraîche (`before-aliases-production.dump`, 414 808 818 octets, sha256 `245ebc8b…c45f`, fraîcheur vérifiée : aucune écriture en prod depuis 19:55 UTC) → répétition sur le clone d → application en production → run borné de preuve. Preuves : `aliases-sitemaps/`.

## 1. Les libellés d'entités juridiques refusés par la porte d'identité

**Preuve avant** (`review-required-scale.json`, prod) : depuis que la porte existe, 6 sources, 17 paires (source, libellé), 201 annonces nouvelles refusées ; les sources ne peuvent plus créer d'offres tant que leurs libellés natifs ne sont pas revus.

**Dérivation, sans nouvelle décision métier** (`legal-entity-aliases-review.json`) :

| Règle | Paires | Annonces | Exemples | Preuve |
|---|---|---|---|---|
| **A — clé canonique = la marque** (`resolveCompany(label)` rend la clé du propriétaire de la source : marque + forme juridique ou pays) | 7 | 161 | « Nordstrom Inc » → Nordstrom · « MANGO FRANCE, S.A.R.L. » / « MANGO ITALIA S.r.l. » / « MANGO SUISSE SA » / « Mango Deutschland GMBH » → Mango · « Michael Kors Retail Inc » → Michael Kors · « URBN Stores » → URBN (source retirée, exclue) | site officiel de la marque archivé |
| **B — ligne du référentiel D45 de Loïc rattachée au domaine officiel de la marque** (décision du 2026-09-07) | 9 | 34 | « MANGO MNG, S.A. » (ligne « MANGO MNG »), « MNG-MANGO U.K. LIMITED », « MANGO SINGAPORE GARMENTS PTE, LTD », « MNG MANGO IRELAND LIMITED », « MANGONOR Comércio de Vestuário S.A » → Mango · « Michael Kors (USA) Inc », « (Canada) Holdings LTD », « (Bucharest Stores) SRL » → Michael Kors · « J Choo Germany GmbH » (ligne « J Choo ») → Jimmy Choo | référentiel D45 (sha256 dans l'énoncé) + site officiel |
| **Revue propriétaire** | 1 | 6 | `kering` : 6 offres dont le flux ne porte plus la Maison (Saint Laurent, Boucheron, Kering Corporate, Kering Eyewear) → la porte refuse « Kering » | backlog K1, aucune écriture |

`michaelkors.com` et `jimmychoo.com` refusent toute lecture automatisée (HTTP 403, curl et Chromium) : la preuve archivée est le **portail carrière Workday de la marque** (`capri.wd1.myworkdayjobs.com/Michael_Kors`, `/JimmyChooCareers`, catalogués `ATS_OFFICIAL`), qui nomme la marque — jamais une page qu'on n'a pas pu lire.

**Correction** : lot `20260909-LOT4-LEGAL-ENTITY-ALIASES-v1` — 15 alias source-scopés (`nordstrom` 1, `mango` 9, `capri-michael-kors` 4, `capri-jimmy-choo` 1), `sourceHash` de la configuration courante, aucune fusion, aucune équivalence groupe/marque, libellé brut conservé dans chaque observation.

**Répétition sur clone** : 15 alias écrits, rejeu 0 ; **ingest borné Capri sur le clone : 9 refus d'écriture avant → 0 après**, les annonces nouvelles sont créées.

**Production** (20:24 UTC) : 15 alias écrits, rejeu `alreadyApplied`, plan `b4d2ab30…`, formes identiques au clone (contrôle par empreinte des paires).

## 2. Cinq sources génériques passent de la page de départ au sitemap de l'éditeur

Recherche lecture seule (robots, index de sitemaps développés, une page testée pour un `JobPosting`) puis qualification locale avec le connecteur réel :

| Source | Avant (crawl de page de départ, non prouvable) | Sitemap | Qualification locale |
|---|---|---|---|
| `oniverse` | 20 offres | `careers.oniverse.it/sitemap.xml` (734 URLs) | 363 offres et 191 échecs de lecture → après décodage des `<loc>` (PR 66) : **483 offres**, 238 pages sans offre, 13 échecs |
| `psycho-bunny` | 10 | `careers.psychobunny.com/jobs-sitemap.xml` | **153 / 153, complet** |
| `oska` | 7 | `www.oska.com/jobs-sitemap1.xml` | **35 / 35, complet** (deux locales) |
| `bevilles-jewellers` | 23 | `careers.bevilles.com.au/sitemap.xml` | 23 / 23, complet |
| `alberto` | 8 | `www.alberto-pants.com/sitemap-0.xml` | 6 offres / 80 pages (sitemap général) |
| `attaquer`, `lumentee`, `kastner-oehler`, `marc-o-polo` | — | aucun sitemap d'offres (page unique, boutique, pages institutionnelles) | restent non prouvables |

**Correction** : lot `20260909-LOT4-GENERIC-SITEMAP-CONFIG-v1` — `config` = `{sitemapUrl, concurrency: 4, previousStartUrl}` (l'ancienne URL est conservée), note datée sur la source, empreinte d'identité avant → après consignée. Ces sources ne figurent pas dans `sources.csv` (aucune ré-écriture au démarrage). Répété sur clone, appliqué en production (20:24 UTC).

## 3. Run borné de preuve (20:26 → 20:36 UTC, commit `3e44e4b`, run `a32c515d`, `COMPLETED_WITH_ERRORS`, 88 événements durables, 0 perte ; commande normale restaurée `dadb08fe`)

| Source | Lu / déclaré | Complet (adaptateur) | Créées | Refus d'identité | Ce qui reste |
|---|---|---|---|---|---|
| `nordstrom` | 1 303 / 1 308 (5 lignes sans `externalPath`, 66 pages) | **oui** | **+108** (les 107 bloquées la veille + 1) | **0** (1 301 observations `REVIEWED_ALIAS`) | — |
| `mango` | 1 627 / 1 628 (1 ligne sans chemin, 82 pages) | **oui** | **+56** (+1 fusion) | **0** (1 254 `REVIEWED_ALIAS`) | 329 observations encore `LEGACY_UNREVIEWED` (libellés déjà connus, non bloquants) |
| `capri-michael-kors` | 512 / 512 | oui | +7 | 0 | — |
| `capri-jimmy-choo` | 51 / 51 | oui | +1 | 0 | — |
| `oniverse` | 482 / 734 pages (238 sans offre, **14 échecs de lecture**) | non | **+398** (+84 fusions) — 20 → 522 actives | 0 | 14 pages en échec (hôte lent) : à relire ; « non prouvé » tant qu'elles ne sont pas lues |
| `psycho-bunny` | 153 / 153 | **oui** | **+153** (10 → 165) | 0 | — |
| `oska` | 35 / 35 | **oui** | +28 (7 → 35) | 0 | — |
| `bevilles-jewellers` | 23 / 23 | **oui** | 0 | 0 | — |
| `alberto` | 6 / 80 pages (74 sans offre) | **oui** | +4 | 0 | — |

Offres actives : 74 255 → **75 010** (+755). Aucune purge (statuts DEGRADED sur les sources à lignes rejetées, voir ci-dessous), aucune fermeture (refresh gelé).

**Défaut trouvé par ce run, corrigé dans la PR suivante** : l'ingest comptait chaque ligne rejetée comme une *erreur* (`stats.errors += rejectedRows.length`) — Alberto « 74 erreurs » pour 74 pages expirées, Nordstrom « 5 erreurs » pour 5 lignes sans chemin — ce qui rendait la source DEGRADED et lui **retirait le droit d'attester l'absence** (`attestation.ts` : `errors > 0`). Désormais seuls les rejets d'échec (`*_FETCH_FAILED`, `*_UNPARSED`, `MALFORMED_*`) sont des erreurs ; les rejets expliqués sont comptés à part (`rejected`, motifs) et lisibles dans la note de santé.

## 4. Tracker v6 (photographie 20:40 UTC, `tracker-v6/`)

78 351 offres / **75 010 actives** / 11 044 France. Sept dimensions inchangées dans leur séparation : identité attestée 21 (20 en v5), portail officiel confirmé 13 (12), flux actifs tous complets 170 acteurs (contre 73 avec au moins un flux partiel ou non prouvé), couverture mondiale `NOT_PROVEN` pour tous (aucun critère de preuve satisfait). Réconciliation : 400 / 423 sources prouvées.

## Contexte : crons de production gelés (20:22 UTC)

Instruction de Loïc pendant ce lot : « on kill le CRON à la production tant que l'application n'est pas production-ready ». Les trois crons (aggregator `0 22 * * *`, refresh `0 2 * * *`, reconcile `0 3 * * 1`) sont gelés sur `0 0 29 2 *` (`crons-frozen-20260909.json`, mutation relue), `PIPELINE_PAUSED=1` conservé ; seuls les runs bornés manuels du protocole continuent (D57).
