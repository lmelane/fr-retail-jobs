# Qualification du 2026-09-10 — contrôles A1–A6 en lecture seule, décisions restantes, corrections de données prouvées

Cadrage de Loïc (2026-09-10) : poursuivre la qualification et les contrôles en lecture seule A1–A6 **sans ingestion** ; décider les libellés sur preuves officielles (jamais sur un nom seul) ; Kering Corporate → groupe canonique si les preuves le désignent ; Mango `SINGLE_BRAND` seulement par vérification du tenant ; Menus & Venues / Reclectic : activité et relation officielle ; Aptar : beauté et fournisseurs spécialisés dans la cible, pharma seule hors cible par défaut, transversal/indéterminé conservé sans classification forcée ; terminer les recherches des 152 tenants candidats et des 212 marques de portefeuille ; fournir le tableau compact par source avant les runs bornés ; dire où en sont les « cinq sans page officielle lisible » ; tenir le dénominateur 423 / 413.

Crons toujours gelés (D57), **aucune ingestion lancée**. Toute mutation de production de cette passe a suivi le protocole : sauvegarde fraîche (`before-0910-qualification-production.dump`, 419 507 592 octets, sha256 `4bb11394…b233`, fraîcheur vérifiée : aucune écriture en production depuis 2026-09-09 21:40 UTC), restauration sur le clone d (migrations à jour), répétition, comparaison des plans au témoin du clone, application, rejeu 0. Preuves : `qualification-0910/` (28 fichiers), tableaux : `tracker-v8/`.

## 1. Dénominateur : 423 sources historiques → 413 actives (09/09) → 407 actives (10/09)

Ligne de base = première photographie du LOT 4 (`tracker-snapshot-20260909b`, 423 ACTIVE). Aucune entrée depuis. **Dix sorties** entre la ligne de base et le 09/09 au soir, toutes des retraits de sources mal liées ou vides, jamais des « améliorations » de couverture :

| Sortie | Motif (note datée sur la ligne `Source`) |
|---|---|
| `atlantis` | tenant de logistique, l'« Atlantis » visé reste indéterminé |
| `giga` | HTTP 429 à toute lecture, tenant sans rapport avec le secteur |
| `hades` | société hors mode/luxe/beauté/retail |
| `jako` | portail réduit à une candidature spontanée (la société JAKO est conservée) |
| `kent` | le « Kent » visé reste indéterminé |
| `mateo` | autre employeur que la marque visée |
| `pina` | tenant qui n'est pas la Piña du libellé historique |
| `samson` | cabinet d'études, hors secteur |
| `sport-1` | 0 offre sur le portail officiel ; les autres canaux restent à examiner |
| `urbn-stores` | sous-ensemble du hub URBN (doublon de route) |

**Six sorties de plus aujourd'hui** (§7) : `vitamin-a`, `one`, `joy`, `huber`, `carla-b` (tenants qui ne sont pas l'employeur visé) et `b2` (doublon de route du tableau Browns Shoes). Les compteurs de couverture se lisent donc **sur 423** : collecte complète 383 / 423 (90,5 %), énumération prouvée 388 / 423, identité certifiée 16 / 423. Retirer une source ne fait jamais monter ces ratios : les sorties restent au dénominateur.

## 2. Contrôles A1–A5 : 72 sources re-sondées (lecture seule, sans base)

Sondes du 10/09 (`source-probes-current`, révision `201e18b`) : **62 complètes, 9 partielles, 1 (`wttj-sector`) complète en dernier**. Dimensions de preuve recalculées sur la photographie de production après application (`tracker-v8/proof-dimensions-summary.json`, 407 actives) :

| Dimension | 09/09 soir (413) | 10/09 (407) |
|---|---|---|
| Identité certifiée (configuration courante) | 13 | **16** (+ Mango `SINGLE_BRAND`, Shiseido, Groupe Rocher ; URBN re-certifié) |
| Énumération prouvée | 385 | **388** |
| Collecte complète (écart nul, lignes rejetées comprises) | 377 | **383** |
| Déficit non expliqué | 3 | **0** |
| Déficit expliqué | 10 | 10 (645 offres, dont Oniverse 250, Boots 121, NARS 105, Alberto 74, PVH 66) |
| Détails complets | 243 | 240 |
| Reçu de sonde pour la configuration courante | 344 | **407 / 407** |
| Ingestion en phase avec le reçu | 162 | 160 (les autres se mesurent au prochain run borné) |
| Visibilité publique prouvée | 1 | contrôle en direct requis (C1) |

