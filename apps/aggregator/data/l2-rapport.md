# l2 — champs présents à la source, perdus chez nous : correctifs adaptateur par adaptateur

2026-09-06, en local. Aucune écriture en base, aucun commit. Suite aux audits `audit-a4-offres.md` et `audit-a1-canonicite.md` (I10).

## 0. Méthode

- **Une mesure = une exécution** de l'adaptateur (`fetchAtsJobs`, même config, même borne) **avant** puis **après** le correctif, avec le script `src/discovery/l2-measure.mts`. La ligne compte comme la frontière `ingest` : contrat *structuré* (champ de l'adaptateur), contrat *effectif* (après repli titre/description), temps de travail, pays brut / ISO (`normalizeCountry`), langue déclarée, date, `validThrough`, télétravail.
- Bornes : Workday 100 premiers détails (Tapestry) / 30 (Chanel) ; Eightfold 8 pages avec détails (80 offres) + la liste entière sans détail ; Avature 30 pages (600 offres — careers.loreal.com rate-limite, HTTP 406 à la 3ᵉ passe) ; les autres sources entières.
- **TDD** : chaque correctif a d'abord un test rouge sur une **fixture capturée le jour même** (`src/ats/adapters/__fixtures__/l2-*`) : 26 tests rouges → verts. `npx vitest run src/ats src/normalize` : **37 fichiers, 426 tests verts**. `npx tsc --noEmit -p .` : propre sur les fichiers modifiés (voir §10 pour l'erreur externe).
- Sondes de forme (lecture seule) : `l2-workday-probe.mts`, `l2-eightfold-probe.mts`, `l2-sr-probe.mts`, `l2-sf-lvmh-taleo-probe.mts`, `l2-ulta-loreal-check.mts`. Configs lues depuis `data/sources.csv` et les CSV de découverte ; la table `Source` de prod n'est pas joignable depuis ce poste (`railway run` n'injecte que l'hôte interne).
- Revue de code (agent code-reviewer, diff complet + frontière `ingest.ts`) : **aucun défaut introduit** ; un défaut préexistant relevé et corrigé (§2, horaires « 35H »).

## 1. Résumé avant → après (offres | champ visé)

