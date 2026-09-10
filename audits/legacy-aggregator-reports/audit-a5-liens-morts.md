# Audit a5 — liens morts, offres périmées encore affichées, relance des bonnes cibles

Date : 2026-09-06, 11:24 → 11:45 UTC. Lecture seule sur la base de prod (`sakura.proxy.rlwy.net`, SELECT uniquement via `src/discovery/a5-sql.mts`), sonde HTTP par `fetchWithRetry` (porte par hôte, 1 tentative, User-Agent Chrome) sur 260 URLs, site `https://modecareers.com` par `curl`, reproduction locale du site (build standalone) branchée en lecture sur la base de prod.

Doctrine appliquée (D23) : la validation primaire d'une offre est sa **présence dans le feed de sa source** ; le GET par offre est un filet ponctuel, jamais la règle. Chaque chiffre porte son heure : une autre session écrivait en prod pendant l'audit (`retire-source` des routes du registre, commit `03cb6c3` poussé à 11:28) — offres actives **73 494 à 11:24**, **72 710 à 11:39**.

Scripts (lecture seule) : `src/discovery/a5-sql.mts`, `a5-sample.mts`, `a5-probe.mts`, `a5-lvmh-feed.mts`. Verdicts bruts : `data/a5-probe-main.json` (200), `a5-probe-stale.json` (40), `a5-probe-old.json` (20).

---

## 1. Mesures en base (11:24 UTC, 73 494 actives / 1 810 fermées / 493 sources ACTIVE)

