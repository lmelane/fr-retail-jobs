# w1 — WTTJ, tout le secteur sans crawler une page

Demande de Loïc (2026-09-06) : « WTTJ, fixer définitivement et de façon pérenne ». La route sitemap (144 351 entrées → 2 552 en périmètre) est morte derrière le WAF Amazon et a été retirée ; l'adaptateur par société (`wttj.ts`, kind `wttj`, une Maison par slug) fonctionne. Ce lot livre le chemin **par secteur** : l'index Algolia public de WTTJ porte les secteurs de chaque organisation, donc tout le périmètre se lit par facette, sans page HTML, en moins de 3 minutes.

Tout chiffre ci-dessous vient d'une exécution du 2026-09-06 (15 h–17 h UTC), lecture seule ; la prod n'a été que lue (`railway ssh --service catwalks-web`, le conteneur aggregator dort).

## 1. Cartographie de l'index (`CSEKHVMS53` / `wttj_jobs_production_fr`, mêmes clés que `wttj.ts`)

`facets:["*"], hitsPerPage:0` → **88 781 offres**, **33 attributs de facette**, `exhaustiveFacetsCount:true`. Les attributs utiles :

| attribut | valeurs | remarque |
|---|---|---|
| `sectors.parent_reference` | 20 | secteur parent de l'**organisation** (tableau : Hermès porte 3 secteurs) |
| `sectors.reference` | 112 | sous-secteur ; chaque sous-secteur n'a qu'un parent |
| `organization.slug` / `organization.name` | 4 325 organisations dans l'index | c'est la clé de lecture (voir §2) |
| `offices.country_code` | 249 | FR 58 789 · US 17 995 · GB 4 759 · CA 1 882 · DE 1 080 · ES 927 · IT 245 |
| `language` | 12 | fr 57 308 · en 30 822 · de 224 · es 208 · it 139 |
| `contract_type`, `remote`, `salary_*`, `experience_level_minimum`, `education_level`, `new_profession.*` | — | portés par le hit, déjà lus par `toNormalized` |

Il n'existe **ni** `industry`, **ni** `organization.sector` : le secteur est `sectors[]` sur chaque hit, posé par WTTJ à l'organisation, jamais déduit du titre.

**Notre secteur dans le vocabulaire WTTJ** (monde | France) :