| # | Source (borne) | Champ | Avant | Après |
|---|---|---|---|---|
| 1 | Workday Tapestry (100 détails / 2 000) | description en anglais | « Coach est une maison de mode… », lieu « Dublin, IRL (Entraineur Arnotts - Entraineur) » | « Coach is a global fashion house… », « Dublin, IRL (Coach Arnotts - Coach) » |
| 1 | — | pays | « États-Unis d'Amérique » 79, « Royaume-Uni » 5, « Taïwan » | « United States of America » 79, « United Kingdom » 5, « Taiwan Region » → ISO 98/100 |
| 1 | — | temps (`timeType`) | **0** | **98** (Part time 75, Full time 23) |
| 1 | — | `validThrough` (`endDate`) / remote | 0 / 0 | 28 / 3 |
| 1 | Workday Chanel (30 détails / 1 092) | temps / date | 0 / 30 | 30 / 30 (la date était déjà lue : §8) |
| 2 | normaliseur | `PART_TIME`, `FULL_TIME`, `Teilzeit`, `À temps plein`, `Fulltime-Regular`… | `UNKNOWN` | temps reconnu, contrat CDI/CDD selon le mot (§2) |
| 3 | Jibe Ulta (9 959) | temps / contrat | 0 / 0 | **9 868 (99 %)** / 93 (Seasonal, Temporary — Ulta ne publie pas d'autre contrat, §3) |
| 3 | Phenom Foot Locker (2 832) | contrat / temps | 26 (1 %) / 0 | **2 779 (98 %)** / **2 797 (99 %)** |
| 3 | SmartRecruiters H&M (1 000, plafond §10) | contrat / langue | 0 / 0 | **508 (51 %)** / **1 000 (100 %)** |
| 3 | SmartRecruiters Primark (824) | contrat / langue | 0 / 0 | **444 (54 %)** / **824 (100 %)** |
| 3 | SuccessFactors Douglas RMK v2 (130) | temps / remote | 0 / 0 | **129 (99 %)** / **130 (100 %)** |
| 3 | Eightfold ELC (80 détails) | contrat / temps | 0 / 0 | **75 (94 %)** / **68 (85 %)** |
| 3 | Eightfold Kering (80 détails) | contrat | 0 | **76 (95 %)** |
| 4 | Eightfold ELC (liste entière, 1 448) | pays | **0** | **1 448 (100 %)** — GB 373, US 332, MX 78, CA 75… |
| 4 | Eightfold Kering (80) | pays | 0 | 80 |
| 5 | LVMH (5 490) | date | 5 490 (déjà lue) | 5 490 ; **langue 0 → 5 490**, temps 4 425 → 5 043, contrat effectif 4 204 → 4 494 |
| 6 | Avature L'Oréal (120 / 6 pages) | date | 107 (89 %, cartes de liste) | **120 (100 %)** — la fiche date le reste (§6) |
| 7 | Eightfold Kering (80) | société | ∅ 80 (→ « Kering ») | Gucci 19, Balenciaga 19, Kering Corporate 10, Saint Laurent 9, Kering Eyewear 6, Bottega Veneta… |
| 7 | Phenom Foot Locker (2 832) | société | ∅ (→ « Foot Locker France ») | « Foot Locker » 2 832 ; enseigne disponible via `brandTag` (§7) |
| 8 | Taleo Brown Thomas (18) | date | **0** | **18 (100 %)** |
| 8 | Workday Chanel | date | déjà lue (30/30) | inchangé — les nuls en base sont l'héritage B1 |

## 2. `src/normalize/contract.ts` — les valeurs structurées

Rejeu (`a4-contract.mts`, sans réseau) — avant, d'après l'audit : `PART_TIME → UNKNOWN`, `FULL_TIME → UNKNOWN`, `Teilzeit → UNKNOWN`, `Fulltime-Regular → CDI / UNKNOWN`, `TEMPORARY → INTERIM`. Après :

| valeur | contrat | temps | misfiled |
|---|---|---|---|
| `PART_TIME` / `FULL_TIME` | UNKNOWN | TEMPS_PARTIEL / TEMPS_PLEIN | true (→ déplacé vers le temps à la frontière) |
| `Part time`, `Full time`, `Teilzeit`, `Vollzeit`, `À temps plein`, `全职`, `兼职` | UNKNOWN | reconnu | true |
| `Fulltime-Regular` | **CDI** | **TEMPS_PLEIN** | false |
| `Fulltime-Temporary` | **CDD** | TEMPS_PLEIN | false |
| `permanent`, `Regular Part-Time` | CDI | — / TEMPS_PARTIEL | false |
| `Temporary`, `Seasonal`, `Fixed-term contract` | **CDD** (avant : INTERIM / UNKNOWN) | — | false |
| `Internship` / `Apprenticeship` | STAGE / ALTERNANCE (inchangé) | — | — |
| `Variable`, `OTHER`, `CONTRACT_TO_HIRE` | UNKNOWN | UNKNOWN | false (aucune valeur canonique) |

Changements : `PART[ _-]?TIME` / `FULL[ _-]?TIME` (underscore et forme collée) ; Teilzeit/Vollzeit, 全职/兼职 ; `TEMPORARY|TEMP|SEASONAL|SAISONNI` passent d'INTERIM à **CDD** (une saison ou un remplacement est un CDD, pas une mission d'intérim ; « Contemporary » reste UNKNOWN, testé) ; `isEmploymentTerm` + `employmentTermsFrom(values)` : parmi des valeurs libres (tags), ne garder que celles qui nomment un contrat ou un temps. Valeurs canoniques inchangées (`CDI CDD STAGE ALTERNANCE VIE INTERIM FREELANCE GRADUATE` / `TEMPS_PLEIN TEMPS_PARTIEL`, alignées sur `apps/web/lib/format.ts` `contractLabel`).
Défaut préexistant relevé par la revue et corrigé : `\d{1,2}\s?H\b` capturait « 35H » / « 39H » avant la ligne temps plein → « Vendeur 35H CDI » devenait temps partiel. Désormais : < 35 h partiel, 35–39 h plein (testé).

