# Taxonomie des métiers Catwalks : plan de refonte complète (lot 2 de D-475)

*Statut : **proposé**, non construit. Version 6, après cinq tours d'audit adverse. Tout ce qui n'est pas
marqué **existe** (lu ou mesuré le 28/09/2026) ou **décidé** (D-475, R-140 dans
`catwalks-backend/docs/governance/`) est proposé par ce plan. Les choix produit connus sont tranchés
(D-475 §23-§32) ; il reste au CEO les GO de production et, au lot 3, l'heure d'envoi des alertes (§6).*

## 1. Le modèle, décidé

- **Une taxonomie propre à Catwalks** (D-475 §12, §29) : identifiant stable par métier, variantes par langue,
  hiérarchie métier › famille › domaine ; propriété du catalogue, lue par le backend, le back-office et, au
  travers des API, par le site.
- **L'ESCO est l'amorce et la référence de la machine**, jamais affiché tel quel (§29).
- **Chaque intitulé est normalisé à son arrivée**, jamais pendant une recherche (§20) : métier, sinon famille,
  sinon domaine (§13). Le candidat tape librement et n'est jamais bloqué ; son texte est stocké avec son code
  (§7, §12).
- **La recherche par le code retient les offres du métier et celles dont l'intitulé contient le métier**,
  jamais toute la famille (§26 a, §27 e).
- **Une IA valide seule** (§30), **par passes de curation sur plan**, jamais au fil de l'eau (§31 a) ; un métier
  publié n'est jamais supprimé, il est remplacé par un successeur.
- **Un recruteur dont le métier manque choisit le plus proche et publie**, en signalant « métier manquant » ;
  l'IA l'ajoute à la passe suivante et reclasse l'offre (§31 b ; R-39 tient).
- **Les métiers s'affichent en forme courte** (« Conseiller de vente »), la forme d'usage dans chaque langue ;
  les autres formes restent des variantes de recherche (§31 c).
- **Deux juges** : un synonyme appris (un intitulé d'offre valable pour toutes les offres qui le portent) exige
  leur consensus ; le métier d'un seul candidat est vérifié par un juge (R-66 §1-§2, D-213 ; lecture de
  l'assistant au §30).
- **Le poste actuel se lit dans le parcours et les missions** (D-145 ; le moteur actuel n'a jamais écrit, §29).
- **Un poste d'encadrement est un autre métier** (« Responsable vendeur » n'est pas « Vendeur ») ; **un intitulé
  vague** n'a jamais de métier, sa famille seulement quand elle est sûre ; **quand un métier tapé est rattaché
  plus tard, l'accueil et les alertes basculent ensemble** (§32).

## 2. L'existant qui contraint (vérifié)

- **Version servie** `catwalks-occupations-20260909-v1` : 61 métiers, 27 familles, 4 domaines, 66 règles ;
  « Demand Planner » y désigne deux métiers (`audits/2026-09-28/scripts/etat-catalogue-metiers.txt`). Les
  identités publiées ne peuvent être ni retirées ni changer de parent ; une fusion passe par un successeur
  (`apps/aggregator/src/occupation/release.ts:13-36`).
- **Moteur** : inclusion de phrase (`packages/db/occupation-engine.ts:312-317`), `AMBIGUOUS` à deux candidats
  (`:487-490`), regex héritées gelées (`:187-197`) ; `phrase()` ne sépare que les idéogrammes (`:92`) : un
  intitulé en kana sans idéogramme (« コスメビューティーアドバイザー ») ou en thaï (« พนักงานขายเครื่องสำอาง »)
  ne peut pas contenir une variante plus courte, et le thaï perd ses voyelles à la normalisation. Importer l'ESCO dans le manifeste fait passer les offres à métier précis de 172 à 94 sur 480
  (`audits/2026-09-28/scripts/prototype-esco-*.txt`).
- **Activation** : une transaction qui change `releaseId` (`release.ts:167-208`) ; le déclencheur remet alors
  en file, en un seul INSERT, toutes les offres (environ 82 000) dans chaque génération d'index (migration
  `20260924120000`). Reconstruction mesurée : 232,569 s pour 76 096 documents (`search-3`,
  `audits/2026-09-24/search-railway.md:15`), soit environ 327 documents par seconde. Au-delà de 300 s d'attente,
  la recherche avec texte, les suggestions de titre et `/api/health` répondent 503 (`search-index.ts:106-111`) ;
  le healthcheck Railway attend 120 s. `search-3`, périmée, garde plus de 18 000 éléments en file.
- **Recherche** : le filtre et la facette métier lisent le code stocké, hors index (`job-search-query.ts:72-74,
  218`) ; les rôles lus dans le titre n'existent que dans le document d'index (`search-model.ts:55-65`) ; le
  vocabulaire de recherche prend libellés et variantes du manifeste, plus des alias écrits dans l'API
  (`search-vocabulary.ts:9-48`).
- **Offres Catwalks** : contrat v1 `metier {slug, libelle}` (`direct/contrat.ts:41,159`) ; 28 des 59 sans code ;
  un champ additif ne casse pas l'ancien agrégateur, une version 2 du contrat le ferait (`contrat.ts:6-7`).
- **Backend** : `canonical()` efface les écritures non latines (`job-taxonomy.ts:24-34`), `masculiniser`
  rattrape les féminins (`:36-60`) ; les alertes sont des instantanés à empreinte unique (`RechercheSauvegardee`) ;
  R-39 exige un métier pour mettre une offre en ligne.

## 3. Architecture

### 3.1 Données : la taxonomie v3

- Les 61 clés servies restent ; les nouveaux métiers reçoivent une clé stable Catwalks, jamais dérivée de l'ESCO.
- Contenu : les 61, `optical-assistant`, les vrais métiers du backend (fusionnés quand c'est le même métier), les
  métiers génériques que nos offres portent vraiment. Correspondances : les 290 métiers du backend (241 actifs ;
  les inactifs restent référencés par des profils et des candidats sourcés), et ses 32
  « domaines » (un axe fonctionnel) vers les **familles** du catalogue ; ses 13 familles vers celles du catalogue.
- **Forme additive du manifeste** : `aliases` reste un tableau de chaînes ; champs optionnels : variantes par
  langue, URI ESCO (`externalRefs`), successeur (`replacedBy`). Stockage additif du **domaine** sur `Job` et
  `DirectOffer`, avec le déclencheur d'intégrité (remplacement de la contrainte `occupation_state_valid`) ; le
  domaine n'est pas un filtre de recherche (aucune décision ne l'expose).
- **Garde d'unicité**, une fonction partagée appelée par la preview et par un test de l'API : aucune variante
  (toutes langues, libellés, secteurs) ne désigne deux concepts. Les alias écrits aujourd'hui dans l'API
  (`search-vocabulary.ts:9-44`) sont versés dans le manifeste : il n'existe plus qu'une source de vocabulaire,
  versionnée avec lui.
  La v3 corrige « Demand Planner ». Une traduction machine n'entre dans le vocabulaire qu'une fois passée par la
  curation (§3.2).