| facette | monde | FR | ce que c'est |
|---|---|---|---|
| parent `fashion-luxury-beauty-lifestyle` (« Mode / Luxe / Beauté / Art de vivre ») | **2 357** | 2 026 | 156 organisations, la plus grosse : Hermès 609 |
| ↳ `luxury-1` (Luxe) | 1 046 | 828 | 41 org. |
| ↳ `fashion-1` (Mode) | 890 | 774 | 72 org. |
| ↳ `cosmetics` (Cosmétiques) | 359 | 346 | 43 org. |
| ↳ `lifestyle` (Art de vivre) | 321 | 307 | 24 org. — hôtels, traiteurs, CE, matelas |
| ↳ `jewelry-1` (Bijouterie) | 152 | 149 | 7 org. (Histoire d'Or = `thom-europe`, Pandora) |
| ↳ `mode` (doublon historique) | 6 | 6 | 1 org. (Little Cigogne) |
| `selective-distribution` (parent Distribution) | 3 010 | 2 741 | 57 org. dont Decathlon 1 182, Hermès 609, Descours & Cabaud, Rexel, Atol, Kingfisher… |
| `e-commerce-1` (parent Distribution) | 12 656 | 12 501 | Mousquetaires 7 561, Carrefour 1 988, Auchan 725… |
| `mass-distribution` | 11 735 | 11 592 | grande distribution : hors périmètre |

Les cinq sous-secteurs `luxury-1 / fashion-1 / cosmetics / jewelry-1 / mode` sont **entièrement** contenus dans le parent (1 046 = 1 046, 890 = 890, 359 = 359, 152 = 152). Il n'existe **aucune** facette horlogerie : les horlogers du référentiel (Rolex, Breitling, Swatch, TAG Heuer, Hublot…) ne sont pas sur WTTJ (sondés par slug : 0 hit). Idem Sephora, Chanel, Dior, LVMH, Kering, Richemont, Cartier, Zara, Etam, Sézane, Sandro, Maje, Courir, Galeries Lafayette, Printemps, Nocibé, Marionnaud, Yves Rocher, Kiko, Primark, Uniqlo, Mango : **absents de l'index**. WTTJ est un board de PME/startups françaises ; les grandes Maisons y sont Hermès, L'Oréal, Kiabi, Calzedonia, Lacoste, Pandora, Histoire d'Or, L'Occitane, Puig, Clarins, ba&sh, Veja.

## 2. Les deux plafonds Algolia, mesurés, et la forme qu'ils imposent

- **1 000 hits par requête** : sur le seul filtre parent (2 357 offres), `page:10, hitsPerPage:100` répond `"you can only fetch the 1000 hits for this query"` (`nbHits:0`) ; `hitsPerPage:1000, page:0` rend 1 000 hits et `nbPages:1`. Paginer le secteur perd donc silencieusement 1 357 offres.
- **1 000 valeurs par facette** (`maxValuesPerFacet`).

Donc on ne pagine pas le secteur : on **liste ses organisations par facette** (156 < 1 000, `exhaustiveFacetsCount:true`), puis on lit **chaque organisation exactement comme `fetchWttjJobs`** — le plus gros tenant (Hermès, 609) tient sous 1 000, et si une organisation dépassait un jour 1 000 offres, `fetchWttjJobs` la découperait de toute façon en pages de 100 dans la limite de 1 000 (`truncated` le dirait). Si la facette elle-même atteignait 1 000 organisations, l'adaptateur redécoupe par `offices.country_code` et fait l'union ; si un pays seul dépasse encore, il **échoue explicitement** plutôt que de rendre les 1 000 premières (testé sur fixture).

Ce choix a une vertu de plus : **externalId, URL et `company` sont les mêmes que ceux de `wttj.ts`** (`hit.reference` = UUID ; `…/fr/companies/{slug}/jobs/{slug}` ; `organization.name`), puisque c'est la même fonction qui les produit. À l'écriture : même Maison (`resolveCompany`), même AtsType `WTTJ`, même externalId → la clé unique `Job(companyId, source, externalId)` et la recherche de cluster (même titre, même ville) rattachent l'offre au Job existant et y ajoutent une `JobSource(wttj-sector, id)` — jamais un doublon (chemin lu dans `dedup/upsert.ts`). Si le kind était mappé sur un NOUVEAU AtsType, la clé Job ne collisionnerait plus mais le cluster rattraperait encore ; le plus simple et le plus sûr est `KIND_TO_ATS['wttj-sector'] = 'WTTJ'` — aucune migration.

## 3. Livré

- **`src/ats/adapters/wttjSector.ts`** — `fetchWttjSectorJobs(config): Promise<AdapterResult>` et `listOrganizations(filters)`.
  Config : `sectors` (valeurs de `sectors.reference`, défaut `['luxury-1','fashion-1','cosmetics','jewelry-1','mode']`), `parentSectors` (valeurs de `sectors.parent_reference`, défaut aucune), `organizations` (slugs ajoutés d'office), `excludeOrganizations`, `withDescriptions`, `detailConcurrency` (≤ 4, comme `wttj.ts`), `organizationConcurrency` (défaut 2 ; la porte par hôte D25 garde la politesse réelle). Une organisation entre si elle porte **au moins un** des secteurs demandés ; **aucun filtre par titre**. Un filtre qui ne rend aucune organisation lève une erreur (facette renommée ≠ secteur vide) ; un refus de clé lève l'erreur nommée de `wttj.ts` ; `declaredTotal` = somme des `nbHits` par organisation, `truncated` si une organisation rend moins.
- **`src/ats/adapters/wttj.ts`** — seule modification d'un fichier existant : la requête Algolia + le rafraîchissement de clé sont extraits en `export async function wttjSearch<T>(body)`, utilisée par les deux adaptateurs (une clé qui tourne se rafraîchit à UN endroit). Comportement inchangé, `wttj.test.ts` 5/5.
- **`src/ats/adapters/wttjSector.test.ts`** — 8 tests sur fixture capturée (`__fixtures__/w1-wttj-sector.json` : réponse facette réelle du 2026-09-06 ramenée à 3 organisations, hit Hermès tel que l'index le rend) : forme exacte des requêtes (OR cité sur les cinq sous-secteurs, `organization.slug:"…"` par organisation), externalId/URL/company identiques à `wttj.ts`, exclusions et ajouts, `declaredTotal`/`truncated`, secteur vide refusé, rotation de clé propagée, découpage par pays au plafond, échec explicite si un pays dépasse.
- **`src/discovery/w1-wttj-sector.mts`** — la mesure (`npx tsx src/discovery/w1-wttj-sector.mts [core|flbl] [--no-desc]`), écrit `data/w1-wttj-sector-{core,flbl}.json`.
- `npx tsc --noEmit -p .` : propre. `vitest` sur les deux fichiers : 13/13.

Non touché : dispatch (`ats/index.ts`), `KIND_TO_ATS`, `SourceKind`, schéma Prisma, catalogue.

## 4. Mesure réelle

**Défaut (`sectors` = les cinq du cœur), avec descriptions par l'API — 168 s** :

| | offres | lieu | desc > 200 | date | France |
|---|---|---|---|---|---|
| **TOTAL** | **2 091** | 2 091 | 2 090 | 2 091 | 1 761 |
| luxury-1 | 1 046 | 1 046 | 1 045 | 1 046 | 826 |
| fashion-1 | 890 | 890 | 890 | 890 | 774 |
| cosmetics | 359 | 359 | 359 | 359 | 346 |
| jewelry-1 | 152 | 152 | 151 | 152 | 149 |
| mode | 6 | 6 | 6 | 6 | 6 |

138 organisations lues, `declaredTotal` 2 091, `truncated:false` ; contrôle indépendant sur l'index avec le même filtre : `nbHits` **2 091**, 138 organisations — lecture exhaustive. (Une offre compte dans chaque secteur de son organisation, d'où des lignes qui se recouvrent.) Ex : « Chargé(e) administratif et développement du réseau d'affiliés » @ Paris (5àsec). Hermès : 609/609, 413 FR.

**Tout le parent `fashion-luxury-beauty-lifestyle`, sans descriptions — 14 s** : 2 357 offres | 2 357 lieu | 2 313 « desc > 200 » (ce sont les **résumés** de 400–550 caractères de l'index, pas le texte) | 2 357 date | 2 024 FR ; 156 organisations ; `nbHits` 2 357. Les 266 offres de plus que le cœur sont : Club Employés 82, 369° Hôtels & Maisons 57, Beaumarly 43, Foodles 16, Vente-unique 15, JJA 12, Castalie 8, CMP 7, The Sanctuary 7… — « Art de vivre » au sens WTTJ, pas le nôtre. **Le parent n'est pas à cataloguer tel quel** ; le cœur par sous-secteurs l'est.

Coût réseau du run cœur : 1 facette + 138 requêtes Algolia (+1 par tranche de 100) + 2 091 appels `api.welcometothejungle.com` (0,3 s chacun, concurrence 4 par hôte).

## 5. Comparaison avec ce que la prod tient déjà (lecture seule, 2026-09-06 ~15 h UTC)

40 sources `kind='wttj'` en base (39 ACTIVE + `puig` RETIRED) → **1 127 offres actives attestées** (Hermès 643, L'Oréal 73, Sud Express 42, Sessùn 36, Aubade 28, Diptyque 26…), 100 % de description sur les runs de 13:11/14:24.

- **33 de ces 39 sources (1 066 offres) sont couvertes par le balayage cœur** — même slug, mêmes ids : la sweep les ré-atteste, rien n'est perdu et rien n'est doublé.
- **6 ne le sont pas**, parce que WTTJ les classe ailleurs : `charlotte-tilbury` (17, secteur `software-1`), `lectra` (21, `software-1`), `groupe-figaro` (12, `media-1`) — à garder via `organizations:[…]` ou en sources par société ; et **trois qui ne sont pas les Maisons qu'elles prétendent** : `frame` = « Frame », cabinet de conseil en stratégie (3 offres : « Consultant(e) senior en Stratégie et Management »), `corum` = « CORUM L'Épargne », fintech (6 : « Investment Analyst - In Lisbon »), `bedrock` = JV media-tech M6/RTL (2 : « Assistant Facility Manager »). Ce sont des homonymes de slug (cf. mémoire « sondes-slug ~70 % fausses ») : **11 offres hors secteur affichées sous des noms de Maisons** → `retire-source frame corum bedrock` (D27), décision Loïc.
- Le balayage apporte **~1 025 offres que le catalogue n'a pas** (2 091 − 1 066) : Kiabi 250, Calzedonia 113, Histoire d'Or 56, Pandora 53, ba&sh 32, Lacoste 30, Tissus des Ursules 24, L'Occitane 22, Balzac Paris 20, Groupe Rocher 16, Puig 12 (retiré à tort), Devialet 12, Bleu Libellule 11, Ysé 11, Faguo 9, Lush 8, Oh My Cream 8… Certaines (Kiabi, Lacoste, Pandora, L'Occitane, ba&sh) existent déjà par leur ATS propre : la dédup à l'écriture (même Maison + même ville + même titre) fera de WTTJ une seconde `JobSource`, jamais une seconde carte.
- Réciproque vérifiée : les 729 Maisons du référentiel croisées avec les 4 325 organisations de l'index → 45 correspondances de slug, dont 30 dans le cœur, 4 réelles hors cœur (Charlotte Tilbury, Lectra, Avril `avril-fr` 53 offres classée `agri-food`/`environment`, Passage du Désir 14 en `selective-distribution`), 11 homonymes (Bleu, Hays, Eres Group finance, Oris IA, Orchestra tourisme, APM association, Normal Computing, System, charles…).

## 6. Config à cataloguer

**Une seule source** (pas une par secteur : les sous-secteurs se recouvrent — Balzac Paris porte les quatre — et une source par secteur relirait Hermès deux fois) :

```
maison        : Welcome to the Jungle (Mode · Luxe · Beauté)
kind          : wttj-sector          → KIND_TO_ATS: 'WTTJ' (même AtsType, aucune migration)
tier          : SPECIALIST_JOBBOARD  (tierFor : ajouter `wttj-sector` à côté de `wttj`)
careersDomain : welcometothejungle.com
config        : {
  "sectors": ["luxury-1", "fashion-1", "cosmetics", "jewelry-1", "mode"],
  "organizations": ["charlotte-tilbury", "lectra"],
  "excludeOrganizations": [ …voir ci-dessous… ],
  "detailConcurrency": 4,
  "filterSector": false
}
```

`filterSector` reste **faux** : le filtre par titre du pipeline a écarté 100 % des offres de 18 sources WTTJ le 2026-09-06 13:11 ; le périmètre est ici porté par la facette de l'organisation. `sectorForSource` (`normalize/sector.ts`) : ajouter le préfixe `wttj-sector` → `FASHION` pour que les Maisons inconnues du référentiel (Ysé, Odaje, Hindbag, Losanje…) héritent d'un secteur au lieu de `RETAIL` par défaut — un mot, à la discrétion de qui câble.

**Exclusions à trancher (Loïc)** — 43 organisations du cœur, **251 offres**, portent un secteur WTTJ du cœur mais ne sont visiblement pas des Maisons Mode/Luxe/Beauté : palaces et traiteurs classés « Luxe » (Ritz Paris 56, Potel & Chabot 18, Shangri-La 9, Biografy 7, Des Gâteaux et du Pain 6, eluxtravel 6, IHG 2), voyages (Voyage Privé 10), services à domicile (Wecasa 10, 5àsec 6), laboratoires dermo/pharma classés « Cosmétiques » (Laboratoire Cooper 13, Expanscience 8, Coptis 5, Isispharma 4, Clinique des Champs-Élysées 9, Aesthe 2), bien-être (Relax Massage 5, Treatwell 5), vins (Wine Services 1, iDealwine 3, French Bloom 4), audio (Devialet 12), agences/PR (Helmut, Pascale Venot, The Agent), SaaS mode (Fairly Made 5, Faume 4, Luxurynsight 1), Unilever 2. La liste avec leurs sous-secteurs est dans `w1-wttj-sector-core.json` (`byOrg`) et `scratchpad/w1/org2subs.json`. Deux options : les exclure à la config (`excludeOrganizations`), ou les laisser entrer et laisser `classifySector` (qui connaît `HOTEL`, `CLINIQUE`, `PHARMA`) les marquer — mais avec `fromCatalogue:true` tout entre `inScope`. Je recommande l'exclusion explicite à la config : lisible, réversible, et la liste sera courte à maintenir (l'index bouge peu : 4 325 organisations, 156 dans le parent).

**Après validation** : retirer par `retire-source` les 33 sources `wttj` par société que le balayage couvre (elles reliraient les mêmes feeds à chaque run — le cas D34/D36), et garder `charlotte-tilbury` / `lectra` / `madame-figaro` soit en sources, soit dans `organizations`. La contrainte `tenantKey` ne le fera pas seule : la clé de la source sectorielle tombe sur `careersDomain` (`wttj-sector:welcometothejungle.com`), distincte de `wttj:hermes`.

**Volume attendu** : ~2 090 offres monde (1 760 FR) au cœur, −250 après exclusions, soit **~1 850 offres**, dont ~1 000 nouvelles pour le catalogue ; ~3 minutes par run, à 100 % de lieu, date et description.

## 7. Risques et limites

- **Plafond 1 000 hits** : contourné par construction (lecture par organisation ; Hermès 609 est le maximum observé). Un tenant qui dépasserait 1 000 sortirait `truncated:true` → DEGRADED, visible.
- **Plafond 1 000 valeurs de facette** : 156 aujourd'hui ; redécoupage par pays codé et testé ; échec explicite au-delà.
- **Quotas Algolia** : la clé est la clé **cliente publique** du site (référer-restreinte, `Access-Control-Allow-Origin: *`, aucun en-tête de rate-limit rendu : `X-Alg-PT: 1`, `processingTimeMS: 1`). ~140 requêtes par run, contre les milliers qu'un visiteur du site déclenche ; pas de quota observé sur ~500 requêtes de mesure aujourd'hui. **La clé tourne à chaque déploiement WTTJ** : `refreshSearchKey` la relit dans la page Lacoste — si cette page passe un jour derrière le WAF Amazon (comme le sitemap), la source tombe en erreur **nommée** (« WTTJ refused the query… »), jamais en zéro silencieux. C'est le vrai point de fragilité pérenne : à surveiller par le digest Brevo (D24).
- **`api.welcometothejungle.com/robots.txt` : HTTP 404 « Page not found »** (lu à la source) — aucune directive, donc autorisé par défaut ; l'API répond sans clé ni en-tête, `x-cache-status: HIT`, 0,3 s, 32 Ko. `www.welcometothejungle.com/robots.txt` : `Disallow: /*?` et `*/jobs?query=*` — on n'y fait **aucune** requête (la clé se relit sur `/fr/companies/lacoste/jobs`, sans `?`, autorisé). Algolia (`*.algolia.net`) est un hôte tiers sans robots applicable.
- **Le secteur est celui de l'organisation** : une offre comptable chez Hermès entre (voulu, doctrine « company-first ») ; un palace classé « Luxe » entre aussi (d'où les exclusions ci-dessus).
- **Descriptions** : `withDescriptions:false` ne rend que le résumé (400–550 car.) — ne jamais cataloguer sans les descriptions.
- **Ce qui reste impossible** : lire par facette les Maisons que WTTJ classe hors du cœur (`software-1` pour Charlotte Tilbury) autrement que par slug explicite ; et faire apparaître sur WTTJ des Maisons qui n'y sont pas (grands groupes, horlogers) — pour elles, le chemin est leur ATS, pas ce board.