| Population | Mesure | Lecture |
|---|---|---|
| Actives `lastSeenAt` > 48 h | **512** (toutes entre 48 h et 96 h ; 0 au-delà) — 807 autres entre 24 et 48 h | 512 offres que le refresh (gelé depuis le 06/09 05:32) aurait déjà fermées. Toutes mono-source, JobSource encore active. 64 sources, toutes au dernier run **OK** (sauf l-oreal-professionnel, BROKEN) |
| … par source | fashionjobs 168 · michael-page-france 83 · l-oreal-professionnel 32 · lvmh 29 · nike 26 · decathlon 16 · normal 11 · hans-anders 11 · lovisa 10 · sandro 9 · kering 8 · clarkson-eyecare 8 · courir 7 … | fashionjobs : 991 actives, 153 lues/run, curseur revenu en page 1 à 08:58 → une rotation complète sans revoir ces 168 = elles ne sont plus listées |
| Sources BROKEN/TIMEOUT/ERROR depuis ≥ 3 runs | **0** | — |
| Source BROKEN au dernier run | **l-oreal-professionnel** : `BROKEN 0 (prev 1 716)` à 10:17, après 5 runs OK à 1 716 (02:15 → 09:51). 1 782 offres actives portées | Run isolé de 10:17 (hors run global) : à confirmer par un re-run ; le refresh exclut la clé tant qu'elle est BROKEN (offres conservées) |
| Clés de JobSource sans ligne `Source` ACTIVE | à 11:24 : `decathlon` 138 actives, `wttj` 32, `iwc-schaffhausen-3` 0/441 — à 11:39 : **plus aucune** (retirées par l'autre session, `03cb6c3`) | Clos pendant l'audit |
| `validThrough` passé | **15** (FashionJobs 7, GENERIC_JSONLD 5, SuccessFactors 3 ; toutes < 7 jours) sur 2 935 actives qui en portent une | Voir M-1 : personne ne lit ce champ |
| `postedAt` > 180 j | **7 387** (> 365 j : 3 434 ; > 730 j : 1 234 ; plus ancien : 2014-05-08). ulta-jibe 2 731, foot-locker 466, mango 462, luxe-talent 460, pvh 317… — **toutes re-vues < 24 h** sauf 27 | L'âge n'est pas un signal de mort ici (voir §2.3 : 20/20 vivantes) |
| Actives **sans aucune JobSource active** | **1 849** (0 sans JobSource du tout ; 1 849 re-vues < 24 h) — element-6 386, jean-paul-gaultier-5 220, a-derma-4 208, aptar-beauty 194, conde-nast-france 138… | Re-mesure du B-1 de l'audit a2 (1 855 à 10:04). Ce sont des offres **vivantes** que le prochain `refresh` fermera (`refresh.ts` L150-160) |
| `refresh` lancé maintenant (48 h, hors BROKEN) | fermerait **527** offres (fashionjobs 170, michael-page 86, richemont 38, lvmh 30, nike 27, decathlon 17…) **+ les 1 849** ci-dessus | ≈ 2 376 fermetures dont ~1 850 à tort |
| Fermées dont `lastSeenAt` < 72 h | 1 475 / 1 810 | Cycle de vie actif jusqu'au gel |

---

## 2. Sonde réelle (11:28 → 11:34 UTC)

### 2.1 Échantillon principal — 40 sources les plus volumineuses × 5 offres actives tirées au hasard = 200

Verdicts bruts : `200_visible` **184** · `200_expiree` 6 · `404` 5 · `403_waf` 5 · 3xx-vers-liste 0 · 410 0. Après vérification manuelle de chaque verdict non-visible :

| Source | 5 sondées | Verdict réel | Preuve |
|---|---|---|---|
| **normal** (Teamtailor, 478 actives) | **5/5 → 404** | Lien mort sur offre **vivante** (458/478 re-vues < 24 h) | `https://jobs.normal.eu/jobs/8288459-…` → 404 ; la même offre sur `https://jobs.normal.no/jobs/8288459-…` → **200** ; `jobs.normal.fr/jobs/8315622-…` → 200 vs `.eu` → 404 |
| **foot-locker-france** (Phenom, 2 842 actives) | 5/5 « expirée » | **Faux positif** de la sonde, mais **mur de connexion** : l'URL stockée est `…icims.com/jobs/<id>/login` (2 842/2 842) | `/jobs/69861/login?in_iframe=1` → `<title>Login</title>`, 0 occurrence du titre ; `/jobs/69861/job?in_iframe=1` → `<title>Sales Associate in Tampa, Florida…</title>`, 17 occurrences |
| **fashionjobs** (991 actives) | 4/5 → 403 Cloudflare, 1/5 « expirée » | Indéterminable en HTTP (connu : seul Chromium passe) ; la 5ᵉ a pour `Job.url` le formulaire LVMH (canonique lvmh) et est **présente** dans le feed LVMH (id 1091219) | `a5-lvmh-feed.mts` : `1091219 PRÉSENT` |
| mango (Workday) | 1/5 → 403 | Throttle ponctuel (4 autres 200) | — |
| 36 autres sources | **5/5 visibles** chacune | — | lvmh, ulta-jibe, michael-page, tapestry, pandora, ELC, l-oreal-pro, boots, pvh, richemont-workday, levis, nordstrom, parfums-chanel, rituals, adidas, kering, hm-group, primark, lovisa, courir, nike, saks, bloomingdales, la-casa-de-las-carcasas, hermes, stripe-stare, aritzia, sandro, lacoste, capri, swarovski, crocs, luxe-talent, stone-by-stone, richemont, tiffany |

**Offres réellement mortes dans l'échantillon frais : 0 / 195 déterminables.** Mais **2 sources sur 40 envoient le candidat dans un mur** (404 ou login) sur 100 % de leurs offres.

### 2.2 Échantillon « stale » — 40 offres actives non re-vues depuis > 48 h

`410` **14** · `404` 5 · absente du feed 1 · `200_visible` 11 · `403_waf` 9 (fashionjobs 7, nike 1, chanel 1).

| Source | sondées | mortes | vivantes | preuve |
|---|---|---|---|---|
| michael-page-france | 14 | **12** (410) | 2 | `https://www.michaelpage.fr/job-detail/…/ref/jn-072026-7070650` → 410 |
| l-oreal-professionnel | 4 | **3** (404) | 1 | `https://careers.loreal.com/en_US/jobs/JobDetail/Retail-Store-Manager/247206` → 404 |
| lvmh | 3 | **1** | 2 | id 1088046 : **ABSENT** du feed LVMH (5 490 offres) ; la page `lvmh.com/rac/csod/prod/apply.html` est une appli JS dont le libellé d'erreur est « Cette offre n'est plus disponible » |
| lovisa / merkal (Teamtailor) | 2 / 1 | 1 / 1 (410) | 1 / 0 | — |
| blueland (Lever) | 1 | 1 (404) | 0 | — |
| normal | 1 | 1 (404 = défaut d'URL) | — | — |
| sandro 3, funky-buddha 1, crocs 1 | 5 | 0 | 5 | vivantes mais non re-listées depuis le 04/09 |

**20 mortes / 31 déterminables = 65 %.** Les 168 fashionjobs (indéterminables en HTTP) n'ont pas été revues pendant une rotation complète du curseur : par D23, elles ne sont plus listées.

### 2.3 Échantillon « anciennes » — 20 offres actives `postedAt` > 2 ans

**20/20 visibles** (ulta-jibe 9, ion 2, luxe-talent 2, aritzia, laverana, levis, hot-topic, kering, buck-mason, via). `postedAt` chez Jibe/WordPress/Greenhouse est la date de création de la réquisition, pas de publication : **ne pas fermer sur l'âge**.

### 2.4 Estimation étayée des offres mortes encore affichées (à 11:24, 73 494 actives)

- **Stale > 48 h : 512 × 65 % ≈ 330** (fourchette 300–400 en comptant les 168 fashionjobs comme délistées). Toutes seraient fermées par un `refresh` — c'est le gel des crons qui les maintient à l'écran.
- **Fraîches (< 48 h) : 0 / 195 déterminables** → borne haute 1,5 % (règle de trois) ≈ 1 100, estimation ponctuelle ≈ 0.
- **Total : ≈ 330 offres mortes affichées (0,45 %)**, auxquelles s'ajoutent **3 320 offres vivantes dont le lien « Postuler » est cassé** : normal 478 (404) + foot-locker-france 2 842 (mur de connexion).

---

## 3. Le site : `/api/offre-status` et `/offre/<id>` (11:24 → 11:44 UTC)

| Test | Attendu (D22) | Mesuré |
|---|---|---|
| `/api/offre-status/<id fermée>` × 10 | `closed` | 10/10 `{"status":"closed"}` (HTTP 200) ✓ |
| `/api/offre-status/<id active>` × 10 | `active` | 10/10 ✓ |
| `/api/offre-status/<id inexistant>` | `missing` | `{"status":"missing"}` (HTTP 200 par conception, la page fait le 404) ✓ |
| `/offre/<id inexistant>` | 404 | 404 ✓ |
| `/offre/<id active>` × 10 | 200 | 308 → URL slug (S-01) → 200, JSON-LD JobPosting présent ✓ |
| **`/offre/<id fermée>` × 10** | **410 + `x-robots-tag: noindex`** | **10/10 HTTP 200, aucun `x-robots-tag`** ; la page rend bien le bandeau « Expirée » et porte `<meta name="robots" content="noindex, nofollow">` ; forme slug (`/offre/x-<id>`) → 200 aussi |

### I-1 — IMPORTANT · Le 410 des offres fermées ne sort jamais en prod : le middleware sonde `https://0.0.0.0:8080` et échoue en silence

**Fait** : 10/10 offres fermées → 200 (ci-dessus). Le middleware est bien déployé et vivant (`www.modecareers.com/offre/…` → 301 apex, D30 ; déploiement SUCCESS 09:53 = commit `c82e2a5`, ancêtre de HEAD, aucun diff sur `middleware.ts` / `app/offre` / `api/offre-status`).

**Reproduction** (build standalone local du même code, base de prod en lecture) : `curl http://127.0.0.1:3014/offre/<fermée>` → **410 + noindex** ; **même requête avec `x-forwarded-proto: https`** (ce que Cloudflare/Railway envoient toujours) → **200**.

**Cause** : `apps/web/middleware.ts` L43 construit la sonde avec `new URL('/api/offre-status/…', request.url)`. Or Next compose `request.url` (`node_modules/next/dist/server/lib/router-utils/resolve-routes.js` L103-105) comme `${proto}://${hostname}:${port}${path}` où `proto` = `https` dès que `x-forwarded-proto` le dit et `hostname` = l'hôte d'écoute (`0.0.0.0` en standalone) → `https://0.0.0.0:8080/api/offre-status/…` → poignée de main TLS sur un port HTTP → `fetch` lève → `catch` L57 → `NextResponse.next()` → 200. En local sans proxy, `http://…` → la sonde passe → 410. Le test e2e (`e2e/critical-flows.spec.ts` L82-91) n'envoie pas `x-forwarded-proto` et ne peut donc pas voir le défaut.

**Impact** : candidat — aucun (bandeau rendu, similaires proposées). Loïc / SEO — la promesse D22 « offre périmée → 410 » n'est pas tenue ; seul le `<meta noindex>` de la page protège l'index (déréférencement plus lent qu'un 410, et un 200 signale à Google une page vivante). ~1 600 à 1 800 pages fermées concernées à tout moment.

**Correction** : la sonde ne doit jamais dériver de `request.url` : `fetch(\`http://127.0.0.1:${process.env.PORT ?? 8080}/api/offre-status/${id}\`)` (ou variable `INTERNAL_ORIGIN`), ou passer le middleware en `runtime: 'nodejs'` (Next 15.5) et lire Prisma directement, sans auto-appel. Test : le e2e envoie `x-forwarded-proto: https` + `host: modecareers.com` et exige 410 ; un test unitaire vérifie que la sonde ne contient jamais `0.0.0.0`.

---

## 4. Constats par priorité (pipeline)

### B-1 — BLOQUANT · Normal : 478 offres vivantes, 100 % des liens « Postuler » en 404

**Fait** (5/5 sondées + 1 stale, 11:29) : `Job.url` = `JobSource.url` = `https://jobs.normal.eu/jobs/<id>-<slug>` → **404** ; la racine `jobs.normal.eu` → 200 ; la même offre sur `jobs.normal.no/…` ou `jobs.normal.fr/…` → **200**. Le feed `jobs.normal.eu/jobs.json` renvoie `item.url` sur `.eu` pour tout, alors que le listing HTML lie vers `jobs.normal.{se,no,fr,es,it,nl}` selon le pays ; chaque item porte `_jobposting.jobLocation[0].address.addressCountry` (« NO », « FR »…).

**Cause** : `src/ats/adapters/teamtailor.ts` L84 `url: item.url ?? ''` — l'URL du feed est prise telle quelle ; Teamtailor multi-pays sert le détail uniquement sur l'hôte du pays.

**Impact** : 478 candidats sur 478 tombent sur un 404 chez la Maison — la pire expérience possible pour un agrégateur (D18).

**Correction** : dans `toNormalized`, si `addressCountry` est renseigné et que l'origine est un hôte `jobs.<marque>.eu`, réécrire l'hôte en `jobs.<marque>.<cc>` ; à défaut, résoudre une fois par run les hôtes du listing HTML. Test : « un item NO du feed `.eu` reçoit une URL `.no` ». Relance : `ingest --only normal` (même source, même rang → `upsert.ts` L423-431 ré-écrit `Job.url`).

### B-2 — BLOQUANT · Foot Locker : 2 842 offres dont le lien mène à la page de connexion iCIMS, pas à l'offre

**Fait** : 2 842/2 842 `Job.url` se terminent par `/jobs/<id>/login`. Rendu serveur (`?in_iframe=1`) : `/login` → `<title>Login</title>`, titre du poste absent ; `/job` → `<title>Sales Associate in Tampa, Florida | Careers…</title>`. Aucune page équivalente sur `careers.footlocker.com` (`/job/<id>`, `/us/en/job/<id>[/slug]` → 404).

**Cause** : `src/ats/adapters/phenom.ts` L82 `url: data.applyUrl ?? data.apply_url ?? …` — Phenom livre `apply_url` = l'étape de connexion iCIMS (`{"req_id":"71906","slug":"71906","apply_url":"https://us-retail-footlocker.icims.com/jobs/71906/login"}`), pas la fiche.

**Impact** : 2 842 candidats arrivent sur « Login » sans jamais voir l'offre ; c'est la 4ᵉ source du catalogue.

**Correction** : quand `apply_url` est une URL iCIMS `/jobs/<id>/login`, remplacer par `/jobs/<id>/job` (page de description, vérifiée 200) ; test « une apply_url iCIMS /login devient /job ». Relance : `ingest --only foot-locker-france`.

### I-2 — IMPORTANT · Le `refresh`, à la reprise, fermerait ~2 376 offres dont ~1 850 vivantes

**Fait** (11:24) : 527 offres à JobSource périmée (65 % mortes d'après §2.2) **+ 1 849** offres vivantes sans JobSource active (a2 B-1, re-mesuré). `refresh.ts` L95-102 ne lit que `JobSource.lastSeenAt` ; L150-160 ferme toute offre sans JobSource active.

**Correction / ordre** : (1) corriger la ré-attestation de la JobSource (a2 B-1) ou réactiver one-shot les JobSource des 1 849 ; (2) ingest complet ; (3) seulement alors `refresh` — qui fermera les ~330 mortes de §2.4 correctement. Lancer `refresh` avant (1) fabrique 1 849 faux « expirées ».

### I-3 — IMPORTANT · Michael Page : 3 334 offres actives pour 1 450 lues par run — la queue de liste n'est jamais revue

**Fait** : `SourceRun` 08:57 `OK 1 450` (19,2 min, coupé par la deadline — a3), 02:40 `OK 2 936`, en alternance avec des `BROKEN 0` (22:11, 06:34 — avant le correctif D35 déployé à 07:59). Histogramme `lastSeenAt` des actives : 1 450 (08:00), 1 486 (02:00), 186 (05/09 18:00), 127 (04/09 22:00), 83 (04/09 05:00). Sur les 83 stale sondées : 12/14 → **410** (Michael Page dépublie réellement) ; 2/14 vivantes.

**Cause** : `src/ats/adapters/genericJsonLd.ts` L76-77, L156 : à la deadline, l'adaptateur s'arrête sans curseur ; chaque run relit la tête de liste (plus récente : `postedAt` 31/08 → 04/09) ; ~1 880 offres plus anciennes ne sont revues qu'un run sur deux et seront fermées à 48 h qu'elles soient vivantes ou non (cas a3 B1, mesuré ici sur la 3ᵉ source du catalogue).

**Correction** : curseur de reprise (a3 B1) ; la relance n'est **pas** `ingest --only michael-page-france` (relirait la même tête).

### I-4 — IMPORTANT · l-oreal-professionnel : BROKEN 0 à 10:17 après 5 runs à 1 716 ; 3/4 liens stale en 404

**Fait** : run isolé 10:17 `BROKEN 0 (prev 1 716)` ; 1 782 offres actives portées, 32 non re-vues > 48 h, sonde stale 3/4 → 404 sur `careers.loreal.com/en_US/jobs/JobDetail/…`. Les 5 fraîches sondées → 200. Contexte : opération D36 (fusion L'Oréal) par l'autre session au même moment.

**Relance** : `ingest --only l-oreal-professionnel` pour lever le BROKEN (sinon le refresh gardera ses 32 mortes indéfiniment — c'est voulu par D32(c), mais ici la source n'est pas en panne).

### I-5 — IMPORTANT · Le correctif Eightfold de l'audit A1 n'atteint pas la base : 125 offres ELC envoient encore le candidat sur une AUTRE position, parce que leur `canonicalTier` est orphelin

**Fait** (11:47) : 125 offres actives `estee-lauder-companies` ont un `Job.url` dont l'id n'est pas le leur (ex. `Beauty Advisor - MAC - Manchester` #1168274822584 → `careers.elcompanies.com/careers/job/1168275251425`, la position « MAC Boots Manchester 22.5hrs ») — exactement les 125 de l'audit A1. La `JobSource.url` est, elle, correcte pour 100 % des lignes (`elcompanies.eightfold.ai/careers/job/<id propre>`, 0 écart id/URL) : l'adaptateur (`src/ats/adapters/eightfold.ts` L106-115) est bien corrigé et la source a re-attesté ces offres à 09:47.

**Cause** : `src/dedup/upsert.ts` L423-431 — `urlRefresh` exige `tierRank(candidate) ≤ tierRank(existing.canonicalTier)`. Ces offres portent `canonicalTier = EMPLOYER_DIRECT` (119/125) alors que leur seule JobSource est de rang GROUP_OFFICIAL : plus aucune source active ne détient le rang gravé, et la correction d'URL est bloquée pour toujours. Mesure globale : **3 128 offres actives** ont un `canonicalTier` qu'aucune JobSource active ne porte (EMPLOYER_DIRECT 2 479, ATS_OFFICIAL 525, SPECIALIST_JOBBOARD 124) ; 1 242 ELC ont ainsi gardé `careers.elcompanies.com` (vivant, 5/5) pendant que la source dit `elcompanies.eightfold.ai`. `retireSource.ts` L85-92 ne réassigne le rang que si l'URL retirée était la canonique.

**Impact** : 125 candidats postulent à un autre poste (autre contrat/horaires) — promesse D18 rompue malgré un correctif « livré » ; tout futur correctif d'URL d'adaptateur est inopérant sur 3 128 lignes.

**Correction** : à la ré-attestation, si aucune JobSource active ne porte `existing.canonicalTier`, adopter le rang de la meilleure JobSource active (puis appliquer `urlRefresh`) ; réparation one-shot des 3 128. Test : « une offre au rang orphelin reprend l'URL de sa seule source active ». Relance ensuite : `ingest --only estee-lauder-companies`.

### M-1 — MINEUR · `validThrough` est affiché au candidat mais jamais lu ni rafraîchi par le pipeline

**Fait** : 15 offres actives avec `validThrough` passé (< 7 j) ; 2 935 en portent une. `src/dedup/upsert.ts` L326 l'écrit **à la création seulement** ; `reattestationFields` (L374-392) ne le ré-écrit pas ; `refresh.ts` ne le lit pas (le commentaire du schéma « drives the refresh pass » est faux). `apps/web/components/job-detail.tsx` L84-85 l'affiche « Candidature avant le ». Une source qui prolonge une offre laisse une date dépassée à l'écran. Correction : ré-écrire `validThrough` à la ré-attestation ; ne pas l'utiliser pour fermer (D23 : le feed décide).

### M-2 — MINEUR · LVMH : 2 583 liens « Postuler » ouvrent un formulaire de candidature, pas l'offre

`Job.url` = `emea3.recruitmentplatform.com/apply-app/…` → 302 → `lvmh.com/rac/csod/prod/apply.html` (`<title>Application Form</title>`), libellé d'erreur JS « Cette offre n'est plus disponible » quand l'id n'existe plus. C'est le `hit.link` officiel du jobhub LVMH (`lvmhAlgolia.ts` L141) : lien vivant et légitime (D18), mais le candidat ne relit pas l'offre chez la Maison. À trancher par Loïc (lien fiche `lvmh.com/join-us/…` vs formulaire) ; pas un défaut de pipeline.

### M-3 — MINEUR · Diptyque (Workday) : 113 `Job.url` en locale `en` vs `JobSource.url` en `fr` (« tats-Unis---Caroline-du-Nord »)

Les deux formes répondent 200 (Workday n'indexe que le `_JR<id>`). Cosmétique ; le slug tronqué (« É » perdu) vient de Workday lui-même.

---

## 5. Cibles de relance (résumé opérationnel)

| Cible | Action | Pré-requis |
|---|---|---|
| ~330 offres mortes (stale > 48 h) | `refresh` | **après** correction a2 B-1 (sinon +1 849 fausses fermetures) |
| normal (478) | corriger `teamtailor.ts` L84 → `ingest --only normal` | — |
| foot-locker-france (2 842) | corriger `phenom.ts` L82 → `ingest --only foot-locker-france` | — |
| l-oreal-professionnel (BROKEN) | `ingest --only l-oreal-professionnel` | vérifier que D36 est terminée |
| michael-page-france | curseur de reprise (a3 B1) ; pas de `ingest --only` | — |
| fashionjobs (170 à fermer) | `refresh` (rotation complète faite) | idem ligne 1 |
| estee-lauder-companies (125 URL vers une autre position) | corriger le rang orphelin (`upsert.ts` L423-431) → `ingest --only estee-lauder-companies` | — |
| site : 410 des fermées | `middleware.ts` L43 : sonde sur loopback, e2e avec `x-forwarded-proto` | — |

Défauts d'URL par adaptateur : **teamtailor** (hôte pays, B-1), **phenom** (`apply_url` = login iCIMS, B-2), **écriture** (rang canonique orphelin qui bloque tout rafraîchissement d'URL, I-5 — 125 ELC vers une autre position), workday (locale, M-3). Aucune URL mal formée en base (0 sans schéma, 0 racine seule, 0 placeholder) ; 310 URLs partagées par 627 offres actives (galeries-lafayette 168 / lacoste 88 = doublons registre a2 B-3, retirés à 11:28 ; ELC 77 offres / 37 URLs = le cas I-5).
