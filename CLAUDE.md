# CLAUDE.md — Catwalks Job Aggregator

> Ce fichier grave les **décisions métier** et l'**état vérifié** de la plateforme.
> Règle : le **code + la base + les logs de prod** sont la source de vérité, jamais un résumé.
> Toute décision métier structurante se prend avec le propriétaire (Loïc), jamais seul.

## Le produit, en une phrase

Un **jobboard/agrégateur gratuit** qui réunit **toutes les offres publiques Mode · Luxe · Beauté · Horlogerie · Retail disponibles en France**, sans doublon, avec le texte complet et le lien de candidature direct. Deux flux de rang égal : (A) les ATS/pages carrière des employeurs, (B) les jobboards et cabinets. Déduplication à l'écriture : **1 offre canonique + N sources**.

## Parties prenantes

- **Propriétaire / décideur produit** : Loïc (loic.melane.pro@gmail.com). Décide de toute intention métier.
- **Candidats** : cherchent, filtrent, lisent une offre complète, postulent chez l'employeur. Aucune inscription.
- **Employeurs / Maisons** : leurs offres sont agrégées depuis des sources publiques et autorisées (robots.txt lu à la source).

## Infra (vérifié le 2026-09-02)

Projet Railway **« data feed of jobs »**, env `production` :

| Service | Rôle réel |
|---|---|
| `Postgres` | base de prod (postgres-ssl:18), volume monté, réseau interne uniquement |
| `catwalks-web` | site Next.js — `catwalks-web-production.up.railway.app` |
| `catwalks-aggregator` | cron `ingest` |
| `catwalks-refresh` | cron `refresh` (lifecycle) |
| `catwalks-reconcile` | **anomalie : exécute `ingest`, pas `reconcile`** (à corriger) |

Monorepo npm workspaces : `apps/aggregator` (pipeline), `apps/web` (site), `packages/db` (Prisma).
La base de prod n'est joignable que via le réseau interne Railway → diagnostics via `railway ssh --service catwalks-aggregator` (lecture seule pour l'audit).

## Décisions métier gravées

### D1 — DB indisponible → page d'erreur propre, jamais d'offres fictives
Si la base est injoignable, le site rend une **page d'erreur propre (503)**, pas d'offres inventées. Le fallback `DEMO_JOBS` (6 offres fictives) est **supprimé**. _Un jobboard ne ment jamais sur ses offres._ (Décidé 2026-09-02.)

### D2 — Les filtres Groupe et Source sont activés dans l'UI
La barre de filtres expose **Secteur · Contrat · Ville · Maison · Groupe · Source**. Le groupe et la source, aujourd'hui morts-nés dans le code, deviennent des filtres réels (comptes exacts), conformément à la promesse produit (« Kering ouvre ses 14 Maisons »). (Décidé 2026-09-02.)

### D3 — `Job.source` stocke le vrai ATS
`Job.source` (AtsType) doit refléter la **vraie source** (WORKDAY, GREENHOUSE, LVMH_ALGOLIA…), pas la valeur figée `GENERIC_JSONLD`. Corrige la contrainte unique `(companyId, source, externalId)` et le chemin de récupération après course. (Décidé 2026-09-02.)

### D4 — Fresh start, versioning conservé, legacy d'affichage supprimé
On **repart d'une base propre** une fois. On **garde** `pipelineVersion` comme garde-fou des futurs correctifs de schéma. On **supprime** `readableDescription` (nettoyage des vieilles lignes) : les nouvelles lignes sont déjà propres. (Décidé 2026-09-02.)

### D5 — Suppression du legacy à 100 %
Tout code mort / de compatibilité inter-générations / rustine temporaire est **supprimé**, pas conservé « au cas où ». Une décision métier cachée dans du legacy remonte en decision card avant suppression.

### D6 — Ingest découpé par source, purge conditionnelle au succès
Chaque source (ou petit lot) devient un **run court et indépendant**. La purge par génération n'efface une source que **si son fetch a réussi** — jamais en tête de run global. Un flux qui casse n'empêche plus les autres ni ne vide la base. (Décidé 2026-09-02.)

### D7 — Chantier en local d'abord, prod à la fin
Toutes les corrections et la reconstruction de base se font **en local** (Postgres Docker isolé). On ne déploie/relance les crons de prod qu'une fois la plateforme **validée de bout en bout**. Aucune écriture en prod pendant le chantier. (Décidé 2026-09-02.)

