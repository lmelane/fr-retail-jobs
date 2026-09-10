# Sources ACTIVE non certifiées — familles de traitement (2026-09-10T18:19Z)

Dénominateur : **344 sources ACTIVE** dont la configuration courante n'a pas de revue d'identité valide, sur **432 actives** (88 certifiées au contrat strict). Une source = une famille, première règle qui s'applique dans l'ordre D → G → A → B → C → E. Généré par `scripts/coverage/uncertified-families.mts` (lecture seule, aucune collecte) ; liste complète avec les indices dans `uncertified-sources.csv`.

**Ce que le pré-tri compare** : le domaine enregistrable (`tldts`, comme la porte de promotion) — un hôte d'ATS mutualisé (`*.myworkdayjobs.com`, `*.teamtailor.com`, `boards.greenhouse.io`, `jobs.lever.co`, `*.talent-soft.com`, `*.successfactors.*`…) n'est jamais « sur le domaine officiel » ; le domaine officiel d'une Maison = `Company.domain` de sa société canonique (`Source.maison` → `sourceSubjectKey` → `Company.fashionjobsUrl = resolved:<id>`, fusions suivies) ou l'`officialDomain` d'une revue VERIFIED existante du même tenant ; un lien archivé ne vaut que depuis une page de ce domaine, et il vise le TENANT (sur un hôte partagé, `jobs.smartrecruiters.com/<société>`, `jobs.lever.co/<site>`, `welcometothejungle.com/…/companies/<slug>`), pas l'hôte ; une société nourrie est légitime si elle EST la société canonique de la Maison, y est fusionnée, ou porte un alias revu pour cette source (`CompanyAlias.reviewId`).

| Famille | Sources | Offres actives | Blocage réel | Prochaine action |
|---|---:|---:|---|---|
| Portail de groupe (plusieurs sociétés canoniques nourries, ou tier GROUP_OFFICIAL) | 30 | 9421 | aucun technique : il faut une certification MULTI_BRAND et un alias revu par libellé (la porte refuse chaque libellé sans alias) | comme Saks / KnitWell : `b6-aliases.mts <clone|production> <clés>` (libellé → Maison, page officielle archivée) puis `b6-certify-existing.sh <nom> <clés>` avec périmètre MULTI_BRAND |
| Homonymie suspecte (société nourrie ≠ Maison cataloguée et ni fusionnée ni alias revu ; ou nourrie par cette seule source sans domaine ni lien officiel vérifié) | 26 | 1510 | l'identité peut être fausse (cas loft, vitamin-a, one) : rien ne se certifie avant l'audit | audit hors ligne sur les indices (pays, titres, hôte) ; mauvais tenant → `retire-source <clé>` (D27) ; même employeur → alias/fusion revus puis B ou C |
| Portail hébergé sur le domaine officiel de la Maison (domaine enregistrable identique, hôte non mutualisé) | 83 | 9858 | aucun | `b6-certify-existing.sh <nom> <clés>` par lots de 10–15 (méthode OFFICIAL_DOMAIN : page du portail hébergée), libellés lus à la validation |
| Lien réciproque archivé DEPUIS une page du domaine officiel vers le portail du tenant | 13 | 463 | aucun | `b6-certify-existing.sh <nom> <clés>` par lots (méthode OFFICIAL_LINK depuis la page archivée ; dump, clone, validation réelle, certification) |
| Jobboard, balayage sectoriel ou cabinet | 3 | 2490 | décision : identité de board, pas de portail employeur | décision Loïc sur le flux B ; identité de board documentée |
| Aucune provenance officielle vérifiée (ni domaine, ni lien depuis le domaine officiel) | 189 | 8610 | recherche à mener ; les liens archivés depuis d'autres pages sont des pistes, pas des preuves | `research-portals.mts <input.json> <dossier>` ciblé sur la Maison (pistes : colonne unverifiedLinks), puis C ; sinon documenter le blocage daté |
| **Total** | **344** | **32352** | | |

## Homonymie suspecte — toutes les sources, avec les indices lisibles hors ligne (FED_NOT_MAISON 2 · SOLE_FEEDER_NO_PROOF 24)

