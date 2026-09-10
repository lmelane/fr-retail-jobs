# Audit défensif Catwalks Intelligence — Axe 1 : vérité des chiffres

Date : 2026-09-06 (15:45 → 16:10 UTC). Lecture seule, aucune correction, aucun commit.
Base : copie locale `postgresql://catwalks:catwalks@localhost:55440/catwalks` (conteneur `catwalks-audit-pg`, requêtes via `docker exec … psql`).
Serveur : `npm run dev -w @catwalks/web -- -p 3111` sur cette base, coupé à la fin (port 3111 libre, vérifié par `lsof`).
Le rapport du constructeur (`w-intelligence-rapport.md`) a été lu comme piste ; chaque chiffre ci-dessous a été re-mesuré.

## Méthode

1. `curl` de 18 URL (200 sur 17 ; `/intelligence/groupes/lvmh` → **404** : aucune société de la copie locale n'a `parentGroup = 'LVMH'`, le seul groupe est « Hermes » — testé sur `/groupes/hermes` à la place).
2. HTML → texte brut (script maison, `<main>` seul, scripts/styles/SVG retirés), tous les nombres relevés à la main.
3. Recalcul **par SQL brut** sur `Job`/`Company`/`Source`/`MarketSnapshot` (pas la lib) : une table temporaire `iso` re-plie les 68 graphies de `Job.country` sur un code ISO avec une table `CASE` indépendante de `lib/countries.ts`, puis agrégats par pays, ville, Maison, groupe, secteur, contrat.
4. Grep des littéraux numériques dans `app/intelligence`, `components/intelligence`, `lib/intelligence`.
5. Parité de la taxonomie : les 25 clés de `lib/intelligence/taxonomy.ts` existent toutes dans `apps/aggregator/src/normalize/taxonomy.ts` (boucle grep, 0 absente).

État de la copie locale (SQL) : **1 996 offres actives + 1 inactive** (`closedAt` NULL), toutes `firstSeenAt` le 2026-09-02, `max(lastSeenAt)` = 2026-09-02 11:28 UTC, **7 Maisons**, 1 groupe, `jobFunction`/`seniority`/`skills`/`isRetail`/`reopenedCount` à 0 partout, `MarketSnapshot` = **1 seul jour** (2026-09-06, 208 lignes ; global : 1 996 actives, 0 nouvelle, 0 fermée, 7 Maisons).

---

## Verdict

**Le socle tient** : sur ~320 nombres relevés, tous les comptes (actives, nouvelles, Maisons, villes, secteurs, contrats, sources), toutes les parts (≈ 110 pourcentages, contrôlés un par un contre la division SQL, arrondi fr-FR compris), les 7 phrases « Lecture Catwalks », les dates de couverture (`max(lastSeenAt)` = 2 sept., premier snapshot = 6 sept.) et toutes les dates « disponible à partir du … » (7, 13 sept., 2 et 6 oct., 5 déc., 5 mars 2027, 6 sept. 2027) sont exacts. Aucun indice, momentum, variation, intensité ou croissance n'est affiché avec 1 seul snapshot. Aucun nombre codé en dur dans les pages.

**Mais trois nombres mentent au lecteur**, dont un sur toutes les pages Maison :

| # | Gravité | Constat | Statut |
|---|---|---|---|
| 1 | **CRITIQUE** | « Pays » d'une Maison / d'un groupe = **plafonné à 15** par une limite d'affichage : Cartier affiche 15 pays, elle en a **33** ; Hermès 15 → **25** ; APM Monaco 15 → **18** ; groupe Hermes 15 → 25. Aussi dans la `meta description`. | CONFIRMÉ |
| 2 | **CRITIQUE** (local) / **HAUT** (prod) | Pays non replié : « Turkey » et « Czech Republic » → `null` (Intl v26 dit « Türkiye »/« Czechia »). Turquie affichée **2** au lieu de **5**, Tchéquie **1** au lieu de **2**, « 42 offres sans pays » au lieu de **38**, Hermès « 4 offres sans pays identifié » alors qu'elle en a **0**. | CONFIRMÉ |
| 3 | **HAUT** | Colonne « Maisons » par pays = somme des graphies (« borne haute ») : **États-Unis 6** sur la home et `/geographies`, **5** sur `/pays/US` (vrai : 5). | CONFIRMÉ |
| 4 | MOYEN | `/marche` : deux « Nouvelles · 30 j » sur la même page, **1 996** (KPI, actives) et **1 997** (tableau, toutes offres) ; l'offre inactive sans `closedAt` n'est comptée « fermée » nulle part → Solde net **+1 997** ≠ 1 996 actives, inexplicable pour le lecteur. | CONFIRMÉ |
| 5 | MOYEN | La méthodologie promet « métrique dérivée affichée à partir de 30 offres **dans le périmètre** » ; « Part du marché mondial » (étiquetée dérivée) s'affiche à 21 offres (`/pays/BE` 1,1 %), 22 (`/villes/us-new-york`), et **0** (`/metiers/retail-client-advisor` : 0,0 %). | CONFIRMÉ |
| 6 | MOYEN | `HISTORY_START = '2026-09-06'` gravé dans `format.ts` : sans snapshot, toutes les pages annonceraient « historique dès le 6 sept. 2026 » quelle que soit la date réelle du premier snapshot prod. | CONFIRMÉ (code) |
| 7 | MOYEN | Clé de série pays : le pipeline écrit `key = Job.country` (ignore `isFrance`), le web lit `'FR'` et compte la France par `isFrance`. En local aucune série pays n'est trouvable (clés « France », « fr »). En prod, alignement **à vérifier** (`isFrance AND country <> 'FR'` doit être 0). | PROBABLE |
| 8 | BAS | Blocs étiquetés « Fait observé » (Top pays, Top Maisons, Secteurs, Contrat…) contiennent des parts dérivées (34,6 %…) sans étiquette « Métrique dérivée » ; les seuils sont respectés, la séparation visuelle non. | CONFIRMÉ |
| 9 | BAS | Le H1 dit « En direct. » et le lede « mesuré chaque jour » alors que la ligne de couverture dit « mis à jour le 2 sept. » (4 jours) — en prod les crons sont gelés (D35/D36). | CONFIRMÉ |

---

## Preuves, constat par constat

### 1. « Pays » d'une Maison plafonné à 15 — CRITIQUE

Affiché (`/intelligence/maisons/cartier`, lede + tuile KPI + `<meta name="description">`) : « 1 173 offres actives, **15 pays**, 10 villes ». Idem Hermès « 15 pays », APM Monaco « 15 pays », `/groupes/hermes` « 15 pays ». AMI Paris « 3 pays » (sous le plafond).

SQL (table `iso`, pays distincts par Maison, offres actives) :
```
Cartier      | 33 pays | 0 sans pays | 1173
Hermès       | 25      | 0           |  547   (23 sous le repli du web, cf. §2)
APM Monaco   | 18      | 0           |   84
Polène       | 13      | 0           |   76
Groupe Courir|  4      | 0           |   57
AMIRI        |  0      | 38          |   38
AMI Paris    |  3      | 0           |   21
```
Cause, lue dans le code : `lib/intelligence/queries/profile.ts:49` pose `lim = { countries: 15, … }` et ligne 70 `countries: countries.rows.slice(0, lim.countries)` ; `app/intelligence/maisons/[slug]/page.tsx:51` (`Kpi "Pays" value={fmtInt(profile.countries.length)}`), ligne 60 (lede) et ligne 28 (`generateMetadata`) lisent la **longueur de la liste tronquée**. Même chemin sur `groupes/[slug]/page.tsx:25,44` et `metiers/[key]/page.tsx:50`. Trois Maisons différentes qui affichent exactement 15 est le symptôme. Le compte exact existe déjà dans `byCountry` (`rows.length` avant `slice`) : c'est un bug d'affichage, pas de données.

### 2. « Turkey » / « Czech Republic » non repliés — CRITIQUE en local, HAUT en prod

Affiché (`/geographies`, carte de la home via `aria-label`, `/maisons/hermes`) : « Turquie 2 · 1 Maisons », « Tchéquie 1 · 1 Maisons », « 42 offres sans pays identifié », Hermès « 4 offres sans pays identifié ».

SQL :
```
Cartier | Tchéquie        | 1     Cartier | Turquie | 2
Hermès  | Czech Republic  | 1     Hermès  | Turkey  | 3
country IS NULL (actives) : 38 (toutes AMIRI)
```
Vérité : Turquie **5 offres, 2 Maisons** ; Tchéquie **2 offres, 2 Maisons** ; sans pays **38** ; Hermès **0** sans pays.

Preuve d'exécution du repli du web (`npx tsx`, `lib/countries.ts` réel, Node v26.7.0) :
```
"Czech Republic" -> null
"Turkey"         -> null
Intl en TR = Türkiye | en CZ = Czechia
```
`countryCode()` s'appuie sur `Intl.DisplayNames(['en'])` : le libellé anglais de TR est « Türkiye » et celui de CZ « Czechia » depuis les ICU récents — la sortie **dépend de la version de Node du conteneur**. En prod, `Job.country` est ISO-2 après ré-attestation (D37) et le chemin « 2 lettres » du repli suffit ; mais toute ligne non ré-attestée (D37 : les 3 829 lignes NON re-vues gardaient un pays non ISO) tombera « sans pays » sur une simple différence de libellé. Le constructeur avait vu « 4 graphies inconnues » sans les nommer ni compter l'effet.

### 3. « Maisons » par pays = somme sur les graphies — HAUT

Affiché : home « Top pays » → « États-Unis · **6 Maisons** » ; `/geographies` colonne Maisons US = **6** ; `/pays/US` : « 296 offres actives, **5 Maisons** ».
SQL (`count(DISTINCT companyId)` par ISO) : US = **5**. Simulation de la somme par graphie (« États-Unis d'Amérique » + « United States » + « USA ») = 6 → c'est bien l'origine (`facts.ts:162-164`, commentaire « borne haute »). Seul pays touché en local ; en prod (ISO), non reproductible, mais le mécanisme reste : deux nombres différents pour la même question selon la page. La méthodologie le déclare en « Limites » — un nombre faux annoncé reste un nombre faux.

### 4. `/marche` : 1 996 vs 1 997, et l'offre inactive invisible — MOYEN

Affiché : KPI « Nouvelles · 30 j **1 996** » ; tableau « 30 jours · Nouvelles **1 997** · Fermées 0 · Solde net **+1 997** » ; « Aujourd'hui 0 ».
SQL : `Job` total = 1 997 ; `firstSeenAt ≥ now()-7d` : actives 1 996, inactive 1. L'inactive (`cmtjxzv4t000d3ne36c0xb9jd`, « Stockista / Stock Keeper … », Groupe Courir) a `closedAt = NULL` → jamais comptée « fermée » (`closedFacts`/`windowFacts` filtrent sur `closedAt`). `market.ts:44` compte toutes les offres, `headline` seulement les actives : même libellé, deux définitions, non documentées côte à côte. En prod, le refresh écrit-il toujours `closedAt` ? (Axe 2.)

### 5. Seuil « 30 offres dans le périmètre » non tenu par « Part du marché mondial » — MOYEN

Méthodologie (`/methodologie`, bloc Seuils) : « Une métrique dérivée n'est affichée qu'à partir de 30 offres dans le périmètre ». Affiché : `/pays/BE` (21 offres) « Part du marché mondial 1,1 % — Métrique dérivée » ; `/villes/us-new-york` (22) « 1,1 % » ; `/metiers/retail-client-advisor` (**0** offre) « 0,0 % ». `metrics.ts:96` seuille sur le **total** (dénominateur), pas sur le périmètre. Les autres dérivées (concentration, repost) rendent bien n/d sur les mêmes pages. Les nombres sont exacts (21/1 996 = 1,05 %), c'est la règle annoncée qui n'est pas celle appliquée.

### 6. `HISTORY_START` gravé — MOYEN

`lib/intelligence/format.ts:13` : `export const HISTORY_START = '2026-09-06'` ; `queries/coverage.ts:33` : `historyStart: firstSnapshot ?? HISTORY_START`. Tant que `MarketSnapshot` est vide en prod, la couverture dit « historique dès le 6 sept. 2026 » et toutes les dates « disponible à partir du 7/13 sept. » en découlent, quelle que soit la date réelle du premier snapshot. Sur la copie locale le snapshot du 6 sept. existe, donc l'affichage est juste ici ; le risque est prod.

### 7. Clés de série pays / ville — PROBABLE (prod à vérifier)

`snapshot.ts:170` `country: key = country` ; `:171` `city: country || '|' || city`. Le web (`profile.ts` via `pays/[code]`) lit `series('country', 'FR')` et compte la France par `isFrance`. Local : clés écrites « France » (644), « fr » (47), « France|Paris »… → aucune page pays/ville n'aura jamais de série ici, et « Où le recrutement accélère » restera vide même avec 8 jours. En prod, si `country = 'FR'` pour toute offre `isFrance` ET que la casse de `city` est stable, ça s'aligne. Requête à passer en prod avant déploiement : `SELECT count(*) FROM "Job" WHERE "isActive" AND (("isFrance" AND country IS DISTINCT FROM 'FR') OR (NOT "isFrance" AND country = 'FR'))` → doit être 0 ; et vérifier qu'aucune ville n'a deux casses dans un même pays (0 cas en local, vérifié).

### 8. Parts dérivées dans des blocs « Fait observé » — BAS

`BarList` (`charts/bar-list.tsx:26`) et `Mix` (`chrome.tsx:134`) impriment `fmtPct(value/total)` dès que `total ≥ 30`, dans des blocs `level="fact"` (Top pays, Top Maisons, Secteurs, Contrat, Séniorité). Seuil respecté, étiquette absente. Note annexe (Axe 4) : dans le DOM, valeur et part sont dans le même `span` sans séparateur → un lecteur d'écran lit « 69134,6 % ».

### 9. « En direct. » — BAS

H1 de la home « Le marché mondial du recrutement luxe. En direct. », lede « mesuré chaque jour » ; ligne de couverture « mis à jour le 2 sept. 2026 » (= `max(lastSeenAt)`, exact). Ce n'est pas un nombre faux, c'est une promesse de fraîcheur que les crons gelés ne tiennent pas aujourd'hui.

---

## Ce qui est exact (preuves)

**Faits globaux** (home, marché, couverture de chaque page) : 1 996 actives · 1 996 nouvelles 30 j · 0 sur 24 h · 7 Maisons · 38 pays · 133 villes · 42 sans pays (exact **selon le repli du web**, cf. §2) · 0 fermées · 0 ré-ouvertes · « mis à jour le 2 sept. 2026 » · « historique depuis le 6 sept. 2026 » — SQL identique (requête `headline` rejouée à la main ; 133 = `count(DISTINCT lower(city))`, et = `count(DISTINCT (iso, lower(city)))` : aucune collision inter-pays).

**Classement des 38 pays** (`/geographies`) : les 38 volumes recalculés par la table `iso` sont identiques (FR 691, US 296, CH 169, KR 86, JP 82, IT 66, DE 58, AU 53, GB 51, AE 47, SG 46, HK 42, PT 41, TW 33, SA 29, TH 22, BE 21, CA 18, MX 18, MY 14, ES 13, NL 11, AT 7, GR/IN/MC/VN 5, ID 4, MO 3, BR/CN/DK 2, ZA/IE/LU/NZ 1) **sauf TR et CZ (§2)** ; somme 1 954 + 42 = 1 996. Colonne Maisons exacte sur 37 pays sur 38 (§3). Parts : 38/38 exactes (ex. 47/1 996 = 2,35 → « 2,4 % »).

**Top villes monde (30)** et **top villes France (10)** : comptes et « N Maisons » identiques au SQL (Paris 335/5, Pantin 150/1, New York 22, Seoul 17, Lyon 14, Manhattan 14, Le Pré-Saint-Gervais 13/2, …, Grenoble 4 et Thiais 4 sous la graphie « fr » correctement repliées). `/pays/FR` 78 villes, `/pays/US` 15, `/pays/BE` 2 (Brussels 5, KORTRIJK 1), Cartier 10, Hermès 92, APM 4, AMI 5 — tous exacts.

**Maisons / secteurs / groupes** : Cartier 1 173, Hermès 547, APM 84, Polène 76, Courir 57, AMIRI 38, AMI 21 ; Horlogerie & Joaillerie 1 257 (2 Maisons), Mode 682 (4), Retail 57 (1) ; Hermes 547 (1) — exacts. `/secteurs` : top pays et top Maisons par secteur (Mode FR 419 / US 82 / KR 18 ; H&J FR 225 / US 214 / CH 163 ; Retail FR 47 / ES 6 / IT 3 ; Cartier 93,3 % / APM 6,7 % ; Hermès 80,2 % / Polène 11,1 % / AMIRI 5,6 %) — exacts, `null` pays bien ignoré (38 offres Mode sans pays).

**Profils** : `/pays/FR`, `/pays/US`, `/pays/BE`, `/villes/fr-paris`, `/villes/us-new-york`, Cartier, Hermès, APM, AMI, groupe Hermes — top pays (10), top villes (10), top Maisons, secteurs, contrats : chaque compte égal au SQL et chaque répartition somme au total (ex. Cartier contrats 897+189+38+26+14+8+1 = 1 173 ; Paris 136+91+53+26+19+9+1 = 335). Concentration « 100,0 % · N employeurs au total » vraie (N < 10). Part du marché mondial : 691/1 996 = 34,6 · 296 = 14,8 · 335 = 16,8 · 1 173 = 58,8 · 547 = 27,4 · 84 = 4,2 · 21 = 1,1 — exacts.

**Lectures Catwalks** (7 phrases, toutes portées par des nombres affichés à côté) : « Paris concentre 48 % … (335 sur 691) » = 48,5 ; « Hermès porte 52 % » = 51,9 ; « New York concentre 7 % (22 sur 296) » = 7,4 ; « Cartier porte 71 % » = 71,3 ; « Cartier porte 54 % » (Paris) = 54,3 ; « Pantin concentre 27 % (150 sur 547) » = 27,4 ; « Hermès porte 100 % » — exactes. Aucune phrase d'insight sans donnée ; le bloc « Ce qui a changé cette semaine » est un placeholder daté (13 sept.).

**Tendances / indices** : CGHI, momentum, Δ actives, Δ Maisons, sous-indices sectoriels, familles dans le temps, courbes, intensité 90 j, croissance 30 j, momentum par Maison, « où le recrutement accélère » — **tous n/d datés** avec 1 snapshot ; les dates sont `series[0].date + n` (6 sept. + 1 = 7 sept., + 7 = 13 sept., + 30 = 6 oct., + 90 = 5 déc., + 180 = 5 mars 2027, + 365 = 6 sept. 2027) et « Nouveaux marchés » = `firstJobSeen` + 30 = 2 oct. — vérifiées. Base 100 « le 6 sept. 2026 » = date du snapshot global. Fenêtres « · depuis le 2 sept. 2026 » = `min(firstSeenAt)`, exact.

**Seuils** : `/pays/BE` (21), `/villes/us-new-york` (22), `/maisons/ami-paris` (21), `/metiers/retail-client-advisor` (0) → concentration, médiane, repost en « n/d — échantillon insuffisant », parts de Mix remplacées par « Parts non affichées : moins de 30 offres », `<meta name="robots" content="noindex, follow">` présent sur ces 4 pages et absent sur FR/US/Cartier/Hermès/APM/Paris. « Non classé » : 1 996 (100 %) partout, ligne dédiée sur `/metiers` avec part, top pays (France · États-Unis · Suisse) et top Maisons (Cartier · Hermès · APM Monaco) exacts ; `/methodologie` « métier renseigné sur 0 %, séniorité sur 0 % » exact.

**Méthodologie** : 416 sources ACTIVE et les 23 familles (teamtailor 117 … phenom 1) identiques à `SELECT kind, count(*) FROM "Source" WHERE status='ACTIVE'`. « fermée … pendant 48 h » = `REFRESH_STALE_HOURS ?? 48` (`refresh.ts:26`). « Les 25 métiers » = 25 entrées de `JOB_FUNCTIONS`, toutes présentes dans la taxonomie du pipeline.

**Littéraux numériques** (grep) : seuls des seuils exportés (`MIN_SAMPLE 30`, `MIN_SNAPSHOT_DAYS 2`), des fenêtres (7/30/90/180/365), des limites de liste, des libellés (« 25 métiers », « 48 h », formule du momentum) et `HISTORY_START` (§6). Aucun compte ni pourcentage en dur dans une page. JSON-LD `Dataset` : `spatialCoverage "38 pays"`, `keywords "1996 offres"`, `dateModified 2026-09-02T11:28:04Z`, `temporalCoverage 2026-09-06/..` — cohérents avec la base.

---

## Non testable en local (à faire en prod avant déploiement)

- `/intelligence/groupes/lvmh` : 404 ici (pas de LVMH dans la copie) — vérifier en prod que la page rend et que « N Maisons » = `count(DISTINCT companyId)` du groupe.
- §2 et §7 dépendent de la normalisation ISO de `Job.country` en prod : passer la requête du §7 et `SELECT country, count(*) FROM "Job" WHERE "isActive" AND country !~ '^[A-Z]{2}$' GROUP BY 1` ; toute ligne renvoyée sera « sans pays » ou mal repliée sur le site.
- Les pages sont mémorisées 1 h (`unstable_cache`) : un chiffre peut être en retard d'une heure sur la base, ce que la ligne « mis à jour le … » (calculée dans le même cache) ne montre pas — acceptable, à connaître.

## Fichiers en cause

- `apps/web/lib/intelligence/queries/profile.ts` (l. 49, 70) et `apps/web/app/intelligence/maisons/[slug]/page.tsx` (l. 28, 51, 60), `groupes/[slug]/page.tsx` (l. 25, 44), `metiers/[key]/page.tsx` (l. 50) — §1.
- `apps/web/lib/countries.ts` (l. 66-83, 98-106) — §2.
- `apps/web/lib/intelligence/facts.ts` (l. 146-167) — §3.
- `apps/web/lib/intelligence/queries/market.ts` (l. 44-45) et `facts.ts` (l. 133-144) — §4.
- `apps/web/lib/intelligence/metrics.ts` (l. 96-99), `apps/web/app/intelligence/methodologie/page.tsx` (l. 120) — §5.
- `apps/web/lib/intelligence/format.ts` (l. 13), `queries/coverage.ts` (l. 33) — §6.
- `apps/aggregator/src/pipeline/snapshot.ts` (l. 170-171) vs `apps/web/lib/intelligence/facts.ts` (l. 93-100) — §7.

Traces d'exécution : `scratchpad/html/*.html|.txt` (18 pages), `scratchpad/q1..q4.sql` (requêtes rejouables), `scratchpad/map.ts` (repli pays).