### D19 — MONDE par défaut partout (révise D12), et le monde doit être ATTEIGNABLE
Le site affiche **toutes les offres (monde) par défaut** ; le filtre **Pays** restreint (FR, IT…). Révise D12 (« FR par défaut ») : le candidat voyait « France » figé, l'autocomplete ville/titre était câblé `isFrance:true`, et taper « Milan » ne renvoyait rien → les ~26k offres monde étaient **invisibles depuis la barre**. Corrigé : `parseFilters`/`parseCompanyFilters` défaut `country=undefined` ; `suggestCities`/`suggestTitles` sans filtre FR ; champ Lieu vide (placeholder « Ville, région ou pays ») ; sitemap élargi au monde. `isFrance` reste stocké et sert le filtre France. Vérifié : New York → 22, London → 9 (avant : injoignable). (Décidé et validé par Loïc via AskUserQuestion, 2026-09-02.)

### D20 — Page entreprise : barre de filtre légère (ville + contrat)
Une Maison à plusieurs centaines d'offres (Cartier : 1 173) était un mur infini sans filtre. Ajout d'une **barre légère scopée à la Maison** : recherche **ville** + pills **contrat** (facettes réelles), refetch serveur `/api/jobs?maison=…&ville=…&contrat=…` (chaque match vu, pas seulement le slice chargé). Pas la barre complète de `/emplois` (page déjà scopée à une société). Compteur d'offres et facettes de la fiche passés en **monde** pour coller à la liste. (Décidé et validé par Loïc via AskUserQuestion, 2026-09-02.)

### D21 — Attribution UTM : déjà bout-en-bout côté Catwalks, rien à construire
Le tracking « candidat inscrit via Fashion Atlas » est **déjà complet côté Catwalks** (vérifié à la source) : `capturerPremierContact()` (`premier-contact.ts`, monté globalement via `CapturePremierContact.tsx`) lit `utm_source/medium/campaign` à la **première** visite, stocke en `localStorage` sans jamais écraser (premier contact ≠ dernier), et le **backend + PostHog** l'attribuent à l'inscription. Les 3 CTA Atlas (footer, job-detail, landing) portent déjà `?utm_source=fashion-atlas&utm_medium=aggregator` (+ `utm_campaign` par surface). **Aucun dev côté Atlas** au-delà de porter les UTM. _Le code de l'état technique est la source : ne pas re-construire un tracking qui existe._ (Vérifié 2026-09-02.)

### D22 — Le catalogue doit VIVRE : datePosted stable, auto-index Google, expiration → 410/redirect
Constat gravé (vérifié en base 2026-09-02) : **0 offre n'a un `firstSeenAt` > 24h** → la base est wipe+rebuild à chaque run (churn), ce qui réinitialise `datePosted` (lu par Google Jobs) et déstabilise les IDs/URLs. Le correctif code existe déjà (`upsert.ts` estampille `pipelineVersion` à chaque touche, pas qu'au create) — **stabilité vérifiée en prod** (SourceRun : `previousJobs ≈ jobs`, ex. hermes 581→581, sandro 533→533 : les sources conservent leurs offres run-to-run, plus de churn). Décisions Loïc, **implémentées 2026-09-03** : (a) **soumission automatique à l'Indexing API Google** des nouvelles/périmées offres à chaque passe — `googleIndexing.ts`, JWT service-account signé avec `crypto` natif, câblé dans `ingest-all`, **no-op tant que `GOOGLE_INDEXING_CREDENTIALS` + le vrai domaine ne sont pas configurés** (code prêt, dormant) ; (b) **offre périmée → 410 Gone** — `middleware.ts` + `/api/offre-status/[id]` (410+noindex pour fermée, 404 pour inexistante, 200 pour active), vérifié en prod. **Action externe restante** : brancher le vrai domaine + provisionner le service account Google. (Décidé par Loïc 2026-09-03 ; (a) code prêt / (b) live.)