`FED_NOT_MAISON` : la société créditée n'est ni la société canonique de la Maison, ni fusionnée dedans, ni un alias revu de cette source. `SOLE_FEEDER_NO_PROOF` : la société n'est nourrie que par cette source, sans domaine officiel connu en base et sans lien vérifié — l'identité repose sur le seul libellé (une grande Maison sans `Company.domain` y tombe aussi : à lever en posant le domaine, D45).

| Source | Maison cataloguée | Société nourrie | Motif | Hôte du portail | Offres | Pays principal (nb pays) | Sources de la société | 3 titres récents |
|---|---|---|---|---|---:|---|---:|---|
| parfums-chanel | Chanel | Chanel (Maison en base : Chanel) | SOLE_FEEDER_NO_PROOF | cc.wd3.myworkdayjobs.com | 1120 | FR (30) | 1 | Bauty Advisor / Head of Brand Communications, SEAA / Werkstudent:in Fragrance & Beauty (m/w/d) CHANEL Parfums & Beauté Breuninger Düsseldorf |
| pga-tour-superstore | PGA Tour Superstore | Golf & Tennis Pro Shop, Inc. d/b/a PGA TOUR Superstore (Maison sans société en base) | FED_NOT_MAISON | pgatoursuperstore.wd12.myworkdayjobs.com | 190 | US (1) | 1 | Retail Sales Associate - Apparel/Shoes / Customer Service Specialist / Retail Golf Services Associate |
| everything-but-water | Everything But Water | Orlando Bathing Suit (Maison sans société en base) | FED_NOT_MAISON | everythingbutwater.wd5.myworkdayjobs.com | 43 | US (1) | 1 | Key Holder / Assistant Store Manager |
| ephemera | EPHEMERA | EPHEMERA (Maison en base : EPHEMERA) | SOLE_FEEDER_NO_PROOF | ephemera.teamtailor.com | 28 | FR (1) | 1 | Plongeur en CDD H/F / Serveur H/F / Runner H/F |
| army-logic | Army Logic | Army Logic (Maison en base : Army Logic) | SOLE_FEEDER_NO_PROOF | hypebeast.cn | 21 | HK (3) | 1 | クリエイティブエディター Creative Editor / Workplace Experience Coordinator / Senior Creative Producer |
| f-a-e | f.a.e. | f.a.e. (Maison en base : f.a.e.) | SOLE_FEEDER_NO_PROOF | www.thrivemarket.com | 17 | IN (2) | 1 | Associate Category Manager (ACM) / Sr. Director, Growth Marketing / Senior Software Engineer, iOS |
| brothers | Brothers | Brothers (Maison en base : Brothers) | SOLE_FEEDER_NO_PROOF | brothers.teamtailor.com | 13 | SE (1) | 1 | Butikssäljare 5,5h/v, varannan helg / Butikssäljare 21 h/v / Butikssäljare - Extra vid behov |
| georges | GEORGES | GEORGES (Maison en base : GEORGES) | SOLE_FEEDER_NO_PROOF | georges.teamtailor.com | 13 | FR (1) | 1 | Livreur Relation Client H/F / Chef d'équipe livraison H/F / Opérateur de production - Livreur H/F |
| bego | Bego | Bego (Maison en base : Bego) | SOLE_FEEDER_NO_PROOF | bego.recruitee.com | 11 | DE (1) | 1 | Initiativbewerbung für Studierende / Initiativbewerbung / Zahntechniker / Quereinsteiger (m/w/d) Oberflächenbearbeitung zahntechnischer Bauteile |
| bright | BRIGHT | BRIGHT (Maison en base : BRIGHT) | SOLE_FEEDER_NO_PROOF | bright.recruitee.com | 9 | DE (1) | 1 | Kauffrau/-mann für Büromanagement - Vollzeit - BNB Pro Hosting (m/w/d) / Hotelfachfrau/-mann / Hospitality Operations Manager - Vollzeit/Teilzeit (m/w/d) - BRIGHT / Housekeeper / Reinigungskraft Serviced Apartments Rosenheim - Teilzeit (m/w/d) - BRIGHT |
| baron | Baron | Baron (Maison en base : Baron) | SOLE_FEEDER_NO_PROOF | jobs.smartrecruiters.com | 5 | US (1) | 1 | Car Dealer Sale Closer or OEM Vehicle industry Sales Manager / Production Artist Prod Approval Excel Schedule Compiler / Bi-Lingual Mainland Mandarin Chinese Administrator |
| jewells | Jewells | Jewells (Maison en base : Jewells) | SOLE_FEEDER_NO_PROOF | jewells.teamtailor.com | 4 | GB (1) | 1 | Part Time Stylists / Retail Space Planner / Store Manager London |
| agency | Agency | Agency (Maison en base : Agency) | SOLE_FEEDER_NO_PROOF | jobs.smartrecruiters.com | 4 | US (1) | 1 | Editorial Intern for Social Network Luxury Magazine / Assistant/Intern for Asia-focused Luxury Private Social Network / CopyWriter for Asia Digital Luxury Lifestyle Brand |
| ghost | Ghost | Ghost (Maison en base : Ghost) | SOLE_FEEDER_NO_PROOF | boards.greenhouse.io | 4 | US (1) | 1 | Livestream Host / Staff Accountant / Senior Manager, Financial Planning & Analysis |
| guild-pepper | Guild+Pepper | Guild+Pepper (Maison en base : Guild+Pepper) | SOLE_FEEDER_NO_PROOF | boards.greenhouse.io | 4 | US (1) | 1 | Senior Director, Product Marketing / Senior Compensation Manager / Lead Forecasting & Financial Analyst |
| picard | PICARD | PICARD (Maison en base : PICARD) | SOLE_FEEDER_NO_PROOF | picard.recruitee.com | 4 | DE (1) | 1 | Initiativbewerbung / Full Stack Developer (m/w/d) - Java / Fachkraft für Lagerlogistik, Fachlagerist, Lagerarbeiter (m/w/d) |
| subset | Subset | Subset (Maison en base : Subset) | SOLE_FEEDER_NO_PROOF | subset.teamtailor.com | 4 | SE (1) | 1 | Senior systemutvecklare / Systemutvecklare / Cybersäkerhets- och informationssäkerhetskonsulter |
| markham | Markham | Markham (Maison en base : Markham) | SOLE_FEEDER_NO_PROOF | jobs.lever.co | 3 | US (1) | 1 | Onsite Event Specialists (Freelance / Evergreen Talent Pool) / Freelance Graphic Designer / Cvent Freelancer |
| lensa | Lensa | Lensa (Maison en base : Lensa) | SOLE_FEEDER_NO_PROOF | lensa.teamtailor.com | 3 | HU (1) | 1 | Data Engineer / Software Engineer - Data / Data Engineer - Data Warehouse & Analytics |
| bloom | Bloom | Bloom (Maison en base : Bloom) | SOLE_FEEDER_NO_PROOF | jobs.smartrecruiters.com | 2 | LB (1) | 1 | Community Engagement Lead “Weaver” Position / Project Manager for MSME Accelerator and Training Support Program (mid-level to senior position) |
| knock-knock | Knock Knock | Knock Knock (Maison en base : Knock Knock) | SOLE_FEEDER_NO_PROOF | boards.greenhouse.io | 2 | — (0) | 1 | Mortgage Processor/Underwriter - Remote / Mortgage Account Executive - Remote |
| saffron | Saffron | Saffron (Maison en base : Saffron) | SOLE_FEEDER_NO_PROOF | saffron.teamtailor.com | 2 | GB (1) | 1 | Senior Brand Researcher / Client Manager |
| cove | Cove | Cove (Maison en base : Cove) | SOLE_FEEDER_NO_PROOF | cove.teamtailor.com | 1 | US (1) | 1 | Cove HR Manager |
| parco | Parco | Parco (Maison en base : Parco) | SOLE_FEEDER_NO_PROOF | jobs.smartrecruiters.com | 1 | US (1) | 1 | Appointment Scheduler |
| kidzart | Kidzart | Kidzart (Maison en base : Kidzart) | SOLE_FEEDER_NO_PROOF | jobs.smartrecruiters.com | 1 | US (1) | 1 | After-School Art Instructor |
| loplabbet | Löplabbet | Löplabbet (Maison en base : Löplabbet) | SOLE_FEEDER_NO_PROOF | loplabbet.teamtailor.com | 1 | SE (1) | 1 | Butikssäljare (heltid) - Löplabbet |