- **A2 — les trois déficits DigitalRecruiters étaient un défaut de mesure, pas de collecte** : l'éditeur déclare des *diffusions* (une annonce publiée sur plusieurs sites/langues), nous collectons des *annonces*. Reçus du 10/09 : aigle 110 diffusions / 109 annonces, gant 112 / 108, lacoste 462 / 455 — les deux portées lues en entier. `proof-dimensions.py` mesure désormais l'écart sur les annonces quand l'adaptateur prouve les deux portées, et consigne le compte de diffusions comme explication.
- **A3 — Workday après le correctif « Logo »** : a-derma-4 243/243, deckers 408/408, richemont 459/459, richemont-workday 1 357/1 357, complets ; plus aucun libellé contenant « Logo » dans les libellés natifs lus (Pierre Fabre ; UGG, HOKA, Deckers, TEVA ; Richemont, Cartier, Montblanc…). Les 7 libellés « Logo » du rejeu (1 341 offres) sont donc réglés par l'adaptateur.
- **A4 — Oniverse** : 484 offres / 734 pages, 238 pages sans offre, **12 échecs de lecture persistants** (hôte lent) : reste non prouvé tant que ces 12 pages ne sont pas lues.
- **A5 — sitemaps** : bevilles-jewellers 24/24, oska 35/35, psycho-bunny 150/150 (153 le 09/09 : trois offres retirées par l'éditeur), alberto 6 / 80 pages (74 pages sans offre, rejets expliqués) — complets.
- **A1 — 69 reçus manquants pour la configuration courante** : tous obtenus. Restent non prouvées 19 sources (`tracker-v8/per-source-table.md`), dont un défaut d'adaptateur nommé : le pager de `beiersdorf`, `globus`, `luxexperience` répète la dernière page (`BROKEN_PAGER_REPEATS_LAST_PAGE`) ; `levis` et `foot-locker-france` lisent des identifiants répétés entre pages Workday ; `pandora-talenthub` 904/912 avec 8 échecs de détail ; `luxe-talent` (jobboard) sans total éditeur.

## 3. Mango — certification `SINGLE_BRAND` par vérification, pas par accord

- **Périmètre du tenant** (`mango-perimeter.json`, lecture seule) : 50 libellés d'employeur distincts observés sur `mango.wd3`, **tous des entités juridiques Mango** (MANGO MNG S.A., MANGO FRANCE S.A.R.L., MNG-MANGO U.K. LIMITED, MANGO SUISSE SA, MANGO SINGAPORE GARMENTS…), 0 libellé étranger ; les 54 observations retenues (`WORKDAY_EMPLOYER_ABSENT_IN_DETAIL`, 27 annonces vues deux fois) sont des postes de boutique Mango (VENDEDOR/A, STORE MANAGER, SALES ASSISTANTS, en ES/RO/PL/UA/HR/US).
- **Chaîne officielle réciproque, archivée par empreinte** (`mango-evidence/`) : `mangofashiongroup.com/en/talent` (« See job offers ») → `jobs.mango.com/en` (site carrière sur le domaine de la marque) → son application ouvre `https://mango.wd3.myworkdayjobs.com/en/Mango_Work_Your_Passion` (« Visit workday jobs », dans le bundle `main.dbc0519d617a5e20.js`).
- **Écrit** : `SourceIdentityReview` VERIFIED / OFFICIAL_DOMAIN `mango.com` / `portalScope = SINGLE_BRAND` (clone puis production, `certifiedPortalScope('mango') = SINGLE_BRAND`). Effet attendu au run borné B4 : les 27 annonces retenues sont publiées avec la provenance `portal.certifiedScope`.

## 4. Kering Corporate — rattaché au groupe canonique Kering, sur preuve explicite

- L'API officielle du portail (`careers.kering.com/api/apply/v2/jobs/<id>?domain=kering.com`) rend **`business_unit = "Kering Corporate"` pour les 120 offres** (`kering-business-units.json`) ; l'export du site kering.com (`/_next/data/…/talent/job-offers.json`) affiche la **même offre R167939 sous la Maison « Kering »** (image `kering.jpg`), alors que les offres des Maisons se lisent 1:1 (Balenciaga → Balenciaga, Kering Eyewear → Kering Eyewear). « Kering Corporate » désigne donc l'employeur corporate Kering lui-même ; **aucune Maison n'est inventée**.
- **Écrit** (`20260910-LOT4-KERING-CORPORATE-v1`) : fusion de la société « Kering Corporate » (120 offres) dans « Kering » (kind → GROUP), alias source-scopé `kering` / « Kering Corporate » → Kering. Rejeu 0, formes identiques au clone. Après : Kering GROUP 120 offres actives ; l'API publique rend 120 pour « Kering » comme pour l'ancien nom.

## 5. URBN — Reclectic qualifié, Menus & Venues à arbitrer

- **Reclectic** : ses 16 offres sont des postes de vente en magasin (Gurnee IL, Arlington TX, Pineville NC, Lakewood CO, Willow Grove PA) publiés sur le hub URBN (« Reclectic is growing and opening a new location in Lakewood, CO »). Pages officielles URBN archivées : `urbn.com/employees/employee-discount-overview` (« At Reclectic stores, 30% off regular priced apparel ») et `talent.urbn.com/jobs/30295` (« Reclectic Sales Associate in Arlington, Texas | URBN ») ; presse : NBC Philadelphia (« URBN launches a new concept store, Reclectic », neuf, seconde main et surstock des marques du groupe). **`reclectic.com` est un homonyme** (antiquaire britannique) : aucun domaine n'est posé. Activité : retail habillement → dans le périmètre. **Écrit** (revue v3 `…URBN-RECLECTIC-v3`, restatement complet du hub : 1 300 offres) : société BRAND « Reclectic », groupe URBN, 16 offres ; l'alias provisoire Reclectic → URBN est **supplanté** par Reclectic → Reclectic ; hub re-certifié `MULTI_BRAND` et re-promu ACTIVE. Parité publique : `/api/jobs?maison=Reclectic` = 16.
- **Menus and Venues** : les 38 offres sont des postes de restauration (Terrain Cafe / Terrain Events : hôte, serveur, plongeur, cuisinier, barman) ; `urbnmenusandvenues.com` : « the food and beverage division of URBN » ; `urbn.com/our-brands` la présente. Identité officielle établie, société distincte conservée, **secteurs vides** — elle est pourtant visible publiquement (38 offres dans l'API). **Arbitrage de périmètre pour Loïc** : la restauration n'est ni mode, ni luxe, ni beauté, ni retail ; recommandation : retirer ses offres de l'affichage (retrait de la représentation, société conservée) tant que le périmètre ne l'inclut pas.

## 6. Aptar — fiche de périmètre par offre, sans classification forcée

`tracker-v7/aptar-perimeter-sheet.csv` (224 offres actives d'Aptar Group ; chaque ligne porte l'extrait de preuve et l'URL de la page) : le verdict vient de la **division qu'une offre nomme elle-même** (Aptar Beauty / Aptar Pharma / Closures) ou de son titre/service ; un indice de site (divisions nommées par les autres offres du même site) est enregistré séparément, jamais comme verdict.

| Verdict | Offres |
|---|---|
| IN_SCOPE_BEAUTY (division Beauty nommée : Le Neubourg, Charleval, Verneuil, Rueil) | 8 |
| OUT_PHARMA_ONLY (Aptar Pharma nommée ou titre pharma : Congers, Cwmbran, Midland…) | 40 |
| TRANSVERSAL (les deux divisions nommées) | 1 |
| OUT_OTHER_SEGMENT (Closures / Food + Beverage) | 6 |
| UNDETERMINED — preuves conservées, périmètre non tranché | **169** (indice de site : Pharma 40, Closures+Pharma 16, Beauty+Pharma 16, Closures 15, Beauty 1, aucun 81) |

Aucune mutation ; Aptar Beauty reste une identité distincte (0 offre). Décision de périmètre par offre/site : Loïc.

## 7. Les 83 libellés refusés par la porte d'identité : état final

| État | Libellés | Offres | Détail |
|---|---|---|---|
| Alias v1/v2 (09/09) | 27 | 10 914 | Ulta, NIKE ×7, NORMAL ×8, RealReal, UNIQLO, Vlisco… |
| **Alias v3 / v3b (10/09)** | **36** | 1 235 | lots `…LEGAL-ENTITY-ALIASES-v3` (34) et `…v3b-VCA` (2), chaque alias adossé à une page officielle archivée qui imprime le libellé ou l'employeur cible : site du propriétaire, site de la marque cible, ou **portail carrière propre de l'employeur rendu au navigateur** (Workday/SuccessFactors n'impriment rien en HTML brut) ; + fusions MECCA Brands → MECCA et Coach Shanghai → Coach (sociétés nées d'un libellé d'entité) ; + renommage Eurofragrance → **Eurofragance** (orthographe réelle) |
| « Logo » (adaptateur Workday) | 7 | 1 341 | réglé, vérifié par les reçus A3 |
| Source retirée (tenant erroné / doublon) | 5 | 102 | `vitamin-a` = Vitamin Well Group (boissons), `one` = one.com (hébergeur), `joy` = Privateaser (événementiel), `huber` = J.M. Huber Corporation (matériaux), `carla-b` = société suédoise Carla ; + `b2` = doublon de route de Browns Shoes (72/73 identifiants identiques à `browns-shoes`, `brownsshoes.teamtailor.com` redirige vers `careers.brownsshoes.com`) |
| Revue propriétaire (portail de groupe sous clé de marque) | 3 | 289 | `careers.shiseido.com` (clé `drunk-elephant-2`, 166 offres du groupe créditées à Drunk Elephant) → propriétaire **Shiseido** (GROUP) ; `careers.groupe-rocher.com` (clé `dr-pierre-ricaud`, 45 offres) → **Groupe Rocher** (GROUP) ; sources re-certifiées `MULTI_BRAND` et re-promues. Sans preuve native par offre, l'attribution par marque (suffixes de titre YVES ROCHER / Petit Bateau / SABON) n'est pas faite |
| **Arbitrage de périmètre (Loïc)** | 4 | 65 | `nutrire` = Tricoci Salon \| Spa (chaîne de salons/spas, marque Nutrire) ; `printful` (impression textile à la demande, maison mère FYUL) ; `cal-k-holding` (holding : finance/énergie/textile) ; `maryruth-s` (compléments alimentaires) |
| En attente | 1 | 13 | `saks` : entité Neiman Marcus Group Technology Services (Inde) sur le tenant Saks Global — aucune société Neiman Marcus au catalogue |

**Les « cinq sans page officielle lisible »** (New Balance Europe B.V., Swarovski UK / Deutschland / Malaysia, Versace Deutschland GmbH) **sont appliqués dans le lot v3** : preuve = le portail Workday propre à la marque rendu au navigateur, qui imprime le nom de la marque (newbalance.wd1/Careers-UK, swarovski.wd3/swarovski, capri.wd1/Versace) — pas le site officiel, qui refuse toute lecture automatisée (403). Les deux autres entités Swarovski (GBS Pologne, GBS Asia) suivent la même règle.

## 8. 212 marques de portefeuille et 152 tenants candidats

- **212** = marques des pages « portefeuille » officielles de onze groupes sans site officiel connu (`portfolio-report.json`, statut `OFFICIAL_SITE_TO_FIND`). Lecture des pages de marque des groupes (`portfolio-official-sites.json`) : **102 sites officiels liés par le groupe** (L'Oréal 45, LVMH 20, Richemont 12, Swatch 11, ELC 7…), 15 à plusieurs candidats, **91 sans lien sortant** (Shiseido 31, Coty 30, LVMH 28 : pages de liste sans lien par marque), 4 échecs (pradagroup.com, HTTP/2). Recherche des portails carrière sur les 117 sites trouvés (`research-portals`, `tracker-v7/portfolio-brands-research.json`) : 26 candidats ATS (dont **15 déjà couverts** par un portail de groupe actif : Richemont, Swatch, L'Oréal, ELC, Kering), 9 liens carrière à qualifier, 24 sites à rechercher, 55 sans lien carrière. Nouveaux candidats hors couverture : NIOD / The Ordinary (Deciem), Harry Winston, Nivarox, CHH Microtechnique, Redken, musées Swatch/Omega/Longines.
- **152 tenants lisibles** : les 32 à lien réciproque sont classés (`tracker-v8/reciprocal-candidates-32.json`) — **19 plausibles** (Knitwell Group ×3, Skechers, J.Crew, On Running, Arc'teryx, Charlotte Tilbury, Columbia, s.Oliver, MF Brands, Balenciaga créatif…, 6 976 offres), **7 hors secteur malgré le lien** (AIG, Perkins Coie, NBN, Third Bridge, Ryan ×2, Prudential : homonymes de slug), 6 à lire (deux tenants Oracle HCM non nommés, hub iCIMS « lw », trois Pinpoint vides). Aucun n'est activé : revue périmètre/groupe par le propriétaire. Les 120 autres restent « pages lues sans lien vers le portail » : leur identité ne peut pas être certifiée automatiquement.

## 9. Tableau compact par source (avant les runs bornés)

`tracker-v8/per-source-table.md` / `.csv` — une ligne par source active (407) : identité & périmètre certifiés · configuration vérifiée (reçu courant) · collecte complète ou écart · détails / ingestion · correction attendue · contrôle de production prévu. Répartition des contrôles : **B6** passe complète contrôlée 356 · **B1** création débloquée après alias/revues 33 · B5 lignes rejetées 2 · B2 Kering 1 · B3 URBN 1 · B4 Mango 1 · A4 relecture Oniverse 1 · correctif d'adaptateur avant run 5 (pagers) · relecture 1 · décision de Loïc 6.

## 10. Production : preuve après

`after-facts-0910.json` (lecture seule, 07:03 UTC) : 78 351 offres / **74 853 actives** (75 010 − 157 : les représentations des six sources retirées, sans clôture d'employeur) ; sources 407 ACTIVE / 8 PAUSED / 88 RETIRED ; alias 137 (98 + 36 + 2 + 1), lots du jour : v3 34, v3b 2, Kering 1, Reclectic 1 ; périmètres certifiés : mango SINGLE_BRAND, urbn-hub / drunk-elephant-2 / dr-pierre-ricaud MULTI_BRAND. Parité API publique (cache contourné) : Kering 120, Reclectic 16, Shiseido 169, Drunk Elephant 0, Groupe Rocher 64, Dr Pierre Ricaud 0, MECCA 175, Coach 260, Browns Shoes 72, B2 0, Eurofragance 40, Van Cleef & Arpels 276. Identifiants, URL, `firstSeenAt`, RAW conservés (contrôles de conservation de chaque plan). Aucune ingestion.

## 11. Ce qui reste, dans l'ordre

1. **Décisions de Loïc** : Menus & Venues (restauration) ; Aptar par offre/site ; Tricoci, Printful, Çalık, MaryRuth's ; Saks Global / Neiman Marcus ; les 19 candidats plausibles à lien réciproque (périmètre/groupe) ; L'Occitane groupe vs marque (deux sociétés `L’Occitane` et `L’Occitane en Provence`, même domaine).
2. **Correctifs avant run** : pager qui répète la dernière page (beiersdorf, globus, luxexperience) ; identifiants répétés Workday (levis, foot-locker-france) ; attribution par marque sur les portails Shiseido et Groupe Rocher (preuve native à archiver au run borné).
3. **Runs bornés** B1 (33 sources), B2 kering, B3 urbn-hub, B4 mango, B5 nordstrom / oniverse / alberto, puis **B6** passe complète, puis contrôles publics C1–C3 — chacun sur feu vert.