### D23 — La chaîne d'hygiène A→Z : le validateur est la SOURCE, pas un HTTP HEAD
Un agrégateur ne montre que des offres réelles avec des liens vivants. La chaîne (validée avec Loïc) : (1) Maison entre → détection ATS ; (2) ingest depuis l'ATS (Flux A) avec la **bonne URL** (fix adapters Magnet/Workday/Eightfold + propagation `Job.url` aux lignes existantes) ; (3) **VALIDATION = présence dans le feed de la source** — gratuit (on re-crawle déjà), exhaustif, vrai. Un HTTP HEAD par offre est **rejeté comme primaire** : à 14k+ maisons c'est des millions de requêtes souvent bot-bloquées (FashionJobs/WTTJ renvoient 403 en étant vivants → le HEAD ment ; le feed ne ment pas). Le HEAD reste un **filet de sécurité ponctuel**. (4) Lien mort → **re-crawl source d'abord** (self-heal via `refresh.ts` : une offre survit tant qu'une source la re-liste ; fermée seulement quand toutes ses sources sont stale ; ré-ouverte si la source revient). (5) Offre fermée → **410 Gone** (implémenté : `middleware.ts` + `/api/offre-status/[id]` → 410 pour une offre `isActive:false`, 404 pour un id inexistant, `noindex` sur le 410). (Décidé et validé par Loïc, 2026-09-03.)

### D24 — Alerte email Brevo sur source dégradée/en panne (observabilité)
À 14k+ sources, une panne silencieuse est l'ennemi (FashionJobs a tourné 0 fois pendant des jours sans signal). Un **digest email par run** liste chaque source DEGRADED/BROKEN → `loic.melane@catwalks.io`. Déclencheur = **source qui meurt** (0 offre, chute anormale), jamais un email par lien mort (une offre qui ferme = normal et constant). Transport = **Brevo** (le fournisseur que Catwalks utilise déjà — `api.brevo.com/v3/smtp/email`, header `api-key` ; ne pas réinventer). No-op propre si `BREVO_API_KEY` absent. **Config prod requise** : ajouter `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` aux variables Railway du service `catwalks-aggregator` (elles existent côté Catwalks, à recopier — action Loïc). (Décidé et validé par Loïc, 2026-09-03.)

### D25 — Hygiène réseau GLOBALE : politesse par hôte + dégradation gracieuse (pas de patch par adaptateur)
Le même échec revenait partout : plusieurs marques partagent un hôte (`careers.elcompanies.com` pour 6 marques Estée Lauder, `richemont.wd3…` pour toutes les Maisons Richemont, un tenant Beaumanoir, le rate-limiter de Courir), on le martèle en parallèle, il nous throttle (403/405/429), et les offres d'un groupe entier tombent à un blip. **Corriger la cause une fois pour TOUTE requête sortante**, pas par rustine d'adaptateur (règle Loïc, 2026-09-03). Solution : `hostGate.ts` — une **porte par hôte** (concurrence limitée + délai minimum entre requêtes au même hôte + **backoff adaptatif** : un hôte qui throttle voit son délai grandir puis décroître au succès), appliquée dans `fetchWithRetry` ET le transport navigateur (`fetchRenderedHtml`) → **tous les adaptateurs + la découverte 14k en bénéficient automatiquement**. Des hôtes différents ne s'attendent jamais (débit global inchangé). Corollaire : une étape optionnelle qui échoue (ex. `openSession` Eightfold, qui n'est PAS requise — la search API répond 200 sans cookie) **dégrade gracieusement** au lieu de couler la source. (Décidé par Loïc, 2026-09-03 ; implémenté + testé.)

### D8 — Retirer les filtres « 7 jours » et « Confirmées »
Ces deux boutons de la barre n'apportent pas de valeur candidat (« Confirmées » expose un concept interne multi-sources ; « 7 jours » isolé est bancal). Barre finale : Secteur · Contrat · Ville · Maison · Groupe · Source. (Décidé 2026-09-02.)

