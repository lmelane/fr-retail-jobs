# FRONT F1 — Architecture actuelle et cible

*Phase 0 du chantier « migration du front Mode Careers vers catwalks.io ».
Établi le 14/09/2026 par lecture du code des deux dépôts et mesure des
services en production. Chaque affirmation porte son statut :*
**[EXISTE]** *dans le code aujourd'hui ·* **[DÉCIDÉ]** *validé par le CEO
(D-417) ·* **[PROPOSÉ]** *recommandation CTO ·* **[À ARBITRER]** *carte de
décision ouverte.*

---

## 1. Les deux dépôts, tels qu'ils sont [EXISTE]

### 1.1 `catwalks-job-aggregator` (Railway) — monorepo : **OUI**

npm workspaces (`package.json` racine : `apps/*`, `packages/*`), trois paquets :

| Paquet | Responsabilité | Ce qu'il touche |
|---|---|---|
| `packages/db` | schéma Prisma, migrations, client | la base Postgres Railway |
| `apps/aggregator` | ingestion, adaptateurs ATS, déduplication, cycle de vie, attribution, remédiation, couverture | la base en écriture |
| `apps/web` | **rendu Mode Careers ET fonctions serveur de recherche** | la base en lecture, directement |

**Railway** : deux services sur le projet `catwalks-agregator-service`,
`catwalks-aggregator` et `catwalks-web`. Aucun `railway.json` ni
`railway.toml` dans le dépôt : la configuration vit dans le dashboard.
Le web se déploie par `apps/web/Dockerfile` (contexte = racine du monorepo,
`CMD ["node","apps/web/server.js"]`, port 3000, `preDeployCommand: prisma
migrate deploy`, healthcheck `/api/health`). Domaine public :
`modecareers.com` (le middleware redirige en 301 `www.` et le domaine
`*.up.railway.app` vers lui).

### 1.2 `apps/web` : ce qu'il contient, route par route

**Pages** (toutes `force-dynamic`, toutes en accès Prisma direct depuis le
composant serveur) : `/`, `/emplois`, `/offre/[id]`, `/entreprises`,
`/entreprise/[slug]`, `/bot`, `/intelligence` et 12 sous-pages.

**Routes API JSON** — `app/api/*` :

| Route | Rôle | Cache | Auth | CORS |
|---|---|---|---|---|
| `GET /api/jobs` | recherche complète : mêmes clés que `/emplois` (`parseFilters` partagé), 25 offres/page, facettes, `total` | aucun | aucune | aucun |
| `GET /api/companies` | annuaire Maisons, 40/page | aucun | aucune | aucun |
| `GET /api/suggest?type=title\|city\|company&q=` | autocomplétion, 8 max | aucun | aucune | aucun |
| `GET /api/offre-status/[id]` | `active \| closed \| missing`, sonde interne du middleware | aucun | header interne | aucun |
| `GET /api/logo?domain=` | logo binaire, anti-SSRF par regex | 1 j / 7 j | aucune | aucun |
| `GET /api/health` | contrat de migrations | no-store | aucune | aucun |

**Ce qui n'existe PAS en API** : la fiche d'une offre (`JobRow` complet +
similaires + fiche Maison), la fiche Maison, le JSON-LD `JobPosting`
(calculé au rendu, `lib/job-posting-schema.ts`), les sitemaps en JSON
(servis en XML par `app/sitemap.xml` et `app/sitemaps/[chunk]`, 5 000
offres par chunk, base URL codée sur `modecareers.com`).

**Middleware** : 301 canonique de domaine ; sur `/offre/:id`, sonde
`/api/offre-status` puis `rewrite` en **410** + `x-robots-tag: noindex` pour
une offre fermée. **La règle de statut est unique** : `isActive = false` ⇒
hors catalogue et 410 ; `withdrawnAt` ne sert qu'au libellé « Retirée » vs
« Expirée ».

**Recherche** (`lib/jobs.ts`, `lib/job-search-query.ts`) : une requête SQL
brute à CTE matérialisées, préfiltre `searchText ILIKE` sur index GIN
trigram, prédicats exacts par champ, branche sémantique `occupationCode`.
Tri `postedAt DESC NULLS LAST, firstSeenAt DESC, id`. Pagination offset,
`PAGE_SIZE = 25`, `MAX_PAGE = 10 000`. **`ville` est une égalité**
(`j.city ILIKE ${ville}`), pas un `%…%` : sans autocomplétion, « Ile de
France » rend zéro. `pays` absent = monde entier.