## 3. Contrat / temps depuis les champs structurés, par adaptateur

- **Jibe** (`jibe.ts`) : tous les `tagsN` passent par `employmentTermsFrom`. Mesuré sur Ulta : `tags1` = « Part Time » / « Full Time », `tags2` = « **Field** » (pas « Regular » comme l'écrivait a1 I10), `tags3` = intitulé, `tags4` = magasin (« ST1566 Troy MI »), `tags5` = « Talent Acquisition ». Ulta ne publie donc **pas** de contrat hors « Seasonal » / « Temporary » (93) ; le gain est le temps : 0 → 9 868.
- **Phenom** (`phenom.ts`, `parsePhenomJob` exporté) : `employment_type` (`PART_TIME` 2 067, `FULL_TIME` 537, `INTERN` 24, `CONTRACT_TO_HIRE` 10, `TEMPORARY` 2) + les tags qui nomment un terme (`tags2` « Regular Part-Time » 1 846, « Regular Full-Time » 515, « Regular Full-Time/Part-Time » 176, « CDI à temps partiel » 144, « Regular de tiempo parcial » 41). Contrat 26 → 2 779, temps 0 → 2 797.
- **SmartRecruiters** (`smartrecruiters.ts`, `parseSmartRecruitersPosting` exporté) : ids réels mesurés : `permanent` / `part-time` / `contract` (labels Full-time / Part-time / Contract). `permanent → Permanent (CDI)`, `contract → Fixed-term contract (CDD)`, `temporary`, `intern`, `apprenticeship`, `freelance` ; `part-time` n'est pas un contrat → seul le temps est renseigné ; `language.code` → ISO-639-1 sans région (`en-GB → en`, `es-MX → es`). H&M : contrat 0 → 508, langue 0 → 1 000 (21 offres hongroises ne seront plus stockées en `pt`).
- **SuccessFactors RMK v2** (`successfactors.ts`) : `unifiedStandardEmploymentType` est **null sur 130/130** items Douglas (lu quand un tenant le remplit, testé) ; les champs réellement présents sont `custFullTimePartTime` (Teilzeit 60, Vollzeit 30, « Voll- oder Teilzeit » 19, Full Time 18…) et `custOnsiteRemote` (Hybrid…) → temps 0 → 129, remote 0 → 130 (`canonicalRemote` connaît « Hybrid » → partial).
- **Eightfold** (`eightfold.ts`) : le détail `/api/pcsx/position_details` porte `efcustomTextAssignmentcat` (ELC : Parttime-Regular 25, Fulltime-Regular 24, Fulltime-Temporary 10, Parttime-Temporary 9, On-Call/Freelance 6) et `efcustomTextWorkerSubtype` (Kering : Regular 60, « Fixed Term (Fixed Term) » 9, « Student (Fixed Term) (Trainee) » 7). ELC : contrat 0 → 75, temps 0 → 68 ; Kering : contrat 0 → 76.

Limites honnêtes : « Voll- oder Teilzeit » (19) et « Regular Full-Time/Part-Time » (176) tombent en temps **partiel** (premier motif) ; « Variable » (Nordstrom) n'a pas de valeur canonique ; « Student (Fixed Term) (Trainee) » → CDD (le « Fixed Term » explicite prime sur STAGE).

## 4. `eightfold.ts` — `standardizedLocations` est une liste de chaînes

Vérifié sur la recherche : ELC `["Bogotá, Bogota, CO"]`, `["Camarillo, CA, US"]`, `["England,GB"]` (2 tokens) ; Kering `["Vienna, Vienna, AT"]`, `["Paris, IDF, FR"]`. `placeFromEightfold` : pays = dernier token s'il est ISO-2 (sinon dernier token de `locations[0]`), ville = premier token de `locations[0]` (« London » plutôt que la région « England »), `location` = le libellé du tenant avec des virgules propres (« Bogota, CO-DC, Colombia »). La forme objet `{city, country}` est conservée (testé). ELC : pays 0 → 1 448/1 448 ; Kering 0 → 80/80.

## 5. `lvmhAlgolia.ts` — `publicationTimestamp` et `language`

Mesuré sur l'index entier (5 490 hits) : `publicationTimestamp` présent 5 490/5 490 (nombre, secondes) et **déjà mappé** (`lvmhAlgolia.ts:143`) → `postedAt` rendu 5 490/5 490 avant comme après. Les 5 212 nuls en base sont les lignes nées le 02/09 avant ce mapping, jamais ré-écrites (B1) — guéries par la ré-attestation de `4115ec5` au prochain run, rien à changer ici. En revanche `raw.language` (EN 3 502, FR 1 051, ZH-HANS 570, IT 211, DE 66, JA 33, ES 17, SP 11…) n'était **pas** lu : `lvmhLanguage` → ISO-639-1 (`ZH-HANS → zh`, `SP → es`), langue 0 → 5 490. Bonus du §2 : temps 4 425 → 5 043 (`全职`), contrat effectif 4 204 → 4 494 (« Seasonal »).

## 6. `avature.ts` — `datePosted` de la fiche

Deux modes dans l'adaptateur, et L'Oréal (`listingUrl`, 20 offres/page) passe par le mode **liste**, pas le mode portail. Première passe : `parseAvaturePortalDetail` lisait la date (fixture réelle `g6-loreal-jobdetail.html` : 2026-07-15) — mais la mesure 30 pages restait à 527/600 : le mode liste ne recopiait **que** la description (`avature.ts`, fusion `withDescriptions`), exactement le trou de l'audit. Contrôle direct sur 3 fiches sans date de liste : `"datePosted"` présent (2026-08-24, 2026-01-01, 2026-01-01), parsé 3/3. Correctif : `postedAtFromJsonLd(html)` partagé par les deux modes, `postedAt: job.postedAt ?? postedAtFromJsonLd(html)` (la carte prime quand elle date). Mesure 6 pages : **107 → 120/120**. Tests : `avature.listing.test.ts` (carte sans date + fiche datée ; la carte prime).
Note : careers.loreal.com rate-limite (HTTP 406) après ~600 requêtes rapprochées ; un détail refusé est avalé par le `catch` (perte silencieuse préexistante, pas de compteur).
Ajout utilitaire : `config.maxPages` borne aussi le mode portail (300 par défaut, inchangé).

## 7. Marques de groupe (D11)

- **Kering** : `business_unit` n'existe **pas** sur `/api/pcsx/position_details` (il vient de `/api/apply/v2/jobs`, que l'adaptateur ne peut pas appeler — 403) ; la Maison est dans **`efcustomTextHouse`** (« Bottega Veneta », vérifié). `brandOf` le lit → société ∅ 80 → Gucci 19, Balenciaga 19, Kering Corporate 10, Saint Laurent 9, Kering Eyewear 6, Bottega Veneta… Les 863 lignes `GENERIC_JSONLD` + 180 « Kering » en base seront ré-attachées par la ré-attestation (`4115ec5` ré-écrit la société).
- **Foot Locker** : la charge Phenom publie `hiring_organization` = « Foot Locker » (2 832/2 832) et l'**enseigne** dans `tags4` : Foot Locker 1 899, Champs Sports 483, Kids Foot Locker 429, « Foot Locker, Inc. » 13, WSS 8. `company` = `hiring_organization` par défaut (plus jamais « Foot Locker France » sur un poste de Fayetteville) ; l'enseigne est **opt-in** par `config.brandTag: "tags4"` sur la ligne Source (les tags sont propres à chaque tenant : chez Ulta `tags4` est un magasin). **Décision Loïc** : afficher l'employeur (« Foot Locker ») ou l'enseigne (« Champs Sports », « Kids Foot Locker ») — si l'enseigne, ajouter `"brandTag":"tags4"` à la config de `foot-locker-france` (table `Source`, non modifiable d'ici).