### D10 — Le site affiche toutes les offres (monde), avec un filtre Pays
Le site n'est plus limité à la France par défaut : il affiche **toutes** les offres actives (10 235 : monde entier), et un **filtre Pays** permet d'affiner (France, Italie, Espagne, Portugal…). `isFrance` reste stocké et sert le filtre « France » ; les autres pays viennent de `country` normalisé. Le mode « zéro filtre France » (rien jeté à l'ingestion) est conservé. (Décidé 2026-09-02.)

### D9 — Logos d'entreprises via DuckDuckGo, fallback initiale
Page Entreprises **et cartes d'offres** : logo via `https://icons.duckduckgo.com/ip3/{domaine}.ico` (gratuit, sans clé, respectueux de la vie privée). Clearbit, initialement retenu, est **mort** (racheté par HubSpot, endpoint fermé, HTTP 000) — remplacé par DuckDuckGo qui répond 200. Le domaine est deviné depuis le nom de la maison. Fallback **pastille avec initiale** si pas de domaine (`onError`). Le logo ne casse jamais l'affichage. (Décidé 2026-09-02, révisé.)

### D17 — L'UI est la DA Catwalks (noir/blanc, 400 UPPERCASE, pills), pas l'habillage Indeed
Lu à la source (skill DA Catwalks : `catwalks-backend/docs/dev-skill/references/design-tokens.md` + `components.md`). Le clone Indeed reste le modèle de **STRUCTURE/UX** (funnel, scroll page, master-detail, infinite scroll) — mais l'**HABILLAGE visuel** est la DA Catwalks, radicalement différente de ce qui a été fait (Indeed : magenta, bold, ombres, radius 12px, transition 0.2s). Règles Catwalks, non négociables :
- **Couleurs : NOIR / BLANC / GRIS uniquement — AUCUNE couleur d'accent.** Le magenta (#C622AB) mis partout est **retiré**. `--color-black #000`, `--color-white #FFF`, `--color-grey-400 #767676` (texte secondaire), `--color-bg #FAFAFA`, `--color-listing-bg #F8F8F8`, `--color-border #E1E1E1`.
- **Typo : TOUJOURS weight 400.** *« c'est la règle fondamentale »*. Le bold (700) est réservé EXCLUSIVEMENT au logo brand. Les **titres de poste sont en MAJUSCULES** (`text-transform: uppercase`), 32px sur la fiche, weight 400, letter-spacing 0.4px. Le nom de maison : 12px uppercase #767676 letter-spacing 1px. Overlines/eyebrows : 11px uppercase #767676.
- **Cartes** : radius 16px, **aucune ombre au repos**, ombre au hover seulement (`0 8px 30px rgba(0,0,0,.08)`). Hero card 32px.
- **Boutons/search/inputs** : `border-radius: 100vmax` (pill), pas 12px.
- **Transitions** : uniquement **0.3s** et 0.6s, easing `cubic-bezier(0.39,0.575,0.565,1)` (ease-lv). Pas de 0.2s (invention Indeed).
- Font `catwalks_font`, letter-spacing 0.4px, header 70px, container 1280px.

La font de marque était déjà mise (D16) ; D17 aligne **couleurs, graisses, casse, radii, ombres, transitions** sur la même DA. *Fashion Atlas porte la DA Catwalks.* (Décidé par Loïc, 2026-09-02, après lecture du skill DA à la source.)

### D16 — Typo = la font de marque Catwalks (`catwalks_font`)
Vu D14 (Fashion Atlas est une marque Catwalks, pas un clone Indeed pixel-perfect), la typo passe de Noto Sans à **`catwalks_font`** — la police propriétaire déjà utilisée par la plateforme Catwalks (`catwalks-website`), self-hébergée via `@font-face` (5 graisses : light/regular/medium/bold/oblique, woff2 dans `/public/fonts`). Le clone Indeed reste le modèle de **structure/UX** (scroll, master-detail, funnel, radii), l'**identité visuelle** est Catwalks. Noto Sans + next/font retirés. (Décidé par Loïc, 2026-09-02.)

### D15 — Fiche entreprise dédiée `/entreprise/[slug]` (corrige le clic cassé, +SEO)
Cliquer une maison menait vers `/?maison=` — cassé (route `/` = landing depuis D14, plus les résultats) et sans vraie fiche. Indeed a une **fiche entreprise riche** (`/cmp/Veolia` : logo, note, avis, salaires, PDG, effectifs, CA, secteur, offres…) — mais ces données (avis, salaires agrégés, dirigeants) **on ne les a PAS**. Décision : construire une **page `/entreprise/[slug]`** avec ce qu'on a réellement — logo, nom, secteur, groupe (`parentGroup`), nb d'offres ouvertes, villes, + la **liste de ses offres** (master-detail comme `/emplois`), description/lien carrière si dispo. Corrige le bug ET crée **~515 pages indexables** (levier SEO majeur, D14) : `/entreprise/chanel`, `/entreprise/dior`… La grille Entreprises et les liens maison pointent vers cette page. (Décidé par Loïc, 2026-09-02.)

### D18 — Le pont candidature : DOUBLE bouton, sans jamais promettre une transmission
La tension réelle (tranchée avec Loïc) : Fashion Atlas agrège des offres publiques d'employeurs (Cartier, Dior…) qui ne sont PAS clients Catwalks. Donc « Postuler » ne peut PAS promettre « on transmet ta candidature à Cartier » — ce serait une **promesse non tenue = tromper le candidat** (interdit par la doctrine). Le modèle honnête retenu = **deux boutons distincts** sur le détail d'offre :
1. **« Postuler chez [Maison] »** → lien DIRECT vers l'employeur (`job.url`), ce que Fashion Atlas fait déjà. Valeur agrégateur, honnête : l'offre Cartier mène chez Cartier.
2. **« Créer mon profil Catwalks »** → `https://catwalks.io/inscription?utm_source=fashion-atlas&utm_medium=aggregator` → onboarding Catwalks (profil + CV, D-134) → matching avec les VRAIES Maisons clientes de Catwalks + « X offres qui matchent ton profil ». Le message ne promet jamais de transmettre à l'employeur de l'offre agrégée ; il promet un **matching actif** avec l'écosystème Catwalks — ce que Catwalks tient réellement.

**Vérifié à la source (catwalks-website)** : `/inscription` existe (page canonique, `AuthForm`, D-134), l'inscription mène à `/onboarding` puis `/mes-jobs`, et le concept d'« offre d'origine » (retour après inscription) existe déjà côté Catwalks. Le pont côté Fashion Atlas = juste les deux CTA + l'URL UTM ; rien à construire côté Catwalks. Domaine Catwalks : **catwalks.io**. Funnel complet : *Agrégateur → référencement SEO → le candidat veut postuler → double choix (direct employeur OU profil Catwalks) → matching Catwalks*. (Décidé par Loïc, 2026-09-02.)

### D14 — Deux marques : « Fashion Atlas by Catwalks » (search) → « Catwalks » (candidat)
Cap stratégique validé par Loïc (2026-09-02). Cet agrégateur devient **Fashion Atlas by Catwalks** : le moteur de recherche gratuit et exhaustif des offres Mode·Luxe·Beauté·Retail (SEO, acquisition, longue traîne — `/jobs/chanel`, `/jobs/paris`, `/companies/dior`…). Sa fonction économique n'est PAS de monétiser directement : c'est **d'alimenter Catwalks en candidats à grande échelle**. **Catwalks** (plateforme distincte, **déjà existante** — dossier à intégrer au workspace) possède le candidat : compte, CV, candidature, matching, et la monétisation B2B côté Maisons (CVthèque, matching, publication premium, ATS léger, abonnement). Résumé : *Fashion Atlas owns the search, Catwalks owns the candidate.*

**Le pont** : Google → Fashion Atlas → offre → « Apply with Catwalks » → **candidature progressive** (email/Google/LinkedIn + upload CV + Apply = compte Catwalks créé automatiquement, PAS d'onboarding de 5 min qui tue la conversion) → « ✅ Application sent · complete your profile » → enrichissement progressif → matching (« 37 other jobs match your profile »). Le candidat ne doit quasiment pas sentir le changement de plateforme.

**Moat** : 30K+ offres indexées + dizaines de milliers de pages SEO + comptes candidats + données comportementales + CV + matching + relations recruteurs — beaucoup plus dur à copier qu'un simple jobboard.

**Impact à cadrer avec Loïc AVANT d'implémenter** (aucune de ces décisions n'est prise seul) : (a) le **nom/branding** du site passe de « Catwalks » à « Fashion Atlas by Catwalks » ; (b) le **domaine** change (avant le SEO) ; (c) la **font** : Noto Sans a été mise pour cloner Indeed — une identité Fashion Atlas propre peut la remplacer, ce qui assume un écart au clone Indeed strict ; (d) le **pont candidature** exige de lire le code réel de Catwalks (à la source) avant conception. (Décidé — cap ; implémentation à cadrer.)

### D13 — Clone Indeed : la PAGE scrolle (pas des panneaux figés)
Objectif validé par Loïc : **clone Indeed**, pas « inspiré ». Mesuré à la source (Playwright sur fr.indeed.com) : Indeed est une **page web qui scrolle naturellement** — `body overflow: visible`, header `static` qui part vers le haut au scroll, **barre de filtres `fixed`** qui reste collée, détail à droite `sticky`. Notre layout actuel est au contraire une **app à hauteur fixe** (`h-dvh`, `overflow-hidden`, header figé, 2 panneaux qui scrollent isolément) — c'est le modèle Gmail, pas Indeed. Décision : **refondre le layout `/emplois` en page scrollable** : plus de `h-dvh`/`overflow-hidden` sur le conteneur, le body scrolle, le header défile avec, la barre de recherche+filtres devient `sticky`/`fixed` en haut, la liste défile, le détail est `sticky` à droite. Mesures Indeed de référence conservées pour valider le comportement de scroll réel, pas seulement les tailles statiques. (Décidé et validé par Loïc, 2026-09-02.)

### D12 — Le site est le modèle INDEED, FR par défaut, sans carte
Le référentiel visuel est **Indeed** (fr.indeed.com), pixel-perfect. (a) **Offres** : liste à gauche + **détail de l'offre à droite** (master-detail), cartes fines et denses SANS logo (le titre mène le scan), auto-sélection de la première offre. (b) **Entreprises** : le modèle Indeed « Meilleures entreprises » (fr.indeed.com/companies) — une **grille de maisons** (logo, nom, secteur, nb d'offres = « Emplois ouverts »), **SANS carte géographique**, cliquer une maison → ses offres. (c) **Périmètre : FR par défaut** — le site montre la France (`isFrance:true`) par défaut, un **filtre Pays** permet d'élargir au monde. La donnée monde reste stockée (SEO/B2B futur), simplement pas affichée par défaut. **Aucune carte** nulle part (Indeed n'en a pas) : le composant JobMap/WorldMap et la mini-carte du détail sont retirés. (Décidé et validé par Loïc après comparaison Playwright Indeed-vs-nous, 2026-09-02. Révise D10 : FR par défaut au lieu de monde par défaut.)