**Sécurité** : CSP `connect-src 'self'`, `X-Frame-Options: DENY`, HSTS.
Aucun en-tête CORS nulle part, `robots.txt` : `Disallow: /api/`.

### 1.3 `catwalks-website` (Vercel, catwalks.io)

Next.js App Router, branche de production `main` (dérogation D-417 : le
chantier vit sur `catwalks-front-end`, locale). Design system `cw-*`
(`globals.css`), skill `catwalks-dev-skill`. Authentification et espace
candidat en place (`/connexion`, `/inscription`, `/cv`, `/mes-jobs`,
`/mes-candidatures`, `/profile`, `/settings`, `/onboarding`). Backend
Catwalks séparé (`NEXT_PUBLIC_API_URL`, Neon). Sentry actif (D-318).
`/offres` et ses facettes (`/offres/metier|ville|contrat|secteur|specialite|
arrondissement`) servent les **121 offres propres** de Catwalks ; leur
paramètre `metier` attend des identifiants canoniques (D-100), pas du texte.
Sitemaps segmentés (`sitemap-offres.xml`, `-maisons`, `-lieux`, `-metiers`,
`-facettes`, `-guides`, `-pages`).

---

## 2. Mesures en production (14/09/2026, 12:20 UTC+2) [EXISTE]

| Mesure | Valeur | Source |
|---|---|---|
| Offres actives | **82 145** | `GET /api/jobs` → `total` |
| Maisons | **844** | `GET /api/companies` → `total` |
| Pays | **118** | facette `countries` |
| Répartition | US 36 540 · FR 10 935 · GB 3 222 · CA 3 083 · DE 3 024 | facette `countries` |
| Facettes servies | 59 métiers, 16 secteurs, 60 villes, 36 groupes, 844 Maisons, 40 sources | `facets` |
| `/api/jobs?q=vendeuse&ville=Paris`, 5 tirs | 0,35 · 0,38 · 0,38 · 0,41 · 0,46 s | curl, depuis Paris |
| `/emplois?q=vendeuse` (HTML), 3 tirs | 0,53 · 0,59 · 0,66 s | curl |
| **Poids d'une page d'API** | **173 Ko** pour 25 offres | la liste embarque `description` |
| En-têtes | `server: cloudflare`, aucun `Cache-Control`, aucun `Access-Control-*` | curl -I |

Tableau de référence complet (p50/p95/p99, 4xx/5xx, timeouts, connexions
DB) : **à produire en phase 2**, une fois les logs `x-request-id` en place.
Les cinq tirs ci-dessus sont indicatifs, pas une baseline.

**Coût du paramètre `lieu` (14/09/2026, apps/web local sur la base de
production, 5 tirs chacun, cache contourné)** : `ville=Paris` (égalité
stricte) 0,28 à 0,58 s · `lieu=Paris` (large) 0,33 à 0,41 s · `lieu=Lyon`
0,27 à 0,36 s · `lieu=France` (pays) 0,33 à 0,47 s · `q=vendeuse` 0,53 à
0,56 s. À 83 431 offres actives, la correspondance large sur `city` et
`location` (sans index) ne coûte pas plus que l'égalité stricte ; l'index
trigram sur ces deux colonnes (audit sécurité H2) se pose quand le seuil
§5.6 (p95 > 800 ms) est franchi, pas avant. Mesure rejouable :
`apps/web/scripts/mesure-f1-url-candidature.mjs` (index) et les tirs curl
ci-dessus. Le même script a compté **0** URL de candidature hors http(s)
sur 83 431 offres actives (audit H1).

---

## 3. Schéma des flux

**Aujourd'hui [EXISTE]**

```
SOURCES (ATS, portails, sitemaps)
   → apps/aggregator (Railway)      ingestion · dédup · cycle de vie
   → Postgres (Railway)
   → apps/web (Railway)             Prisma DIRECT depuis les pages
   → modecareers.com                HTML + /api/* (usage interne)
   → UTILISATEUR

catwalks.io (Vercel) → backend Catwalks (Neon) → 121 offres propres   (séparé)
```

**Cible [DÉCIDÉ pour la forme, PROPOSÉ pour les moyens]**

```
SOURCES
   → apps/aggregator (Railway)      inchangé
   → Postgres (Railway)             inchangée, ne bouge pas
   → API de lecture (Railway)       /api/v1/* versionnée, clé serveur, cache HTTP
   → catwalks.io (Vercel)           composants serveur + client API typé
                                    (le NAVIGATEUR ne parle qu'à catwalks.io)
   → UTILISATEUR
```

