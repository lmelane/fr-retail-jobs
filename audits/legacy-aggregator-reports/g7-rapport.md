# g7 — Logos des Maisons : un domaine lu à la source, jamais deviné

Demande de Loïc (2026-09-06) : « les pictogrammes des entreprises ne correspondent pas aux entreprises : trouver une solution fiable de A à Z ».

## Constat et cause

Le site devinait le domaine depuis le NOM (`guessDomain` : « MAC » → mac.com, « Omega » → omega.com) et servait le favicon de ce domaine. Un nom devine souvent le domaine réel d'une AUTRE entreprise : le favicon existe, la route `/api/logo` le voit en 200, et aucun `onError` ne peut détecter « mauvaise entreprise ». Le logo ment sans qu'aucun garde-fou puisse le savoir.

## La solution, de bout en bout

Le domaine d'une Maison vient toujours d'une source qui la **nomme**, ou de rien :

| Chemin | Source | Réseau | Où |
|---|---|---|---|
| (i) `source-careers` | la racine du domaine carrière d'une source du catalogue (`careers.hermes.com` → `hermes.com`) dont la Maison résout (`resolveCompany`) à cette Company | aucun | à l'ingest (`upsert.ts`) et dans `resolve-domains` |
| (ii) `wikidata` | l'entité dont la description dit « entreprise / marque / maison de luxe… », propriété P856 (site officiel) | ≤ 1 req/s, User-Agent nommé | `resolve-domains` |
| (iii) rien | — | — | le composant web affiche l'initiale |

Gardes du chemin (i), toutes testées :
- un hôte ATS (`*.myworkdayjobs.com`, `*.icims.com`, `*.teamtailor.com`, `*.oraclecloud.com`, `*.taleo.net`, `*.successfactors.*`, `*.avature.net`, `jobs.lever.co`, `boards.greenhouse.io`, `*.recruitee.com`, `*.personio.de`, `*.talent-soft.com`, `*.talentview.io`, `apply.workable.com`, `welcometothejungle.com`…) ne rend **aucun** domaine — pas le logo Workday sur toutes les Maisons Richemont ;
- la racine est le domaine enregistrable (suffixes `co.uk`, `com.au`, `com.mx`… connus), donc tout sous-domaine carrière tombe sans liste à tenir, et un mot carrière collé au label est retiré (`carrieres-rolex.com` → `rolex.com`, `recrutement-nocibe.fr` → `nocibe.fr`, `burberrycareers.com` → `burberry.com`) ;
- **le domaine doit porter le nom de la Maison** : un flux de groupe est catalogué sous sa marque de tête avec le domaine du groupe (« Element +6 » → groupe-beaumanoir.com, « Escada Parfums +16 » → coty.com, « Maison Margiela » → otb.net, « NARS » → shiseidoamericas.com). Sans cette garde, le logo Beaumanoir s'affichait sur Element. Mesuré sur le catalogue de prod (493 lignes), elle écarte exactement ces cas et garde « Galeries Lafayette » → groupegalerieslafayette.com, « Clarins » → groupeclarins.com, « Foot Locker France » → footlocker.com.

