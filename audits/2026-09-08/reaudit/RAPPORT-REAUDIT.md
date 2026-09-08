# Réaudit Catwalks — production réelle, 8 septembre 2026

**Verdict : le moteur fonctionne, mais je ne qualifierais pas encore son catalogue de référentiel mondial fiable.** Les obstacles démontrés sont la mauvaise attribution des employeurs, des fusions d’offres distinctes, la traçabilité incomplète et plusieurs écarts de sens entre la donnée et le front. Le nombre d’offres n’est pas le problème principal.

Audit **sans modification du code applicatif ni de la production**, sans activation de source, sans déploiement, sans test de charge et sans données simulées. Seuls ces rapports, requêtes et exports d’audit ont été créés.

Mesure principale : **8 septembre 2026 à 15:57:38 UTC / 17:57:38 Paris**, transaction PostgreSQL `REPEATABLE READ READ ONLY`. Contrôles complémentaires de production, API, navigateur et sources officielles effectués ensuite le même jour. Version applicative déployée : `b7aa6dafe00c8cc286a43b62332b938de5db7a9f`. Les 73 645 fiches ont été examinées pour les métriques globales ; les vérifications chez les employeurs sont ciblées et ne constituent pas un échantillon statistiquement représentatif.

## Les chiffres à retenir

| Mesure | Production observée | Ce que cela permet de dire |
|---|---:|---|
| Offres totales / actives / fermées | 73 645 / **71 636** / 2 009 | États Catwalks, pas certification de l’ouverture chez l’employeur |
| Pays renseigné | **66 882 — 93,36 %** | Complétude ; certaines valeurs restent suspectes |
| Pays absent | **4 754 — 6,64 %** | Non accessibles par un filtre de pays déterminé |
| Métier canonisé | **66 531 — 92,87 %** | 5 105 non classés ; précision du classement non certifiée |
| Ville renseignée / subdivision de premier niveau | 70 450 / 15 845 | Des départements, pays et zones commerciales occupent encore `city` |
| Identifiant INSEE | 2 770 | Preuve plus structurée, mais couverture partielle |
| Séniorité renseignée | 67 443 | **48 601 `MID`** ; le classifieur retourne MID par défaut |
| Durée du contrat / rythme de travail renseignés | 22 581 / 50 814 | 31,52 % / 70,93 % ; dimensions correctement séparées |
| Modalité de travail renseignée | **5 838 — 8,15 %** | 3 607 sur site, 1 828 hybrides, 403 remote ; 65 798 inconnues |
| Sans réobservation depuis plus de 48 h | **2 456 — 3,43 %** | À réexaminer ; ne signifie pas 2 456 offres fermées |
| Date d’expiration déclarée dépassée, toujours active | **79** | Risque à instruire, pas 79 fermetures prouvées |
| Publication datée dans le futur à plus de 24 h | **5** | Erreur de parsing Douglas démontrée |
| Copies d’une même page d’annonce | **32 représentations en trop confirmées**, dans 26 groupes | **Borne minimale 0,045 %**, pas taux global de doublons |
| Fusions réunissant plusieurs identifiants Oracle | **38 fiches à revoir** | Deux fiches Paris/Gold Coast manifestement croisées |
| Entreprises enregistrées / avec offres actives | **1 556 / 1 054** | Toutes ont `kind=UNKNOWN` ; impossible de certifier séparément le nombre de Maisons, groupes et enseignes |
| Libellés de groupes parents | 34 au total, 30 avec offres actives | Chaînes de caractères, pas référentiel de groupes validés |
| Offres sans relation Company | **0** | Une relation existante ne prouve pas une identité correcte |
| Entreprises sans empreinte historique d’une source actuellement ACTIVE | **343** | Mesure indirecte ; un groupe peut couvrir une Maison sans offre actuellement |
| Sources cataloguées / actives | **495 / 440** | 7 PAUSED, 48 RETIRED |
| Familles d’adaptateurs actives | **38** | Ce n’est pas « 38 éditeurs ATS » : le total inclut des portails et extracteurs génériques |
| Source propriétaire canonique renseignée | **32 offres actives seulement** | 71 604 sans les deux identifiants canoniques explicites |
| Offres actives sans RAW dans Job ni JobSource | **5 251** | Leur état d’origine ne peut pas être intégralement rejoué à partir de ces tables |