## Portails de groupe — sociétés nourries

| Source | Maison cataloguée | Tier | Hôte | Offres | Sociétés créditées (offres) | Maison ou alias revu parmi elles |
|---|---|---|---|---:|---|---|
| levis | Levi's | ATS_OFFICIAL | levistraussandco.wd5.myworkdayjobs.com | 1333 | Levi's 1331 · THA- Levi Strauss (Thailand) 2 | oui |
| kering | Kering (toutes Maisons) | EMPLOYER_DIRECT | careers.kering.com | 1112 | Gucci 236 · Saint Laurent 219 · Bottega Veneta 151 · Balenciaga 150 · Kering 120 · Kering Eyewear 77 · Boucheron 56 · Pomellato 33 · Alexander McQueen 23 · Brioni 19 · Richard Ginori 16 · Qeelin 11 · Kering Beaute 1 | oui |
| nike | Nike | ATS_OFFICIAL | nike.wd1.myworkdayjobs.com | 834 | NIKE 403 · Nike Sports (China) Co. 85 · NIKE India Technology Center Private 66 · Nike Commercial (China) 34 · Nike NEON 27 · NIKE de Mexico, S. de R.L. de C.V. 26 · NIKE Korea 24 · Nike Israel 14 · Air MI 13 · Converse 13 · NIKE Retail Poland 11 · NIKE India Private 10 · Nike China Holding HK 10 · NIKE Sourcing (Guangzhou) 10 · BRS Nike Taiwan 8 · Converse Sporting Goods 7 · PT Nike Indonesia 6 · NIKE ELC 6 · NIKE Vietnam Limited Liability Company 6 · Nike (Thailand) 6 · NIKE Retail Austria 5 · NIKE Retail Ireland 5 · Nike Japan Group 4 · NIKE New Zealand Company 3 · NIKE Global Trading 3 · Nike 360 (Korea) 3 · NRBV Turkey 3 · Nike Retail BV Branch 3 · Nike 360 (Taiwan) 2 · NIKE Malaysia 2 · NIKE Sourcing India Private 2 · Converse Korea 2 · NIKE U 2 · NIKE Retail B.V. Norway 1 · Nike 360 (Hong Kong) 1 · Nike Taiwan 1 · NRBV Admin (inactive) 1 · NIKE Retail Portugal 1 · Nike China Holding HK Limited (Macau Branch) 1 · NIKE Retail Hungary 1 · American Converse 1 · NIKE Retail Denmark 1 · NIKE Brasil Marketing 1 | oui |
| la-casa-de-las-carcasas | La casa de las Carcasas | EMPLOYER_DIRECT | lacasadelascarcasas.teamtailor.com | 745 | La casa de las Carcasas 689 · La casa de las Carca 56 | oui |
| sandro | SMCP (toutes Maisons) | EMPLOYER_DIRECT | jobs.smartrecruiters.com | 568 | Maje 226 · Sandro 135 · Claudie Pierlot 120 · Fursac 56 · SMCP 31 | oui |
| aritzia | Aritzia | ATS_OFFICIAL | aritzia.wd3.myworkdayjobs.com | 554 | Aritzia 348 · Aritzia LP 206 | oui |
| capri-michael-kors | Michael Kors | ATS_OFFICIAL | capri.wd1.myworkdayjobs.com | 529 | Michael Kors 355 · Michael Kors Stores California 54 · Michael Kors (UK) 36 · Michael Kors (Germany) 27 · Michael Kors (Italy) srl con socio unico 13 · Michael Kors Spain, S.L.U. 12 · Michael Kors (Europe) 5 · Michael Kors (Austria) 4 · Michael Kors (Switzerland) 4 · Michael Kors (Portugal) 3 · Michael Kors (Netherlands) 2 · Michael Kors (Canada) 2 · Michael Kors (Czech Republic) s.r.o. 2 · Michael Kors (Poland) sp. z. o.o. 2 · Michael Kors (Lithuania) UAB 2 · Michael Kors (Hungary) Kft 2 · Michael Kors (Sweden) 1 · Michael Kors (USA) 1 · Michael Kors (HongKong) 1 · Michael Kors Yuhanhoesa 1 | oui |
| swarovski | Swarovski | ATS_OFFICIAL | swarovski.wd3.myworkdayjobs.com | 527 | Swarovski 182 · Swarovski Retail Ventures 120 · Swarovski Crystal, S.A de C.V 39 · Swarovski (Deutschland) 32 · Swarovski Global Business Services sp. z o.o. 18 · Swarovski (Schweiz) 16 · Swarovski Cristais Ltda. 13 · Swarovski GBS 12 · Swarovski Int. d'Italia 12 · Swarovski India Private 12 · Swarovski Korea 7 · Swarovski Ibérica 6 · Swarovski Kristal Ticaret Ltd Sti. 6 · Swarovski Manufacturing (Thailand) 5 · Swarovski Internat. N. Z. 5 · Swarovski Hellas 4 · Swarovski Hungary Retail Limited Liability Company 4 · Swarovski Bohemia spol.s.r.o. 4 · Swarovski Poland Sp. z o.o. 4 · D. Swarovski Tourism 4 · Swarovski Austria 3 · Swarovski Thailand 3 · Swarovski Iberica SA PT 3 · Swarovski Ireland 2 · Swarovski Subotica DOO 2 · Swarovski Manufacturing Vietnam 2 · Swarovski AG, Triesen, Zweigniederlassung Männedorf 2 · Swarovski Servicios, S.A. de CV 1 · Swarovski Malaysia 1 · DSW Kristall AG & Co KG 1 · Swarovski Crystal Comp.Lt 1 · Swarovski Mobility 1 | oui |
| oniverse | Oniverse (Calzedonia) | GROUP_OFFICIAL | careers.oniverse.it | 524 | ONIVERSE 524 | oui |
| element-6 | Element +6 | EMPLOYER_DIRECT | recrutement.groupe-beaumanoir.com | 403 | La Halle 64 · Cache Cache 62 · Bonobo 45 · Boardriders 44 · Morgan 41 · Caroll 37 · Clog 35 · Vib's 31 · Groupe Beaumanoir 24 · Bréal 12 · Sarenza 5 · Sarenza Studio 2 · Jennyfer 1 | NON |
| nike-nke2 | Nike | ATS_OFFICIAL | nike.wd1.myworkdayjobs.com | 348 | NIKE 335 · Converse 13 | oui |
| swatch-group | Swatch Group | GROUP_OFFICIAL | www.swatchgroup.com | 293 | Swatch 71 · ETA 44 · Omega 39 · Swatch Group 32 · Longines 20 · Blancpain 10 · Hour Passion 10 · Tissot 9 · Nivarox 6 · Swiss Timing 6 · EM Microelectronic 6 · Breguet 5 · Rado 5 · Renata 5 · Rubattel et Weyermann 4 · Universo 4 · Meco 4 · Comadur 3 · Glashütte Original 3 · Hamilton 1 · Certina 1 · Lascor 1 · Flik Flak 1 · CPK Swatch Group 1 · MOM Le Prélet 1 · Micro Crystal 1 | oui |
| madewell | Madewell | ATS_OFFICIAL | jcrew.wd1.myworkdayjobs.com | 290 | Madewell Stores Madewell 266 · Corporate J. Crew Group 23 · Lynch DC / Cust Care J.Crew 1 | NON |
| avolta | Avolta (Dufry) | GROUP_OFFICIAL | careers.avoltaworld.com | 248 | Avolta 248 | oui |
| prada-group | Prada Group | GROUP_OFFICIAL | jobs.pradagroup.com | 149 | Prada Group 149 | oui |
| chalhoub | Chalhoub Group | GROUP_OFFICIAL | careers.chalhoubgroup.com | 148 | Chalhoub Group 148 | oui |
| conde-nast-france | Conde Nast France | ATS_OFFICIAL | condenast.wd115.myworkdayjobs.com | 143 | Advance Magazine Publishers 46 · Advance Magazine Publishers Inc. HQ 29 · The Condé Nast Publications 20 · Les Publications Condé Nast 15 · Condé Nast 11 · Edizioni Condé Nast 6 · CONDE NAST (INDIA) PVT LTD - 30361 6 · CONDE NAST (INDIA) PVT LTD - 30360 5 · Condé Nast Taiwan Publications 2 · Condé Nast Digital Taiwan 1 · Interculture Total Media Service 1 · Conde Nast de México, S.A. de C.V. 1 | oui |
| movado | Movado | ATS_OFFICIAL | movadogroup.wd1.myworkdayjobs.com | 132 | Movado Retail Group 74 · Movado Group 24 · MGI Distribucion S. de R.L. de C.V. 10 · Movado Group Private 6 · MGI Luxury Group Sàrl 5 · MGS Distribution 4 · Movado Group Deutchland 2 · MGI Luxury Trading 2 · MGI Luxury Malaysia Bhd 1 · Movado 1 · Movado Group España S.L.U. 1 · MGI Distribution Pte 1 · Movado Group of Canada Inc. (Retail) 1 | oui |
| canada-goose | Canada Goose | ATS_OFFICIAL | canadagoose.wd3.myworkdayjobs.com | 101 | Canada Goose 96 · Canada Goose UK Retail Limited, Ireland Branch 1 · Canada Goose Services Limited, Paris Branch 1 · Canada Goose HK Limited, Macau Branch 1 · Canada Goose Retail Denmark ApS 1 · Canada Goose EU B.V. UK Branch 1 | oui |
| eram-3 | Eram +3 | EMPLOYER_DIRECT | recrutement.groupe-eram.com | 89 | Gémo 41 · Groupe ERAM 18 · BOCAGE 10 · TBS 9 · Mellow Yellow 7 · PARADE 2 · LOG XL 1 · DRESCO 1 | oui |
| browns | Farfetch (portail multi-enseignes) | ATS_OFFICIAL | www.brownsfashion.com | 63 | Farfetch 52 · Luxclusif 5 · Browns 3 · Stadium Goods 3 | oui |
| luxexperience | LuxExperience | GROUP_OFFICIAL | career.luxexperience.com | 57 | LuxExperience 57 | oui |
| versace | Versace | ATS_OFFICIAL | capri.wd1.myworkdayjobs.com | 55 | Versace 33 · Gianni Versace 10 · Versace España S.A.U. 5 · Versace UK PLC. 4 · Versace Austria 1 · Versace Singapore Pte. 1 · Versace España, S.A.U., Sucursal em Portugal 1 | oui |
| capri-jimmy-choo | Jimmy Choo | ATS_OFFICIAL | capri.wd1.myworkdayjobs.com | 52 | J Choo 34 · Jimmy Choo 4 · Franchoo 4 · Jimmy Choo Tokyo 3 · Jimmy Choo (Shanghai) Trading Co. 2 · J Choo (Switzerland) 1 · Michael Kors 1 · Jimmy Choo Florence 1 · Jimmy Choo Hungary KFT 1 · Itachoo 1 | oui |
| brunello-cucinelli | Brunello Cucinelli | ATS_OFFICIAL | brunellocucinelli.wd3.myworkdayjobs.com | 45 | BRUNELLO CUCINELLI 32 · BRUNELLO CUCINELLI (ENGLAND) 6 · SAM BRUNELLO CUCINELLI MONACO 3 · BRUNELLO CUCINELLI MIDDLE EAST L.L.C 3 · BRUNELLO CUCINELLI (MACAU) FASHION 1 | oui |
| stella-mccartney | Stella McCartney | ATS_OFFICIAL | stellamccartney.wd3.myworkdayjobs.com | 30 | Stella McCartney 23 · Stella McCartney (Japan) 7 | oui |
| rebag | Rebag | ATS_OFFICIAL | job-boards.greenhouse.io | 17 | Rebag 15 · Reb 2 | oui |
| tods | Tod's Group | GROUP_OFFICIAL | jobs.todsgroup.com | 16 | Tod's Group 16 | oui |
| lagardere-duty-free | Lagardère Duty Free | GROUP_OFFICIAL | lagardere-travelretaildutyfreeglobal-recrute.talent-soft.com | 9 | Lagardère Duty Free 9 | oui |
| jansport | JanSport | ATS_OFFICIAL | vfc.wd5.myworkdayjobs.com | 7 | JanSport 6 · VF Outdoor 1 | oui |

