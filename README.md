# Catwalks Job Aggregator — MVP

Objectif : utiliser FashionJobs comme **annuaire de sociétés actives**, puis récupérer les offres directement depuis les ATS / pages carrière officielles.

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

FashionJobs n'est pas la source de vérité des offres. Il sert à découvrir le marché et à vérifier qu'une société recrute. L'ATS officiel devient la source primaire. Cela évite de dépendre de la structure HTML des pages d'offres FashionJobs et permet souvent de voir une annonce avant sa republication sur un jobboard.

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