### Pays principaux : base → API → front

| Pays | Base `countryCode` | API / filtre public | Conclusion |
|---|---:|---:|---|
| Monde | 71 636 actives | 71 636 | Conforme |
| France | **9 639** | **9 636** | Le filtre utilise `isFrance` : trois divergences précises |
| États-Unis | 30 423 | 30 423 | Compteur conforme aux données stockées |
| Royaume-Uni | 2 808 `GB` + 20 `UK` | 2 828 | Regroupement d’alias explicable |
| Allemagne | 2 683 | 2 683 | Conforme |
| Canada | 2 655 | 2 655 | Conforme ; cela ne valide pas chaque géographie |
| Italie | 2 335 | 2 335 | Conforme |
| Espagne | 2 022 | 2 022 | Conforme |
| Pays-Bas | 1 679 | 1 679 | Conforme |
| Suisse | 1 061 | 1 061 | Conforme |
| Japon | 519 | 519 | Conforme |

Les 11 requêtes de comparaison ont répondu 200. Les premières pages respectent les ensembles attendus. Le détail des **122 codes non vides stockés**, avec la ligne des pays inconnus, est dans [pays-production.csv](tableaux/pays-production.csv). Ce nombre ne doit pas être annoncé comme 122 marchés certifiés.

**France : le compteur autour de 9,6 K n’est pas une erreur arithmétique massive.** La France représente environ 13,5 % du stock actuel, les États-Unis 42,47 %. Sans liste de référence du marché et sans correction des attributions, ces parts ne mesurent pas l’exhaustivité nationale.

## A. Ce qui est fiable aujourd’hui

- La base est effectivement servie par le moteur, avec des offres réelles. La recherche partage ses paramètres entre rendu serveur et API ; ses compteurs et facettes reposent sur un ensemble SQL commun. Les erreurs de base ont un état d’erreur explicite, sans faux catalogue de remplacement.
- Les garde-fous de cycle de vie sont présents dans la version déployée : un run incomplet, tronqué, en erreur ou soumis à un challenge ne peut pas attester une disparition. Le refresh exige une attestation positive récente et l’absence de toute source encore active. Les écritures de cycle de vie utilisent des transactions et des verrous par entreprise.
- Aucun Job actif sans JobSource active, aucun Job actif portant encore `closedAt`, aucun Job fermé sans `closedAt` au moment de la mesure.
- Le modèle distingue durée, rythme, programme, relation contractuelle et modalité de travail. Cette séparation est une bonne base internationale.
- Le catalogue Source dispose d’un cycle de validation, d’une unicité de tenant et d’une procédure existante pour découvrir et vérifier des portails. Les limites réseau, budgets de source et annulations sont explicites.
- L’interface est lisible sur ordinateur et à 390 px ; le parcours consulté ne déborde pas horizontalement et les filtres restent accessibles. La direction graphique existante est cohérente : aucune refonte visuelle générale n’est nécessaire pour résoudre les problèmes de données.

**Ces constats valident des mécanismes et des mesures. Ils ne certifient ni chaque annonce ni une capacité mondiale sous charge.**

## B. Ce qui est incomplet

**Fraîcheur.** `lastSeenAt` prouve une observation par un connecteur, pas qu’un candidat peut encore postuler. La collecte est programmée chaque jour à 22 h UTC et le refresh à 2 h UTC. L’historique récent mélange anciennes cadences et passages manuels : médiane des médianes par source ≈ 4 h, intervalle maximal observé ≈ 32,9 h. Ce n’est pas le SLA de la programmation actuelle. Les dates exactes de modification et de fermeture chez les sources ne sont généralement pas enregistrées : **le délai réel source → Catwalks n’est donc pas mesurable exhaustivement aujourd’hui**.