## Par famille — les dix premières sources par volume

### Portail hébergé sur le domaine officiel de la Maison (domaine enregistrable identique, hôte non mutualisé) (83)

| Source | Maison | ATS | Hôte | Offres | Société nourrie (pays principal, nb pays, nb sources) | Domaine officiel connu | Lien vérifié depuis | Pistes non vérifiées |
|---|---|---|---|---:|---|---|---|---|
| rituals | Rituals | rituals | careers.rituals.com | 1245 | Rituals (DE, 19, 1) | rituals.com | — | — |
| adidas | adidas | successfactors | jobs.adidas-group.com | 1142 | adidas (US, 52, 1) | adidas-group.com | — | — |
| ralph-lauren-avature | Ralph Lauren | avature | careers.ralphlauren.com | 1104 | Ralph Lauren (US, 20, 2) | ralphlauren.com | — | — |
| primark | Primark | smartrecruiters-whitelabel | careers.primark.com | 966 | Primark (US, 21, 1) | primark.com | — | — |
| lovisa | Lovisa | teamtailor | careers.lovisa.com | 893 | Lovisa (US, 24, 1) | lovisa.com | www.lovisa.com | — |
| crocs | Crocs | successfactors | careers.crocs.com | 512 | Crocs (US, 16, 1) | crocs.com | — | — |
| lacoste | Lacoste | digitalrecruiters | careers.lacoste.com | 464 | Lacoste (US, 18, 2) | lacoste.com | — | — |
| penningtons | Penningtons | smartrecruiters-whitelabel | www.penningtons.com | 334 | Penningtons (CA, 1, 1) | penningtons.com | — | — |
| akira | AKIRA | teamtailor | careers.shopakira.com | 187 | AKIRA (US, 1, 1) | shopakira.com | — | — |
| aroma-zone | Aroma-Zone | teamtailor | careers.aroma-zone.com | 184 | Aroma-Zone (FR, 2, 2) | aroma-zone.com | — | — |