- **Libellés** en forme courte dans 25 langues : matière ESCO pour 17, modèle pour les autres, variantes
  régionales (espagnol du Mexique, portugais du Brésil).
- **Constitution de la v3** (R-140 §2 : « constituée une fois ») : elle échappe au plafond de métiers par passe
  et à la preuve de volume, qui valent ensuite ; elle garde ses contrôles (granularité ancrée à l'ESCO, famille,
  unicité, deux juges). **Encadrement** (§32 a) : la v3 porte des métiers d'encadrement et leurs **exclusions
  dans les règles** : aujourd'hui « Responsable vendeur H/F » et « Team Leader Client Advisor » sont classés
  `sales-advisor` par la règle `sales-advisor-title`, que ni la table ni une variante ne peuvent corriger ; le
  nombre de titres classés qui combinent un rôle et un mot d'encadrement est mesuré sur le corpus. Le champ
  « titre seulement » d'un alias (`financial-controller`, `search-vocabulary.ts:49`) devient un champ optionnel
  du manifeste.
- **Déroulé de la constitution** (`apps/aggregator/scripts/taxonomie/curation/`), chaque étape échouant plutôt que de
  laisser une entrée sans décision : (1) métiers du backend face aux métiers servis ; (1b) doublons à l'intérieur du
  backend, groupés par cliques confirmées ; (2) familles ; (3) intitulés d'offres sans métier, la tête (au moins 3
  offres sans métier), avec leurs employeurs et services ; (3b) garde d'unicité des métiers nouveaux ; (4) encadrement ;
  (5, 5b) libellés et leur correction ciblée ; (6) manifeste ; (6b) preview ; (6c) vérification des généralisations ;
  (6d) échantillon neuf et mesure de justesse. Toute fusion proposée par l'un ou
  l'autre des deux modèles passe au consensus des deux juges ; une exclusion ou un métier nouveau venu des offres
  exige l'accord des deux modèles ; sans accord, un intitulé d'offre reste sans métier (§32 c). **Seuils de départ**,
  à recalibrer comme ceux du §3.2 : un métier nouveau venu des offres porte au moins 10 offres de 3 employeurs
  distincts (sinon il attend la passe suivante) ; une famille nouvelle reçoit au moins 1 métier (11 des 27 familles
  servies en portent 0 ou 1 ; le seuil de 2 rangeait « Mannequin » dans l'atelier). Les métiers hors luxe vont dans
  « Autres secteurs » (D-475 §33).
- **Résultat de la constitution (2A, 29/09/2026, `audits/2026-09-28/curation-v3/`)**, après trois tours d'audit
  adverse (le premier et le deuxième BLOCKED, corrigés) et les arbitrages D-475 §35 et §36 : manifeste
  `catwalks-occupations-20260929-v3` (empreinte `8cfb2180…`), 253 métiers (3 absorbés par fusion confirmée), 33
  familles, 25 langues ; compilé par le moteur, conforme à la règle de succession. Preview sur les 80 741 offres
  publiables, intitulé nettoyé comme en production (la version servie rejouée redonne 100 % du code ET du statut) :
  62,3 % des offres ont un métier (47,1 % aujourd'hui) ; 0,1 % d'ambiguës (seuil 1 %) ; 0,3 % des intitulés classés
  changent de métier hors plan (seuil 10 %) ; aucune perte hors plan (seuil 0,5 %) ; 57 offres (0,07 %) perdent le
  métier servi. Bancs (`6e-bancs.json`) : les 6 338 libellés et alias de recherche rendent chacun leur métier ;
  compilation 92 ms, 35 Mo, environ 58 000 classements par seconde.
- **Justesse, par tour** (échantillon de 200 couples tiré en proportion des offres qui changent, enregistré dans un
  commit avant tout jugement ; `6d-echantillon-final[-n].json`) :

  | Tour | Version mesurée | Assistant | Second juge | Verdict |
  |---|---|---|---|---|
  | 1 | avant la séparation vente / rayon | 6 faux (3,0 %) | 4 (2,0 %), `gemini-3-flash-preview` | BLOQUÉE |
  | 2 | séparation, première forme | 1 (0,5 %) | 2 (1,0 %), même juge, **non indépendant** (il a co-décidé les rattachements) | audits BLOCKED |
  | 3 | correctifs du 2e audit, avant §36 | 0 | 0, `gemini-3.1-pro-preview` (aucun rattachement) | audit : §36 à trancher |
  | 4 | après §36 | 0 (borne haute de Wilson 1,9 %) | 3 (1,5 %), tous des cas tranchés par §36 (« Team Manager » → Floor manager), notés d'après une grille restée périmée ; 0 hors ces cas | 0 hors §36 ; non concluant au seuil de 1 % ; 3e audit : rayons « à service » rouverts (13 offres), corrigé |
  | 5 | rayons « à service » exclus | 1 (0,5 %) | 11 (5,5 %), grille résumant les décisions ; 2 relèvent de §36 (« Lead Supervisor I », « Team Lead ») ; 4 retenus par l'assistant et corrigés (« Chef des ventes » de Pandora au Manager commercial, « Part Time Supervisor », « Service Lead » de Burberry, « Planner » seul) ; 5 écartés par l'assistant seul (« Sales and Service Leader », « Retail Lead », « Eladó » d'H&M, « Trainee Dispenser », « Replenishment Sales Associate » de Primark) | au-dessus du seuil ; les 4 causes corrigées, plus « Lead - Full Time » (5 offres) sans métier par le même correctif |
  | 6 | avant §37 | 1 (0,5 %) : « Responsable Contrôle de Gestion » au métier de base (§32 a, 1 offre) | 7 (3,5 %) : 2 relèvent de §36 (« Shift Leader », « Acting Supervisor I ») ; 5 hors de toute décision : « Assistant Manager » (×2) et « Responsable adjoint » rattachés à l'Adjoint au responsable de boutique, « Responsable de rayons » au Floor manager (40 offres), « Assistant Manager - Visual Merchandising » à l'Assistant VM | entre 0,5 % (assistant) et 3,0 % (juge, hors §36) ; au-dessus du seuil selon le juge |

  **Version finale de 2A** : le tour 6 plus l'arbitrage D-475 §37 (quatre lectures de l'assistant soumises au CEO :
  « Supervisor », « Superviseur », « Lead » seuls → Floor manager, 67 offres, dont « Lead - Full Time » (5) et « Part
  Time Supervisor » (4) que le tour 5 laissait sans métier ; « Assistant Manager » et
  « Responsable adjoint » gardent l'Adjoint ; « Sales Manager » et « Chef des ventes » restent sans métier ; sans
  accord des juges de 3c, aucun métier). Preview : 62,3 % des offres classées, 57 perdent le métier servi, 0 décision
  de 3c non tenue ; bancs 6 338/6 338. Elle n'a pas de tour propre : la mesure finale ci-dessous la porte.

  Le critère d'arrêt porte sur les verdicts du **juge de mesure** (plan : un modèle différent de celui qui a
  rattaché) ; ceux de l'assistant l'accompagnent, jamais ne le remplacent. Deux cents couples ne peuvent pas
  prouver 1 % : **avant l'activation (2C), une mesure finale de 600 couples** sur la version à activer, avec la même
  grille, pré-enregistrée (la borne haute de Wilson à 95 % passe sous 1 % à 381 couples sans faux, à 563 avec un
  faux).

  Les « 0,1 % en offres » annoncés aux tours 1 et 2 étaient faux : le tirage est déjà proportionnel aux offres, la
  repondération comptait le poids deux fois ; la proportion brute approche la part d'offres fausses (recalcul
  Horvitz-Thompson du 2e audit : tour 2 à 0,46 % et 0,94 %). Avec 200 couples, zéro faux ne prouve pas le seuil de
  1 % (borne haute 1,9 %) ; il ne le contredit pas, et un tirage proportionnel aux offres ne voit pas un défaut de
  quelques offres : les décisions de 3c sont donc aussi vérifiées sur TOUTES les offres par la preview
  (`decisions3cNonTenues`, éprouvé en rouge sur le manifeste du tour 4). **Pertes** jugées toutes (`6d-pertes-4.json`, 48 couples, 57
  offres) : 4 offres fausses selon les règles (« Keyholder / Verkäufer », « Visual Merchandiser Keyholder » perdent un
  métier évident) ; les autres sont des postes d'encadrement sans métier d'encadrement dans la taxonomie (« Director,
  HRBP », « Responsable comptable », « Lead Software Engineer » : §32 a, « lead » jugé encadrement par les deux juges
  à l'étape 4) ou des doubles intitulés. « Aucune perte hors plan » signifie que chaque perte vient d'une décision de
  la passe ; les 4 offres ci-dessus sont des décisions fausses. **Entrées de la passe suivante** : ces 4 offres ; les
  métiers d'encadrement manquants (responsable comptable, directeur RH business partner…) ; « Lead » niveau
  d'expertise ou encadrement (« Lead Software Engineer », « Lead Accountant », environ 17 offres perdues), « chef de rayon » et « responsable de rayons » de la grande distribution (un
  métier d'encadrement propre, aujourd'hui Floor manager, 40 offres et plus), « Responsable contrôle de gestion » au
  métier de base (corrigé par 6h le 30/09/2026), « Dispenser » partagé entre Assistant et Préparateur en pharmacie (Boots, près de 400 offres), la forme
  « Responsable adjoint·e » généralisée (« Responsable adjoint comptable » recevrait l'Adjoint de boutique ; 3 cas
  trouvés depuis, Comptabilité, Visual Merchandising, Prévention des pertes, exclus par 6h le 30/09/2026 ; la ramener
  à l'exact ferait perdre les « Assistant Manager (m/w/d), <centre> » justes),
  les marques de contrat et de genre sur les intitulés de niveau (« Superviseur H/F », « Lead - Part Time »,
  « Responsable Adjointe » sans métier : exigence (9) et (10) du moteur), « Sales Lead with Keys » partagé entre Premier vendeur et Floor manager chez UGG, « chef de rayon »
  de la grande distribution rattaché au Floor manager, les noms de « Conseiller de vente » dans 8 langues à confronter
  à l'usage des offres (§34), « Stellvertretender Filialleiter » classé Store manager par une règle servie (corrigé par 6h le 30/09/2026 : Adjoint).
- **Ce que la constitution impose au moteur (sous-lot 2B)** : (1) un intitulé validé par les juges vaut pour
  l'intitulé EXACT ; sa généralisation à tout intitulé qui le contient est un synonyme partagé, vérifié sur ce qu'il
  capte (R-66 §2, étape 6c : 187 expressions jugées sur leurs captures, 570 ramenées à l'intitulé exact) ; (2)
  l'expression la plus longue l'emporte (D-475 §32 a), portée en 2A par la préséance des règles du moteur, sans cycle ;
  (3) une règle nouvelle d'un métier servi hérite de ses exclusions revues ; (4) un mot seul qui généralise est jugé en
  lui-même (« commercial », adjectif en anglais) ; (5) les intitulés vagues seuls ne classent rien (§32 c) ; (6) une
  garde d'unicité unique sur libellés, alias et expressions, toutes langues, où la version servie prime sur un libellé
  écrit par l'IA (étape 5c) ; (7) des clés de métier tirées d'un identifiant stable ; (8) une seule normalisation, celle
  du moteur, l'expression stockée brute ; (9) **une règle exacte doit ignorer les marques de genre et de contrat**
  (« H/F », « (m/w/d) », « - Part Time ») : aujourd'hui 164 libellés décorés sur 759 seulement rendent leur métier
  (`6e-bancs.json`, information) ; (10) **la forme féminine de chaque expression classe comme la masculine**
  (« Responsable adjointe », « Cheffe de rayon » ne classent pas ; 22 offres « adjointe ») : témoin à écrire en 2B ;
  (11) une expression faite seulement de mots de niveau ne se généralise jamais (D-475 §36). Limite connue : la
  mémoire des réponses des modèles ne rejoue pas à l'identique une correction de libellés en plusieurs tours
  (29/09/2026) ; la sortie relue de l'étape 5b fait foi.
- **Correspondance v2 du moteur (2B-1, commit 4a34fe6)** : écritures japonaise et thaïe, formes féminines, marques
  ignorées en mode exact ; activée par `matchingVersion: 2` (la v1 servie identique à l'octet sur les 80 741 offres,
  audit du 29/09/2026) ; 63,0 % des offres classées, 759/759 libellés décorés ; 17 % plus lente que la v1 sur le même
  manifeste (45 000 classements par seconde). **À contrôler avant l'activation (2C)** : « Animateur » seul va à
  l'animateur de loisirs par son libellé allemand alors que le corpus beauté entend l'animation des ventes (0 offre
  aujourd'hui) ; « Magasinier » va au stock en boutique (intitulé jugé, 26 offres d'Intersport et Blackstore) et plus à
  l'entrepôt ; formes féminines non couvertes (-era/-ero, -iera, -essa italien, -in allemand hors -erin, -ster
  néerlandais, -ka polonais), compensées aujourd'hui par des expressions explicites ; la release
  `catwalks-occupations-20260914-v2` (optique) est dans le code mais la production sert `20260909-v1` (instantané de la
  preview) : vérifier en lecture la release active avant de basculer.
- **Garde d'unicité et vocabulaire unique (2B-2, commits 4707325 et 5e78a1e)** : une seule garde
  (`packages/db/occupation-vocabulary.ts`), deux surfaces (moteur : les métiers ; recherche : métiers, familles et
  secteurs ensemble), lancée par l'assemblage, la preview et un test de l'API ; la v3 porte tout le vocabulaire de
  recherche (`searchVocabularyVersion`), noms remplacés compris (§31 c) ; aucune phrase trouvée par la version servie
  n'est perdue. Défaut connu : le nom vietnamien de la famille Direction de boutique reste « Ban quản lý cửa hàng »
  (organe administratif), trois tours de 5b n'ont pas trouvé de nom court distinct du métier ; entrée de la passe
  suivante.
- **Migrations additives (2B-3a, commits 5431476, 58441d8 et suivant ; deux audits, le premier BLOCKED)** :
  `20260929160000_occupation_title_roles_domain` (clés de chaque version indexées dans `OccupationReleaseConcept`,
  écrites seulement en publiant une version ; `titleRoles` versionnés sur Job et DirectOffer ; domaine CALCULÉ par
  déclencheur depuis la famille) et `20260929160100_occupation_learned_table` (table apprise scellée à sa création,
  immuable, rattachée à sa taxonomie ; état actif à part d'`OccupationState`, remis à vide à chaque activation de
  taxonomie ; source de chaque décision : règle, table apprise ou back-office). **Appliquées en production le 29/09/2026 à 18:18 UTC** (GO n°1 du CEO, après la fin du RUN ; avec la migration `20260930090000_search_requeue_tranches`), en 2 s ; vérifié : statut à jour, aucune transaction en cours, l'API servie répond `ok` (search-4 prête, file vide), et le contrôle de démarrage du worker servi (`prisma migrate status` avec ses 93 migrations) rend 0 face à une base en avance.
  **Application (GO du CEO)** : mesuré en lecture seule le 29/09/2026 (`scripts/taxonomie/mesure-application-2b.mts`) :
  Job 83 826 lignes (188 Mo, 1,9 Go avec index), DirectOffer 59, une seule version publiée (la v1, sans clé en
  double) ; contraintes `NOT VALID` (lignes existantes valides par construction), seul coût sous verrou : l'index GIN
  de `Job.titleRoles`, quelques secondes ; `lock_timeout` de 5 s : une attente de verrou annule la migration d'un
  bloc (`prisma migrate resolve --rolled-back <migration>` avant de relancer). **Ordre imposé** : les migrations AVANT
  toute promotion de ce code sur `main` (le client Prisma lit les nouvelles colonnes : sans elles, toute lecture des
  offres échouerait), hors RUN, après contrôle de `pg_stat_activity`. Le domaine des lignes existantes se remplit au
  reclassement de l'activation (2C) : aucun lecteur ne l'attend avant ; une offre Catwalks rattachée à sa seule
  famille n'a pas de domaine (aucun filtre n'en dépend, plan §3.1) ; le sceau recompte les entrées d'une version à
  chaque ligne (2,8 s à 8 000 entrées) : à revoir au-delà de 10 000.