Avec le seuil de 48 h et le refresh quotidien, une disparition confirmable attend potentiellement jusqu’à environ 72 h depuis la dernière observation, plus les délais de collecte. En cas de panne ou de preuve incomplète, cette attente n’a pas de borne certaine. C’est préférable à une fermeture abusive, mais il manque un état public « fraîcheur incertaine ».

**La nouvelle preuve de complétude n’a pas encore traversé toute la production.** Sur les derniers runs des 440 sources actives : 3 portent `complete=true` et `canAttestAbsence=true`, 437 ont ces champs non renseignés. Cela correspond à un stock de runs antérieurs aux nouveaux contrôles ; **437 ne veut pas dire 437 sources cassées**. Il faut observer leur renouvellement réel avant de déclarer le dispositif pleinement opérationnel.

**Traçabilité.** Il existe 32 observations immuables dans `SourceObservation`, 8 037 événements et 114 évaluations de confiance de champs. Les évaluations couvrent 65 sources, uniquement des dimensions contractuelles ; 93 évaluations ont des preuves insuffisantes. Les pays, métiers, séniorités et identités n’ont pas encore une provenance et une confiance persistées par valeur sur tout le stock. 64 709 offres actives n’ont aucun événement ; 69 062 n’ont pas d’événement OPENED. L’historique ne commence que le 2 septembre et ne permet pas de reconstituer le passé antérieur.

**Référentiel d’identité.** `CompanyAlias` est vide ; des alias existent bien dans le code. `Company.careersUrl` est vide et `Company.atsType=UNKNOWN` pour les 1 556 lignes, alors que les informations de collecte vivent ailleurs dans Source. Il n’existe pas de relation explicite source → entités couvertes. Le roster CSV contient 728 entrées mais n’est pas un inventaire de couverture réellement validée.

## C. Ce qui est faux ou incohérent