### Lien réciproque archivé DEPUIS une page du domaine officiel vers le portail du tenant (13)

| Source | Maison | ATS | Hôte | Offres | Société nourrie (pays principal, nb pays, nb sources) | Domaine officiel connu | Lien vérifié depuis | Pistes non vérifiées |
|---|---|---|---|---:|---|---|---|---|
| lagardere-travel-retail | Lagardère Travel Retail | talentsoft | lagardere-recrute.talent-soft.com | 130 | Lagardère Travel (FR, 2, 1) | lagardere-tr.com | www.lagardere-tr.com | www.lagardere-tr.nl |
| soeur | Soeur | teamtailor | soeur-1711354805.teamtailor.com | 56 | Soeur (FR, 7, 1) | soeur.fr | soeur.fr | — |
| promod | Promod | talentview | promodjob.talentview.io | 54 | Promod (FR, 2, 2) | promod.com | promod.com | — |
| amiri | AMIRI | lever | jobs.lever.co | 43 | AMIRI (US, 4, 1) | amiri.com | amiri.com | — |
| eric-bompard | Eric Bompard | smartrecruiters-whitelabel | jobs.smartrecruiters.com | 34 | Eric Bompard (FR, 2, 2) | eric-bompard.com | www.eric-bompard.com | careers.smartrecruiters.com |
| longchamp | Longchamp | talentsoft | longchamp-career.talent-soft.com | 27 | Longchamp (FR, 1, 1) | longchamp.com | www.longchamp.com | — |
| balmain | Balmain | talentsoft | balmain-career.talent-soft.com | 27 | Balmain (FR, 2, 2) | balmain.com | balmain.com | — |
| club-monaco | Club Monaco | greenhouse | boards.greenhouse.io | 24 | Club Monaco (CA, 1, 1) | clubmonaco.com | clubmonaco.com | — |
| ami-paris | AMI Paris | recruitee | amiparis.recruitee.com | 23 | AMI Paris (FR, 4, 2) | amiparis.com | www.amiparis.com | — |
| closed | CLOSED | personio | closed.jobs.personio.de | 14 | CLOSED (—, 0, 1) | closed.com | closed.com | — |

