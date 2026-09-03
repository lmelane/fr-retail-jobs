# Fashion Atlas by Catwalks — l'agrégateur d'offres Mode · Luxe · Beauté · Horlogerie · Retail

Le moteur de recherche gratuit et exhaustif des offres publiques **Mode, Luxe, Beauté,
Horlogerie et Retail dans le monde** — sans doublon, avec le texte complet et le lien
de candidature direct chez l'employeur.

> **Deux marques (décision D14).** *Fashion Atlas* possède la recherche (SEO, acquisition,
> longue traîne) ; *Catwalks* (catwalks.io, plateforme distincte et existante) possède le
> candidat (compte, CV, matching, monétisation B2B). Fashion Atlas alimente Catwalks en
> candidats à grande échelle. *Fashion Atlas owns the search, Catwalks owns the candidate.*

## Monorepo

```text
apps/aggregator   Pipeline d'ingestion (crons : ingest, refresh, reconcile, discover)
apps/web          Le site Next.js (recherche, fiches offre/entreprise, SEO)
packages/db       Schéma Prisma + client Postgres partagé
```

## Le modèle : deux flux parallèles, pas une cascade

```text
A) MARQUES DU SECTEUR ──────► ATS / pages carrière officielles ──┐
   (liste sectorielle, Flux A, source canonique)                 │
                                                                 ├──► NORMALISATION
B) JOBBOARDS & CABINETS ────► leurs offres, directement ─────────┘         │
   FashionJobs · WTTJ · cabinets spécialisés                               ▼
                                                                     DÉDUPLICATION
                                                        (1 offre canonique + N JobSource)
                                                                           │
                                                                           ▼
                                                              CLASSIFICATION SECTEUR
                                                                           │
                                                                           ▼
                                                         STOCKAGE MONDE (flag isFrance)
```

Les deux flux sont **indépendants et de même rang**. Une offre Dior peut arriver par Dior
Careers, par LVMH et par un jobboard : la déduplication n'en garde qu'**une**, avec N
`JobSource` attachées. L'**URL canonique** vient toujours de la source la mieux classée
(`employeur direct > groupe officiel > ATS officiel > jobboard spécialisé > agrégateur`) —
un jobboard ne peut jamais écraser le lien direct de l'employeur (décision D18).

### Périmètre : MONDE par défaut (décision D19)

Le site affiche **toutes les offres (monde) par défaut** ; un filtre **Pays** restreint
(France, Italie…). `isFrance` reste stocké et sert le filtre France. La recherche, les
suggestions de villes/titres et le sitemap sont mondiaux — taper « Milan » ou « New York »
remonte bien les offres.

## Le pipeline (`apps/aggregator`)

| Commande | Rôle |
|---|---|
| `ingest` | Une source (`--source=<clé>`) ou le run complet — fetch + dédup à l'écriture |
| `ingest-all` | Entrée de prod : chaque source sous son propre timeout, puis geocode + santé + alerte |
| `refresh` | Cycle de vie — ferme les offres qu'aucune source ne rapporte plus (garde anti-purge massive) |
| `reconcile` | Fusions rétroactives après ajout d'un alias / synonyme |
| `discover` | Découverte d'ATS sur un roster de Maisons (`--input=<nom,url.csv>`) → fichier de review |

```bash
npm run ingest -w @catwalks/aggregator -- --source=cartier-3   # une source
npm run ingest -w @catwalks/aggregator                          # run complet local
npx tsx apps/aggregator/src/cli.ts ingest-all                   # entrée de prod
npx tsx apps/aggregator/src/cli.ts discover --input=data/maisons.csv --concurrency=5
```

### La chaîne d'hygiène (décisions D22–D24)

Un agrégateur ne montre que des offres réelles avec des liens vivants.

1. **Bonnes URLs à l'ingestion** — chaque adaptateur produit l'URL de candidature réelle
   (l'API/le feed de l'ATS fait foi), et une URL corrigée se propage aux offres déjà en base.
2. **Validation = la source, pas un HTTP HEAD massif** — une offre reste vivante tant qu'une
   de ses sources la re-liste ; elle n'est fermée que quand toutes ses sources sont périmées
   (`refresh`), et ré-ouverte si une source revient. À 14k+ sources, sonder chaque lien par
   HEAD mentirait (beaucoup de sites renvoient 403 en étant vivants) — le feed ne ment pas.
3. **Offre périmée → 410 Gone** — `apps/web/middleware.ts` + `/api/offre-status/[id]`
   renvoient 410 (+ `noindex`) pour une offre fermée, 404 pour un id inexistant, 200 pour une
   offre active. Google dé-indexe vite un 410, retente un 404 pendant des semaines.
4. **Alerte email (Brevo)** — un digest par run liste chaque source DEGRADED/BROKEN
   (`sendHealthAlert`), pour garder le catalogue propre. No-op sans `BREVO_API_KEY`.

## Le site (`apps/web`)

Next.js 15 (App Router). Recherche master-detail, fiches `/offre/[id]` et
`/entreprise/[slug]` (SEO), `sitemap.xml` + `robots.txt`, JobPosting JSON-LD (le
`hiringOrganization` est la **vraie Maison**, pas Fashion Atlas — modèle agrégateur).
DA Catwalks : noir/blanc/gris, graisse 400, titres en MAJUSCULES, pills.

```bash
npm run web:dev      # dev local (http://localhost:3009)
npm run web:build    # build de prod
```

## Installation

```bash
cp .env.example .env         # renseigner DATABASE_URL
npm install
npx playwright install chromium   # requis pour FashionJobs + la découverte ATS
npm run db:generate
npm run db:push
```

### Variables d'environnement

| Variable | Usage |
|---|---|
| `DATABASE_URL` | Postgres (requis) |
| `NEXT_PUBLIC_SITE_URL` | URL publique du site, pour sitemap/robots/JSON-LD (le vrai domaine une fois branché) |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Alerte email santé des sources |
| `ALERT_EMAIL` | Destinataire du digest (défaut : loic.melane@catwalks.io) |
| `SERPER_API_KEY` | Optionnel — recherche web pour la découverte ATS quand une URL carrière manque |

## Tests

```bash
npm run test:unit -w @catwalks/aggregator          # normalizers, secteur, france, ssrf…
DATABASE_URL=…/catwalks_test npm run test:integration -w @catwalks/aggregator
```

> ⚠️ **Les tests d'intégration VIDENT la base.** Ils ne tournent que sur une base dont le
> nom contient « test » (garde `src/test/setup-integration.ts`). Ne jamais les lancer sur la
> base de démo/prod.

## Requête publiable (côté site)

```sql
SELECT j.*
FROM "Job" j
JOIN "Company" c ON c.id = j."companyId"
WHERE j."isActive" = true            -- ajouter j."isFrance" = true pour la France seule
ORDER BY COALESCE(j."postedAt", j."firstSeenAt") DESC;
```

## État & décisions

L'état vérifié de la prod et les **décisions métier gravées** (D1–D24) vivent dans
[`CLAUDE.md`](./CLAUDE.md) — la source de vérité du produit. Règle : le **code + la base +
les logs de prod** priment sur tout résumé ; toute décision métier structurante se prend
avec le propriétaire (Loïc).