- **Ce que la séparation vente / rayon impose à l'activation (sous-lot 2C)** : la clé stable `employe-de-commerce`
  porte désormais « Employé de rayon » ; les profils, préférences et alertes qui la portent au backend (141 candidats
  sourcés mesurés le 29/09/2026, aucun inscrit) ne se renomment pas en bloc : chacun se reclasse depuis son intitulé
  selon les décisions de l'étape 3c (vente, rayon ou aucun métier).
- **Métiers lus dans l'intitulé (2B-3b, D-475 §38, commits 9281fc6 et suivants)** : `titleRoles` = les candidats du
  moteur, plus les métiers que le résolveur de la recherche (réduit aux métiers) lit dans un intitulé PLUS LONG
  (`packages/db/occupation-title-roles.ts`), seulement pour une expression vérifiée sur ce qu'elle y capte (étape 6g :
  `titleReadingAliases`, 70 expressions ; un seul verdict « autre métier » la ramène à l'intitulé exact ; sous 5
  offres, pas de lecture), jamais sous un mot d'encadrement du même segment de l'intitulé (liste partagée avec
  l'étape 4), jamais pour une forme qui désigne un autre métier (`titleReadingExclusions` : frontières servies comme
  « adjoint » ou « deputy », décisions v3 §32 a, §35, §37 ; sauf « formation » et « training », que l'exemple de la
  décision montre faux), jamais au-delà d'un intitulé classé par une règle exacte. L'exemple de la décision
  (« Conseiller(ère) de Vente – Poste avec formation avant embauche ») se lit ; 1 048 offres gagnent un métier.
  **Lecture de l'assistant sur la justesse, à soumettre au CEO avec la carte d'activation** : mesure 6f (tirage neuf,
  verdicts de l'assistant committés avant le juge indépendant `gemini-3.1-pro-preview`) : lecture sans preuve,
  18,5 % de faux selon l'assistant et 16,5 % selon le juge ; tour 2, 10,5 % et 7 % ; tour 3 (version précédente de
  la lecture), 3 % et 1,5 %, au-dessus du seuil de 1 % du moteur. La version actuelle n'est pas encore mesurée : elle
  le sera avant l'activation, avec la question « un poste d'assistant X sort-il sous X ? » (aujourd'hui, à la lettre
  du §38, oui). **Rien n'est lu par la recherche** : aucun lecteur de `titleRoles` avant 2B-4. Dès les migrations 2B
  appliquées et ce code promu, chaque RUN écrit `titleRoles` avec la version active (la v1 : les seuls candidats).
  `loadOccupationTaxonomy` refuse de tourner sans les migrations 2B (`OCCUPATION_SCHEMA_2B_MISSING`). **La recherche
  servie (`search-3`, `apps/api/lib/search-model.ts`) lit tout alias dans l'intitulé et le fait passer devant le code
  du moteur : aucune activation de la v3 (2C) tant qu'elle n'est pas remplacée par la lecture de la colonne (2B-4)** ;
  sinon 869 offres verraient leur métier remplacé (« Responsable vendeur » indexé Conseiller de vente).
  **Défauts connus, entrées de la passe suivante** : l'alias servi « Optometric Technician » d'Optométriste (sa lecture
  est retirée par 6h le 30/09/2026 ; l'alias de recherche reste) ;
  « Säljare », « Πωλητής », « 销售助理 » portés par Commercial ou Assistant commercial ; adjoints suédois et japonais
  lus Responsable de boutique (« Assisterande Butikschef Gant Outlet Hede », « アシスタントストアマネージャー » ; corrigé par
  6h le 30/09/2026) ;
  « area manager » lu sur des postes d'entrepôt ou de vente wholesale ; Chef de produit rangé en Développement
  produit & R&D (« chef de produit » ramené à l'exact : 53 offres non assistantes perdues) ; « Conseiller.e de
  ventes » au pluriel non lu (48 offres) ; libellés affichés de Premier vendeur et Keyholder en pl, cs, pt, ro, el.
  L'empreinte du manifeste a changé avec 6g (règles identiques) : les mesures 6d déjà comptées valent pour le moteur.
  **Mesures finales avant activation (29/09/2026, verdicts de l'assistant committés avant le juge indépendant)** :
  aperçu 6b refait (63 % des offres classées contre 47,1 %, prémisse 100 %, 0 collision, hors plan 0,3 %) ; moteur,
  6d tour 7, 600 couples : 1,2 % de faux selon l'assistant, 1,8 % selon le juge (bornes hautes 2,4 % et 3,3 %),
  dont « Manager des ventes » (45 offres) classé Floor manager alors que le point 37 d laisse « Sales Manager » sans
  métier : question au CEO (le contexte de D-486 le range sous le point 37 d ; corrigé par 6h le 30/09/2026, voir plus bas) ; métiers lus, 6f tour 4, 400 couples sur 979 (1 048 offres) : 2,8 % selon l'assistant,
  5,5 % selon le juge (qui compte aussi les Product Owner informatiques et les formateurs d'entrepôt comme d'autres
  métiers, par la famille). **Compatibilité des trois migrations avec le code servi (vérifiée dans le code de
  `main`)** : la disponibilité de l'API n'exige que ses propres migrations ; le code servi n'écrit ni `titleRoles` ni
  le domaine (valeurs par défaut, déclencheurs compatibles) ; le RUN touche `OccupationState` après chaque lot
  reclassé, ce qui remettait jusqu'ici tout l'index en file : la demande de remise en file la remplace (l'ancienne API
  ne la sert pas ; chaque offre modifiée reste remise en file par son déclencheur). **Contrainte de 2C** : l'API de ce
  dépôt sert `search-5` et ne se déploie qu'avec la v3 active (sinon régression ou indisponibilité) ; l'agrégateur et
  l'API partagent `main` : leur promotion appartient à la fenêtre d'activation.
  Audit technique du 29/09/2026, suites : la lecture coûte 0,012 ms par intitulé (le rejeu d'activation reste de
  l'ordre de 3 s) ; elle lit l'intitulé que le moteur classe, pas le brut et ses entités HTML ; l'historique immuable
  des décisions ne compte plus un changement limité aux métiers lus (sans quoi le premier passage après les
  migrations aurait écrit une observation par offre) ; les sondes de couverture mesurent le métier comme la facette
  (code ou métier lu, `packages/db/colonnes-facette.ts`). Défauts connus restants : la clé de l'intitulé et celle de
  l'alias ne passent pas par la même normalisation (le « ı » turc : 133 formes jamais lues, 4 offres) ; le lecteur
  ignore les familles (« Visual Merchandising Assistant » lu Assistant merchandiser, 4 offres : exclu par 6h le
  30/09/2026 ; le défaut général demeure) ; `titleRoles` dépend
  aussi du code du lecteur, que sa version ne date pas (à dater avant toute modification du lecteur une fois activé).
- **Vocabulaire corrigé à la main avant l'activation (étape 6h, 30/09/2026, D-475 §39)**, fichier
  `audits/2026-09-28/curation-v3/6h-corrections-main.json`, lu par l'assemblage (6) et l'aperçu (6b) : seulement des faux
  mesurés (tours 6 et 7 du moteur, 4 et 5 des métiers lus, 8 du moteur) ; chaque correction dit sa nature :
  **décision** (§37 d : « Manager des ventes », « Manager, Sales » sans métier ; §37 b : « Responsable adjoint » suivi de
  Comptabilité, Visual Merchandising ou Prévention des pertes n'est pas l'adjoint de boutique ; §32 a : « Responsable
  contrôle de gestion »), **frontière servie** (« assistant », « adjoint », « deputy » du Responsable de boutique, dans les
  langues du corpus : Assistent, Assisterende/Assisterande, Ställföreträdande, Stellvertretender/Stellv., Vice,
  アシスタント, qui vont à l'Adjoint par des expressions ajoutées) ou **lecture de l'assistant** (Commis de cuisine,
  Assistant KAM, Designer chaussures et Collection Merchandiser pour leur niveau d'assistant, Visual Merchandising
  Assistant, « controlling solutions », « inventory controlling », « programme office », « Product Manager Assistant
  Designer », lecture « Optometric Technician » retirée). Effets recomptés par `6h-effets.mts` (`6h-effets.json`) :
  116 couples et 183 offres changent sur le corpus du 29/09 (122 et 189 sur l'export du 30/09), aucun changement
  inexpliqué ; le Responsable de boutique perd 93 offres, toutes à l'Adjoint ; le Floor manager 45 (« Manager des
  ventes »), le Manager commercial 7, le Contrôleur de gestion 8, l'Optométriste 8 (lecture), le Cuisinier 6 (au Commis
  de cuisine), l'Account Manager 4 (à l'Assistant KAM). L'assemblage refuse une forme sans métier qui en garde un, une
  expression qui ne rend pas son métier, une lecture retirée encore vérifiée, et une exclusion non tenue ou inutile
  (chaque forme, retirée en mémoire, doit rendre le métier à l'un de ses témoins, intitulés réels du corpus). Témoins :
  `apps/aggregator/src/occupation/title-roles.test.ts`, prémisse prouvée en mémoire, 36 rouges sur le manifeste d'avant
  6h. Aperçu refait : 62,9 % des offres classées, prémisse 100 %, hors plan 0,3 %, 58 offres perdent le métier servi,
  0 collision ; bancs 6 338/6 338.
  **Mesures (verdicts de l'assistant committés avant le juge `gemini-3.1-pro-preview`, même grille qu'aux tours 7 et
  4)**, sur les seuls couples jamais jugés sous leur résultat actuel (écartés par le COUPLE, jamais par le titre : les
  corrections ont été faites sur les couples déjà jugés, et les remesurer rendrait 0 faux par construction) :

  | Tour | Version | Population mesurée | Assistant | Juge |
  |---|---|---|---|---|
  | moteur, 6d tour 8 | 6h, premier tour (`e6ae8bc1`) | corpus du 29/09 : 600 couples sur 3 286 (4 030 offres, 30 % des offres qui changent) | 2 F, 0,3 % (Wilson 1,2 %) | 11 F, 1,8 % (3,3 %) |
  | lus, 6f tour 5 | idem | les 368 couples jamais jugés (377 des 1 024 offres lues) | 5 F, 1,4 % (3,1 %) | 12 F, 3,3 % (5,6 %) |
  | moteur, 6d tour 9 | **finale** (`e789492d`) | export du 30/09 : 600 couples sur 3 182 (3 849 offres, 26 % des offres qui changent), dont 78 nouveaux | 8 F, 1,3 % (2,6 %) | 14 F, 2,3 % (3,9 %) |
  | lus, 6f tour 6 | **finale** | les 135 couples lus apparus depuis le 29/09 (141 des 1 153 offres lues), qu'aucune correction n'a vus | 0 F (2,8 %) | 4 F, 3,0 % (7,4 %) |

  Faux du tour 9 relevés par les deux : « Lead Sales Associate » qui perd le Conseiller de vente sans recevoir le
  Premier vendeur (3 couples, 16 offres ; défaut connu du « Lead »), « Junior Sales Manager » au wholesale (§37 d, non
  couvert par 6h), « Sales Representative » d'une boutique Omega au Commercial, « Employment Brand Manager » au Chef de
  marque, « Sales & Client Advisor (Keyholder) » sans métier du moteur ; par le juge seul : chef de rayon (2), « Services
  Manager, Stores » (2), « Chef d'équipe des services », « Regional Brand Ambassador », « Eladó (Tesco) » ; par
  l'assistant seul : l'Account Manager d'un comptoir Clinique chez Boots. Faux du tour 6 selon le juge : un « assistant
  X » et une alternance lus X, « Business Process Owner – Controlling », « Ingénieur amélioration continue Transport ».
  Au tour 8, parmi les 11 du juge : 3 intitulés de niveau que le point 36 range au Floor manager (« Supervisor I-1 »,
  « Lead Supervisor I-1 », « Acting Lead Supervisor I »), « Associate Manager » à l'Adjoint (8 offres, règle exacte),
  2 « Replenishment Sales Associate », 2 « Eladó (Auchan) », un chef de rayon, « International Sales Manager » ; au
  tour 5, parmi les 12 : 5 « assistant X » ou stages lus X sans métier distinct pour ce niveau, 3 par la famille
  (Product Owner informatiques, formateur d'entrepôt), « Manager, Sales Controlling » et « Client Experience Training
  Manager ». L'audit métier du 30/09 relit certains verdicts de l'assistant plus sévèrement (tour 8 : 0,8 % ; tour 5 :
  1,6 %). **Aucune des deux lectures n'est sous 1 % selon le juge de mesure, ni le moteur selon l'assistant au tour 9 :
  la condition de D-486 n'est pas remplie (§6).** Restent pour une passe suivante ou une carte : les faux ci-dessus,
  les questions du §6.
- **Référence ESCO** publiée et datée, somme de contrôle versionnée.

### 3.2 L'IA validatrice : passes de curation (D-475 §30, §31 a)

Une passe, mensuelle au départ : regrouper les intitulés nouveaux et les signaux « métier manquant » →
écrire le plan (métiers nouveaux, successeurs, correspondances, variantes) → preview sur le corpus réel →
contrôles (granularité ancrée à l'ESCO, famille obligatoire, aucun orphelin, garde d'unicité, deux juges, au
moins 20 intitulés réels venus d'au moins 3 employeurs ou sources distincts par métier nouveau, sauf signal
d'un recruteur Catwalks, qui suffit (§31 b) ; au plus 20 métiers nouveaux par passe) → activation avec reçu.
Après la v3, **les passes s'activent sans GO** (D-475 §30 : aucun humain en bout de chaîne ; lecture de
l'assistant), sous leurs seuils d'arrêt ; chacune est irréversible pour les identifiants qu'elle publie.
**Sécurité** : la sortie du modèle est contrainte par un schéma ; un libellé n'est jamais recopié d'un intitulé
tiers ; les gardes « non-métier » de R-66 s'appliquent. **Seuils de départ, à recalibrer** : échantillon neuf de 200
rattachements par version, jugé par un modèle différent de celui qui a rattaché (sans vérité humaine) ; arrêt si
plus de 1 % de faux mesurés (la preuve en mesure 1 sur 541 avec le consensus, 2 % sans ; D-475 §30, mesure
corrigée le 28/09/2026), ou si la version change la classe de plus de 10 % des intitulés hors plan de curation. **Surveillance** : une passe suspendue, une sonde de juge en échec,
un retard de synchronisation ou une file d'index de plus de 60 s envoient une alerte par l'e-mail d'exploitation
du RUN (`apps/aggregator/src/pipeline/alert.ts`, Brevo) ; la présence de sa clé en production est vérifiée en 2B,
car sans elle l'alerte ne part pas. **Construit (pas déployé)** : la file de recherche est surveillée par l'indexeur de
l'API lui-même (`apps/api/lib/search-alert.ts`, une vérification par minute, alerte au-delà de 60 s, une par heure au
plus). **Mesuré le 29/09/2026 sur Railway (noms de variables seulement)** : `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` et
`ALERT_EMAIL` ne sont posées que sur `catwalks-ingestion-worker` (le RUN) ; ni `catwalks-catalogue-api` (l'API, qui
indexe) ni `catwalks-direct-sync` n'en ont : **les poser sur l'API fait partie de la carte d'activation**, sans quoi
cette alerte reste muette. Les alertes des passes de curation et des juges viendront avec les passes automatiques.

### 3.3 Normalisation d'un intitulé

- **Un seul module de normalisation et de classification**, partagé par l'agrégateur, l'API et le backend
  (paquet versionné) : il remplace `canonical()`, `phrase()` et `searchWords()`, garde le rattrapage des
  féminins, découpe le thaï et les kana. Témoins communs, dont deux rouges aujourd'hui :
  « コスメビューティーアドバイザー » (contient « ビューティーアドバイザー ») et « พนักงานขายเครื่องสำอาง »
  (contient « พนักงานขาย ») ; plus des féminins, « 販売員 », « مستشار مبيعات », « 판매 사원 », et
  « アドバイザー » (la normalisation actuelle efface le dakuten : « アトハイサー »).
- **En ligne, déterministe** : variante exacte, puis règle relue, puis table apprise. La table peut préciser en
  métier une décision `FAMILY_ONLY`, `NO_RULE` ou `AMBIGUOUS`, jamais remplacer un `CLASSIFIED` venu d'une règle.
  Aucun appel d'IA en ligne (garde de test).
- **Table apprise** : cache, verrou et garde d'écriture sur deux versions (taxonomie, table) ; toute décision qui
  atteint l'étape de la table porte la version évaluée ; le balayage reprend les intitulés dont l'entrée a changé.
  Reçu et pointeur précédent pour revenir.
- **Rôles du titre stockés** : au moment de la classification, `occupationTitleRoles` (`packages/db`, avec le
  résolveur de la recherche) écrit sur `Job` et `DirectOffer` un tableau `titleRoles`, indexé, avec la version du
  manifeste qui l'a calculé : les candidats du moteur et les expressions vérifiées lues dans l'intitulé (§3.1,
  2B-3b) ; pour `DirectOffer`, l'empreinte de projection inclut ces rôles et leur version.
- **Hors ligne** : candidats Catwalks d'abord (avec leurs URI ESCO), l'ESCO au-delà ; synonymes d'offres au
  consensus de deux juges. Les intitulés de CV sont traités **au backend**, qui appelle déjà le modèle : aucun
  intitulé de CV ne part vers l'agrégateur ; la politique de confidentialité le déclare avec le reste du lot.
  Comme aujourd'hui (R-66 §2, D-213), un intitulé de CV récurrent peut devenir une variante de recherche : le
  backend ne transmet au catalogue que les variantes validées par le consensus de deux juges et les gardes
  d'alias, vues dans au moins 3 CV distincts, jamais l'intitulé d'une personne ; elles ne deviennent jamais des
  suggestions affichées ; la politique de confidentialité le déclare.

### 3.4 Profils, choix et corrections

- Le profil stocke le texte, et le code de métier quand il est connu (une saisie rattachée à sa seule famille
  cherche par son texte) ; sans code, l'accueil et les alertes cherchent par le texte ; quand le code arrive,
  **ils basculent ensemble** (§32 b) : une tâche du backend réécrit la préférence et les alertes nées d'elle
  (onboarding, conversion ; jamais une alerte créée depuis un texte tapé sur `/emplois`), fusionne un doublon
  d'empreinte en gardant la plus ancienne, son état (active ou suspendue) le plus actif et **l'union des offres
  déjà annoncées** (`AlerteOffreAnnoncee`), pour qu'aucune ne reparte. Un profil qui a plusieurs métiers dont certains sans code cherche par le code pour les uns
  et par le texte pour les autres, dans une même requête (le paramètre de texte accepte plusieurs valeurs).
- Le choix d'une suggestion vaut 1,0 sur le profil seulement ; il ne nourrit que la passe de curation suivante
  (au moins 3 comptes distincts), jamais une écriture directe dans la table.
- Corrections (candidat, recruteur, chasse) : des signaux négatifs pour la passe suivante.
- Poste actuel (D-145) : calculé au backend sur l'intitulé et les missions de l'expérience en cours, avec le
  module partagé, par une **passe cadencée et durable** (reprise sur erreur), jamais dans la requête ni dans une
  mémoire d'instance : c'est un cache d'empreintes en mémoire serverless qui faisait sauter le moteur v1 à froid
  (`rattachement-v1.ts:108-117, 231`) ; un témoin prouve le passage à froid.

### 3.5 Recherche, suggestions, alertes

- `metier=X` retient une offre si son code est X, **ou** si X figure dans ses `titleRoles` ; sans aucun des deux, elle est « non classée » (2B-4, `apps/api/lib/job-search-query.ts`, témoin dans `jobs-database.test.ts` ; construit, pas encore déployé). Aucune clé servie par l'agrégateur n'est remplacée par la v3 (les trois absorptions portent sur des clés du backend) : le suivi vers un successeur n'a pas de cas aujourd'hui. **Recherche texte (2B-4, construit, pas déployé)** : les métiers du document sont ceux de ses colonnes, son code et
  ses `titleRoles` (`apps/api/lib/search-model.ts`, génération `search-5`) ; sans aucun, l'intitulé reste cherchable par
  ses mots (`search-sql.ts`). **`search-5` ne se sert qu'avec la v3 active et le stock reclassé** : la commande
  `rebuild` le refuse sinon, et l'API qui la sert ne se promeut qu'à l'activation (2C). Servie sous la v1, elle
  ferait perdre un métier à 99 offres (36 « Esthéticien / Conseiller de beauté ») et sortir 10 adjoints sous le
  Responsable de boutique (« Assistant Store Director », non classé en v1) : audit du 29/09/2026, sur l'export v1.
  Défaut connu sous la v3 : 1 562 offres sans métier en colonnes nomment un métier dans leur intitulé, dont 982 avec un
  mot de niveau (« Adjoint(e) Responsable de Boutique ») ; une recherche « Responsable de boutique » les trouve par les
  mots (`search-4` les trouvait par un métier lu sans preuve) ; le remède est leur vocabulaire (passe de curation).
  Reste pour 2C : le reclassement touche `OccupationState` à chaque lot, ce qui reprend la remise en file au début
  (une fois par passe, plan §3.6) ; `rebuild` peut s'arrêter avant la fin d'une remise en file, que l'API termine. Une clé remplacée
  n'est plus classée, n'entre plus dans le vocabulaire, la garde ou les facettes ; une recherche, une préférence
  ou une alerte qui la porte est suivie vers son successeur **au moment de la requête**, sans réécrire son
  empreinte. La facette compte la même appartenance. Aucune dépendance à l'index. **Encadrement** (§32 a) :
  « Responsable vendeur », « Team Leader Client Advisor » ont leur métier d'encadrement, dont la v3 porte les
  variantes ; témoins : ils ne comptent pas comme « Vendeur ».
- **Suggestions, contrat additif** (API construite en 2B, pas déployée : `apps/api/lib/suggestions.ts`,
  `/api/suggest` ; le site les lira en 2D) : les chaînes restent ; un champ nouveau porte `{libellé, identifiant}`
  (`metiers[i]` pour `suggestions[i]`, `null` quand la suggestion ne nomme pas un seul métier ; `type=metier` rend les
  métiers de la taxonomie, même sans offre vivante et index indisponible) ;
  les intitulés réels sans identifiant restent proposés ; l'écran dit le métier reconnu (« Métier : Conseiller
  de vente ») ; pour les préférences et l'onboarding, un métier sans offre vivante reste choisissable, sans
  dépendre de l'index.
- **Alertes** : elles rejouent le même filtre ; la bascule texte → code est celle du §3.4.

### 3.6 Changer de version sans panne

- **Préalable, en 2B (construit, pas déployé : migration `20260930090000_search_requeue_tranches`, `advanceSearchRequeue` dans `apps/api/lib/search-index.ts`, témoins dans `jobs-database.test.ts`)** : le changement de version ne remet plus rien en file ; il incrémente la révision, et une
  tâche remet le stock en file **par tranches** bornées par le débit mesuré (environ 327 documents par seconde :
  une tranche de 10 000 se vide en une trentaine de secondes, sous le seuil d'alerte de 60 s), la tranche
  suivante partant quand le plus ancien élément de la **génération servie** a moins de 60 s ; la durée réelle
  est remesurée sur la génération courante (`SearchGeneration.createdAt` et `readyAt`) avant la bascule ; `search-3` retirée avant (suppression en
  cascade : GO et confirmation).
- **Séquence de bascule, hors RUN** (commande de construction : `node --import tsx apps/api/scripts/search/index.mts rebuild`, lancée avec le code de la nouvelle génération ; retrait : `retire search-4-… --previous-runtime-stopped`) : migrations additives ; remplissage cadencé de `titleRoles` ; construction de
  la nouvelle génération d'index, **drainée sans arrêt** jusqu'au déploiement par un processus dédié du service
  d'indexation (l'API en service ne vide que sa propre génération, `search-index.ts:53-91`) ; déploiement de
  l'API ; retrait de l'ancienne génération. L'âge de la file est surveillé en continu par ce même service, qui
  détient la clé Brevo et envoie l'alerte (§3.2).
- Même règle pour tout écrivain de masse (reclassement, table apprise, rattrapage) ; `OccupationState` touché une
  fois par passe.
- **Cible mesurée sur une copie** : aucune réponse 503 pendant l'activation et le reclassement ; p95 de la
  recherche avant et après `titleRoles`.

### 3.7 Backend, site, back-office, Média

- **Synchronisation** : export versionné (version et empreinte) de la taxonomie, des variantes et de la table
  apprise, tiré par une tâche du backend, chargé par paquets puis basculé par un pointeur (la table peut compter
  des dizaines de milliers d'intitulés, sous les plafonds des fonctions Vercel, mesurés dans ce contexte) ; retard
  mesuré et alerté ; un identifiant inconnu
  est accepté, stocké et résolu plus tard, jamais refusé.
- **Transition** : chaque écrivain écrit le code et l'ancien identifiant (correspondance validée par l'IA) ; R-39
  accepte le code ; l'onboarding ne bloque jamais sur un code en attente ; les anciens liens de la CVthèque
  (`?jobFamily=`) sont traduits.
- **Back-office** : métier d'une offre choisi dans la taxonomie ; signal « métier manquant » (§31 b), enregistré
  au backend et remis au catalogue par une route authentifiée par la clé du backend (jamais par la liste
  publique) ; il suffit à la passe suivante ; après la passe, une tâche du backend réécrit le métier de l'offre
  sur le nouveau métier, qui voyage ensuite dans le contrat ; un témoin va du signal au reclassement. La création
  de métier disparaît. **Pour une offre Catwalks, le métier choisi au back-office
  prime sur le titre** (§20) : il s'écrit dans l'offre du backend, voyage dans le contrat, et l'agrégateur le
  prend tel quel.
- **Offres Catwalks** : identifiant en champ additif du contrat v1 ; agrégateur livré avant le backend ; libellé
  dans la langue du marché.
- **Ordre en 2E** : backend, puis back-office, puis site, puis Média (qui lit le libellé du métier des offres).
- **Construit en 2E (30/09/2026, branches `v2-lot-2e-taxonomie-v3`, pas déployé ; lectures D-492 dans `DECISIONS.md` du
  backend)** : côté agrégateur, `GET /api/taxonomie/export` (clé du backend seule ; parties `entete`, `concepts`,
  `apprise`, `signalements` ; chaque page porte la version et l'empreinte qu'elle sert, un curseur périmé rend 409),
  `POST /api/metiers/signalements` (clé du backend seule, idempotent, 8 Ko) et la table `OccupationMissingSignal`
  (migration additive `20260930210000_occupation_missing_signal`, non appliquée ; une résolution nomme un métier que sa
  version publie, sinon la base la refuse) ; la liste publique porte `occupationCode` (additif) et la projection des
  offres directes le fait primer sur l'intitulé quand la version active le publie (`occupationDecisionSource =
  'backoffice'`, correspondance directe v7). La résolution d'un signal est écrite par la passe de curation (2C bis),
  pas encore construite : jusque-là, les signaux restent ouverts. Preuve de bout en bout sur deux bases jetables : le
  backend tire la v3 réelle (253 métiers, 33 familles, 4 domaines) par l'API servie en local et remet un signal.

### 3.8 Retrait complet

Après bascule vérifiée de chaque surface : retrait du moteur v1 et de son drapeau, du chemin IA inerte de
`mapJobCategory`, de la création de métier au back-office, des écritures dans `JobCategoryRef`, puis des
anciennes colonnes (suppression : GO, confirmation, sauvegarde), et de `/api/job-categories` sans client.
Mise à jour du `CLAUDE.md` de l'agrégateur (D-475 §20, §26 a).

## 4. Sous-lots, dans l'ordre

| | Contenu | Production |
|---|---|---|
| 2A | Référence ESCO datée ; taxonomie v3 et correspondances par la première passe de curation ; bancs (classification, recherche, mémoire, rappel par marché) | aucune écriture |
| 2B | Agrégateur : forme additive, garde d'unicité partagée, module partagé, `titleRoles`, domaine stocké, table à deux versions, filtre et facette sans index, suggestions additives, activation sans remise en file massive, génération d'index pré-construite, surveillance ; la preview de 2A est refaite sur ce code (l'IA validatrice passe après 2C : D-475 §39) | migrations additives et retrait de `search-3` : GO et confirmation |
| 2C | Activation de la v3 hors RUN, reclassement au rythme, table apprise sur le stock de l'agrégateur | GO, **irréversible pour les identifiants** |
| 2C bis | Passes de curation automatiques (IA validatrice, §3.2), avant la v4 (D-475 §39) | activation sans GO sous leurs seuils (§30) |
| 2D | Site `/emplois` : suggestions, recherche par identifiant | GO |
| 2E | Backend (synchronisation, colonnes, transition, poste actuel), puis back-office, site, Média ; rattrapage des populations du backend | GO et confirmation |
| 2F | Retrait (§3.8) | suppressions : GO, confirmation, sauvegarde |

Chaque sous-lot : audit adverse, push sur `development`.

## 5. Pour le lot 3 : ce que disent les plateformes (citations vérifiées à la source)

- **Google Cloud Talent Solution** : une recherche dédiée aux alertes, « tuned to the needs of "passive job
  seekers" », restreinte aux offres « posted since the last alert was generated » ; les quasi-doublons : « displays
  only one representative job from that group high up in the results. The remainder are returned lower down. » ;
  la requête normalisée : « the ontologies are used to map the cleaned query to relevant clean jobs ».
- **LinkedIn, Air Traffic Controller (01/03/2018)** : « repetitive, excessive and low-quality notifications can
  create a bad experience for members » ; une notification tombe si le membre a déjà agi, si elle est en
  double, si son contenu a expiré ; envoi « at a time when the member is most likely to engage » ; « cut member
  complaints in half ».

Catwalks a déjà décidé l'essentiel (R-130) : les offres nouvelles depuis le précédent examen, un e-mail par
inscrit, rien s'il n'y a pas de nouveauté, jamais une offre déjà poursuivie. À instruire au lot 3 : l'heure
d'envoi, le regroupement d'une même offre entre plusieurs alertes, le suivi des désabonnements et des plaintes.

## 6. Ce qui reviendra au CEO

Les GO de production du §4. Au lot 3 : l'heure d'envoi des alertes (07:30 heure de Paris, décidé par R-130 §1,
non construit). Tout nouveau choix produit qu'un audit révélerait lui sera posé en carte de décision.

**À arbitrer, relevé par les mesures et l'audit du 30/09/2026 (étape 6h, §3.1)** — rien n'en est tranché :
- **D-486** (GO de l'activation « si la mesure finale passe sous 1 % ») : sur la version finale, le moteur mesure 2,3 %
  de faux selon le juge (1,3 % selon l'assistant) et les métiers lus 3,0 % (0 selon l'assistant, sur 135 couples) ; la
  condition n'est pas remplie (§3.1) : l'activation revient au CEO.
- **« Un poste d'assistant X sort-il sous X ? »** en général (§38) : environ 75 offres lues aujourd'hui ; 6h ne l'a
  appliqué qu'aux métiers dont la v3 porte un métier distinct pour ce niveau, en le disant (lecture de l'assistant).
- **Chef de rayon et responsable de rayons de la grande distribution** rangés au Floor manager (plus de 50 offres) :
  un métier d'encadrement propre, par analogie avec le point 35.
- **« Replenishment Sales Associate »** (réassort de boutique, Primark) : rangé au rayon par les juges de 3c, au stock
  en boutique ou sans métier selon la variante.
- **« Account Manager » d'un comptoir de marque en magasin** (Clinique chez Boots, John Lewis) lu Account Manager du
  wholesale ; **« Lead Sales Associate »** qui perd le Conseiller de vente sans recevoir le Premier vendeur.
- **« Manager des ventes »** : rangé sous le point 37 d par 6h (forme française de « Sales Manager ») ; ses 45 offres
  sont toutes de boutique, comme les 137 « Sales Manager » que le point 37 d laisse sans métier.