Gardes du chemin (ii), testées sur des réponses Wikidata **capturées** (`src/normalize/__fixtures__/wikidata/`) :
- une entité sans mot de secteur ni d'entreprise dans sa description est écartée (le prénom, la station de métro, macOS, le styliste Tom Ford, le « groupe de rock hongrois » Omega) ;
- le **libellé exact** prime sur la note : pour « Louis Vuitton », LVMH (« groupe … d'entreprises de luxe ») notait plus haut que la maison et le premier run de g7-check a posé `lvmh.com` sur Louis Vuitton — corrigé, re-mesuré : `louisvuitton.com` ;
- P856 : rang `preferred` avant `normal`, jamais `deprecated`, ramené à la racine (Louis Vuitton déclare 43 sites régionaux) ;
- une entité sans P856 cède la place à la suivante ; on ne remonte **jamais** au groupe (P749) : « Christian Dior Couture » → LVMH aurait mis le logo LVMH sur Dior.

Choix pris par délégation, à valider : le chemin (i) accepte les tiers `EMPLOYER_DIRECT` **et** `ATS_OFFICIAL` (le tenant ATS propre de la Maison : la ligne nomme la Maison et son hôte carrière — même garantie, et la garde « le domaine porte le nom » écarte « Army Logic » → hypebeast.cn, « f.a.e. » → thrivemarket.com). Le brief ne citait qu'EMPLOYER_DIRECT.

## Livré

1. **Schéma** : `Company.domain String?` + `Company.domainSource String?` (`packages/db/prisma/schema.prisma`) ; migration `20260906140000_company_domain` (`ADD COLUMN IF NOT EXISTS`). Appliquée en local sur `catwalks_test` seulement. **Pas en prod.**
2. **Résolution** : `apps/aggregator/src/normalize/companyDomain.ts` — `rootDomainOf`, `nameMatchesDomain`, `domainFromEmployerSources`, `wikidataSearchTerms`, `rankWikidataEntities`/`pickWikidataEntity`, `hostFromOfficialWebsite`, `resolveViaWikidata`, `wikidataClient` (via `fetchJson` : porte par hôte + garde SSRF, 1 req/s, UA `ModeCareersBot/1.0`), `resolveCompanyDomain`. 67 tests unitaires (`companyDomain.test.ts`).
3. **CLI** `resolve-domains` (`src/cli.ts` → `src/pipeline/resolveDomains.ts`) : parcourt les Company actives sans `domain`, offres actives décroissantes ; `--limit=<n>`, `--dry-run` ; bilan JSON (résolues par provenance, non résolues, exemples). Idempotente ; une Maison non résolue est re-tentée au run suivant. 3 tests d'intégration.
4. **Écriture à l'ingest** : `CandidateJob.companyDomain` (calculé dans `toCandidate` depuis `SourceDef.careersDomain`, nouveau champ alimenté par le catalogue) ; `upsert.ts` pose `domain`/`domainSource=source-careers` à la création et **remplit seulement si vide** à la ré-attestation — un domaine posé (catalogue, Wikidata, main) n'est jamais écrasé. 2 tests d'intégration.
5. **Web** : `lib/jobs.ts` expose `JobRow.companyDomain`, `lib/companies.ts` expose `CompanyRow.domain` et `CompanyProfile.domain` ; `company-logo.tsx` prend `domain` et rend l'initiale sans lui. `lib/company-domain.ts` et son test **supprimés** (D5). `/api/logo` inchangée. Les quatre appels (`jobs-view`, `job-detail`, `companies-view`, `company-profile-view`) passent le domaine.
6. **Preuve** : `src/discovery/g7-check.mts` (ci-dessous).

## Preuve — 40 Maisons de la base de prod, lecture seule

Exécuté deux fois le 2026-09-06 (la seconde après le correctif « libellé exact »). Échantillon : les 20 Maisons actives les plus visibles que le catalogue nomme (chemin (i)), et 20 marques issues de flux de groupe (LVMH, Richemont, Kering, ELC, Swatch). Favicon téléchargé avec la logique exacte de `/api/logo` (DuckDuckGo puis Google, placeholder DDG de 1 478 o refusé, < 100 o refusé).

| bucket | maison | offres | domaine | provenance | favicon |
|---|---|---|---|---|---|
| direct | Foot Locker France | 2842 | footlocker.com | source-careers | 1531 o (google) |
| direct | Kering | 2486 | kering.com | source-careers | 474 o (ddg) |
| direct | Sephora | 2278 | sephora.com | source-careers | 15406 o (ddg) |
| direct | Pandora | 1826 | pandoragroup.com | source-careers | 735 o (google) |
| direct | L’Oréal Professionnel | 1782 | loreal.com | source-careers | 417 o (ddg) |
| direct | Boots | 1401 | boots.jobs | source-careers | 15086 o (ddg) |
| direct | Rituals | 1087 | rituals.com | source-careers | 1150 o (ddg) |
| direct | adidas | 1053 | adidas-group.com | source-careers | 18563 o (ddg) |
| direct | Primark | 860 | primark.com | source-careers | 2238 o (ddg) |
| direct | Lovisa | 832 | lovisa.com | source-careers | 2056 o (ddg) |
| direct | Lacoste | 548 | lacoste.com | source-careers | 686 o (ddg) |
| direct | Crocs | 495 | crocs.com | source-careers | 35874 o (ddg) |
| direct | Normal | 478 | normal.eu | source-careers | 1837 o (ddg) |
| direct | Galeries Lafayette | 336 | groupegalerieslafayette.com | source-careers | 2636 o (ddg) |
| direct | Penningtons | 323 | penningtons.com | source-careers | 2162 o (ddg) |
| direct | Nocibé | 306 | nocibe.fr | source-careers | 34494 o (ddg) |
| direct | Etam | 239 | groupeetam.com | source-careers | 9662 o (ddg) |
| direct | Aptar Beauty | 209 | aptar.com | source-careers | AUCUN favicon |
| direct | Rolex | 208 | rolex.com | source-careers | 2762 o (ddg) |
| direct | Aroma-Zone | 181 | aroma-zone.com | source-careers | 15086 o (ddg) |
| groupe | Christian Dior Couture | 484 | — | non résolu | initiale |
| groupe | Cartier | 118 | cartier.com | wikidata | 2069 o (ddg) |
| groupe | MAC | 344 | — | non résolu | initiale |
| groupe | Tom Ford | 71 | tomford.com | wikidata | 318 o (ddg) |
| groupe | Loewe | 60 | loewe.com | wikidata | 4286 o (ddg) |
| groupe | Bulgari | 107 | bulgari.com | wikidata | 450 o (ddg) |
| groupe | Tiffany & Co. | 436 | tiffany.com | wikidata | 7973 o (ddg) |
| groupe | Omega | 40 | omegawatches.com | wikidata | 15086 o (ddg) |
| groupe | Guerlain | 115 | guerlain.com | wikidata | 889 o (ddg) |
| groupe | Clinique | 111 | clinique.com | wikidata | 1150 o (ddg) |
| groupe | Jo Malone London | 116 | jomalone.fr | wikidata | 10990 o (ddg) |
| groupe | Montblanc | 108 | montblanc.com | wikidata | 478 o (google) |
| groupe | Louis Vuitton | 615 | louisvuitton.com | wikidata | 334 o (ddg) |
| groupe | Celine | 141 | celine.com | wikidata | 7406 o (ddg) |
| groupe | Loro Piana | 102 | loropiana.com | wikidata | 1728 o (ddg) |
| groupe | VanCleef-Aprels | 266 | — | non résolu | initiale |
| groupe | Fendi | 95 | fendi.com | wikidata | 607 o (ddg) |
| groupe | Givenchy | 24 | givenchy.com | wikidata | 186 o (ddg) |
| groupe | Hermès | 647 | hermes.com | wikidata | 332 o (ddg) |
| groupe | Parfums Christian Dior | 249 | — | non résolu | initiale |

**36 / 40 résolues (90 %)** : 20/20 par le catalogue, 16/20 par Wikidata. **35 favicons servis** (Aptar Beauty résolu en `aptar.com`, sans favicon chez les deux fournisseurs → initiale). 46 s au total, Wikidata à 1 req/s. Les tailles identiques (15 086 o pour Boots, Aroma-Zone, Omega) ont été vérifiées par hash : trois icônes distinctes, même gabarit ICO — pas un second placeholder.

Couverture en prod : **1 127 Maisons actives**, dont **122** nommées par le catalogue (chemin (i), sans réseau) ; les autres passent par Wikidata.

## Ce qui reste non résolu, et pourquoi

- **Christian Dior Couture** (484 offres) et **Parfums Christian Dior** (249) : Wikidata a les entités (Q131721678, Q3365053) mais **sans P856** ; leur seul lien est P749/P127 → LVMH, refusé (logo du groupe). L'entité « Christian Dior » (Q542767) porte `dior.com`, mais l'atteindre suppose de deviner qu'il faut tronquer le nom — on ne devine pas. **Recommandation** : `domainSource='manual'` avec `dior.com` (décision Loïc, une ligne SQL : `UPDATE "Company" SET domain='dior.com', "domainSource"='manual' WHERE "canonicalKey" IN ('DIOR','PARFUMS_DIOR')`).
- **MAC** (344) : « MAC » ne renvoie que le macédonien, Macao, macOS. Le nom en base est celui du flux ELC. **Recommandation** : `manual` → `maccosmetics.com`.
- **VanCleef-Aprels** (266) : orthographe du flux Richemont ; ni le catalogue ni Wikidata ne connaissent ce nom. La vraie correction est un alias `VANCLEEF APRELS` → `VAN_CLEEF` dans `resolveCompany` — mais c'est une fusion d'identité de Company (dédup), donc une décision à prendre, pas un correctif de logo.
- **Aptar Beauty** : domaine juste (`aptar.com`), aucun favicon servi par DuckDuckGo ni Google → initiale, conforme.

Autres cas à connaître (résolus, favicon juste, mais domaine « corporate ») : Pandora → pandoragroup.com, Etam → groupeetam.com, Galeries Lafayette → groupegalerieslafayette.com, adidas → adidas-group.com, L'Oréal Professionnel → loreal.com. Le favicon est celui de la marque ; si Loïc préfère le site marchand, `manual` prime toujours.

## Mise en prod — ordre impératif

Les crons sont gelés (D35) et un push **ne lance pas** le CMD Docker (donc pas `migrate deploy`). Le web lit désormais `Company.domain` : déployé **avant** la colonne, chaque page renvoie 503 (Prisma échoue sur une colonne absente → `DatabaseUnavailableError`).

1. `cd packages/db && DATABASE_URL=<prod> npx prisma migrate deploy` — ajoute les deux colonnes (IF NOT EXISTS, sans verrou long).
2. `npx tsx src/cli.ts resolve-domains --dry-run --limit=50` depuis `apps/aggregator` avec `DATABASE_URL=<prod>` — lire le bilan.
3. `npx tsx src/cli.ts resolve-domains` — ~1 127 Maisons, jusqu'à 4 requêtes Wikidata par Maison non couverte par le catalogue, à 1 req/s : compter **jusqu'à ~1 h**. Idempotente, relançable.
4. Poser les `manual` ci-dessus (décision Loïc).
5. Pousser `main` (web + aggregator). Au prochain ingest, le chemin (i) tourne seul sur toute Company créée ou ré-attestée par une source qui la nomme.

## Vérifications

- `apps/aggregator` : `npx tsc --noEmit -p .` propre ; `npm run test:unit` **437/437** (40 fichiers) ; `npm run test:integration` sur `catwalks_test` **63/63** (12 fichiers, dont `upsert.test.ts` +2 et `resolveDomains.test.ts` +3).
- `apps/web` : `npx tsc --noEmit -p .` propre ; `npx vitest run` **25/25**.
- Aucune écriture en base de prod (les deux runs de `g7-check` lisent avec `select` explicite) ; aucun commit, aucun push.

## Fichiers

- `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20260906140000_company_domain/migration.sql`
- `apps/aggregator/src/normalize/companyDomain.ts` (+ `.test.ts`, `__fixtures__/wikidata/*.json` : 8 recherches + 6 lectures P856 capturées)
- `apps/aggregator/src/pipeline/resolveDomains.ts` (+ `.test.ts`), `apps/aggregator/src/cli.ts`
- `apps/aggregator/src/dedup/match.ts`, `src/dedup/upsert.ts` (+ `.test.ts`), `src/connectors/registry.ts`, `src/pipeline/ingest.ts`
- `apps/web/components/company-logo.tsx`, `jobs-view.tsx`, `job-detail.tsx`, `companies-view.tsx`, `company-profile-view.tsx` ; `apps/web/lib/jobs.ts`, `lib/companies.ts`, `lib/job-posting-schema.test.ts` ; supprimés : `lib/company-domain.ts`, `lib/company-domain.test.ts`
- `apps/aggregator/src/discovery/g7-check.mts`