### D11 — Une offre de groupe est créditée à la MARQUE de tête, pas au groupe
Les flux ATS de groupe (L'Oréal Luxe, Puig, Richemont, SMCP…) étiquettent chaque offre « marque de tête +N » (« Cartier +3 », « Dr. Jart+ +13 »), où N compte les autres maisons du flux. Stocké tel quel, ce compteur devient un **nom de société fantôme** que le candidat voit sur des milliers d'offres. Décision : on affiche **la marque** (Cartier, Helena Rubinstein), pas le groupe (Richemont) — _un candidat postule chez Cartier, personne ne cherche « un job chez Richemont »_. Le groupe reste accessible via le **filtre Groupe** (`parentGroup`). Implémenté par `stripMultiBrandSuffix` (retire un « +N » final, préserve le « + » d'un vrai nom comme « Dr. Jart+ ») + `resolveCompany` qui mappe la marque connue vers son orthographe canonique. **Auto-guérit au prochain ingest** ; ~4 900 offres (16 sociétés/151) restent mal étiquetées jusqu'au déploiement. (Décidé et validé par Loïc, 2026-09-02.)

## État vérifié de la prod (2026-09-02) — ce qui NE va pas

Constats lus dans la base et les logs de prod, pas supposés :

1. **La base ne contient que 3 employeurs** (Kering, L'Oréal, Groupe Courir) pour **2 140 offres**, dont **305 seulement en France**. Très loin du marché visé (728 maisons, 93 flux annoncés).
2. **L'ingest meurt avant d'atteindre les flux API.** `runIngest` fait d'abord les sources sitemap (8), puis les flux API (le gros du marché) — mais le run s'arrête pendant les sitemaps (timeout / container tué). Les 22 adaptateurs ATS ne produisent donc **rien en prod**.
3. **L'Oréal = 0 offre France** sur 1 662 offres (bug de parsing de localisation Avature).
4. **WTTJ tronqué** : 59 560 offres à la source, 17 lues, 12 en France.
5. **Puig = 0 offre** (source cassée, silencieuse).
6. **La purge par génération s'exécute AVANT tout fetch, hors transaction, sans garde de succès** → si le fetch échoue après un bump de version, la base reste vide.
7. **`pipelineVersion` n'est écrit qu'au CREATE** → les offres MERGED/attach gardent l'ancienne version et sont re-supprimées au run suivant (churn : `firstSeenAt` et `id` instables). Preuve : 31 offres encore en v4, dont 12 multi-sources.
8. **`SourceRun` est vide** → le monitoring de santé n'a jamais rien enregistré ; l'ingest meurt avant `checkSourceHealth`.
9. **La santé (`health.ts`) se compare à elle-même** (lit `JobSource` live après l'ingest) et n'est **pas** consultée par `refresh` → une source cassée voit ses offres fermées 48 h plus tard sans garde-fou.
10. **`catwalks-reconcile` lance `ingest`** au lieu de `reconcile`.
11. **Zéro test** dans tout le dépôt.

Détail exhaustif des findings (3 audits défensifs, chaque regex exécutée) : voir `AUDIT.md` (à produire).

## Sécurité — points ouverts

- **XSS JSON-LD** : `apps/web/app/offre/[id]/page.tsx` injecte `JSON.stringify(structuredData)` dans un `<script>` sans échapper `</script>` → titre/description d'une source hostile peut casser hors du script.
- **SSRF** : `lib/http.ts` / `ats/detect.ts` fetchent des URLs issues de Serper / HTML / CSV sans valider le schéma ni bloquer les hôtes internes.
- **Clé Algolia LVMH** codée en dur (`lvmhAlgolia.ts`) — clé publique de secours, à documenter comme telle.

## Tests

- **Unitaires** (sans base) : `npm run test:unit -w @catwalks/aggregator` — normalizers, france, html, ssrf, geocode.
- **Intégration** (base dédiée) : `DATABASE_URL=…/catwalks_test npm run test:integration -w @catwalks/aggregator` — purge, santé, refresh.
- ⚠️ **Les tests d'intégration VIDENT la base.** Ils ne tournent QUE sur une base dont le nom contient « test » (garde `src/test/setup-integration.ts` qui refuse sinon). **Ne jamais** les lancer sur la base de démo/prod. Base de démo locale = `catwalks`, base de test = `catwalks_test` (même conteneur Docker `catwalks-audit-pg`, port 55440).

## Règles git — toutes les sessions, sans exception (décidé par Loïc, 2026-09-03)

> Contexte : plusieurs sessions Claude travaillent en parallèle dans le MÊME
> working tree. Un `git reset --hard` d'une session a effacé le travail non
> commité d'une autre. Et Railway auto-déploie `origin/main` à chaque push.

- **Interdits** : `git reset --hard`, `git checkout -- .`, `git clean`,
  `git stash drop`, `git push --force` sur toute branche partagée. En cas de
  besoin réel : `git stash push -m "<session> <raison>"` et on en parle.
- **`git status` obligatoire avant tout changement de branche.** Si des
  fichiers modifiés ne sont pas à toi, tu ne bouges pas (préférer
  `git worktree add` pour travailler sur une autre branche sans toucher le
  tree partagé).
- **Une session = un périmètre de fichiers.** Web : `apps/web`. Pipeline :
  `apps/aggregator`, `packages/db`, `data/`. Aucun commit hors périmètre ;
  fichiers racine partagés (CLAUDE.md…) : prévenir l'autre session d'abord.
- **Push à chaque fin d'étape.** Jamais de travail local non poussé de plus
  d'une heure.
- **`main` = prod (Railway auto-déploie chaque push).** Tout passe par une
  branche + PR ; merge par Loïc uniquement.

## Méthode de travail

1. **Audit défensif** (fait, 3 passes parallèles + vérif prod).
2. **Boucle obligatoire par correctif** : reproduction (test/BDD) → correction → audit défensif → tests de non-régression → validation. Après chaque correction : audit défensif / BDD → validation → correction suivante.
3. **BDD** : formaliser les comportements attendus en scénarios vérifiables (socle de tests à créer — aujourd'hui absent).
4. Rien n'est « corrigé » parce que ça paraît logique : **preuve d'exécution** exigée.
