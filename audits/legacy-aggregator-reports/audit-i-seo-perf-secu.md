# Audit défensif Catwalks Intelligence — Axe 5 : SEO, performance, sécurité, non-régression

Date : 2026-09-06 (17:45 → 18:05 Paris). Lecture seule sur la base ; aucune correction, aucun commit.
Périmètre : `apps/web/app/intelligence/**`, `apps/web/lib/intelligence/**`, `apps/web/components/intelligence/**`, `sitemap`/`robots`, et les pages existantes pour la non-régression.

## Verdict en une ligne

**Aucun constat CRITIQUE.** SEO, sécurité des entrées et non-régression sont **CONFIRMÉS bons, preuves à l'appui**. Deux points HAUT à trancher/corriger avant déploiement : une **licence CC BY 4.0 publiée dans le JSON-LD sans décision** (le brief ne la mentionne nulle part), et un **coût par URL inconnue non borné** (chaque slug aléatoire déclenche deux agrégats SQL et crée un fichier de cache). Cinq points MOYEN de performance, tous structurels et mesurés en nombre de requêtes SQL (transférables à la prod), dont un préexistant qui domine le coût de chaque page vue.

---

## 0. Environnement et méthode — ce qui a été prouvé, et comment

| Élément | Valeur vérifiée |
|---|---|
| Base | locale `catwalks` (Docker `catwalks-audit-pg`, port 55440) : **1 996 offres actives / 7 Maisons / 1 groupe (Hermes) / 416 sources ACTIVE / 208 lignes `MarketSnapshot` sur UN seul jour (2026-09-06)** |
| État local notable | `jobFunction` est **NULL sur 1 996/1 996** offres : la copie n'a pas été ré-ingérée avec la taxonomie → toutes les pages `/metiers/<key>` sont à 0 offre en local (état de la donnée, pas du code) |
| Code | working tree `main` — **tout `app/intelligence`, `lib/intelligence`, `components/intelligence` est non suivi par git (`??`)** ; l'audit porte sur cet état, pas sur un commit |
| Serveur | **`next build` + `next start` (mode production) sur le port 3113**, PAS `next dev` : les timings `next dev` incluraient la compilation à la demande et ne prouveraient rien |
| Isolation | deux `next dev` d'autres sessions tournaient sur 3111/3112 **dans le même `apps/web/.next`** (Next 15.5.25 n'isole pas `.next/dev`) ; un `next build` sur place aurait cassé leurs serveurs → build et serveur exécutés dans une **copie rsync** du dépôt (`scratchpad/axe5/repo`, `node_modules` symlinkés). Vérifié à la fin : aucun `BUILD_ID` écrit dans le `.next` partagé |
| Comptage SQL | log Postgres `log_statement=all` + `log_line_prefix` avec `%a`, serveur lancé avec `application_name=axe5` → **seules mes requêtes sont comptées** (168 exécutions d'autres serveurs voisins ont été observées dans la même fenêtre : le comptage sans ce filtre aurait été contaminé). Réglages **remis à zéro** (`ALTER SYSTEM RESET`, vérifié en session neuve : `log_statement=none`, `postgresql.auto.conf` vide) |
| Fin | serveur 3113 arrêté, port libre, aucun fichier du projet modifié hormis ce rapport |

Fichiers de preuve (scratchpad, session) : `scratchpad/axe5/{build.log, typecheck.log, vitest.log, vitest-integration.log, timing-round{1,2,3}.txt, sql-per-page2.txt, pglog-round2.txt, seo.json, links.json, sitemaps-0.xml, mobile-390*.png, jsonld-escape.mts}`.

---

## 1. Constats classés

### HAUT

**H1 — CONFIRMÉ — Le JSON-LD `Dataset` de `/intelligence` publie `license: https://creativecommons.org/licenses/by/4.0/` sans qu'aucune décision ne l'ait posé.**
Preuve : `lib/intelligence/seo.ts` l.92 ; rendu réel extrait de `/intelligence` (bloc `Dataset`, champ `license`). `grep -n -i "open data|licen|réutilis|attribution|CC-BY|creative commons" intelligence_business.md` → **aucune occurrence** (« Creative » l.619 désigne le département créatif) ; `grep "licen|CC BY|creativecommons" CLAUDE.md` → aucune (D38 ne parle que d'historisation/taxonomie/FACT-DERIVED-INSIGHT). C'est une **assertion juridique** exposée à Google Dataset Search : « ces données sont réutilisables librement avec attribution ». Elle engage Catwalks. À trancher par Loïc : la graver (D-xx) ou la retirer avant tout déploiement. `isAccessibleForFree: true` et `creator: Catwalks` sont cohérents avec le produit et ne posent pas ce problème.

**H2 — CONFIRMÉ — Toute URL Intelligence à slug inconnu coûte deux agrégats SQL complets et crée un fichier de cache : croissance non bornée.**
Preuve exécutée : 50 slugs aléatoires (`/villes/fr-zzNNN`, `/maisons/zzNNN`, `/groupes/zzNNN`) → **850 exécutions SQL `app=axe5`** dont 80 `$queryRaw` (byCity « toutes villes » ×2 par slug ville, allGroups ×2 par slug groupe) et 20 `Company.findMany` (×2 par slug Maison) — le ×2 vient de `generateMetadata` + `Page` (voir M3). Puis 200 slugs ville aléatoires supplémentaires → `.next/cache/fetch-cache` passe de **70 à 270 entrées (+200, 1,1 Mo, ≈4 Ko/entrée)** : `unstable_cache` mémorise le résultat `null` **par slug** (`resolveCity = cached('resolve-city', slug => …)`, `resolve.ts` l.25-35) pendant 1 h, sans éviction proactive. En prod (76 000 offres), `byCity({}, 100_000)` est un `GROUP BY` complet par requête hostile, exécuté deux fois. Un scanner ordinaire suffit à remplir le disque éphémère Railway et à charger la base. Pistes (pour info, pas exécutées) : valider la forme du slug contre une liste de villes mémorisée UNE fois (clé fixe), ne pas mettre `null` en cache par slug, ou renvoyer 404 avant tout appel base quand le slug ne matche pas la liste.

### MOYEN

**M1 — CONFIRMÉ — 10 requêtes SQL par page vue, sur TOUTES les pages du site, même quand le cache Intelligence est chaud (préexistant, hérité par Intelligence).**
Preuve : segment `WARM /intelligence/methodologie` (3 hits) = **30 exécutions**, toutes du shell : `Job.count`, `Company.count` ×2, `Job.findFirst(firstSeenAt)`, `Job.findMany(distinct country)` — **chacune 6 fois = 2 par requête**. Origine : `landingStats()` appelé dans `app/layout.tsx` l.25 (`generateMetadata`) ET dans `components/site-footer.tsx` l.19, jamais mémorisé. Sur `/intelligence` à chaud, 100 % des SQL viennent de là. Non lié au code Intelligence, mais c'est le plancher de coût de chaque page de l'observatoire (et `Job.findMany(distinct country)` ramène toutes les graphies à chaque requête).

**M2 — CONFIRMÉ — `countrySpellings` (`SELECT DISTINCT country FROM "Job"`) est ré-exécuté par chaque fonction de faits pour un pays non-FR.**
Preuve : `COLD /intelligence/pays/US` = 52 exécutions dont **20 × `SELECT DISTINCT country FROM "Job" WHERE country IS NOT NULL`** ; `/pays/FR` (chemin `isFrance`) = 32. Cause : `facts.ts` `scopeSql()` l.97 appelle `countrySpellings()` à chaque construction de WHERE, et `getProfile` construit 10 WHERE en parallèle (×2 avec M3). Une mémorisation de la liste (clé fixe, 1 h) ramène 20 → 1.

**M3 — CONFIRMÉ — Sur une page de profil à froid, `generateMetadata` et `Page` exécutent chacun l'intégralité des requêtes : tout est fait deux fois.**
Preuve arithmétique sur le log filtré : `/pays/FR` 32 = 10 (shell) + 11 (profil) × 2 ; `/pays/US` 52 = 10 + (11 + 10 spellings) × 2 ; `/maisons/*` 38 = 10 + (13 profil + 1 resolveCompany) × 2 (les trois Maisons donnent exactement 38) ; `/villes/fr-paris` 34 = 10 + (11 + 1 allCities) × 2 ; `/groupes/hermes` 34 ; `/metiers/<key>` 34 = 10 + 12 × 2. Les pages sans `generateMetadata` dépendant des données (`/marche` 25, `/geographies` 14, `/metiers` 15, `/secteurs` 16, `/methodologie` 12) ne doublent rien. `unstable_cache` n'a pas de déduplication en vol : deux appels concurrents à la même clé avant écriture exécutent tous deux la fonction. À chaud (clé écrite), 0 requête Intelligence — le cache fonctionne.

**M4 — CONFIRMÉ — `/sitemaps/0` exécute 6 requêtes à CHAQUE hit et ne porte aucun `Cache-Control`.**
Preuve : segment `WARM /sitemaps/0` (3 hits) = 18 exécutions = 6/hit : `sitemapCompanies` + les 5 agrégats de `sitemapIntelligence()` (`byCountry`, `byCity({},500)`, `byFunction`, `byCompany({},2000)`, `byGroup({},200)`) — **aucun n'est passé par `cached()`**. En-têtes de `/sitemaps/0` : `content-type` seulement ; `CACHE_HEADER` est défini l.17 et **jamais utilisé** dans la réponse (déjà le cas à `HEAD`, l.16 : préexistant), alors que `/sitemap.xml` l'envoie bien. L'ajout Intelligence multiplie par 6 le coût d'un hit non caché. Note : l'index sitemap met `lastmod = now()` à chaque hit (préexistant, BAS).

**M5 — CONFIRMÉ — `/intelligence` et `/intelligence/geographies` pèsent 343 Ko et 363 Ko bruts (121 Ko gzip chacune), deux fois la page la plus lourde du site.**
Preuve (`curl -w size_download`, avec et sans `Accept-Encoding: gzip`) : `/emplois` 179 Ko → 64 Ko gzip, `/entreprise/cartier` 181 → 65, **`/intelligence` 343 → 121, `/geographies` 363 → 121** ; les autres pages Intelligence 60-88 Ko → 12-23 Ko gzip. Cause mesurée sur `/intelligence` : 188 `<path>` de carte = **112 Ko d'attributs `d=`**, et le payload RSC (`self.__next_f.push`) = **186 Ko** — la carte SVG rendue côté serveur est sérialisée une seconde fois pour l'hydratation. Impact LCP/TTFB réel sur mobile ; pistes : sortir les tracés dans un asset statique (`<use>`/sprite) ou éviter la double sérialisation.

### BAS

- **B1** — `/intelligence/secteurs` : title tronqué à 50 caractères avec « … » et **sans marque** (« Secteurs : Mode, Luxe, Beauté, Horlogerie, Retail… ») — le sujet dépasse même la forme courte de `intelTitle()`. Les 13 autres titres tiennent en 47-60 (max exactement 60 : `/maisons/ami-paris`).
- **B2** — 14/14 meta descriptions dépassent 160 caractères (163 → 245 ; `/marche` 245, `/methodologie` 235) : tronquées en SERP, pas fausses.
- **B3** — `jsonLd()` (`seo.ts` l.50) n'échappe que `<` ; `safeJsonLd` de `/offre/[id]` échappe aussi U+2028/U+2029. Inoffensif dans un bloc `application/ld+json` (données, non exécutées), mais deux helpers pour la même fonction.
- **B4** — 87 liens internes Intelligence mènent à des pages `noindex, follow` (pays/villes sous 30 offres, et 25/25 métiers en local à cause de `jobFunction` NULL). Comportement voulu ; à surveiller en prod (dilution du maillage vers des pages non indexées).
- **B5** — `X-Powered-By: Next.js` exposé (`poweredByHeader` non désactivé, préexistant).
- **B6** — Pages `force-dynamic` → `Cache-Control: private, no-cache, no-store` : aucun cache CDN/navigateur ; cohérent avec la décision documentée dans `cache.ts` (pas de `revalidate` de page car la build Railway n'a pas de base), à connaître. Aucune invalidation par tag `intelligence` après un `snapshot` : jusqu'à 1 h de retard d'affichage après la photographie.
- **B7** — `resolveCompany` : `prisma.company.findMany` sans `take` (toutes les Maisons + `_count`), 1 requête, borné par la table (~600 en prod). Seul `findMany` du périmètre ; `allCities` = `byCity({}, 100_000)` (agrégat, pas un scan de lignes).
- **B8** — Doc : la section « Sécurité — points ouverts » de `CLAUDE.md` cite encore un XSS JSON-LD sur `/offre/[id]` ; le code a `safeJsonLd` (l.15-31). Périmée.

---

## 2. SEO — CONFIRMÉ conforme

Pages testées (HTML réel de `next start`, extraction par script) : `/intelligence`, `/marche`, `/geographies`, `/pays/FR`, `/pays/US`, `/villes/fr-paris`, `/metiers`, `/metiers/retail-client-advisor`, `/secteurs`, `/maisons/{cartier,hermes,apm-monaco}`, `/groupes/hermes`, `/methodologie`, plus sous seuil `/pays/CA` (18), `/villes/fr-lyon` (14), `/maisons/ami-paris` (21), plus inexistants `/groupes/lvmh`, `/pays/XX`, `/metiers/nope`, `/villes/zz-nowhere`, `/maisons/nope`.

| Critère | Résultat |
|---|---|
| `generateMetadata` par page | 11/11 routes ; title 47-60 c. (≤ 60 : 14/14), description présente 14/14 |
| Canonical | absolu, correct 14/14 ; `/intelligence/pays/fr` (minuscules) rend 200 avec canonical `…/pays/FR` (doublon d'URL résolu) |
| OpenGraph | `og:title/url/image(absolue via metadataBase)/type/site_name/locale` 14/14 ; `twitter:card summary` + `twitter:image` hérité du layout |
| H1 | exactement 1 par page, 14/14 ; 404 : 1 H1 (page not-found existante) |
| JSON-LD | **parse OK** sur 14/14 : `Dataset` (home) ; `WebPage` + `BreadcrumbList` ailleurs (positions, `name`, `item` absolus, `dateModified` = max `lastSeenAt`, `inLanguage fr`) ; aucun `<` brut. Réserve : H1 (licence) |
| `noindex` sous seuil | `robots: noindex, follow` sur CA/fr-lyon/ami-paris/métiers à 0 ; **absents du sitemap** (CA, fr-lyon, ami-paris non listés) ; les 404 portent `noindex` |
| `robots.txt` | `Allow: /`, `Disallow: /api/`, `Sitemap: <site>/sitemap.xml` (force-dynamic, lit `NEXT_PUBLIC_SITE_URL`) |
| Sitemap | index → `/sitemaps/0` + `/sitemaps/1` ; chunk 0 **bien formé (`xmllint --noout` OK)**, 39 URLs dont **29 Intelligence** (6 statiques, 14 pays, 2 villes, 6 Maisons, 1 groupe) — **29/29 → HTTP 200 et indexables (0 noindex)** ; chunk 1 = 1 996 offres = base ; `/sitemaps/abc` et `/sitemaps/999` → 404 |
| Liens internes croisés | **184 liens distincts** collectés sur les 14 pages, **184 × HTTP 200, 0 × 4xx/5xx** (dont 55 vers `/emplois?…`, 42 villes, 38 pays, 26 métiers, 7 Maisons, 5 ancres secteurs, 3 `/entreprise/<slug>`) |
| Nav / footer | « Intelligence » présent dans la nav (`site-nav.tsx`) et le footer (`site-footer.tsx`) ; sous-nav Intelligence avec `aria-current` |

---

## 3. Performance — mesures

Timings `curl -w %{time_total}` en **production locale** (base 1 996 offres : valeurs non transférables à la prod 76 000 ; **les nombres de requêtes SQL le sont**). 3 mesures à froid (3 redémarrages du serveur, `.next/cache/fetch-cache` vidé à chaque fois) puis 3 à chaud.

| Page | froid ×3 (s) | chaud ×3 (s) | SQL froid | SQL chaud/hit | HTML brut / gzip |
|---|---|---|---|---|---|
| `/intelligence` | 0,104 · 0,093 · 0,124 | 0,016 · 0,015 · 0,016 | 24 | 10 (shell) | 343 Ko / 121 Ko |
| `/intelligence/marche` | 0,018 · 0,020 · 0,025 | 0,009 · 0,009 · 0,009 | 25 | 10 | 63 / 14 |
| `/intelligence/geographies` | 0,018 · 0,022 · 0,031 | 0,013 · 0,014 · 0,011 | 14 | 10 | 363 / 121 |
| `/intelligence/pays/FR` | 0,020 · 0,020 · 0,022 | 0,008 · 0,009 · 0,009 | 32 | 10 | 75 / 17 |
| `/intelligence/pays/US` | 0,027 · 0,022 · 0,022 | 0,008 · 0,008 · 0,008 | **52** | 10 | 72 / 16 |
| `/intelligence/villes/fr-paris` | 0,025 · 0,021 · 0,021 | 0,009 · 0,008 · 0,008 | 34 | 10 | 63 / 15 |
| `/intelligence/metiers` | 0,016 · 0,014 · 0,015 | 0,008 · 0,008 · 0,008 | 15 | 10 | 60 / 12 |
| `/intelligence/metiers/retail-client-advisor` | 0,016 · 0,015 · 0,015 | 0,008 · 0,007 · 0,008 | 34 | 10 | 40 / — |
| `/intelligence/secteurs` | 0,015 · 0,014 · 0,017 | 0,007 · 0,007 · 0,007 | 16 | 10 | 60 / 14 |
| `/intelligence/maisons/cartier` | 0,026 · 0,022 · 0,022 | 0,008 · 0,007 · 0,007 | 38 | 10 | 76 / 17 |
| `/intelligence/maisons/hermes` | 0,018 · 0,019 · 0,020 | 0,007 · 0,008 · 0,007 | 38 | 10 | 75 / — |
| `/intelligence/maisons/apm-monaco` | 0,016 · 0,014 · 0,016 | 0,007 · 0,007 · 0,007 | 38 | 10 | 68 / — |
| `/intelligence/groupes/hermes` | 0,018 · 0,017 · 0,016 | 0,008 · 0,008 · 0,007 | 34 | 10 | 80 / 18 |
| `/intelligence/methodologie` | 0,012 · 0,011 · 0,012 | 0,009 · 0,010 · 0,008 | 12 | 10 | 88 / 23 |
| `/sitemaps/0` | 0,011 | 0,014 · 0,009 · 0,007 | 6 | **6** (jamais mémorisé) | 3 Ko |

Lecture : à chaud, **0 requête Intelligence** (le `cached()`/`unstable_cache` 3600 s fait son travail) ; les 10 restantes sont le shell (M1). À froid, le surcoût vient de M2 (spellings) et M3 (double exécution). `revalidate` : aucun `export const revalidate` (choix documenté `cache.ts` l.6-12) ; toutes les requêtes lourdes passent par `cached(name, fn)` avec `tags: ['intelligence']`. Aucun `findMany` non borné sur `Job` (agrégats `$queryRaw` uniquement ; cf. B7 pour `Company`).

---

## 4. Sécurité — CONFIRMÉ sain (hors H2, abus de ressources)

| Point | Preuve |
|---|---|
| SQL brut | `grep -rn 'queryRawUnsafe|executeRawUnsafe|Prisma\.raw|\$executeRaw' apps/web` → **0**. 5 `$queryRaw`, tous en **template `Prisma.sql`** (`facts.ts`, `snapshots.ts`, `lists.ts`, `market.ts`) ; listes via `Prisma.join(...)` sur des valeurs (paramétrées, jamais concaténées) ; `FROM` et colonnes sont des fragments constants |
| Entrées URL | `[code]` : `/^[A-Z]{2}$/` + set ISO (`resolve.ts` l.19-23) avant toute requête ; `[slug]` ville : `parseCitySlug` regex puis **égalité** avec la liste réelle ; `[key]` métier : `FUNCTION_BY_KEY.get` (table statique) ; `[slug]` Maison/groupe : comparaison JS de slug, l'id/nom réel de la base est ensuite passé en paramètre. **Aucune page ne lit `searchParams`** (`grep` → 0) |
| Sondes hostiles (21) | `FR'`, `%00`, `..%2F..%2F`, `fr-' OR 1=1--`, `__proto__`, `constructor`, `%2e%2e%2f…passwd`, slug de 5 000 caractères, U+2028, `?x=<script>` → **404 (ou 200 en ignorant la query), jamais 500**, 0 ligne d'erreur dans le log serveur, temps 9-20 ms |
| JSON-LD | `jsonLd({name:'</script><img src=x onerror=alert(1)>'})` → `</script><img…` ; aucun `<` brut, round-trip JSON identique (script `jsonld-escape.mts` exécuté). Un seul `dangerouslySetInnerHTML` dans le périmètre (`chrome.tsx` l.144), alimenté par ce helper |
| En-têtes | `Content-Security-Policy` (default-src 'self' ; `unsafe-inline` script/style préexistant et documenté dans `next.config.mjs`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `HSTS preload` — présents sur `/intelligence` |
| Middleware | matcher global : seul le 301 d'hôte canonique s'applique aux routes Intelligence ; la sonde 410 ne concerne que `/offre/:id` |

---

## 5. Non-régression — CONFIRMÉ

| Vérification | Sortie réelle |
|---|---|
| `npm run typecheck -w @catwalks/web` | `tsc --noEmit` → **EXIT=0** |
| `npx vitest run` (apps/web) | **52 passed, 2 skipped** (6 fichiers) — les 2 skipped sont `intelligence-facts.integration.test.ts`, garde `DATABASE_URL === URL locale exacte` ; relancé avec cette URL : **2 passed** (totaux qui se recoupent, `MarketSnapshot` lisible) |
| `npm run build -w @catwalks/web` (sans `DATABASE_URL`, comme Railway) | **EXIT=0 en 9 s** ; 25 routes, toutes `ƒ` dynamiques (rien de pré-rendu → pas de `DatabaseUnavailableError` à la build) ; middleware 94,5 Ko ; First Load JS 107-127 Ko |
| `/` | 200 ; H1 « 1 996 offres. 7 Maisons. » = base (1 996 actives, 7 Maisons avec offre). Note : « 24 Maisons » vu dans le HTML est le texte d'une offre Cartier (« l'une des 24 Maisons du Groupe Richemont »), pas un compteur |
| `/emplois`, `/emplois?pays=FR`, `/entreprises`, `/entreprise/{cartier,hermes}` | 200 ; `/entreprises` « 7 Maisons » = base ; `/entreprise/cartier` 1 173 = base |
| `/offre/<actif>` | 308 → URL canonique à slug → 200 (S-01 inchangé) |
| `/offre/<fermé>` | **410 + `x-robots-tag: noindex`**, page rendue 43 Ko (D22 inchangé ; la sonde `127.0.0.1:PORT` fonctionne avec `PORT=3113`) |
| `/api/jobs` | 200, `total 1996` = base ; `?pays=FR` `total 691` = base ; facettes `countries` en ISO (FR 691, US 296, CH 169…) ; `/api/companies` 200 ; `/api/offre-status/*` 200 |
| Mobile 390 px (Playwright, Chromium, `isMobile`) sur `/`, `/intelligence`, `/pays/FR` | `scrollWidth = 390` (aucun débordement) ; menu mobile ouvert : « Intelligence → /intelligence » présent ; footer : 12 liens intacts dont Intelligence ; sous-nav Intelligence + fil d'Ariane visibles ; **0 erreur JS** (captures `mobile-390*.png`) |
| Fichiers partagés modifiés (`git diff`) | `site-nav.tsx` / `site-footer.tsx` : +1 lien ; `sitemaps/[chunk]/route.ts` : +boucle Intelligence (M4) ; `vitest.config.ts` : alias `@` ; `package.json` : d3-geo/topojson/world-atlas ; **`lib/countries.ts` : `countryCode()` replie désormais les libellés `Intl.DisplayNames` fr/en** — change le comportement des pages existantes (facettes pays de `/emplois`, `addressCountry` du JSON-LD offre, compteur pays de la landing) **dans le sens d'une meilleure normalisation** ; testé (`intelligence-format.test.ts` l.64 « Japon → JP »), `jobs.test.ts` vert. À noter comme changement de comportement assumé, pas comme régression |

Incident sans lien : le `next dev` voisin sur 3111 (pid 89221) a cessé de répondre pendant la session ; mes trois `kill` n'ont visé que mes PIDs (99816, 4473, 9227), le `.next` partagé n'a reçu aucun artefact de build de ma part.

---

## 6. Ce qu'il reste à faire avant déploiement (ordre proposé)

1. **H1** — Loïc tranche la licence CC BY 4.0 du `Dataset` (graver ou retirer `license` de `datasetLd`).
2. **H2** — Borner le coût des slugs inconnus (valider contre une liste mémorisée à clé fixe ; ne pas mettre `null` en cache par slug).
3. **M2 + M3** — Mémoriser `countrySpellings` (clé fixe) ; dédupliquer `generateMetadata`/`Page` (ex. `React.cache` autour de `getProfile`/résolveurs pour partager la promesse dans la même requête).
4. **M4** — Passer `sitemapIntelligence()` par `cached()` et envoyer `CACHE_HEADER` sur `/sitemaps/[chunk]` (déjà défini, jamais utilisé).
5. **M5** — Alléger la carte (asset statique ou éviter la double sérialisation RSC).
6. **M1** — (hors périmètre Intelligence, mais gain global) mémoriser `landingStats()` : −10 SQL par page vue sur tout le site.
7. Commiter le périmètre Intelligence (aujourd'hui non suivi) une fois 1-2 réglés.
