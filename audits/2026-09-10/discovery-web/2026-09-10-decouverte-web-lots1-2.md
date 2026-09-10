# Découverte web d'acteurs — Lots 1 & 2 consolidés (2026-09-10)

**Méthode** : recherche web réelle (WebSearch + FetchURL), sondes curl/API publiques, et **navigateur réel piloté (WebBridge)** pour les sites anti-bot. Absence systématiquement vérifiée par grep sur : `maisons.csv`, `sources.csv`, `export-maisons-etat.csv`, `maisons-enrichies-grandes-marques.csv`, `GROSSES-ENSEIGNES-MANQUANTES.csv`, `A-TROUVER-loic.csv`. FashionJobs utilisé en découverte de noms uniquement, jamais pour les offres. **Aucune création ni activation en base.** Toutes les preuves datées du 2026-09-10.

**Garanties** : aucun domaine, ATS, tenant, compteur ou lien de parenté inventé ; un échec HTTP n'est jamais présenté comme une preuve d'absence.

---

## Synthèse chiffrée

| Catégorie | Nombre |
|---|---|
| Nouveaux acteurs avec portail documenté | 29 |
| Nouvelles sources d'acteurs déjà référencés (dont 8 victoires A-TROUVER) | 26 |
| Déjà couverts / rien à faire | 7 |
| Sans portail structuré (documenté) | 16 |
| Corrections catalogue suggérées | 6 |
| Encore non résolus | 8 |
| ATS supplémentaires identifiés (hors 40 adaptateurs existants) | 15 |

---

## 1. Nouveaux acteurs — portail carrière documenté