### Jobboard, balayage sectoriel ou cabinet (3)

| Source | Maison | ATS | Hôte | Offres | Société nourrie (pays principal, nb pays, nb sources) | Domaine officiel connu | Lien vérifié depuis | Pistes non vérifiées |
|---|---|---|---|---:|---|---|---|---|
| wttj-sector | Welcome to the Jungle (Mode · Luxe · Beauté) | wttj-sector | www.welcometothejungle.com | 2002 | Hermès (FR, 29, 3) | — | — | — |
| luxe-talent | Luxe Talent | wordpress | www.luxetalent.net | 478 | Luxe Talent (—, 0, 1) | luxetalent.fr | — | — |
| madame-figaro | Madame Figaro | wttj | www.welcometothejungle.com | 10 | Groupe Figaro (FR, 1, 1) | lefigaro.fr | — | — |

### Aucune provenance officielle vérifiée (ni domaine, ni lien depuis le domaine officiel) (189)

| Source | Maison | ATS | Hôte | Offres | Société nourrie (pays principal, nb pays, nb sources) | Domaine officiel connu | Lien vérifié depuis | Pistes non vérifiées |
|---|---|---|---|---:|---|---|---|---|
| bloomingdales-oracle | Bloomingdale's | oraclehcm | ebwh.fa.us2.oraclecloud.com | 791 | Bloomingdale's (US, 1, 1) | bloomingdales.com | — | — |
| tiffany-oracle | Tiffany & Co. | oraclehcm | eljs.fa.us2.oraclecloud.com | 424 | Tiffany & Co. (US, 28, 2) | tiffany.com | — | — |
| courir | Courir | smartrecruiters-whitelabel | jobs.smartrecruiters.com | 405 | Groupe Courir (FR, 7, 2) | courir.com | — | — |
| nocibe-eqwa | Nocibé | eqwa | recrutement-nocibe.fr | 321 | Nocibé (FR, 2, 1) | nocibe.fr | — | — |
| kiabi | Kiabi | smartrecruiters-whitelabel | jobs.smartrecruiters.com | 255 | Kiabi (FR, 9, 2) | kiabi.com | — | — |
| buck-mason | Buck Mason | lever | jobs.lever.co | 247 | Buck Mason (US, 8, 1) | buckmason.com | — | — |
| rolex | Rolex | successfactors | www.carrieres-rolex.com | 213 | Rolex (CH, 1, 1) | rolex.com | — | — |
| lush | Lush | greenhouse | job-boards.greenhouse.io | 213 | LUSH | (US, 2, 2) | lush.com | — | — |
| jd-sports | JD Sports | greenhouse | boards.greenhouse.io | 201 | JD Sports (IT, 3, 1) | jdsports.de | — | — |
| marella | Marella | smartrecruiters-whitelabel | jobs.smartrecruiters.com | 196 | Marella (IT, 6, 2) | marella.com | — | — |