---

## 4. Réponses de la phase 0

| Question | Réponse |
|---|---|
| Monorepo Railway ? | **OUI** |
| `apps/web` contient-il des API indispensables ? | **OUI** : la recherche (`/api/jobs`, seule forme HTTP du moteur), l'autocomplétion, le statut d'offre, le logo. Et des fonctions serveur sans route HTTP : fiche offre, similaires, fiche Maison, `JobPosting`, sitemaps. |
| Catwalks peut-il les consommer sans accès direct à la base ? | **OUI pour la liste et la recherche**, telles quelles, dès qu'un accès serveur-à-serveur est ouvert. **NON pour la fiche, la Maison, le JSON-LD et les sitemaps** tant que ces fonctions ne sont pas exposées en HTTP (phase 1). |
| Service Railway à conserver après migration | `catwalks-aggregator` (le moteur) **et** le service qui portera l'API de lecture. Aujourd'hui c'est `catwalks-web` : il reste tant que catwalks.io en dépend. |
| Service retirable plus tard | le **rendu** de `catwalks-web` (pages, middleware 410, sitemaps XML sur modecareers.com), une fois ses routes API isolées et ses redirections 301 posées. Jamais avant. |

---

## 5. Architecture cible pour un agrégateur international à plusieurs centaines de milliers d'offres [PROPOSÉ]

*Exigence du CEO (14/09/2026) : « la meilleure architecture possible pour un
agrégateur international avec des centaines de milliers d'offres ». Elle se
lit avec la doctrine du chantier : aucun scaling préventif, on mesure d'abord.
La meilleure architecture n'est pas la plus grosse : c'est celle dont chaque
étage a un seuil mesurable qui dit quand passer au suivant.*

### 5.1 Une seule vérité métier, sur Railway

Le moteur de recherche, les règles de statut, la canonicalisation d'URL, la
déduplication et l'éligibilité `JobPosting` restent dans `apps/web/lib`.
Ils sont **exposés**, pas recopiés. Vercel ne porte que du rendu et un
client typé. C'est la condition pour que la fiche, le 410, le sitemap et
Google Jobs disent la même chose que la liste.

### 5.2 Le navigateur ne parle jamais à Railway

Tous les appels partent des composants serveur et des route handlers de
catwalks.io, avec une clé (`Authorization: Bearer`) et un `x-request-id`.
Conséquences : aucun CORS à ouvrir, la CSP `connect-src 'self'` reste, la
clé n'est jamais dans un bundle, et un abus se coupe côté Vercel. Le défilement
infini de la liste appelle `catwalks.io/api/emplois` qui proxifie.

### 5.3 Une API de lecture versionnée, mince, cacheable

`/api/v1/` sur Railway, sans rien réécrire du moteur :

| Route | Rôle | Cache HTTP |
|---|---|---|
| `GET /v1/offres` | recherche ; **projection `liste`** sans description (173 Ko → ~15 Ko) | `s-maxage=120, stale-while-revalidate=600` + `ETag` |
| `GET /v1/offres/{id}` | `JobRow` complet + statut + similaires + fiche Maison + **JSON-LD prêt** | `s-maxage=300` ; `410` porté par l'API elle-même |
| `GET /v1/maisons`, `/v1/maisons/{slug}` | annuaire et fiche | `s-maxage=600` |
| `GET /v1/suggest` | autocomplétion, 8 max | `s-maxage=3600` |
| `GET /v1/facettes` | compteurs pour la home et les pages métier / lieu / secteur | `s-maxage=600` |
| `GET /v1/sitemap/{chunk}` | ids + `lastmod`, 5 000 par chunk, **sans base URL** (le front la pose) | `s-maxage=3600` |

Pagination : offset jusqu'à la page 40 pour l'humain (au-delà, personne ne
clique), **curseur keyset** (`postedAt,id`) pour les robots et les exports.
Cloudflare est déjà devant Railway : ces en-têtes suffisent pour absorber les
crawlers sans toucher à la base.

### 5.4 Le front rend depuis le cache, invalide sur événement

Listes et facettes : `fetch` avec `revalidate` 120 à 600 s. Fiches offre :
ISR avec `revalidate` 600 **et** revalidation à la demande déclenchée par
l'agrégateur quand une offre ferme (`POST catwalks.io/api/revalidation`,
signé) : un 410 se propage en secondes, pas en dix minutes. Sitemaps : le
front sert `sitemap-emplois-{n}.xml` depuis `/v1/sitemap/{n}` en posant
`https://catwalks.io/emplois/…`. Le générateur reste sur Railway.