## 8. Taleo / Chanel — dates

- **Taleo TBE (Brown Thomas)** : le commentaire de l'adaptateur (« aucune date publiée ») était **faux** : la fiche `viewRequisition` porte un JSON-LD `"datePosted": "2026-08-20 00:00:00.0"`. `parseTaleoDetail` (+ `parseTaleoDate`, minuit UTC) → date 0 → 18/18 ; commentaire corrigé.
- **Chanel** (`parfums-chanel` = Workday `cc/ChanelCareers`, pas Taleo) : le détail cxs publie `startDate` et `attachWorkdayDescriptions` le mappait déjà — date 30/30 avant et après. Les 1 071 nuls en base sont des lignes nées le 02/09 (B1) : rien à corriger dans l'adaptateur, la ré-attestation les guérit. Gain collatéral : temps 0 → 30/30, `validThrough` 2.

## 9. Fichiers

Modifiés : `src/normalize/contract.ts`, `src/ats/adapters/{workday,eightfold,lvmhAlgolia,avature,taleo,jibe,phenom,smartrecruiters,successfactors}.ts`.
Tests : `contract.test.ts` (+7), `workday.test.ts` (+1), `eightfold.test.ts` (+4), `avature.test.ts` (+2), nouveau `avature.listing.test.ts` (3), `taleo.test.ts` (+2), `jibe.test.ts` (+2), `phenom.test.ts` (+4), `successfactors.test.ts` (+2) ; nouveaux `smartrecruiters.test.ts` (4), `lvmhAlgolia.test.ts` (3).
Fixtures capturées le 2026-09-06 : `__fixtures__/l2-workday-tapestry-detail-{en-US,fr-FR}.json`, `l2-eightfold-{elc,kering}-{search,detail}.json`, `l2-smartrecruiters-{primark,hmgroup}-posting.json`, `l2-successfactors-douglas-item.json`, `l2-lvmh-hit.json`, `l2-taleo-brownthomas-detail.html` (réduite au JSON-LD + début de description).
Non touchés : `src/dedup/`, schéma, dispatch, `ingest.ts`.

