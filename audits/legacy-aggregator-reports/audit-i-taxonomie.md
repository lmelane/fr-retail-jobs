# Audit I — Axe 3 : taxonomie (métier, séniorité, retail, IA, compétences)

Date : 2026-09-06 (mesures prod entre 15:30 et 16:05 UTC). Lecture seule partout. Aucune correction, aucun commit.

## Verdict en cinq lignes

1. **Le classificateur est juste sur ~91 % des offres qu'il classe** (mesuré sur 2 × 300 offres jugées une par une), mais **il se trompe massivement sur quelques titres à très gros volume** : 4 357 coiffeurs de salon Ulta classés « Création & design » (71 % de cette famille en prod), 377 « Selling Associate » classés « Atelier & savoir-faire », 22 ingénieurs machine learning classés « Ressources humaines ». — CRITIQUE, CONFIRMÉ.
2. **L'indice IA ment** : sur 60 offres `isAiRelated` tirées au hasard en prod, **28 (47 %) sont des faux positifs**, et 1 335 des 3 235 offres flaggées (41 %) le sont par une phrase d'entreprise recopiée dans chaque annonce (« AI at Toast », « We do not employ machine learning », « L'IA peut être utilisée à des fins de présélection », un code d'État américain « IA » = Iowa). — CRITIQUE, CONFIRMÉ.
3. **La séniorité dépend de la langue du titre** : « Sales Associate » → JUNIOR (6 160 sur 6 865 en base), « Conseiller de vente » / « Client Advisor » → MID (3 541 sur 3 888). Même poste, deux barreaux. — HAUT, CONFIRMÉ.
4. **Compétences** : « Événementiel » est la 5ᵉ compétence du marché (17 420 offres) et n'est réelle que 455 fois (97 % de faux positifs, « in-store events ») ; « Workday » (2 976) est à 94 % le bouton « apply via your Workday account » ; « Français » est faux sur 332 offres (Nocibé 292/295 : « territoire français … plus de 550 points de vente »). — HAUT, CONFIRMÉ.
5. **Le code déployé est le code local** : sur 49 667 offres prod classées, **1 seul écart** entre `jobFunction` stocké et `classifyFunction` rejoué. Les erreurs ci-dessous sont donc celles des règles, pas d'un décalage de version.

Une chose qui va bien, avec la preuve : les faux positifs de langue redoutés (« French luxury house » → « Français ») **n'existent pas** — `extractSkills('A French luxury house founded in 1837…')` → `[]` ; sur les 111 offres locales portant une langue, 0 fausse.

## Méthode (reproductible)