### 5.5 International dès la forme des URL

`/emplois` accepte `q`, `lieu`, `pays`, `metier`, `secteur`, `maison`,
`groupe`, `contrat`, `page`. `lieu` est résolu par l'API (ville exacte, pays
par nom ou code ISO, « télétravail ») : le front n'a pas à savoir ce qu'est
une ville. Pages d'atterrissage : `/emplois/pays/{code}`,
`/emplois/ville/{slug}`, `/emplois/metier/{slug}`, `/emplois/maison/{slug}`,
générées depuis `/v1/facettes`, indexables seulement au-dessus d'un seuil
d'offres (le même `MIN_SAMPLE` que l'Intelligence). `hreflang` quand une
seconde langue d'interface existera, pas avant.

### 5.6 Les seuils qui déclenchent l'étage suivant

| Signal mesuré sur 7 jours | Seuil | Étage suivant |
|---|---|---|
| p95 `/v1/offres` (cache MISS) | > 800 ms | index de recherche dédié (Meilisearch ou Typesense) alimenté par le pipeline ; Postgres reste la vérité |
| CPU Postgres | > 70 % soutenu | réplique de lecture Railway pour l'API |
| Ratio cache HIT Cloudflare | < 60 % | revoir les clés de cache (normaliser l'ordre des paramètres) avant d'ajouter une machine |
| 5xx ou timeouts `/v1/*` | > 0,5 % | passer l'API dans son propre service Railway, séparé du rendu |
| Offres actives | > 250 000 | partitionner les sitemaps par pays, curseur obligatoire |

Aucun de ces étages ne se provisionne avant que son signal ne soit mesuré.

### 5.7 Observabilité (phase 2, avant tout trafic)

`x-request-id` généré par Vercel, propagé à Railway, présent dans les logs
JSON des deux côtés, dans Sentry et dans les corps d'erreur techniques.
Champs : route, méthode, statut, durée totale, durée de l'appel amont, cache
HIT/MISS, release. Jamais : token, cookie, CV, donnée candidat.

---

## 6. Arbitrages rendus le 14/09/2026 [DÉCIDÉ] et ce qui reste ouvert [À ARBITRER]

**Rendus (D-418, D-419, dépôt catwalks-backend)** : l'API de lecture vit dans
`apps/web` (choix technique, réversible) ; les 121 offres internes entrent
dans l'agrégateur comme une source de plus ; une seule route de résultats,
`/emplois` ; suggestions dès deux caractères et résolution tolérante du lieu
côté API ; **ordre des résultats : offres Catwalks en tête, puis le pays du
visiteur, puis la fraîcheur** ; facette « Langue » sans exclusion ; « Métier
à préciser » affiché ; « Intelligence » en lot séparé après le cutover.

**Restent ouverts** :

1. **Où vit l'API de lecture** : dans `apps/web` (une route `/api/v1/*` de
   plus, zéro déploiement nouveau) ou dans un service Railway dédié
   `apps/api` (isolation, un déploiement de plus). Recommandation : **dans
   `apps/web` d'abord**, séparation quand le seuil 5xx le demande.
2. **Les 121 offres internes** : ingérées par l'agrégateur comme une source
   de plus (une seule recherche, une seule vérité, un champ
   `modeCandidature: interne | externe` qui choisit modale ou lien) ou
   fusionnées côté front (deux moteurs, deux paginations). Recommandation :
   **une source de plus**.
3. **Route des résultats** : `/emplois` (miroir de Mode Careers, redirections
   301 triviales) ou `/offres` (route existante des offres internes, avec ses
   facettes SEO et son contrat d'URL à IDs). Recommandation : **`/emplois`**,
   `/offres` intact jusqu'au remapping des fiches.
4. **Autocomplétion sur la home** : texte libre pur (aucun appel avant la
   soumission) ou suggestions `/v1/suggest` dès 2 caractères, comme Mode
   Careers (sans elle, « ville » en égalité stricte rend zéro sur une faute).
   Recommandation : **suggestions**, résolues côté API.

---

## 7. Ce que ce chantier ne fait pas

Ne réécrit pas l'agrégateur, ne déplace pas la base, ne change pas les règles
de fermeture, ne touche pas aux adaptateurs, ne réactive pas les crons, ne
provisionne rien par anticipation, ne duplique pas la logique métier, ne
connecte pas le navigateur à Postgres, ne supprime pas `catwalks-web` avant
la cartographie de ses routes (faite ici) **et** la pose des redirections.
