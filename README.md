# Catwalks Job Aggregator

Objectif : **toutes les offres publiques Mode / Luxe / Beauté / Retail disponibles en France**, quelle que soit leur infrastructure.

## Le modèle : deux flux parallèles, pas une cascade

```text
A) MARQUES DU SECTEUR ──────► ATS / pages carrière officielles ──┐
   (liste sectorielle, indépendante de tout jobboard)            │
                                                                 ├──► NORMALISATION
B) JOBBOARDS ───────────────► leurs offres, directement ─────────┘         │
   FashionJobs · WTTJ · APEC · France Travail                              ▼
                                                                     DÉDUPLICATION
                                                                           │
                                                                           ▼
                                                              CLASSIFICATION SECTEUR
                                                                           │
                                                                           ▼
                                                                    FILTRAGE FRANCE
                                                                           │
                                                                           ▼
                                                                        CATWALKS
```

Les deux flux sont **indépendants et de même rang**. Une offre Dior peut arriver par
Dior Careers, par LVMH et par FashionJobs : la déduplication n'en garde qu'**une**,
avec N `JobSource` attachées, l'URL canonique venant de la source la mieux classée
(`employeur direct > groupe officiel > ATS officiel > jobboard spécialisé > agrégateur`).

**FashionJobs n'est pas un annuaire amont.** C'est une source d'offres au même titre
que les autres, doublée d'un signal de découverte d'employeurs. Faire dépendre le
périmètre de son annuaire l'enfermerait dans les 668 sociétés qui y publient — alors
que le périmètre visé est **sectoriel**, pas issu d'un jobboard.

## Pipeline

1. `discover-fashionjobs`
   - lit `https://fr.fashionjobs.com/societesrecrutent/`
   - récupère toutes les sociétés exposées par FashionJobs
   - enregistre nom, URL FashionJobs, slug et volume d'offres affiché

   > **Transport navigateur obligatoire.** Le domaine est protégé par Cloudflare :
   > toutes les requêtes `fetch`/curl reçoivent un HTTP 403, y compris la page
   > d'accueil et le sitemap. Cette étape passe donc par Chromium (Playwright).
   > `robots.txt` autorise bien `/societesrecrutent/` (seul `/societesRecrutent/ajax/`
   > est interdit). Mesuré le 2026-09-01 : **668 sociétés, une seule page, pas de
   > pagination**, dont 665 avec un compteur d'offres (3 sociétés n'en affichent
   > aucun côté source).

2. `discover-ats`
   - cherche la page carrière officielle (Serper, si configuré)
   - détecte automatiquement l'ATS
   - support MVP : Greenhouse, Lever, SmartRecruiters, Recruitee, Personio, Workday
   - fallback : crawler JSON-LD `JobPosting`
   - les cas non résolus passent en `NEEDS_REVIEW`

3. `export-companies`
   - exporte à tout moment le roster FashionJobs + ATS en CSV (`npm run export:companies`)

4. `sync-jobs`
   - appelle directement l'ATS
   - normalise les offres
   - conserve les offres monde mais calcule `isFrance`
   - upsert par `(companyId, ATS, externalId)`
   - marque les offres disparues comme inactives après un sync réussi

## Pourquoi ce modèle

Aucune source ne voit tout le marché — pas même pour ses propres inscrits. Mesuré le
2026-09-01 : Courir affiche **198 offres sur FashionJobs contre 396 dans son ATS**.
S'appuyer sur un seul jobboard reviendrait à ne voir que la moitié du marché.

À l'inverse, l'ATS officiel publie souvent une annonce **avant** sa republication sur
un jobboard, tandis qu'un jobboard couvre des employeurs sans ATS exploitable. Les deux
flux sont donc complémentaires, et c'est la déduplication — pas le choix d'une source —
qui garantit une liste propre.

## Priorité des sources

L'URL de candidature conservée est toujours la mieux classée :

```text
employeur direct  >  groupe officiel  >  ATS officiel  >  jobboard spécialisé  >  agrégateur
```

Une source moins prioritaire reste **attachée** à l'offre : elle sert à détecter les
modifications et les fermetures, même quand la source canonique tarde à se mettre à jour.

Cette priorité a aussi une portée légale. `api.smartrecruiters.com/robots.txt` réserve
`/v1/companies/` à LinkedInBot et renvoie `Disallow: /` à tous les autres, alors que le
domaine employeur vers lequel il redirige (`jobs.courir.com`) publie `Allow: /` et
déclare son sitemap — **mêmes offres, route propre, URL canonique côté employeur**.

## Installation

```bash
cp .env.example .env
npm install
npx playwright install chromium   # requis pour l'étape FashionJobs
npm run db:generate
npm run db:push
npm run sync:all
```

`SERPER_API_KEY` est **requise** pour `discover-ats`. Sans elle, la commande échoue immédiatement avec un message explicite, au lieu de basculer silencieusement les 668 sociétés en `NEEDS_REVIEW`. `discover-fashionjobs` fonctionne sans clé.

## Cron recommandé

- Annuaire FashionJobs : 1 fois/jour
- Découverte ATS : nouvelles sociétés uniquement, 1 fois/jour
- Sync ATS : toutes les 4 heures

Exemples :

```cron
15 3 * * * npm run discover:fashionjobs
45 3 * * * npm run discover:ats
0 */4 * * * npm run sync:jobs
```

## Requête Catwalks

Les offres françaises publiables :

```sql
SELECT j.*
FROM "Job" j
JOIN "Company" c ON c.id = j."companyId"
WHERE j."isFrance" = true
  AND j."isActive" = true
ORDER BY COALESCE(j."postedAt", j."firstSeenAt") DESC;
```

## À durcir avant production massive

- CGU FashionJobs / rate limits par domaine. (`robots.txt` vérifié le 2026-09-01 :
  `/societesrecrutent/` autorisé ; `/societesRecrutent/ajax/`, `/s/?...` et les
  espaces candidat/compte interdits — ne pas y toucher.)
- Alias de sociétés (`BVLGARI` ↔ `BULGARI`, etc.) avec validation humaine.
- Classification de l'employeur (`MAISON`, `RETAILER`, `CABINET`, etc.).
- Géocodage robuste pour `isFrance` au lieu des heuristiques de localisation.
- Déduplication cross-ATS si une même offre est publiée par plusieurs entités du groupe.
- Adaptateurs complémentaires : SuccessFactors, Teamtailor, Workable, Taleo et pages carrière propriétaires.
- Monitoring : taux de succès, nombre d'offres par source, alertes de chute brutale.