- Script : `apps/aggregator/src/discovery/auditi-taxonomy.mts` (SELECT uniquement ; échantillon déterministe `ORDER BY md5(id || 'auditi-axe3') LIMIT 300` ; classement rejoué par `classifyJob` du code réel ; top 50 des titres non classés sur **toute** la base active ; 20 premières offres IA + 60 au hasard avec l'extrait déclencheur ; fenêtre de contexte de chaque langue détectée).
  - local : `DATABASE_URL=postgresql://catwalks:catwalks@localhost:55440/catwalks npx tsx src/discovery/auditi-taxonomy.mts local <out>` (1 996 actives, colonnes de taxonomie toutes nulles → tout est recalculé).
  - prod : `DATABASE_URL="postgresql://postgres:${PW}@sakura.proxy.rlwy.net:40792/railway" … prod <out>` (72 028 actives).
- Preuve par titre : `apps/aggregator/src/discovery/auditi-titles.mts` (sans base : `classifyFunction` / `classifySeniority` / `isAiRelated` / `extractSkills` sur les titres et phrases exacts cités ici).
- Volumes prod : SQL `SELECT` via `psql` (conteneur `postgres:16-alpine`), fichiers `q.sql`…`q5.sql` dans le scratchpad de session.
- Fichiers de travail (scratchpad `…/scratchpad/auditi/`) : `auditi-{local,prod}-sample.tsv` (les 300 lignes jugées, avec valeurs calculées ET stockées), `-ai.txt`, `-lang.txt`, `-unclassified.txt`.
- ⚠️ **Un ingest tournait en prod pendant l'audit** : `taxonomyVersion>0` est passé de 47 138 (15:30) à 49 667 (script) puis 59 749 (15:53) ; `isAiRelated` de 3 080 à 3 235. Les volumes ci-dessous sont datés ; les taux mesurés sur échantillon ne bougent pas.

## Chiffres — taux d'erreur mesurés par famille

Jugement une offre par une (grille : « Financial Controller » en retail = erreur ; « Sales Manager » en direction de boutique = accepté ; un titre ambigu classé dans une famille voisine défendable = accepté).

| Famille | Local (300) | Prod (300) |
|---|---|---|
| **Métier** — non classé | 38 (12,7 %) dont **31 classables** par un humain, 7 légitimes (« Stage WINTER@Richemont », « L'ECOLE Lecturer ») | 32 (10,7 %) dont **23 classables**, 9 légitimes (6 pharmaciens/dispensers Boots, « Freelancer/On-Call », « Elev », « Mini-Jobber ») |
| **Métier** — classé faux | **20 (6,7 % ; 7,6 % des 262 classées)** | **25 (8,3 % ; 9,3 % des 268 classées)** dont 15 « Stylist » |
| **Métier** — juste ou acceptable | 242 (92,4 % des classées) | 243 (90,7 % des classées) |
| **Séniorité** — erreurs manifestes (hors biais Associate) | 7 (2,3 %) : Lehrstelle → MID, Apprendista → MID, « Stagaire » (faute) → MID, « CRO Manager » → EXECUTIVE, 3 coordinateurs → MANAGER | 7 (2,3 %) : 4 coordinateurs → MANAGER, « Assistant Store Leader » → JUNIOR, « General Manager » (magasin Ulta) → EXECUTIVE, Lehrstelle → MID |
| **Séniorité** — biais systématique « Associate » | 37 « …Associate » → JUNIOR contre 13 conseillers/vendeurs → MID | 59 → JUNIOR contre 19 → MID |
| **Séniorité** — contestable « Specialist/Expert » → SENIOR | 6 | 4 |
| **isRetail** — faux (découle du métier) | 11 (3,7 %) + 38 null | 19 (6,3 %) + 32 null |
| **isAiRelated** — offres flaggées dans l'échantillon | 3 : 2 vraies, 1 faible (« Microsoft Copilot is valued ») | **15 : 3 vraies, 2 plausibles, 10 fausses (67 %)** |
| **isAiRelated** — 20 premières (brief) | 4 vraies, 5 plausibles, **11 fausses (55 %)** | 6 vraies, 10 plausibles, 4 fausses (biais : les 20 premiers ids sont Foot Locker / L'Oréal, sources tech) |
| **isAiRelated** — 60 au hasard (prod) | — | **28 fausses (47 %)**, 4 faibles |
| **Langues** — faux positifs | 0 sur 111 offres portant une langue | 4 sur 62 (Nocibé ×3, Sandro ×1) |

## Constats classés

### CRITIQUE — ment au lecteur des pages Intelligence

**C1. « Création & design » est une famille de coiffeurs (CONFIRMÉ).**
`classifyFunction('Stylist', 'Salon Professionals')` → `design-creation` (règle `STYLIST\b(?! ADVISOR)`). Prod : 5 647 titres actifs contiennent « stylist », dont **4 357 chez Ulta Beauty** (département « Salon Professionals »), 413 Levi's (« Stylist 16 hours » = vendeur), 82 Buck Mason (« Full-Time Stylist (Bloomingdales) » = vendeur), 90 Lovisa, 45 AKIRA. La famille `design-creation` recalculée fait 6 119 offres : **~71 % sont des coiffeurs de salon et ~7 % des vendeurs**. Dans l'échantillon prod : 15/300 (5 %). Attendu : coiffeur → `beauty-advisor` (la règle `HAIR ?STYLIST|COIFFEU` existe mais le titre Ulta dit « Stylist » seul, le département dit « Salon ») ; « Sales Stylist » / « Stylist 16 hours » → `retail-client-advisor`.

**C2. L'AI Hiring Index compte des clauses d'entreprise, pas des postes (CONFIRMÉ).**
3 235 offres actives flaggées à 15:53 UTC. Motifs mesurés en SQL (`description ~* …` ET `isAiRelated`) :
| Phrase recopiée dans chaque annonce | Offres flaggées |
|---|---|
| Infuse — « We do not employ machine learning technologies during this phase » (phrase de process, sans mot-clé de la liste `PROCESS_SENTENCE_RE`) | 410 / 410 |
| Toast — « AI at Toast … learning new AI tools empowers us » | 315 / 320 |
| The RealReal — « using AI and machine learning to determine optimal pricing » (présentation société, sur un « Warehouse Technician ») | 136 / 136 |
| Quince — « build and deploy proprietary technology, AI, and analytics » | 133 / 133 |
| H&M — « do not use any personal information to train any AI models » (clause vie privée : « personal information » n'est pas dans la liste, « personal data » y est) | 126 / 1 000 |
| Penningtons — « L'utilisation de l'Intelligence Artificielle peut être utilisée à des fins de présélection » (« présélection » absent de la liste) | 121 |
| L'Oréal — « Charte IA : notre pacte » / « AI Charter » | 60 |
| Levi's — « Altoona, **IA**, USA » : le code de l'Iowa passe `AI_ACRONYM_RE` (`\bIA\b`) | 33 (9 sans autre mention) |
| Marella — « campagna vendite **AI** 2027 » = Autunno/Inverno, vocabulaire mode italien | 3 |
| **Total prouvé par motif** | **1 335 (41 %)** |
Preuve d'exécution (`auditi-titles.mts`) : `isAiRelated('Junior Global Pricing Manager', 'University degree … in … data science or statistics')` → **true** (`data scien` matche un intitulé de diplôme) ; `isAiRelated('Operations Manager', '… issues with Booster, My Copilot, and other systems')` → **true** (`\bcopilot\b`) ; « Stay current on emerging solutions (AI, automation…) » → **true** ; « Data & AI » comme nom d'équipe → **true**. Le commentaire du code annonce « ~1 % de vrais postes » ; la base en flagge 5,4 %. Par société, les flags à 100 % (Infuse 410/410, TRR 136/136, Quince 133/133, Peloton 49/49, Tulip 73/74) sont la signature d'un texte d'entreprise, pas d'un métier.

**C3. « Selling » = sellier (CONFIRMÉ).** `classifyFunction('Selling Associate - Womens Shoes')` → `atelier-craft` : le fragment `SELLI` (pour « sellier ») matche « SELLING ». Prod : 377 titres (« selling ») dont SAKS 259, Nordstrom 44, Ralph Lauren 23, Hermès 13 — des vendeurs comptés comme artisans, `isRetail=false`.

**C4. Machine learning = Ressources humaines (CONFIRMÉ).** `classifyFunction('Machine Learning Engineer')` → `hr-talent` : `LEARNING` de la règle RH, placée avant `it-data`. 22 titres prod (ASOS ×6, Nike ×3, Stripe ×3, Wing…). Même mécanisme : « Data Engineer (H/F) STAGE TALENT DAY » → `hr-talent` (`TALENT\b`), « Data Scientist » → `product-development-rd` (`SCIENTIST`, 47 titres prod), « Manufacturing Operations Semantic/Data Architect » et « Senior Director, Enterprise Architecture - AI & Data » → `design-creation` (`ARCHITECT`).

### HAUT

**H1. Séniorité par langue du titre (CONFIRMÉ).** `classifySeniority('Sales Associate')` → JUNIOR (`\bASSOCIATE\b` dans `JUNIOR_RE`) ; `'Conseiller de vente H/F'`, `'Client Advisor'`, `'Vendeur H/F'`, `'Sales Advisor'` → MID ; `'Sales Assistant'` → JUNIOR. En base prod : 6 160 « Sales Associate » sur 6 865 classés sont JUNIOR ; 3 541 conseillers/vendeurs sur 3 888 sont MID. Un « Retail Hiring Index » par séniorité lira « les États-Unis recrutent junior, la France confirmé » — c'est du vocabulaire, pas du marché. À ce compte, « Associate III » (Tapestry, niveau expérimenté) sort SENIOR par `\bIII\b` et « Sales Associate » JUNIOR : l'échelle interne d'une enseigne devient l'échelle du marché.

**H2. « Coordinator » = manager (CONFIRMÉ).** `MANAGER_RE` contient `COORDINAT(OR|EUR|RICE)` : « VM Coordinator », « Stock Coordinator », « Operations Coordinator - Boston », « Coordinateur.rice Données », « Coordinator, Promotions » → MANAGER. 706 titres prod. Un coordinateur est un contributeur individuel dans toutes les Maisons de l'échantillon.

**H3. « Assistant Manager, X » = direction de boutique quel que soit X (CONFIRMÉ).** Règle `(…|ASSISTANT|…) MANAGER\b` → `retail-store-management`. Faux dans l'échantillon : « Temp Assistant Manager, Network Development », « Client Insights Assistant Manager », « PR Assistant Manager », « Regional Operations & Distribution Assistant Manager », « Assistant Manager, High Jewelry Assortment », « Tech Team Lead » et « Engineering & Product Development Platforms Technology Team Lead » (`TEAM LEAD`). Prod : 685 titres « assistant manager » sans mot de boutique (ex. « Watches Merchandising Assistant Manager », « Young Talent & Employer Branding Assistant Manager », « Assistant Manager, Allocation & Inventory Management »).

**H4. Compétences : trois listes gonflées par du texte d'annonce (CONFIRMÉ).**
- `Événementiel` (`/events?\b/i`) : 17 420 offres, **455** contiennent réellement event management / événementiel / event planning… (SQL) → 97 % de faux (« in-store events », « training events », « life events »). 5ᵉ compétence du marché sur la page Métiers.
- `Workday` (`/\bworkday\b/i`) : 2 976 offres, **2 800** sont « Current employees, apply via your Workday account » / « log into Workday » (SQL) → 94 % de faux.
- `Français` : 332 faux (Nocibé 292/295 « territoire français … plus de 550 » — l'indice `plus\b` ; Sandro/Fursac 40/70 « vision exigeante d'un vestiaire … français » — l'indice `exig`). Preuve : `extractSkills('Nocibé, réseau de plus de 550 points de vente répartis sur tout le territoire français…')` → `["Français"]`.
- `Franchise` (792) : boilerplate Afflelou « 1er réseau de franchise » ; `Achats` via `\bbuying\b` sur « Task Associate » / « Beauty Advisor » (« customers buying ») ; `Stylisme` via `\bstyling\b` sur les coiffeurs ; `Développement durable` via `sustainab` sur « a sustainable, vibrant House » (PROBABLE, non chiffré).
- `Vente` (40 051), `Retail` (33 633), `Luxe` (14 408), `Leadership` (15 347) : présents sur la moitié de la base, ils n'apportent rien à un classement de compétences (MOYEN, question produit).
- Sains, vérifiés : `Lean / Six Sigma` 4 235/4 332 réels ; `Oracle`, `Blender`, `Cegid Y2`, `Rhino 3D` justes sur extraits.

**H5. Titres fréquents non classés en prod (top 50 sur toute la base, 8 732 non classés = 12,1 %).**
| n | Titre normalisé | Métier attendu |
|---|---|---|
| 1 476 (+34 saisonniers, +15 « Task », +14 « Task Lead ») | TASK ASSOCIATE (Ulta, dép. « Retail Associates ») | retail-operations (réassort / stock) |
| 202 (+26 +20 +16 « Aushilfe ») | WEIHNACHTSAUSHILFE (renfort de Noël, DE) | retail-client-advisor |
| 187 (+53 +20 +15) | DISPENSER / TRAINEE / RELIEF / PHARMACY DISPENSER (Boots) | hors référentiel (pharmacie) — null légitime, à documenter |
| 169 | BROW WAXING EXPERT (Ulta) | beauty-advisor |
| 157 (+88 +13 +7) | PHARMACIST / RELIEF / SUPERVISING / SUPPORT PHARMACIST (Boots) | hors référentiel — null légitime |
| 137 / 30 / 29 / 9 | TEMPORARY ASSOCIATE / ASSOCIATE MANAGER / ASSOCIATE III / ASSOCIATE (Tapestry) | retail-client-advisor (435 titres « Associate » seul) |
| 82 (+26) | KUNDENBERATER (DE) | retail-client-advisor |
| 71 (+13 « Retail Artist ») | SPECIALTY ARTIST - MAC | beauty-advisor |
| 60 (149 en base) | TEAM MANAGER (Primark) | retail-store-management |
| 56 / 39 / 20 | OPTOMETRIST / OPTICAL ASSISTANT / AUDIOPROTHÉSISTE | hors référentiel (santé) — null légitime |
| 53 | GUEST COORDINATOR (Ulta salon) | retail-operations |
| 28 / 26 | CUSTOMER HOST / CUSTOMER ASSISTANT | retail-client-advisor |
| 24 / 23 (101 en base) | STOREMANAGER / ASSISTENT SHOPMANAGER (mot collé, DE/NL) | retail-store-management |
| 19 | RETAIL STORES - RISK ASSOCIATE | retail-operations |
| 19 | CLIENT SUCCESS REPRESENTATIVE | customer-service |
| 16 | AGENT DE STOCK | retail-operations |
| 15 (201 en base) | ATHLETE III (Nike appelle ses vendeurs « Athletes ») | retail-client-advisor |
| 13 | RETAIL GOLF SERVICES ASSOCIATE | retail-client-advisor |
| 12 | BECARIO/INTERN STORES | retail-client-advisor (stage) |
| 11 | ASSET PROTECTION INVESTIGATOR | retail-operations |
| 11 | LEAD PIERCER | beauty-advisor |
| 10 / 8 | DORADCA KLIENTA / DORADCZYNI SPRZEDAŻY (PL) | retail-client-advisor |
| 10 | נציג/ת מכירות (HE, vendeur) | retail-client-advisor |
| 8 | COORDINATEUR STOCK ET TECHNIQUE | retail-operations |
| 8 | INITIATIVBEWERBUNG (candidature spontanée) | null légitime |
| 7 | REPLENISHMENT ASSOCIATE | retail-operations |
| 7 | DIRECTEUR ADJOINT | retail-store-management |
Local (239 non classés / 1 996) : CONSTRUCTEUR MOUVEMENT (3, horlogerie → atelier-craft), BOUTIQUE OFFICE EXECUTIVE / BOUTIQUE ADMINISTRATOR / BOUTIQUE ADMIN (7, → retail-operations), STAGIAIRE WEBMASTER, CLIENT PROJECTS DIRECTOR, TRÉSORIER GROUPE (→ finance : `TRESORER` ne couvre pas « trésorier »), APPRENDISTA ADDETTO AL TAGLIO, MÉCANICIEN RÉGLEUR, AUSZUBILDENDER ZUM WERKZEUGMECHANIKER, CRC AMBASSADOR, 매장 직원 (KO, employé de magasin), STAGIAIRE BUREAU TECHNIQUE HABILLAGE, WERKSTUDENT RETAIL EXPERIENCE, SERVICE OFFICER - TECH, BACK-OFFICE ADMIN, GUNMAKER, HIGH END VIP MANAGER, SPÉCIALISTE MÉTIER POLISSAGE (→ atelier : `POLISH|POLISSEU` ne couvre pas « polissage » seul), MD MANAGER, RESPONSABLE DE LIGNE PRODUIT, MASCHINENBEDIENER, ASSISTANT PLANNER, STAGE - ASSISTANT CLIENTELING INTERNATIONAL (→ crm : la règle exige un mot après CLIENTELING).

### MOYEN

**M1. Ordre des règles : le mot d'un autre domaine gagne.** Preuves (`auditi-titles.mts`) : « Contrôleur de gestion industriel » → manufacturing-quality (`INDUSTRIEL`), « Manufacturing Project Controller » → manufacturing-quality, « Joaillier SAV » → customer-service (`SAV`), « Cleaning Technician » → manufacturing-quality (`TECHNICIAN`), « Restaurant Host - Marketplace Café » → ecommerce-digital (`MARKETPLACE`), « B2B Operations Specialist » → retail-operations, « Acheteur Indirect » → merchandising-buying (la règle `ACHATS (INDIRECTS…)` de la supply chain arrive après `ACHETEU`), « STAGE - Assistant Sales Merchandiser » → retail-client-advisor (`\bSALES\b`), « Développeur Peaux Précieuses » → it-data (`DEVELOP(ER|PEU)`), « Account Payable Trainee - … Process Improvement » → manufacturing-quality (`PROCESS`), « Senior Manager, Legal Operations and Innovation » → product-development-rd (`INNOVATION`), « Senior Data Scientist, Growth » → ecommerce-digital (`GROWTH`), « Quality Engineer — Omnichannel Order Execution » → ecommerce-digital.

**M2. Le monde online est compté boutique (isRetail = true).** « Regional Online Retail Director » → retail-area-management, « Online Retail Operations Coordinator » → retail-operations, « Operations Supervisor ECommerce » → retail-store-management, « E-Boutique Client Advisor » → retail-client-advisor (la règle `CLIENT ADVISOR (REMOTE|…|E-?COMMERCE)` ne connaît pas « E-Boutique »), « Client Contact Consultant, E-Commerce » → ecommerce-digital au lieu de customer-service (le lookahead `(?! … CONSULTANT)` de la règle customer-service l'exclut).

**M3. Le magasin est compté direction générale.** « General Manager » (Ulta, département « Retail Management ») → strategy-management + EXECUTIVE ; 63 GM Ulta, 12 VIA, 11 Ralph Lauren, 7 PGA Tour Superstore : des directeurs de magasin qui gonflent « Dirigeants ». « CRO Manager » (Conversion Rate Optimization) → EXECUTIVE par `\bC[EFOMTIHR]O\b`. « Directeur Adjoint de Boutique » → DIRECTOR (contestable).

**M4. Vocabulaire manquant, par langue.** Italien : « Incastonatore » (sertisseur), « Apprendista » (→ APPRENTICESHIP), « Addetto/a alla preparazione », « Responsabile Qualità » (`QUALITE|QUALITY` ne couvrent pas « qualità » → « QUALITA » après retrait des accents). Allemand : « Lehrstelle » (→ APPRENTICESHIP ; « Lehrstelle als Uhrmacher » sort MID), « Kundenberater », « Aushilfe », « Storemanager », « Maschinenbediener », « Auszubildender ». Espagnol : « Cajeros/as ». Portugais : « Responsável de Turno ». Danois (source `normal`) : « Souschef » = adjoint de magasin, classé hôtellerie (12 chez Normal) ; « Elev » = apprenti. Hongrois : « Szépségtanácsadó » (conseillère beauté). Français : « Gestionnaire / Chargé d'ordonnancement » (→ supply), « Trésorier », « Sculpteur », « Directrice de Collection », « Responsable de collection », « Responsable des Ventes », « Responsable Retail », « Welcome Host », « Informaticien », « Chef.fe » (Québec : « Chef.fe d'équipe » → hospitality, 58 titres), « Stagaire » (faute fréquente, 1).

**M5. Coquilles de règles.** « Client Experience Manager » → crm-clienteling mais « Senior Manager, Client Experience » → NULL (l'ordre des mots) ; « Clienteling Product Management Intern » → strategy-management ; « People & Culture In-Store Business Partner » → NULL (`PEOPLE (PARTNER|…)` exige l'adjacence) ; « Operations Leader » (dép. Retail) → retail-client-advisor par le département faute de règle titre ; « Salesforce Technology Support Specialist » → NULL ; « Stock Executive », « Boutique Administrator », « Full Time Operation Associate » (singulier) → NULL ; « Retail Experience Intern », « Responsable Retail », « Alternance - Richemont Retail Génération » → NULL (« RETAIL » seul n'est une règle que côté département).

### BAS

- « Specialist » / « Expert » → SENIOR (`SENIOR_RE`) : « ESG Specialist », « Retail Operations Specialist », « Skin Care Expert », « Legal Specialist », « Brow Waxing Expert » — contestable, à trancher (un « Specialist » Ulta est un vendeur).
- « Assistant Store Leader » (Tapestry, 40 titres « store leader ») → JUNIOR : `MANAGER_RE` ne connaît pas « Store Leader ».
- Séniorité par le contrat plutôt que le titre : 3 Hermès « CDI - Sellier Maroquinier » ont `contract = ALTERNANCE` en base → APPRENTICESHIP. Le titre dit CDI, la colonne dit alternance : donnée source contradictoire (PROBABLE côté adaptateur Hermès), pas une erreur de règle.
- Notion (`\bnotion\b(?! de|du|des|of|d')`) : « sans notion relative à l'ethnie » passe (1/3 des extraits) ; Sketch : « hand sketch designs » (verbe) 2/3 des extraits. Volumes faibles (20, 68).

## Hors périmètre de l'axe, remonté parce que ça fausse les chiffres

- **Sources hors secteur, CONFIRMÉ par leurs titres** (SQL, 3 titres par société) : `stripe-stare` = Stripe Inc. (« Abuse Investigator », « Account Executive, AI Sales » — 619 offres classées sous « Stripe & Stare », une marque de lingerie), `toast` = Toast Inc., logiciel de restauration (« Android Software Engineer », « Bilingual Strategic Cuisines Account Executive »), `infuse` = agence B2B (410 offres, 100 % IA), `bentley` = Bentley Systems (« Software Quality Analyst II »), `tulip` = Tulip Interfaces, `avila` = Efore/Sokli (énergie finlandaise), `ohme` (bornes de recharge), `towa` (conseil), `dept` (agence), `wing` (drones Alphabet), `peloton`. C'est le motif « sonde-slug ~70 % fausses » déjà en mémoire ; ici il alimente directement l'indice IA (Infuse + Toast + Stripe = 946 des 3 235 flags).
- **Offres périmées encore actives** : 3 stages Chanel « Juillet 2023 » (`postedAt` 2023-01 à 2023-04, `lastSeenAt` 2026-09-06 13:27) — la source les re-liste, donc D23 les garde. Cas pour l'axe 1/5, pas celui-ci.
- **Couverture** : à 15:4x UTC, 14 881 actives (20,7 %) avaient `taxonomyVersion = 0` (ulta-jibe 9 959, urbn 2 243, ralph-lauren 1 082, pandora 1 001, hm 624, rituals 581) ; l'ingest en cours les remplit. Toute page qui affiche « part retail » ou « non classé » doit dater sa mesure.

## Règles à ajouter — avec les titres exacts qui les prouvent

Ordre = ordre d'insertion dans `FUNCTION_RULES` (la première qui matche gagne).

**Métier**
1. `beauty-advisor` : `\bSTYLIST\b` quand le département matche `SALON` ou le titre `HAIR|SALON|MASTER STYLIST|ELITE STYLIST|BROW|LASH|WAX|PIERC|SPECIALTY ARTIST|RETAIL ARTIST|SZEPSEGTANACSADO` — titres : « Stylist » (dép. Salon Professionals), « Master Stylist », « Elite Stylist », « Brow Waxing Expert », « Specialty Artist - MAC », « Retail Artist », « Lead Piercer », « La Mer Szépségtanácsadó ».
2. `retail-client-advisor` avant `design-creation` : `SALES STYLIST|STYLIST\s*/\s*SALES|\bSTYLIST\b.*(HOURS|H\b|PART[- ]TIME|FULL[- ]TIME|BLOOMINGDALES|OUTLET)|SELLING (ASSOCIATE|SPECIALIST|SUPERVISOR|PROFESSIONAL)|\bATHLETE\b|KUNDENBERATER|(WEIHNACHTS)?AUSHILFE|DORADCA|DORADCZYNI|CUSTOMER (HOST|ASSISTANT)|^(TEMPORARY |SEASONAL |FULL TIME |PART TIME )?ASSOCIATE( I{1,3})?$|BECARIO|RETAIL (EXPERIENCE|TRAINEE|GENERATION)|JEWELLERY EXPERT|WELCOME HOST|נציג` — titres : « Stylist 16 hours », « Full-Time Stylist (Bloomingdales - North Michigan) », « Designated Selling Associate - Luxottica », « Athlete III », « Kundenberater (m/w/d) », « Weihnachtsaushilfe (m/w/d) », « Temporary Associate », « Associate III », « Retail Experience Intern », « Jewellery Expert », « Welcome Host Zürich », « 매장 직원 ».
3. Retirer `SELLI` de `atelier-craft` au profit de `SELLIER|SELLERIE|SELLIÈRE` — titre : « Selling Associate - Womens Shoes » (faux), « CDI - Sellier Maroquinier » (doit rester).
4. `it-data` avant `hr-talent` pour `MACHINE LEARNING|\bML\b|DATA (SCIENTIST|ENGINEER|ARCHITECT|ANALYST)|INFORMATICIEN|SEMANTIC` et retirer `SCIENTIST` de `product-development-rd` quand précédé de DATA — titres : « Senior Machine Learning Engineer, ITC », « Data Engineer (H/F) STAGE TALENT DAY », « Data Scientist Intern », « Senior Data Scientist, Growth », « Manufacturing Operations Semantic/Data Architect », « Senior Director, Enterprise Architecture - AI & Data », « Apprentissage d'informaticien∙ne CFC ». Corollaire : « TALENT DAY » (Cartier) doit être neutralisé avant la règle RH.
5. `retail-operations` : `TASK (ASSOCIATE|LEAD)?|REPLENISHMENT|RISK ASSOCIATE|ASSET PROTECTION|GUEST COORDINATOR|AGENT DE STOCK|STOCK (EXECUTIVE|COORDINAT)|RETAIL STOCK|OPERATION ASSOCIATE|BOUTIQUE (ADMIN\w*|OFFICE)|BACK[- ]?OFFICE|CAJER[OA]S?|OPERATIONS LEADER` — titres : « Task Associate », « Seasonal Retail Stock - Fashion Valley », « Full Time Operation Associate », « Boutique Administrator », « Stock Executive », « Cajeros/as Part Time », « Operations Leader - Full Time », « Back-office Admin ».
6. `retail-store-management` : `^TEAM MANAGER|STORE ?MANAGER|SHOPMANAGER|RESPONSABLE (DES VENTES|RETAIL)|RESPONSAVEL DE TURNO|SOUSCHEF|DIRECTEUR\S* ADJOINT` — titres : « TEAM MANAGER », « Storemanager (m/w/d) », « Assistent Shopmanager », « Responsable des Ventes H/F », « Responsable Retail », « Responsável de Turno », « Souschef » (source `normal`, danois), « DIRECTEUR/RICE ADJOINT/E ».
7. `finance` avant `manufacturing-quality` : `CONTROLEU\S* DE GESTION|PROJECT CONTROLLER|TRESORI|ACCOUNT PAYABLE` — titres : « CDI - Contrôleur de gestion industriel (H/F) », « Fashion & Accessories Manufacturing Project Controller », « Trésorier Groupe H/F », « Account Payable Trainee - Project management & Process Improvement ».
8. `atelier-craft` avant `customer-service` : `JOAILLI\S* SAV|INCASTONAT|SCULPT|POLISSAGE|ADDETT[OAI] AL TAGLIO|CONSTRUCTEUR MOUVEMENT|GAREU|ADDETT[OAI] ALLA PREPARAZIONE` — titres : « Joaillier SAV (H/F) », « Incastonatore », « CDI Sculpteur (H/F) », « Spécialiste métier Polissage », « Apprendista Addetto al Taglio », « Constructeur mouvement », « ALTERNANCE - Gareur de métiers textiles ».
9. `merchandising-buying` : `SALES MERCHANDIS|DIRECT(EUR|RICE) DE COLLECTION|RESPONSABLE DE COLLECTION|^MD MANAGER|^PLANNER$|ASSISTANT PLANNER|RESPONSABLE DE LIGNE PRODUIT` — titres : « STAGE - Assistant(e) Sales Merchandiser Fashion Accessoires », « Directrice de Collection Ceinture », « Responsable de collection - fashion accessoires », « MD Manager », « Planner ».
10. `supply-chain-logistics` avant `merchandising-buying` : `ACHETEU\S* INDIRECT|ORDONNANCEMENT|STRATEGIC SOURCING` — titres : « Acheteur Indirect (H/F) », « Gestionnaire d'ordonnancement (H/F) », « Chargé d'Ordonnancement Prêt-à-Porter Femme », « Strategic Sourcing Manager, Store Construction ».
11. `crm-clienteling` : `CLIENT EXPERIENCE\b|CLIENTELING\b|CLIENT TREATMENT|EXPERIENCE CLIENT` — titres : « Senior Manager, Client Experience », « Clienteling Product Management Intern », « Client Treatment Manager », « Stage Assistant CDP Expérience Client », « Client Experience Assistant », « Stage - Assistant(e) Clienteling International ».
12. `customer-service` : retirer `CONSULTANT` du lookahead pour « CLIENT CONTACT » ; ajouter `E-?BOUTIQUE|CLIENT SUCCESS` — titres : « Client Contact Consultant, Fixed Term, E-Commerce », « E-Boutique Client Advisor », « Client Success Representative (Remote, Contract) ».
13. `ecommerce-digital` avant `retail-*` : `ONLINE RETAIL|E-?COMMERCE OPERATIONS|OPERATIONS SUPERVISOR E-?COMMERCE` — titres : « Regional Online Retail Director », « Online Retail Operations Coordinator », « Operations Supervisor ECommerce - Evenings » (ou bien : garder le métier retail-ops mais `isRetail=false` — décision produit).
14. `hospitality` avant `ecommerce-digital` : `RESTAURANT|CAFE|CREW MEMBER KITCHEN` doit primer sur `MARKETPLACE` — titres : « Restaurant Host - Marketplace Café », « Crew Member Kitchen - 1600 Lully ».
15. `admin-facilities` : `CLEANING|BACK[- ]?OFFICE ADMIN` avant `TECHNICIAN` — titre : « Cleaning Technician (FTC - Workload Support) ».
16. `marketing-communication` : `PR ASSISTANT MANAGER|COORDINATOR, PROMOTIONS|PROMOTIONS?\b` — titres : « PR Assistant Manager », « Coordinator, Promotions ».
17. `hr-talent` : `PEOPLE (&|AND) CULTURE` — titre : « People & Culture In-Store Business Partner ».
18. `product-development-rd` : `DEVELOPPEU\S* (PEAUX|MATIERES|CUIR)|DEVELOPPEMENT (MATIERES|TECHNIQUE)` — titres : « CDI - Développeur Peaux Précieuses », « Directeur Développement Matières et Composants », « Alternance - Assistant(e) Ingénieur développement technique ».
19. `legal-compliance` avant `product-development-rd` : `LEGAL OPERATIONS` — titre : « Senior Manager, Legal Operations and Innovation ».
20. `wholesale-b2b` avant `retail-operations` / `retail-area-management` : `\bB2B\b` en tête ; `FIELD FORCE|SALES DIRECTOR` ; Beiersdorf « Senior Area Sales Manager (Central) » est du terrain FMCG, pas de la boutique (`isRetail=false`) — titres : « B2B Operations Specialist », « National Field Force Manager », « Efore - Global Sales Director ».
21. « Assistant Manager, X » / « Team Lead » : n'aller en `retail-store-management` que si X est vide ou boutique ; sinon classer X — titres : « Temp Assistant Manager, Network Development », « Van Cleef & Arpels Client Insights Assistant Manager », « Assistant Manager, High Jewelry Assortment », « Regional Operations & Distribution Assistant Manager (Accessories) », « Tech Team Lead », « Engineering & Product Development Platforms Technology Team Lead », « Watches Merchandising Assistant Manager, HKMO », « Assistant Manager, Allocation & Inventory Management ».
22. `comparableTitle` : traiter « .fe » (Québec) et « ∙ne / ∙in » (point médian suisse) comme marques de genre — titres : « Chef.fe d'équipe (Temps plein) », « Apprentissage d'informaticien∙ne CFC », « Lehrstelle als Uhrmacher∙in EFZ ». Accents : `QUALITA` (it.) à ajouter à `QUALITE|QUALITY` — titre : « Responsabile Qualità HCI ».
23. Département : `^RETAIL ASSOCIATES$` → retail-client-advisor, `SALON` → beauty-advisor, `RETAIL MANAGEMENT` → retail-store-management (déjà là mais « General Manager » est capté avant par la règle titre).

**Séniorité**
24. Retirer `\bASSOCIATE\b` de `JUNIOR_RE` (ou le limiter à `ASSOCIATE (ANALYST|MANAGER|DIRECTOR)`) — le poste de vente standard américain n'est pas junior ; « Sales Assistant » idem. Titres : « Sales Associate », « Sales Assistant », « Boutique Assistant ».
25. Retirer `COORDINAT(OR|EUR|RICE)` de `MANAGER_RE` (→ MID) — « VM Coordinator », « Operations Coordinator - Boston », « Coordinateur.rice Données », « Coordinator, Promotions », « Production Sample Coordinator ».
26. `APPRENTICESHIP_RE` : `LEHRSTELLE|APPRENDIST|ELEV\b|AUSZUBILDEND` — « Lehrstelle als ICT-Fachmann/-frau », « Lehrstelle als Uhrmacher∙in EFZ », « Apprendista Addetto al Taglio », « Auszubildender zum Werkzeugmechaniker 2027 ». `INTERNSHIP_RE` : `STAGAIRE` (faute) — « Stagaire Excellence Opérationnelle ».
27. `EXECUTIVE_RE` : exclure `CRO` quand suivi de MANAGER/SPECIALIST (conversion) ; `GENERAL MANAGER` → MANAGER quand la société est une enseigne ou le département `RETAIL MANAGEMENT` — « CRO Manager », « General Manager » (Ulta).
28. `MANAGER_RE` : `STORE LEADER` — « Assistant Store Leader ».
29. À trancher (Loïc) : « Specialist / Expert » = SENIOR ou MID ; « Directeur Adjoint » = DIRECTOR ou MANAGER ; « Associate III » (échelle Tapestry) = SENIOR ?

**IA**
30. `PROCESS_SENTENCE_RE` : ajouter `pr[ée]s[ée]lection|screening|personal information|train(ing)? (any )?(AI|ML) models|do not employ|we (use|leverage|believe)|at (toast|infuse)|company values|hungry to build|charte IA|AI charter|our pact|notre pacte|founded in|we handle all of the work|proprietary technology` — phrases exactes : « L'utilisation de l'Intelligence Artificielle peut être utilisée à des fins de présélection » (Penningtons), « do not use any personal information to train any AI models » (H&M), « We do not employ machine learning technologies during this phase » (Infuse), « AI at Toast … We believe learning new AI tools empowers us » (Toast), « using AI and machine learning to determine optimal pricing » (The RealReal), « build and deploy proprietary technology, AI, and analytics » (Quince), « Charte IA : notre pacte » (L'Oréal).
31. `AI_ACRONYM_RE` : exclure « IA » précédé d'une virgule et suivi d'une virgule/USA (`, IA,` / `IA, USA` = Iowa) ; exclure « AI » suivi d'une saison ou d'une année (`AI 2027`, `AI/PE`, `SS/AI` = Autunno-Inverno) — « Altoona, IA, USA », « campagna vendite AI 2027 ».
32. `AI_PHRASE_RE` : `data scien` ne doit compter que hors intitulé de diplôme (`degree|master|bachelor|B\.?Sc|M\.?Sc|diplôme|formation|studies|laurea|étudiant` à moins de 40 caractères) et hors nom d'équipe (`Data Scientists, Analysts`) — « University degree … in … data science or statistics », « Master's in Data Science », « lead a group of Data Analysts, Data Scientists ». `\bcopilot\b` seul (Microsoft Copilot, « My Copilot ») n'est pas un poste IA.
33. Principe à graver, mesuré : **un flag IA porté par 100 % des offres d'une société est un texte d'entreprise, pas un métier** (Infuse 410/410, TRR 136/136, Quince 133/133, Peloton 49/49). Une garde « part IA par société > 80 % → suspect » attraperait tous les cas ci-dessus.

**Compétences**
34. `Événementiel` : `event (management|planning|coordination|production|marketing)|[eé]v[eé]nementiel|organisation d.[eé]v[eé]nements` au lieu de `events?\b` (455 vrais sur 17 420).
35. `Workday` : exclure la fenêtre `apply|candidat|log ?in|account|portal` à ±60 caractères (2 800 faux sur 2 976).
36. `LANGUAGE_CUE_RE` : retirer `plus\b` et `exig` (ou exiger `is a plus|un plus|serait un plus`) — Nocibé « réseau de plus de 550 points de vente … territoire français », Sandro/Fursac « vision exigeante … vestiaire … français ».
37. `Achats` : `\bbuying\b` seulement près de `team|office|merchandis|department|role|experience in` ; `Stylisme` : exclure `hair styling` ; `Franchise` : exclure `réseau de franchise` (présentation) ; `Développement durable` : exclure `sustainable (growth|House|future|business)` ; `Sketch` : exiger `Figma, Sketch|Sketch, Figma|Sketch app`.
38. Décision produit : `Vente`, `Retail`, `Luxe`, `Leadership` comme « compétences » du marché (40 k / 33 k / 14 k / 15 k) — utiles pour un filtre, inutiles pour un classement.

## Ce qui est bon, avec la preuve

- Le cœur retail est juste : 406/1 996 locales et 23 230/72 028 prod en `retail-client-advisor` ; dans les deux échantillons, aucun « Sales Associate », « Client Advisor », « Conseiller de vente », « Beauty Advisor », « Store Manager », « Visual Merchandiser », « Stock Associate », « Cashier » n'est mal classé (≈ 55 % de chaque échantillon).
- Les langues ne prennent pas les adjectifs de nationalité (`« A French luxury house »` → `[]`, `« Italian brand … required »` → `["Italien"]` seulement parce que `required` est à 60 caractères — cas limite à connaître).
- Les phrases de process IA prévues (« refrain from using AI tools during interviews », « artificial intelligence in our recruitment process ») sont bien filtrées (→ `false`).
- Stocké = recalculé (1 écart sur 49 667) : pas de dérive entre prod et dépôt.
