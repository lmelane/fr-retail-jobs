# l4 — la ville canonique, telle que le candidat la voit

2026-09-06. Lecture seule en prod (SELECT via le proxy TCP Railway), aucun commit, aucune écriture en base. Suite de `audit-a1-canonicite.md` (I6, I7, détail 2 « Ville »).

## 0. Méthode

- **Mesure d'abord, en prod** : un seul SELECT (`src/discovery/l4-export.mts`) exporte les couples (`Job.city`, `Job.location`, source principale, effectif) des offres actives → **70 221 offres, 23 924 couples, 8 047 villes distinctes** (12:35 UTC ; 71 796 actives au ping de 12:32 — un run tournait). Exploration hors base : `l4-explore.mts`.
- **TDD sur `src/normalize/location.ts`** (`displayCity`, `cityFromLocation`, `normalizeLocationString`, `isArrondissementCity`) et `location.test.ts` : les cas réels ont été écrits en attentes AVANT le code (257 tests dont 20 rouges au premier passage), puis la chaîne réécrite. Rien touché dans `src/dedup/`, le schéma ni les adaptateurs.
- **Preuve par simulation** (`l4-simulate.mts`) : les vraies fonctions rejouées sur l'export, avant → après, chiffrées ci-dessous. Trois lectures : (A) `location.ts` seul, (B) avec la garde `!normalizeCountry(city)` de `upsert.ts:359`, (C) si `cityOf` retombait sur `location` quand la ville de l'adaptateur est rejetée.
- Vérifications : `npx tsc --noEmit -p .` → exit 0 (aussi propre avec `--noUnusedLocals`) ; `npx vitest run src/normalize` → 7 fichiers, **412 tests verts** ; `npm run test:unit` → 46 fichiers, **717 tests verts**.

## 1. Ce que la base montrait (avant)

| Famille | Mesure (offres actives) | Exemples |
|---|---|---|
| (1) Ville = pays, état, code ou mode | **1 921** pays (145 formes) + 72 codes à 2 lettres + 44 modes | « Ch » 110, « Nl » 74, « Us » 90, « United States » 89, « Germany » 67, « Ny » 26, « Sf » 19, « Remote » 21, « Flexible » 7, « Western Australia » 17, « Apac-C1 » 17 |
| (2) Libellé de magasin ou de bureau | **951** (340 formes) dont 688 avec code magasin en tête | « Bg 0263 Bg Womens Store » 48, « Sf 0630 Boston Fl » 20, « Hq-Office » 20, « American Dream Mall », « Ch - Foxtown Ugg Retail Outlet Store » |
| (3) Chinois / coréen | **585** (97 formes, lvmh 570) | 上海 127, 武汉 37, 广州 34, 深圳 33, 静安区 25, 서울 10 |
| (4) Deux ou trois graphies | 272 groupes / **9 626** offres en pliant seulement casse-accents-tirets ; plus les exonymes | London 1 240 / Londres 4 ; Milano 268 / Milan 181 ; Genève 151 / Geneva 51 / Geneve 48 / GENÈVE 3 ; Neuilly sur Seine 140 / Neuilly-sur-Seine 83 / NEUILLY-SUR-SEINE 16 / Neuilly Sur Seine 9 ; Munich 108 / Munchen 41 / München 37 ; Brussels 115 / Bruxelles 51 / Brussel 5 |
| (5) Arrondissements | 202 (michael-page-france) + nocibe, naos, eram, element | « Paris-8e-Arrondissement » 12, « Paris 12ème » 5, « Lyon-02 » 3, « Lyon 03 (69383) » 2, « Nantes Cedex 2 » |
| (6) Code postal, pays collé, parenthèses, majuscules | 716 avec virgule/parenthèse/tiret + 454 tout en majuscules + 101 pays collé | « PARIS » 312, « Etats-Unis - New York » 35, « Aix en Provence (13001) » 6, « Toronto Canada » 6, « W1B 3BN London », « Milano (MI) » |

Détail brut : scratchpad `l4/explore.out`.

## 2. Décisions prises (et pourquoi)