| Acteur | Type | Secteur | Groupe parent attesté | Présence chez nous | Site officiel | Portail carrière | ATS / tenant | API publique observée | Périmètre géographique | Preuves et date | Action suivante |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Swarovski | Marque + retail | Joaillerie | Swarovski (indépendant) | absent vérifié | swarovski.com | swarovski.wd3.myworkdayjobs.com/swarovski | Workday — tenant `swarovski`, site `swarovski` | CXS validée : POST /wday/cxs/swarovski/swarovski/jobs → total 511, dont 28 « Paris » | Monde, France incluse | API testée 10/09/2026 | Ajouter maison + source Workday (prêt à brancher) |
| Pandora | Marque + retail | Joaillerie | Pandora A/S (Copenhague) | absent vérifié | pandoragroup.com | careers.pandoragroup.com (locale /fr/) | Portail Paradox devant SAP SuccessFactors (career2.successfactors.eu, company=`pandoraas`) | applyURL SuccessFactors en JSON inline | Monde, France incluse | Pages /fr/ sondées 10/09/2026 | Scraper portail Paradox ou flux SuccessFactors |
| Douglas Group (couvre Nocibé) | Distribution beauté | Retail beauté | Douglas Group (coté Francfort) | absent vérifié | douglas.group | careers.douglas.group | SuccessFactors career55.sapsf.eu, company=`DOUGLAS` | Liens d'offres SF embarqués dans le HTML | Europe entière, France via Nocibé | Probe 200 + grep SF, 10/09/2026 | 1 source groupe couvre Douglas + Nocibé |
| Laboratoires Expanscience (Mustela) | Laboratoire dermo-cosmétique | Beauté | Indépendant familial (B Corp) | absent vérifié | expanscience.com | expanscience.wd3.myworkdayjobs.com/en-US/Expanscience_Careers | Workday — tenant `expanscience`, site `Expanscience_Careers` | CXS validée : total 35 | France + 13 filiales | CXS live 10/09/2026 | Ajouter maison + source Workday |
| Maria Galland Paris | Soin institut/spa | Beauté pro | Klosterfrau Healthcare Group | absent vérifié | mariagalland.com | mariagalland.softgarden.io/fr/vacancies | softgarden — tenant `mariagalland` | API frontend softgarden non testée | FR, DE, ES, EN | curl 200, 10/09/2026 | Adaptateur softgarden à créer |
| Groupe Léa Nature (Jonzac, SO'BiO étic) | Groupe bio | Beauté / hygiène bio | Compagnie Léa Nature | absent vérifié | leanature.com | job.recrutement-leanature.com/fr/annonces | Cegid DigitalRecruiters | Listing SSR Nuxt, pas d'endpoint public identifié | France (24 sites) | curl 200, 10/09/2026 | Réutiliser l'adaptateur DIGITALRECRUITERS existant |
| Laboratoire SVR | Laboratoire dermo-cosmétique | Beauté | Kresk Cosmetics | absent vérifié | fr.svr.com | kreskcosmetics.com/offresemploi (lien officiel) | Aucun ATS — page WordPress renvoyant vers HelloWork et JobTeaser | Non | France | curl 200, 10/09/2026 | Source primaire = page entreprise HelloWork |
| CWF — Children Worldwide Fashion (Billieblush, Carrément Beau, Kids Around, licences BOSS/Kenzo Kids…) | Groupe licences enfant | Mode enfant premium | CWF SAS (Les Herbiers, indépendant) | absent vérifié | groupecwf.com | careers.werecruit.io/fr/groupe-cwf | WeRecruit — tenant `groupe-cwf` | Non observée | 80+ pays distribution ; offres France | Portail actif 10/09/2026 | Ajouter source WeRecruit ; rattacher les marques CWF |
| Smallable | E-commerce / concept store famille | Mode & lifestyle premium | Indépendant (Paris) | absent vérifié | smallable.com | welcometothejungle.com/fr/companies/smallable/jobs | Welcome to the Jungle — slug `smallable` | API WTTJ connue du pipeline | France | Page WTTJ active 10/09/2026 | Ajouter via adaptateur WTTJ existant |
| Damiani Group (Damiani, Salvini, Bliss, Calderoni, Rocca, Venini) | Groupe joaillier | Joaillerie | Damiani S.p.A. (coté Milan) | absent vérifié | damianigroup.com | careers.damianigroup.com | SuccessFactors career55.sapsf.eu, company=`damianispa` | Board jobs2web HTML | IT, CH, HK, Dubaï, Madrid, Mexico ; France non observée | Portail consulté 10/09/2026 | Ajouter via adaptateur SUCCESSFACTORS |
| Watches of Switzerland Group | Détaillant multi-marques | Horlogerie | Coté LSE (indépendant) | absent vérifié | thewosgroupplc.com | ukcareers./usacareers.thewosgroup.com | eArcu | Page résultats publique | UK + US, aucune offre France observée | 10/09/2026 | Priorité faible (pas de France) |
| Selfridges | Grand magasin luxe | Mode/beauté | Selfridges Group : Central Group 60 % / PIF 40 % (10/2024) | absent vérifié | selfridges.com | jobsearch.selfridges.com | Tribepad | HTML crawlable (offres sous /jobs/job/…) | UK | Offres live IDs 7147-7164, 10/09/2026 | Adaptateur Tribepad à créer |
| Liberty London | Grand magasin luxe | Mode/design | Liberty Ltd | absent vérifié | libertylondon.com | libertylondon.com/uk/careers | Teamtailor | Non testée | UK | Sondage 200, 10/09/2026 | Adaptateur Teamtailor existant |
| Fenwick | Grand magasin premium | Mode/beauté/food | Fenwick Ltd (familial) | absent vérifié | fenwick.co.uk | careers.fenwick.co.uk | Eploy (assets /db_assets/production/1936/) | Non testée | UK (9 magasins) | Offres live 10/09/2026 | Adaptateur Eploy à créer |
| Fortnum & Mason | Retail luxe food | Épicerie fine | Fortnum & Mason PLC (Wittington) | absent vérifié | fortnumandmason.com | careers.fortnumandmason.com | Eploy (assets /db_assets/production/2844/) | Non testée | UK | Offres live 10/09/2026 | Adaptateur Eploy |
| KaDeWe Group (KaDeWe, Alsterhaus, Oberpollinger) | Grands magasins luxe | Mode/beauté/food | Central Group / Selfridges Group | absent vérifié | kadewe.de | kadewe-kadewe.career.softgarden.de (+ 2 boards jumeaux) | softgarden ×3 (33 offres KaDeWe, 40 Alsterhaus) | jobdb softgarden à tester | Allemagne | Sondages 10/09/2026 | 3 boards softgarden |
| Galeria (ex-Karstadt Kaufhof) | Grands magasins | Mode/maison | GALERIA S.à r.l. & Co. KG | absent vérifié | galeria.de | karriere.galeria.de/jobsuche | rexx probable (~198-204 offres) — à confirmer | Non | Allemagne | Recherche 10/09/2026 ; sondage direct 403 | Confirmer rexx en navigateur |
| El Corte Inglés | Grands magasins | Mode/maison/voyages | El Corte Inglés S.A. | absent vérifié | elcorteingles.es | empleo.elcorteingles.es | Portail maison (SPA Angular) | API interne à reverse-engineer | Espagne + Portugal | Sondage 200, 10/09/2026 | Scraper la SPA ou son API JSON |
| Macy's Inc (Macy's + Bloomingdale's) | Grands magasins | Mode/maison | Macy's, Inc. (NYSE) | absent vérifié | macys.com / bloomingdales.com | macysjobs.com | Oracle Cloud HCM — tenant `ebwh.fa.us2.oraclecloud.com`, site CX_1001 | API ORC Candidate Experience à tester | USA | Redirection vérifiée 10/09/2026 | Adaptateur ORACLE_HCM existant |
| SSENSE | E-commerce luxe | Mode luxe | SSENSE (privé, Montréal) | absent vérifié | ssense.com | careers.ssense.com | Teamtailor | À tester | Canada + international | Sondage /jobs 200, 10/09/2026 | Adaptateur Teamtailor existant |
| Lane Crawford | Grands magasins luxe | Mode luxe | Lane Crawford Joyce Group (famille Woo) | absent vérifié | lanecrawford.com | careers.lanecrawford.com.hk | SAP SuccessFactors (careersite 6216f8cc) | Company code à identifier | HK + Chine continentale | Sondage 200, 10/09/2026 | Ajouter careersite SF |
| Chalhoub Group (couvre Level Shoes) | Retail luxe (distributeur) | Mode/beauté luxe | Chalhoub Group (Dubaï) | absent vérifié | chalhoubgroup.com | careers.chalhoubgroup.com | Teamtailor | À tester | Moyen-Orient + international | Sondage 200, 10/09/2026 | Source groupe Teamtailor |
| Citizen | Fabricant | Horlogerie | Citizen Watch Co. (TSE) | absent vérifié | citizenwatch-global.com | citizen.co.jp/recruit/ | Pas d'ATS tiers détecté | n/a | Japon uniquement | 10/09/2026 | Hors périmètre France ; archiver |
| Beymen | Grand magasin / retailer luxe | Retail luxe | Beymen Group (Mayhoola/Qatar — plus aucun lien avec Boyner) | A-TROUVER → résolu | beymengroup.com | jobs.flowq.com/company/beymengroup | FlowQ (ATS turc), tenant `beymengroup` | Non documentée (site JS) | Turquie | curl 10/09/2026 | Connecteur FlowQ à créer |
| Vakko | Maison de luxe | Mode/luxe | Vakko Holding (famille Hakko) | A-TROUVER → résolu | vakko.com.tr | vakko.talentics.app | Talentics (ATS turc, backend Firebase) | Pas d'API JSON documentée | Turquie | curl 10/09/2026 | Connecteur Talentics à créer |
| Al Tayer Group (couvre Ounass) | Retail luxe | Distribution | Al Tayer Group | absent vérifié | altayer.com | altayer.com/careers | Oracle Cloud HCM — tenant `hchx.fa.em2.oraclecloud.com`, site CX_1 | hcmRestApi recruitingCEJobRequisitions (finder à calibrer) | EAU / Moyen-Orient | URL Oracle extraite du HTML 10/09/2026 | Adaptateur ORACLE_HCM ; vérifier présence Ounass dans les offres |
| Namshi | E-commerce mode | Mode | noon (rachat 2022, à confirmer) | absent vérifié | namshi.com | careers.smartrecruiters.com/Namshi | SmartRecruiters — slug `Namshi` | api.smartrecruiters.com/v1/companies/Namshi/postings → totalFound 6 | EAU | API testée 10/09/2026 | Adaptateur SMARTRECRUITERS existant |
| Joyce Boutique | Retail luxe | Distribution | Joyce Boutique Holdings | absent vérifié | joyce.com | joyce.com/careers/ | Portail propre | Non | HK/Chine | 200 le 10/09/2026 | Scraper la page careers |
| Kirna Zabête | Retail luxe | Mode | Indépendant | absent vérifié | kirnazabete.com | kirnazabete.com/pages/careers | Page Shopify | Non | US | 200 le 10/09/2026 | Scraper la page |

---

## 2. Nouvelles sources pour acteurs déjà référencés

Inclut les résolutions de `NON_RESOLUE`, `ATS_A_TROUVER`, `ECHEC_CONFIG`, les victoires `A-TROUVER-loic` et les cas anti-bot résolus au navigateur réel.

| Acteur | Type | Secteur | Groupe parent attesté | Présence chez nous | Site officiel | Portail carrière | ATS / tenant | API publique observée | Périmètre géographique | Preuves et date | Action suivante |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Rolex** | Manufacture | Horlogerie | Fondation Hans Wilsdorf | NON_RESOLUE → **résolu navigateur** | rolex.com | carrieres-rolex.com | SAP SuccessFactors jobs2web — company=`rolexsa` | Careersite SF public (~35 lignes d'offres) | Genève/Bienne (Suisse) | Navigateur réel 10/09/2026 (le 403 Akamai ne bloquait que curl) | Ajouter via adaptateur SUCCESSFACTORS |
| **La Rinascente** | Grands magasins | Mode/luxe | Central Group | A-TROUVER (anti-bot) → **résolu navigateur** | rinascente.it | rinascente.intervieweb.it/it/career | Intervieweb / In-recruiting — tenant `rinascente` | Non testée | Italie | Navigateur réel 10/09/2026 | Adaptateur Intervieweb à créer (couvre aussi Cyrillus) |
| **Breuninger** | Grands magasins premium | Mode | E. Breuninger GmbH & Co | A-TROUVER → **résolu navigateur** | e-breuninger.de | e-breuninger.de/de/karriere/stellenangebote/ | Portail maison (pas softgarden — le sg_cookie_optin n'est que le cookie manager) | **`/de/joboffers.json` — JSON public** (filtres + offres), 156 postes | Allemagne | JSON testé 10/09/2026 | Ajouter via JSON maison |
| **Jelmoli** | Grand magasin | Mode | Swiss Prime Site | A-TROUVER → **résolu navigateur** | jelmoli.ch (erreur SSL) | jobs.sps.swiss/job-overview (portail groupe) ; jobs.jelmoli.ch = NXDOMAIN confirmé | Plateforme ABA Services jobportal (portal UUID baa7d421-…) | API publique api.jobportal.abaservices.ch | Suisse | Navigateur réel 10/09/2026 | Source groupe SPS ; vérifier filtre société Jelmoli |
| **David Jones** | Grands magasins | Mode | David Jones Pty (Woolworths Holdings) | ATS_A_TROUVER → **résolu navigateur** | davidjones.com.au | careers.davidjones.com.au | **PageUp People** (les contrôleurs « greenhouse » n'étaient que des champs de formulaire) | Non testée | Australie | Navigateur réel 10/09/2026 | Adaptateur PageUp à créer |
| **Chow Tai Fook** | Joaillier + retail | Joaillerie | Chow Tai Fook Jewellery Group (SEHK 1929) | NON_RESOLUE → **résolu navigateur** | chowtaifook.com | chowtaifook.com/en-hk/house-of-ctf/careers/job-opportunities | SAP SuccessFactors (OData `SFOData.JobRequisitionPosting`) exposé via AEM | **JSON public** `hrcareersection_1587549622.search.HK._._.json` testé | HK + Chine | JSON testé 10/09/2026 | Scraper le JSON AEM ou cibler le tenant SF |
| **Farfetch (+ Browns Fashion)** | E-commerce luxe | Mode luxe | Coupang (01/2024) | ATS_A_TROUVER → **résolu** | farfetch.com | jobs.lever.co/farfetch | Lever — board `farfetch` | api.lever.co/v0/postings/farfetch active | Monde (Porto, Lisbonne, Londres, NYC) | API Lever 10/09/2026 | Rattacher la fiche Farfetch au board Lever (Browns déjà actif dessus) |
| **END.** | Retail premium | Streetwear/luxe | actionnariat non revérifié | A-TROUVER → **résolu** | endclothing.com | careers.endclothing.com | Breezy HR | Board JSON Breezy à tester (~20 offres) | UK | Sondage 200, 10/09/2026 | Adaptateur Breezy à créer |
| **Nordstrom** | Grands magasins | Mode premium | Nordstrom Inc. (privatisé 2025) | ECHEC_CONFIG → **réparable** | nordstrom.com | nordstrom.wd501.myworkdayjobs.com/nordstrom_careers | Workday — tenant `nordstrom`, site `nordstrom_careers` | **CXS validée : total 1 299** | USA | Test CXS 10/09/2026 | Réparer la fiche (l'échec précédent est caduc) |
| **Harrods** | Grand magasin luxe | Mode/beauté/hospitality | Qatar Holding | NON_RESOLUE → portail trouvé | harrods.com | harrodscareers.com | SmartRecruiters (footer attesté), front custom ; 112 offres | API publique SR : slugs testés → 0 ; UUID société à capturer | UK + aéroports | FetchURL 10/09/2026 | Scraper HTML + identifier l'UUID SmartRecruiters |
| **Harvey Nichols** | Grand magasin premium | Mode/beauté | Dickson Concepts (HK) | ECHEC_CONFIG → **réparable** | harveynichols.com | careers.harveynichols.com | Teamtailor confirmé | Non testée | UK + Irlande | Sondage 200, 10/09/2026 | Réparer la config existante |
| **Groupe IDKIDS** (Okaïdi, Obaïbi, Oxybul, Catimini, Absorba…) | Groupe retail enfant | Mode enfant | IDKIDS (redressement judiciaire 02/2026, Jacadi exclu) | NON_RESOLUE → **résolu** | corporate.idkids.com | idkids.talentview.io/fr | Talentview — tenant `idkids` | Non observée (app JS) | France + franchises | Portail 200, 10/09/2026 | Adaptateur TALENTVIEW existant ; surveiller le périmètre post-redressement |
| **Jacadi Paris** | Marque enfant premium | Mode enfant | IDKIDS (cession en cours, revue Autorité concurrence) | NON_RESOLUE → **résolu** | jacadi.fr | jacadi.postule.fr | Talentview — iframe `talentview.io/iframe/p6hlo9` | Non observée | France + international | iframe relevée 10/09/2026 | Ajouter la source ; re-vérifier après cession |
| **Tape à l'œil (TATO)** | Enseigne enfant | Mode enfant | Association familiale Mulliez | NON_RESOLUE → **résolu** | taokids.com | t-a-o.talentview.io | Talentview — tenant `t-a-o` | Non observée | France + ~10 pays | Lien officiel 10/09/2026 | Adaptateur TALENTVIEW existant |
| **Grain de Malice** | Enseigne PAP femme | Mode | Indépendant (J.-C. Garbino) | ATS_A_TROUVER → **résolu** | graindemalice.fr | recrutement.graindemalice.fr | Teamtailor confirmé (assets teamtailor-cdn) | Slug sous-jacent à identifier | France | Portail 200, ~9 offres, 10/09/2026 | Adaptateur Teamtailor existant |
| **Cyrillus** | Enseigne famille | Mode | MGA Paris + Alandia Industries (2021) — pas IDKIDS | NON_RESOLUE → **résolu** | cyrillus.fr | inrecruitingfr.intervieweb.it/cyrillus/fr/career | Intervieweb / In-recruiting — tenant `cyrillus` | Non observée | France | Board actif 10/09/2026 | Adaptateur Intervieweb à créer |
| **The Body Shop** | Marque + retail | Beauté | Aurelius (reprise 2023) — à reconfirmer | NON_RESOLUE → portail trouvé | thebodyshop.com | careers.thebodyshop.com | SuccessFactors CSB | Pas d'API exposée | Mondial | Probe 200 + grep SF, 10/09/2026 | Remplacer la source ; confirmer traitement France |
| **Bucherer** (incl. Tourneau) | Détaillant multi-marques | Horlogerie | **Rolex Group** (rachat 08/2023) | VENDOR_SANS_ADAPTATEUR | bucherer.com | recruitingapp-2840.umantis.com (EU) ; tourneau.hire.trakstar.com (US) | Umantis (EU) / Trakstar Hire (US) | Non testée | CH/DE/AT/FR/DK/UK + USA | Boards consultés 10/09/2026 | Adaptateur Umantis à créer ; documenter parenté Rolex |
| **Saks Global** (Saks Fifth Avenue, Neiman Marcus, Bergdorf Goodman, OFF 5TH) | Grands magasins luxe | Mode luxe | Saks Global (acq. NMG 12/2024 ; Chapter 11 01/2026 — à recouper) | présence à vérifier (backlog N1) | saksfifthavenue.com | careers.saksglobal.com | Phenom — tenant canvas `SFAVUS` | API Phenom à tester | USA | Sondage 200, 10/09/2026 | 1 portail groupe couvre les 4 enseignes |
| **Manor** | Grands magasins | Mode/maison | Maus Frères | NON_RESOLUE → **résolu** | manor.ch | careers.manor.ch | SuccessFactors — company=`manorag` | Careersite SF public | Suisse | Liens sapsf vus 10/09/2026 | Adaptateur SUCCESSFACTORS existant |
| **Globus** | Grand magasin premium | Mode/food | Central Group | NON_RESOLUE → **résolu** | globus.ch | jobs.globus.ch | rexx systems (copyright dans le HTML) | Non testée | Suisse | Sondage 10/09/2026 | Adaptateur rexx à créer |
| **Coin** | Grands magasins | Mode/maison | Coin S.p.A. (familial) | NON_RESOLUE → **résolu** | coin.it | coin.it/it-it/lavora-con-noi | Allibo (widget joblink.allibo.com/ats2/Widget) | Endpoint widget à documenter | Italie | Scripts Allibo dans le HTML, 10/09/2026 | Documenter le widget Allibo |
| **Groupe Bogart** | Parfums + retail beauté | Parfums | Groupe Bogart (Euronext) | présence à vérifier (la ligne « bogart man » = autre société sud-africaine) | groupe-bogart.com | bogart.talentfinder.be | Talentfinder (division retail Belgique) | Non testée | Portail = Belgique uniquement | curl 200, 10/09/2026 | Créer la maison ; source BE ; France = candidature spontanée |
| **Lush** | Marque + retail | Beauté | Lush Ltd (UK) | A_VERIFIER_IDENTITE | lush.com | job-boards.greenhouse.io/lush | Greenhouse — board `lush` | boards-api.greenhouse.io/v1/boards/lush/jobs actif | Board = Amérique du Nord uniquement | API Greenhouse live 10/09/2026 | Valider l'identité ; chercher le canal France/Europe |
| **Kith** | Retail premium | Streetwear | Indépendant | A-TROUVER → **résolu** | kith.com | kith.wd1.myworkdayjobs.com/Kith_External_Careers | Workday — tenant `kith` | **CXS validée : total 88** | US | API 10/09/2026 | Adaptateur Workday existant |
| **Revolve (incl. FWRD)** | E-commerce premium | Mode | Revolve Group (Eminent Inc.) | A-TROUVER → **résolu** | revolve.com | revolve.com/r/Careers.jsp → ADP | ADP Workforce Now (cid 02835ad7-…) | Board mascsr ADP (SPA) | US | 10/09/2026 | Scraper board ADP (JS) ; FWRD couvert par cette source |
| **Beams** | Select shop | Mode | Beams Co., Ltd. | A-TROUVER → **résolu** | beams.co.jp | beams.co.jp/recruit/ | Portail propre + mynavi corp88221 | Non | Japon | 10/09/2026 | Scraper /recruit/ |
| **United Arrows** | Select shop | Mode | United Arrows Ltd. | A-TROUVER → **résolu** | united-arrows.co.jp | recruit.united-arrows.co.jp | Portail propre + recop.jp | Non | Japon | 200 le 10/09/2026 | Scraper le portail |
| **ABC-Mart** | Retail chaussures | Chaussures | ABC-Mart, Inc. (TSE Prime) | A-TROUVER → **résolu** | abc-mart.net | abc-mart-saiyou.net/recruit/ | Portail propre + job finder /jobfind-pc/ | Non | Japon (~1 080 magasins) | 200 le 10/09/2026 | Explorer /jobfind-pc/ |
| **Mephisto** | Chaussures | Chaussures | Familial (Sarrebourg) | A-TROUVER → **résolu** | mephisto.com | mephisto.com/fr-fr/pages/carriere | Page Shopify propriétaire (offres réelles) | Non | **France + international** | 10/09/2026 | Scraper la page |
| **Le Tanneur** | Maroquinerie | Maroquinerie | Qatar Luxury Group (à reconfirmer) | A-TROUVER → **résolu négativement** | letanneur.com | Aucun (carrieres.letanneur.com = NXDOMAIN) | FashionJobs/HelloWork | — | France | NXDOMAIN confirmé 10/09/2026 | Retirer l'URL morte ; job boards |
| **Isetan Mitsukoshi** | Grands magasins | Distribution | Isetan Mitsukoshi Holdings | NON_RESOLUE → portail trouvé | mistore.jp | imhds.co.jp/recruit/ | HTML groupe + mynavi ×4 | Non | Japon | 200 le 10/09/2026 | Scraper ; clarifier périmètre groupe |
| **Takashimaya** | Grands magasins | Distribution | Takashimaya Co. | NON_RESOLUE → portail trouvé | takashimaya.co.jp | takashimaya.co.jp/corp/recruit/ | Portail maison | Non | Japon | 200 le 10/09/2026 | Scraper corp/recruit |
| **Shinsegae** | Grands magasins | Distribution | Shinsegae Group | NON_RESOLUE → portail trouvé | shinsegae.com | job.shinsegae.com | Portail groupe (JS coréen) | Non | Corée | 200 le 10/09/2026 | Scraper portail groupe |
| **Apparel Group** | Retail franchises | Distribution | Apparel Group LLC | NON_RESOLUE | apparelgroup.com | apparelgroup.com/en/careers/ | Oracle Cloud HCM — tenant `ediu.fa.em2.oraclecloud.com`, site CX_1 | hcmRestApi (finder à calibrer) | ME/Inde/SE Asie | URL extraite 10/09/2026 | Adaptateur ORACLE_HCM |
| **J.M. Weston** | Chaussures luxe | Chaussures | — | déjà référencé (sans ATS) | jmweston.com | eu.jmweston.com/blogs/talents | Blog Shopify (offres réelles : vendeur CDI Paris, stages) | Non | France | 200 le 10/09/2026 | Mettre à jour la fiche : portail = /blogs/talents |

---

## 3. Déjà couverts — rien à faire

| Acteur | Statut constaté |
|---|---|
| NAOS (Bioderma, Esthederm, Etat Pur) | EN_PROD_ACTIVE, SuccessFactors careers.naos.com |
| Kiko Milano | EN_PROD_ACTIVE, Recruitee |
| Kiabi | EN_PROD_ACTIVE, SmartRecruiters (261 offres) |
| Faguo | EN_PROD_ACTIVE, Teamtailor |
| Sessùn | EN_PROD_ACTIVE, WTTJ |
| Browns Fashion | Couvert via le board Lever `farfetch` |
| LuxExperience / Mytheresa | Périmètre B6 lot 4 — vérifier que le groupe élargi (YNAP intégré 2025) est couvert |

---

## 4. Sans portail structuré (documenté, preuves à l'appui)

| Acteur | Constat (10/09/2026) | Canal de recrutement attesté |
|---|---|---|
| Graff | graff.com/careers → 302 homepage | Candidature e-mail uniquement |
| MB&F | mbandf.com/jobs accessible (navigateur), offres en HTML statique | E-mail jobs@mbandf.com ; page scrapable |
| F.P. Journe | Aucune page carrières (statut « probe en erreur » à corriger : site 200) | Réseau horloger genevois |
| Jacob & Co | /careers redirige homepage | Glassdoor/Indeed (NY, Miami) |
| Gismondi 1754 | Aucun lien carrière (~27 salariés) | Contact direct |
| De Grisogono | SPA sans page careers (DAMAC Group depuis 2022) | Surveiller la reconstruction |
| Amouage | Aucun lien carrières même au navigateur | LinkedIn / GulfTalent / Bayt |
| Parfums de Marly | Aucun lien carrières même au navigateur | LinkedIn / agrégateurs |
| LuisaViaRoma | Aucun lien carrières au navigateur ; crise financière 07/2025 | Surveiller la restructuration |
| Laboratoire Native (ex-Alès Groupe : Lierac, Phyto, Roger & Gallet) | Pas de portail propre | Multi-jobboards sous l'employeur « LABORATOIRE NATIVE » ; WTTJ à tester |
| L'Exception | /fr/recrutement et /fr/careers = 404 | Indeed (vendu à AA Investments 01/2025) |
| Roseanna | Aucune page carrière (Rosa SAS) | LinkedIn / e-mail |
| Petite Mendigote | Aucune page carrière | FashionJobs (découverte) / LinkedIn |
| Cotélac | Aucun portail (cotelac.com = HTTP only) | Indeed / Glassdoor |
| Bensimon | Candidature par e-mail (page recrutement sans ATS) | E-mail |
| Hartford | Candidature spontanée par CV | E-mail |
| Groupe JAJ (Schott Europe) | Aucun portail propre | FashionJobs (découverte) |
| Vertbaudet FR | Formulaire maison, aucun ATS ; DE : jobs.vertbaudet.de (Talention) | Jobboards FR |
| Eugène Perma (Alfaparf) | Formulaire candidature spontanée groupe | — |
| Sothys, LPG Systems, Garancia | Aucun portail | HelloWork / Indeed / LinkedIn |
| Phytomer | Aucun portail propre | Indeed / HelloWork |
| SKP | Pas de portail occidental | Canaux officiels chinois : Liepin (company 9620094), Zhaopin, campus |
| Rustan's | Pas de page carrière propre | Jobstreet PH (canal officiel) + e-mail |

---

## 5. Corrections catalogue suggérées

1. **Melijoe** : à retirer des cibles — marque dormante (site inaccessible, Babyshop Group en reconstruction).
2. **Clergerie** : à écarter — liquidation 04/2025, reprise in extremis (~14 emplois conservés), site mort.
3. **Groupe Zannier / Kidiliz** : groupe liquidé 11/2020 — corriger la ligne, rediriger Catimini/Absorba/Chipie/Lili Gaufrette vers IDKIDS, licences enfants vers CWF.
4. **Decléor** : marque cédée par L'Oréal à Cospal (12/2024) — plus couvrable via L'Oréal ; pas de portail Cospal connu.
5. **« bogart man »** : la ligne catalogue désigne Bogart Man (Afrique du Sud) — ne pas confondre avec le Groupe Bogart français.
6. **Statuts « site en erreur au probe » erronés** : F.P. Journe, Bensimon, Hartford, Ekyog répondent 200 — probes à rejouer (certains en HTTP only : cotelac.com).
7. **URLs mortes à retirer d'A-TROUVER-loic** : carrieres.julien-dorcel.com (NXDOMAIN — Julien d'Orcel recrute via franchisés/Indeed/HelloWork), careers.vilebrequin.com (US : vbqusa.catsone.com ; FR : jobboards), carrieres.letanneur.com (NXDOMAIN).

---

## 6. Encore non résolus

| Cas | Recherches effectuées | Reste à vérifier |
|---|---|---|
| Lotte Department Store | job.lotte.co.kr résout en DNS mais HTTP 000 (blocage géo/WAF probable) | Navigateur réel ou proxy |
| Azadea Group | careers.azadea.com → azadeagroupholding.com/careers (200, page JS) | ATS en navigateur |
| Heimstone | heimstone.com HTTP 402 (anti-bot probable) | Navigateur réel |
| The Webster | Shopify, /pages/careers 404 ; pistes Glassdoor/Indeed | LinkedIn |
| Mikimoto / Citizen / Casio | Portails confirmés mais Japon uniquement | Entités régionales Europe si périmètre FR requis |
| Harrods (API) | SmartRecruiters attesté en footer ; slugs publics → 0 | UUID société via requêtes réseau navigateur |
| Non explorés (lot 3) | Le Mont Saint Michel (marque), Maison Standards, Orcanta, Groupe GM, Panouille, Thémaé, Marbert, Bleu Libellule | Première passe web à faire |

---

## 7. ATS supplémentaires identifiés (hors les 40 adaptateurs existants)

Intervieweb/In-recruiting (Rinascente, Cyrillus) · softgarden (KaDeWe ×3, Maria Galland) · Eploy (Fenwick, Fortnum & Mason) · Tribepad (Selfridges) · PageUp (David Jones) · Breezy HR (END.) · FlowQ (Beymen) · Talentics (Vakko) · Umantis (Bucherer EU) · ADP Workforce Now (Revolve) · WeRecruit (CWF) · Paradox→SuccessFactors (Pandora) · ABA Services jobportal (Swiss Prime Site/Jelmoli) · CATS (Vilebrequin US) · rexx (Globus, Galeria probable)

---

## 8. Priorités d'intégration suggérées

1. **Swarovski** — Workday prêt à brancher, CXS 511 offres, France incluse
2. **Expanscience** — Workday, CXS 35, France
3. **Douglas Group** — SuccessFactors, couvre Nocibé (France)
4. **Nordstrom** — simple réparation (ECHEC_CONFIG caduc, CXS 1 299)
5. **Farfetch** — rattachement au board Lever existant
6. **IDKIDS / TATO / Jacadi** — adaptateur Talentview existant
7. **Rolex** — SuccessFactors company=`rolexsa`
8. **Kith** — Workday, CXS 88
9. **Namshi** — SmartRecruiters existant
10. **Mephisto** — page France scrapable