| Priorité | Constat démontré | Où / impact |
|---|---|---|
| **P0** | Tiffany : Paris et Gold Coast fusionnés avec liens croisés | Jobs `cmtrslaab1615pg5m8dosnymn` et `cmtrsla9p1610pg5mo0wtb1id` ; requisitions Oracle **63763 / 63762**. Une candidature peut partir vers une autre offre. 38 fiches du même type de conflit sont inventoriées. |
| **P0** | Le flux SMCP est attribué à Sandro | **275 offres avec une autre marque explicite** : Maje 148, Claudie Pierlot 69, Fursac 35, SMCP 23. **118 sont FR**. 180 autres n’ont pas de marque structurée exploitable : aucune attribution forcée proposée. |
| **P0** | Des homonymes hors secteur sont considérés comme des marques | **VIA : 155 offres**, portail de mobilité urbaine, avec le domaine erroné `viarail.ca`. **ASHOKA : 6 offres**, organisation d’entrepreneuriat social, avec domaine de marque `ashokaparis.com`. Preuves : [offre Via](https://job-boards.greenhouse.io/via/jobs/8700271002), [offre Ashoka](https://jobs.lever.co/ashoka/45d1d066-b9e7-4452-9733-dbe4faf90ba5). |
| **P1** | Des offres publiées comme actives mènent à des pages indisponibles | Hermès `cmtk2abeb0p10nv2b0nq0e1pj` : HTTP 200 mais « Cette offre n’est plus disponible », confirmé dans le navigateur ; Browns `cmtlymjcm0f8zqf5k34knxkg8` : HTTP 410. [Hermès](https://www.welcometothejungle.com/fr/companies/hermes/jobs/cdd-charge-e-de-recouvrement-des-ijss-h-f_pantin), [Browns](https://careers.brownsshoes.com/jobs/8282005-commis-d-entrepot-quart-de-jour-warehouse-clerk-day-shift). |
| **P1** | « France » saisi dans « Ville, région ou pays » donne **10 offres** | Le front envoie `ville=France`. Le SQL filtre `city`, au lieu d’appliquer `pays=FR`. Parcours réel reproduit sur ordinateur et petit écran. |
| **P1** | Le catalogue Maisons mélange unités et périmètres | `/entreprises?pays=FR&secteur=BEAUTY` affiche **Toutes 48**, nombre d’entreprises filtrées, et **Beauté 17 318**, nombre d’offres mondiales. Les boutons adjacents n’expriment pas la même mesure. |
| **P1** | France : trois divergences entre flag et pays canonique | Deux offres Vestiaire Collective à Tourcoing et une offre Sephora à Bruxelles mais déclarée France dans le RAW LVMH. Les deux premières sont étayées FR ; la troisième est une contradiction, pas une correction automatique. |
| **P1** | Des pays douteux sont exposés comme certains | « Scottsdale, AZ » apparaît sous Azerbaïdjan ; « Richmond, VA » sous Vatican ; des localisations américaines sous GA/KY/TN. Le menu publie aussi NH comme Vanuatu. Aucune règle globale sur le suffixe n’est justifiée : Berlin/DE et Toronto/CA peuvent être parfaitement justes. `countryIntegrity` est vide partout. |
| **P1** | Cinq dates Douglas deviennent 2027/2028 | RAW `8/27/26` → lecture jour/mois → Date.UTC déborde → mars 2028. Ces offres remontent en tête avec « dans 546 jours ». Le garde-fou d’ingestion déjà présent n’a pas nettoyé ces anciennes valeurs. |
| **P1** | Des identités de groupe sont réduites à une branche | Le tenant global Chanel est étiqueté « Parfums Chanel » : 1 117 offres. Le flux L’Oréal global est nommé « L’Oréal Professionnel » : 1 804 offres reliées à la source. La ventilation marque/univers est à rétablir depuis les preuves par offre. |
| **P1** | « Confirmé » peut être une valeur de repli | Les 48 601 MID sont affichés comme un niveau d’expérience alors que le code retourne MID en l’absence d’un signal reconnu. La complétude de séniorité surestime sa qualification. |
| **P2** | Dates et villes perdent leur sens à l’affichage | Des annonces datées d’aujourd’hui affichent « hier » à cause de l’arrondi à 24 h. La fiche Dior liste deux fois Neuilly-sur-Seine, car les groupes sont séparés par coordonnées. Certaines « villes » sont des départements. |

Les 32 copies confirmées ne sont **pas** un taux global validé. Les rapprochements plus larges produisent 3 365 groupes de fingerprint et 4 601 groupes même employeur/titre/ville/pays. Des réquisitions distinctes et des modèles de description communs y figurent : les fusionner automatiquement détruirait des offres. Voir la méthode et les IDs dans l’annexe.

## D. Les Maisons, groupes et sources à compléter

Il faut d’abord séparer les deux surfaces : [catwalks.io/maisons](https://catwalks.io/maisons) affiche **61 Maisons et 14 offres** dans un parcours de recrutement Catwalks ; le moteur [Mode Careers](https://modecareers.com/entreprises) sert **1 054 identités avec offres agrégées**. Les deux nombres correspondent à des périmètres différents. Je n’ai pas constaté de synchronisation permettant de les traiter comme le même inventaire.

J’ai comparé les 61 fiches Catwalks et **94 fiches extraites de la liste actuelle de la FHCM** à la production. 53 noms FHCM restent sans rapprochement lexical, et six demandent une résolution explicite. **Ce sont des identités à résoudre, pas 53 preuves de portails manquants** : certaines peuvent être présentes sous un groupe ou une autre dénomination. [Référence FHCM](https://www.fhcm.paris/fr/maisons).

La recherche produit **38 fiches de qualification**, avec identité proposée, alias, groupe lorsque prouvé, domaine, portail, ATS lorsque identifié, source de preuve, niveau de validation et contrôles restant à passer : [maisons-sources-a-instruire.csv](tableaux/maisons-sources-a-instruire.csv).

| Priorité de couverture | Acteurs / constat | Suite pertinente |
|---|---|---|
| France immédiate | **Jacquemus**, absent sous son identité ; portail Lever EU avec 37 annonces et une candidature spontanée | Qualifier ce tenant et les champs de lieu ; l’adaptateur Lever EU existe déjà. [Portail officiel](https://jobs.eu.lever.co/jacquemus). |
| France immédiate | **Saint James**, 5 offres affichées ; **Armor-lux**, portail officiel identifié | Qualifier WeRecruit, sans inventer un ATS à partir du seul nom. [Saint James](https://rejoindrenotreequipage.saint-james.com/), [Armor-lux](https://careers.werecruit.io/fr/armor-lux). |
| France / monde | **Inditex et ses enseignes** : seulement 10 offres sous Inditex via FashionJobs, aucun tenant dédié | Une source groupe, relations Zara/Pull&Bear/Massimo Dutti/Bershka/Stradivarius/Oysho/Zara Home/Lefties/Tempe. [Inditex People](https://www.inditexpeople.com/fr/fr). |
| Réparer la couverture apparente | **Maje, Claudie Pierlot, Fursac, SMCP** | Réattribuer les offres déjà collectées, avant toute nouvelle collecte. [Portail SMCP](https://www.smcp.com/en/talents/job-offers/?start=0). |
| Beauté / joaillerie France | **Aesop, Groupe NOVI, Messika** | Aesop a deux parcours de recrutement ; NOVI doit être relié à ses enseignes ; Messika nécessite une source de production prouvée. Beauty Success est déjà couvert : 109 offres. [Aesop](https://www.aesop.fr/careers.html), [NOVI](https://groupe-novi.com/nous-rejoindre/), [communication Messika](https://fr.linkedin.com/posts/messika_hiring-messika-activity-7433088582057185280-u-8D). |
| Indépendants / parfumerie | **Bon Parfumeur, Essential Parfums, Ex Nihilo, Maison Crivelli, Lise Charmel** | Identités à compléter ; portails encore non établis pour plusieurs. Lise Charmel présente un contact de candidature, pas une liste de postes. Ne pas créer d’offres fictives. |
| Complément international | **Dries Van Noten, Akris, Paul Smith, Thom Browne, Grand Seiko, Harrods, El Corte Inglés, Takashimaya, Isetan Mitsukoshi** | Dossiers séparés ; Dries publie notamment une annonce Paris. Les autres portails et limites sont consignés dans le CSV. [Dries Van Noten](https://www.driesvannoten.com/en-eu/pages/career-open-positions), [Harrods](https://www.harrodscareers.com/jobs/), [Takashimaya](https://www.takashimaya.co.jp/corp/recruit/). |

**Déjà couverts, à ne pas recréer comme « manquants » :** Galeries Lafayette 165 offres dont 161 FR ; Printemps 120 dont 74 FR ; Le Bon Marché 48 FR via LVMH ; Polène 79 dont 46 FR ; Fusalp 21 sous deux identités. Une source dédiée absente n’équivaut pas à une Maison absente.

L’inventaire sectoriel mondial n’a pas de dénominateur exhaustif validé : aucun pourcentage de « couverture mondiale » ne serait honnête aujourd’hui. La prochaine expansion doit être pilotée par le référentiel de Maisons attendues, pays et portails, pas par un objectif arbitraire de nombre de connecteurs.

## E. Corrections prioritaires et critères de sortie

### P0 — protéger la vérité de l’offre avant d’élargir

1. **Sécuriser l’identité d’une annonce à travers les sources.** Introduire la clé employeur/tenant ATS/réquisition ; des IDs différents du même tenant doivent rester distincts en l’absence de preuve explicite d’équivalence. Réexaminer les 38 conflits Oracle et préserver une trace réversible des séparations. Sortie : aucun titre, pays ou lien croisé dans la cohorte, et lien de candidature vérifié.
2. **Réparer l’identité employeur et l’affectation des marques.** Traiter les 275 preuves SMCP, VIA et ASHOKA ; revoir les tenants Chanel/L’Oréal et leurs labels. Sortie : chaque attribution possède une preuve et une entité cible explicites ; les cas ambigus restent non tranchés.
3. **Figer les preuves avant remédiation.** Conserver les IDs, RAW disponibles, liens, versions et états observés ; aucune purge/recréation générale comme réparation. Sortie : delta prévu et possibilité de retour arrière pour chaque correction.

### P1 — rendre le catalogue et le front explicables

4. Une seule politique de pays dans résultats, compteurs, profils et intelligence. Corriger les trois divergences sur preuve ; traiter les géographies douteuses dans un inventaire distinct, sans table de villes arbitraire. Offrir un état « non renseigné / à vérifier ».
5. Corriger le parcours Lieu pour distinguer pays, région et ville ; aligner unités et périmètres des compteurs Maisons. Protéger les réponses de pagination contre un changement de filtres en cours.
6. Déployer réellement l’attestation sur les prochains runs normaux des 440 sources ; mesurer la fraction d’offres fraîchement revues et les absences confirmables. Distinguer **OPEN / CLOSED / UNKNOWN** et apparition/disparition de chaque source. Un 403/timeout ne ferme rien ; un 200 ne prouve pas l’ouverture ; un 404/410 sur une annonce doit être distingué d’une panne du portail.
7. Ajouter la provenance **par champ** et retirer les valeurs par défaut présentées comme certaines. Vérifier les cinq dates futures et le parsing de locale ; distinguer « vu aujourd’hui » et « publié aujourd’hui ». Renommer le taux de réouverture actuellement appelé « repost ».
8. Prioriser les défauts de collecte prouvés : Lagardère 20/109, Foot Locker 2 835/2 846, B2 à zéro, Jako sans descriptions, URBN descriptions incomplètes. Puis qualifier les premières sources France du tableau D.

### P2 — étendre sans perdre les garanties

9. Référentiel relationnel Maisons/groupes/enseignes et alias versionnés ; relations plusieurs-à-plusieurs avec les sources ; distinguer employeur légal, marque et groupe.
10. Étendre la géographie multi-sites, subdivisions et modalités de travail ; documenter les règles linguistiques ; traiter le réemploi des mêmes URLs et les republications comme des événements distincts.
11. Garder **PostgreSQL comme vérité canonique**, une couche de lecture commune et des traitements incrémentaux idempotents. Introduire files de travail, caches ou réplicas selon les mesures opérationnelles, après correction de la vérité métier. Aucune refonte en microservices ou moteur de recherche supplémentaire n’est justifiée par ce seul audit.
12. Compléter progressivement les références France puis internationales ; suivre les écarts au référentiel, les sources sans résultat expliqué, les champs contradictoires et le nombre d’offres réellement affectées.

**Critère de qualification :** P0 clos sur preuves ; contre-vérification des parcours front et des cohortes P1 ; cycle normal d’ingestion/fermeture observé ; inconnus clairement représentés ; chaque correction rejouable. Un volume élevé, un HTTP 200 et des tests verts ne suffisent pas à eux seuls.

## Pièces de travail

- [Annexe technique : règles, preuves, limites et procédure d’ajout](ANNEXE-TECHNIQUE.md)
- [Sources et offres à revoir, triées par nombre d’offres distinctes concernées](tableaux/sources-et-risques.csv)
- [38 fiches Maisons / groupes / sources à instruire](tableaux/maisons-sources-a-instruire.csv)
- [Attributions SMCP erronées — 275 IDs](tableaux/marques-smcp-mal-rattachees.csv)
- [Fusions Oracle — 38 IDs](tableaux/fusions-identifiants-oracle.csv)
- [Doublons de pages : 33 groupes examinés et verdicts](tableaux/doublons-urls-revue.csv)
- [Comparaison des 61 fiches Catwalks](tableaux/catwalks-couverture.csv) ; [référence FHCM](tableaux/fhcm-couverture.csv)

Les CSV de risque sont des inventaires de diagnostic, **pas des fichiers à importer directement en production**. Les cohortes se recoupent ; leurs effectifs ne doivent pas être additionnés pour fabriquer un taux global d’erreur.