1. **Une forme par ville, française quand l'exonyme est courant** : Londres, Milan, Genève, Munich, Cologne, Lisbonne, Rome, Florence, Venise, Bruxelles, Anvers, Prague, Varsovie, Cracovie, Séville, Vienne, Athènes, Bucarest, Copenhague, Édimbourg, Hambourg, Barcelone, Séoul, Pékin, Dubaï, Riyad, Djeddah, Le Caire, Le Cap, Hô Chi Minh-Ville, Manille, Philadelphie… ; sinon l'endonyme (Madrid, Berlin, Shanghai, Tokyo).
2. **Chinois / coréen / japonais** : la ville affichée est l'exonyme ou la translittération (上海 → Shanghai, 静安区 → Shanghai, 北京 → Pékin, 서울 → Séoul) ; **le nom d'origine reste dans `location`**, que la fiche affiche. Une ville non latine absente de la table est **gardée telle quelle** plutôt que perdue (« 某某市 »). Un périmètre ou une province chinoise (全国, 海南省, 开放中) → aucune ville.
3. **Guangzhou, pas « Canton »** (l'audit proposait Canton) : mesuré, **32 offres américaines** s'appellent déjà Canton (Georgia 8, Ohio 6, Michigan 5). « Canton » aurait fusionné deux villes.
4. **Exonyme conditionné au pays** quand le nom anglais existe aussi aux États-Unis, mesuré : Vienna = Virginie 14 / Autriche 25 ; Athens = Georgia 12 + Tennessee 7 / Grèce ~30 ; Venice = Californie 12 + Floride 7 / Italie 25 ; Warsaw = Indiana 6 / Pologne 27 ; Moscow = Idaho 5 / Russie 0 ; Toledo = Ohio 11 / Espagne 10 ; Alexandria. Ces sept variantes ne se traduisent que si le libellé porte le pays (« Venice, Italy » → Venise ; « Venice, CA » → Venice). `displayCity(raw, hint?)` accepte un indice de pays séparé pour un adaptateur qui fournit la ville seule.
5. **Mexico City** plutôt que « Mexico » (exonyme français) : `normalizeCountry('Mexico')` = MX, la garde de `upsert.ts:359` effacerait la ville ; « Ciudad de México », « CDMX », « Mexico D.F. » convergent dessus.
6. **« Vienne »** (Wien) partage sa forme avec Vienne (Isère) : 1 offre en base — collision acceptée, notée.
7. **Rejet → `undefined`** : un pays, un code ISO ou d'état, un état/région/province, un mode de travail, un service, un magasin. Le lieu brut reste dans `location`. Perte assumée et documentée : « Lebanon, Tennessee » (12), « Georgia » (16, pays), « Nike Vietnam Hq » (6) — mieux vaut aucune ville qu'une fausse.
8. **Casse** : un nom crié ou tout en minuscules repasse en casse de titre ; un nom déjà en casse mixte n'a que ses particules abaissées (« King Of Prussia » → King of Prussia, « Frankfurt Am Main » → Francfort) et son « Mc » réparé (« Mclean » → McLean). Particules françaises entre deux mots → tirets (« Aix en Provence » → Aix-en-Provence, « Neuilly Sur Seine » → Neuilly-sur-Seine) ; « de/del/di » ne sont jamais reliés (« Ciudad de México », « Rio de Janeiro »).
9. **`cityFromLocation` rend désormais la ville affichable** (accents et exonyme compris) et non la clé majuscule : c'est cette clé qui produisait « Geneve » (48) à côté de « Genève » (151). Son seul appelant (`upsert.ts:358`) la passe déjà dans `displayCity`, idempotent.
10. **La clé de dédup suit** (`normalizeLocationString`, utilisée par `match.ts:69` et `geocode.ts`) : « Milano, Italy » et « Milan, Lombardy » → `MILAN` ; 上海 → `SHANGHAI` (au lieu d'une clé vide). Une clé qui change est re-gravée à la ré-attestation (`upsert.ts:523-525`), pas dupliquée.

## 3. Règles de la chaîne (une seule, partagée)

`analyseLocation(raw, hint?)` → `displayCity` / `cityFromLocation` (forme affichée) et `normalizeLocationString` (clé majuscule sans accents + département).

1. Nettoyage du libellé entier : emoji/drapeaux, jetons de télétravail (« Onsite - Phoenix » → Phoenix), « Cedex… », préfixe « 75 - », parenthèses → séparateurs (« UGG Newbury Street Pop Up (Boston, MA) » → Boston). Seule la **première alternative** d'un multi-lieux est lue (`;`, ` / `, ` & `, ` or `).
2. Découpage en segments (virgule, ` - `, `|`, `·`) ; par segment : préfixe code (« US-NYC » → NYC, « AB-Calgary » → Calgary), code magasin en tête (« NM_0212_ », « SF 0630 », « O5_0776_ »), **tout jeton contenant un chiffre** (code postal, « 8e », « 12ème », « W1B 3BN », « SARI0037 », « Apac-C1 »), mots d'arrondissement/cedex, caviardage « xxxxxx ».
3. **Exonyme d'abord** (`data/villes-exonymes.csv`, clé pliée sans casse/accents/ponctuation) : ce que la table connaît est une ville, point — c'est aussi la liste blanche de « Byron Center », « Studio City », « City of Industry », « Hong Kong », « Singapour », « Saint-Barthélemy ».
4. Rejet : pays (`normalizeCountry`, avec variante à tirets pour « Royaume Uni »), `data/villes-non-lieux.csv` (états, régions, Länder, provinces, modes, services, types de contrat « CDI »/« Stage »), codes à 2 lettres, codes à 3 lettres d'une liste fermée (SGP, QLD, COH… — « Pau », « Gap », « Ulm » sont des villes), préfixes de périmètre (APAC, EMEA…), préfixes de magasin Levi's (LFO, LS), moins de deux lettres (« /a> », « D.F. »).
5. Adresse : un mot de voirie (rue, street, plaza, center/centre, via, calle…) ou un numéro en tête suivi de « St » → seul un Paris/Lyon/Marseille porté par le même segment survit (« 12 rue de la Paix 75002 Paris » → Paris), sinon le segment est sauté (« 1 World Trade Center, New York » → New York).
6. Queue régionale retirée (« Toronto Canada », « Boston FL », « Perth Western Australia », « Ferno VA ») sauf derrière une particule (« Tremblay en France » reste entier) ; suffixe de bureau retiré mais segment **affaibli** (« Berlin Head Office » → Berlin ; « Kensington Office, London » → Londres, le segment net gagne ; « Los Angeles Metropolitan Area » → Los Angeles ; « Greater Atlanta » → Atlanta) ; ce qui reste contenant un mot de magasin/bureau/service → rejet.
7. Choix : premier segment utilisable ; si le **premier segment est un pays**, le dernier (« Germany, Bayern, München » → Munich ; « Belgique - Bruxelles - Bureau » → Bruxelles ; « France, France » → rien).
8. Casse et tirets (§2.8), puis clé.

## 4. Livrables

- `data/villes-exonymes.csv` — **485 lignes** `variante,canonique,pays` (7 conditionnées à un pays), commentées par zone ; une forme canonique est automatiquement sa propre clé.
- `data/villes-non-lieux.csv` — **361 lignes** `libelle,type` : 239 régions/états, 62 modes, 46 services, 14 pays non lus par `country.ts` (日本, Corée, « Republic of »…).
- `src/normalize/cityTables.ts` (88 lignes) — chargeur, `foldCityKey`, `lookupExonym(key, pays?)`, `isNonPlace`.
- `src/normalize/location.ts` (353 lignes) — la chaîne ; `location.test.ts` (554 lignes) : **223 cas réels avant → après** en `it.each` (dont les 40 demandés, répartis dans les six familles) + les tests historiques conservés.
- `src/discovery/l4-export.mts`, `l4-explore.mts`, `l4-simulate.mts` — mesure et simulation rejouables (`npx tsx src/discovery/l4-simulate.mts <villes.json> [source]`).

## 5. Mesure avant → après (simulation sur l'export prod)

| | Avant (base) | Après (A) `location.ts` | Après (B) + garde `upsert.ts:359` | Après (C) + repli `location` |
|---|---|---|---|---|
| Offres avec ville | **68 236** | **65 504** | 64 754 | **66 735** |
| Villes distinctes | **8 047** (7 710 en pliant casse/accents) | **6 500** (−19 %) | 6 494 | 6 582 |

Ventilation (A) : **54 344** inchangées · **10 458** renommées · **3 434** perdues (pays, états, codes, modes, magasins : « Ch » 110, « Nl » 74, « Karnataka » 64, « Germany » 53, « Us » 49, « Bg 0263 Bg Womens Store » 48, « New South Wales » 46, « Italy » 31, « Nm 0112 Northpark » 30…) · **702** récupérées depuis `location` là où la ville était vide (« France - Paris » 21, « HONG KONG SAR, China » 19, « Veracruz, Mexico » 7…).

Top 30, avant → après (A) :

| Avant | | Après | |
|---|---|---|---|
| Paris | 2 991 | Paris | 3 474 |
| New York | 1 582 | New York | 1 818 |
| London | 1 240 | Londres | 1 301 |
| Singapore | 384 | Shanghai | 490 |
| Toronto | 353 | Milan | 468 |
| Los Angeles | 351 | Singapour | 415 |
| Madrid | 348 | Toronto | 375 |
| Shanghai | 327 | Los Angeles | 372 |
| Chicago | 317 | Madrid | 350 |
| Miami | 313 | Miami | 339 |
| PARIS | 312 | Chicago | 333 |
| Amsterdam | 310 | Séoul | 328 |
| Seoul | 300 | Houston | 316 |
| Milano | 268 | Amsterdam | 315 |
| Houston | 263 | Las Vegas | 298 |
| Las Vegas | 263 | Dallas | 269 |
| Tokyo | 261 | Lyon | 268 |
| Dallas | 246 | San Francisco | 267 |
| Dublin | 242 | Neuilly-sur-Seine | 263 |
| Berlin | 239 | Tokyo | 263 |
| Lyon | 234 | Dublin | 261 |
| Dubai | 226 | Atlanta | 259 |
| Orlando | 226 | Berlin | 255 |
| Atlanta | 226 | Genève | 254 |
| Seattle | 216 | Orlando | 239 |
| Bangkok | 206 | Hong Kong | 231 |
| Barcelona | 201 | Dubaï | 230 |
| Vancouver | 200 | Sydney | 227 |
| San Francisco | 200 | Seattle | 217 |
| Hamburg | 199 | Barcelone | 214 |

Renommages les plus lourds : London → Londres 1 240 · Singapore → Singapour 384 · PARIS → Paris 312 · Seoul → Séoul 300 · Milano → Milan 268 · Dubai → Dubaï 226 · Barcelona → Barcelone 201 · Hamburg → Hambourg 199 · Montreal → Montréal 197 · Neuilly sur Seine → Neuilly-sur-Seine 140 · 上海 → Shanghai 127 · Brussels → Bruxelles 115 · Roma → Rome 110 · Philadelphia → Philadelphie 108 · King Of Prussia → King of Prussia 89 · Edinburgh → Édimbourg 89 · Geneva/Geneve → Genève 99 · Hong Kong S A R / Sar → Hong Kong 88 · Nm 0212 San Francisco → San Francisco 32 · Etats-Unis - New York → New York 35. Liste complète : scratchpad `l4/simulate.out`.

Résidu (A) sur 65 504 : une quinzaine de sigles à 3 lettres (« Fac », « Utc », « Dlf »… ≤ 1 offre chacun, sauf « Bod » 5, « Sea » 3, « Chi » 3), « Nm 0228 Bergen » → Bergen (16, comté du New Jersey lu comme la ville norvégienne), « Ugg American Dream East Rutherford » (4) et « D C Metro-Atlantic » (11) inchangés. Tous relèvent de l'adaptateur (§6.3) ou du repli (§6.1), pas d'une règle générale de plus.

## 6. Ce qui reste hors périmètre, avec la ligne

1. **`src/dedup/upsert.ts:358` — pas de repli sur `location` quand la ville de l'adaptateur est rejetée.** `displayCity(candidate.city ?? cityFromLocation(candidate.location))` : si `candidate.city` est un magasin (« Hq-Office »), `displayCity` rend `undefined` et `location` (« HQ-Office, San Francisco, CA, USA ») n'est jamais lu. Une ligne — `displayCity(candidate.city) ?? displayCity(candidate.location)` — vaut **+1 231 offres avec ville** (C − A : Metzingen, Lelystad, Staten Island, Bochum, Dublin, Amsterdam, Boston, Costa Mesa…).
2. **`src/dedup/upsert.ts:359` — la garde `!normalizeCountry(city)` efface les cités-États.** Elle a été ajoutée pour les « Ch »/« Germany » ; `location.ts` les rejette maintenant lui-même, et la garde ne retire plus que **750 offres légitimes** : Singapour 415, Hong Kong 231, Luxembourg 35, Monaco 28, Macao 22, Saint-Barthélemy 19 (LVMH y recrute). À retirer une fois ce lot déployé. Pour passer le pays au `displayCity` (exonymes conditionnels §2.4) : `displayCity(candidate.city, candidate.location)`.
3. **`src/ats/adapters/workday.ts:87` — `location: job.locationsText`** est un libellé de site chez Saks (« NM_0212_SAN FRANCISCO », 689 offres), Deckers (« UGG Williamsburg Retail Store (Williamsburg, NY) », 174) et Tapestry (« Gyeonggi-Do, KOR (Coh… Outlet - Autocar) »). Les règles génériques en récupèrent la majorité ; le vrai correctif est de lire `jobPostingInfo.location` / `country` dans le détail déjà téléchargé pour la description (audit I7-a).
4. **LVMH : `city` et `location` désaccordés en base** — 37 offres `city = 武汉` ont `location = « 上海, Chinese Mainland »` (idem 深圳, 杭州, 厦门). `src/ats/adapters/lvmhAlgolia.ts:140-141` écrit aujourd'hui les deux depuis `hit.city` ; l'écart en base est donc soit historique, soit dû à la ré-attestation qui ré-écrit `city` sans `location` (`upsert.ts:436-437`). À vérifier au prochain run avant de conclure.
5. **`country.ts`** ne lit pas « Corée », « Korea » seul, 日本, 中国 : contourné par 14 lignes `pays` dans `villes-non-lieux.csv`, à rapatrier dans `LABEL_TO_ISO` si on touche `country.ts`.

## 7. Non-régression proposée (SQL, à rejouer après le premier run avec ce code)

- `SELECT count(*) FROM "Job" WHERE "isActive" AND city ~* '^(ch|nl|us|ny|sf|fr|de|gb|remote|flexible|germany|italy|usa|united states|western australia)$'` → **0** (avant : ~800).
- `… AND city ~ '^[A-Za-z0-9]{2,3} ?[0-9]{3,5} '` (codes magasin) → **0** (avant : 688).
- `… AND city ~ '[一-鿿가-힯]'` → **≤ 5** (avant : 585 ; seules les villes absentes de la table restent).
- `… AND lower(city) IN ('london','milano','geneva','geneve','munchen','münchen','brussels','lisboa','warszawa','praha','roma','firenze','venezia','antwerpen','sevilla','singapore','seoul','dubai','beijing')` → **0**.
- `… AND city ~* 'arrondissement|^paris[ -][0-9]|^lyon[ -][0-9]'` → **0** (avant : 202).
- Villes distinctes actives : **≤ 6 600** (avant : 8 047).
- `separate-fused`/reconcile inchangés ; surveiller `SourceRun` au premier run : les clés de cluster qui bougent (Milano → MILAN) se re-gravent, elles ne doivent pas créer de doublons (`doublons_titre_societe_ville` de l'audit A1 stable).

## 8. Fichiers

Modifiés : `src/normalize/location.ts`, `src/normalize/location.test.ts`.
Créés : `src/normalize/cityTables.ts`, `data/villes-exonymes.csv`, `data/villes-non-lieux.csv`, `src/discovery/l4-export.mts`, `src/discovery/l4-explore.mts`, `src/discovery/l4-simulate.mts`, ce rapport.
Aucun commit, aucun push, aucune écriture en base.