## Limites du pré-tri (mesurées)

- 4 sources dont la Maison cataloguée n'a **aucune société en base** sous sa clé canonique (`resolved:<sourceSubjectKey>`) : la légitimité de la société nourrie y est jugée par `resolveCompany(nom)`, sans domaine officiel possible côté société — madewell, everything-but-water, pga-tour-superstore, wttj-sector.
- 3 sources classées G par la règle « ≥ 2 sociétés » alors que la seconde société pèse moins de 5 % des offres (probable libellé d'entité, pas un portail de groupe) : à traiter par alias revu plutôt que MULTI_BRAND — levis, nike-nke2, canada-goose.
- 2 portails de groupe dont AUCUNE société nourrie n'est la Maison cataloguée ni un alias revu : l'homonymie n'y est pas exclue, elle est simplement dominée par la règle G — element-6, madewell.
- 0 sources sans offre active (aucun indice de société possible) ; 0 sources sans hôte lisible dans la configuration.
- Les liens archivés viennent de `backups/lot4-20260909/portal-research/research.jsonl` (275 tenants cibles) : une Maison jamais recherchée n'y a pas de lien, ce qui la range en E sans préjuger de son site.
- Le pré-tri ne lit ni robots.txt ni les libellés natifs : B et C restent soumis à la validation réelle de `b6-certify-existing.sh` (accès ALLOWED lu, board exact, périmètre).