## 10. Hors périmètre, à remonter

1. **`main` ne compile plus** : le commit `2c622cf` (autre session, « fix(country): formes officielles longues… »), poussé pendant cette mission, laisse une clé dupliquée (`'viet nam'`) dans `src/normalize/country.ts:60` → `tsc` TS1117 (`npx tsc --noEmit -p .` échoue sur `main`). `main` = prod (Railway auto-déploie) : à corriger par son auteur avant tout autre push. Mes fichiers compilent (le seul diagnostic `tsc` est celui-là).
2. **H&M plafonné** : `smartrecruiters.ts` lit `offset < 1000` → **1 000 offres lues sur 1 622** annoncées (622 jamais ingérées ; `truncated` devrait déjà le marquer DEGRADED). Une borne à relever, décision de volume hors mission.
3. Audit a1 I10 : « Ulta tags2 = Regular » est faux (tags2 = « Field ») ; Ulta ne publie pas de contrat.
4. SuccessFactors Career Site Builder (adidas, Clarins… pages microdata) : `employmentType` n'est pas lu par `parseMicrodataDetail` — à mesurer avant de l'ajouter.
5. Deux libellés Workday restaient non ISO dans l'échantillon Tapestry (« Korea, Republic of ») — précisément ce que `2c622cf` ajoute à `country.ts` : réglé une fois ce commit compilable.
