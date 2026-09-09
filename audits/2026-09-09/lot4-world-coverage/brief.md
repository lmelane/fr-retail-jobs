# LOT 4 — Discovery mondiale, validation des 1 653 acteurs FashionJobs, qualification des sources et ingestion complète

Ce lot est un **chantier majeur et structurant**.

Il fusionne :

* la discovery proactive de toutes les Maisons, marques, enseignes et groupes appartenant à notre périmètre ;
* l’audit exhaustif des **1 653 libellés actuellement identifiés via FashionJobs** ;
* la recherche systématique des portails carrière officiels ;
* l’identification des ATS, API et endpoints ;
* la validation des connectors / adapters existants ;
* l’investigation et le traitement des sources encore non supportées ;
* puis une **passe complète d’ingestion et de contrôle qualité**.

L’objectif n’est surtout pas de prendre les 1 653 acteurs FashionJobs et de considérer que notre marché s’arrête là.

FashionJobs constitue un **excellent référentiel de comparaison et de contrôle**, mais notre mission est plus large :

> **Découvrir proactivement tous les acteurs pertinents de notre marché mondial, vérifier que nous connaissons leur source officielle d’emploi, être capables de récupérer leurs offres et démontrer ensuite que les données réellement ingérées sont fiables et complètes.**

Ce lot doit être traité avec un **effort maximal de recherche et de validation**.

---

# 4.1 — Périmètre marché à couvrir

Notre périmètre cible comprend notamment :

**Mode · Maroquinerie · Chaussures · Joaillerie · Horlogerie · Beauté · Parfumerie · Lunetterie · Maison & Lifestyle · Vins & Spiritueux · Hospitality · Automobile & Mobilité de luxe · Art & Design · Retail · Luxury Tech & Services**

Cette liste représente les grandes verticales de référence.

Elle ne doit surtout pas être utilisée comme une whitelist rigide.

Nous devons rechercher :

* groupes ;
* Maisons ;
* marques ;
* enseignes ;
* retailers ;
* fabricants ;
* acteurs spécialisés ;
* marketplaces ;
* acteurs technologiques spécialisés ;
* entreprises premium pertinentes ;

dès lors qu’ils appartiennent réellement à notre univers cible.

---

# 4.2 — Exemples permettant de cadrer précisément le périmètre

Les exemples ci-dessous servent à comprendre **l’amplitude du marché recherché**.

Ils ne sont absolument pas exhaustifs.

## Mode

Exemples :

* Louis Vuitton
* Dior
* Chanel
* Hermès
* Gucci
* Saint Laurent
* Balenciaga
* Givenchy
* Celine
* Loewe
* Fendi
* Prada
* Miu Miu
* Valentino
* Versace
* Giorgio Armani
* Dolce & Gabbana
* Moncler
* Burberry
* Ralph Lauren
* Jacquemus
* Isabel Marant
* Acne Studios
* Max Mara
* Maison Margiela
* Alexander McQueen
* Brunello Cucinelli
* Zegna

---

## Maroquinerie

Exemples :

* Hermès
* Louis Vuitton
* Goyard
* Longchamp
* Moynat
* Delvaux
* Bottega Veneta
* Loewe
* Fendi
* Gucci
* Prada
* Celine
* Saint Laurent
* Mulberry
* Coach
* Furla
* Lancel
* Le Tanneur

Une même Maison peut évidemment appartenir simultanément à plusieurs verticales.

---

## Chaussures

Exemples :

* Christian Louboutin
* Jimmy Choo
* Manolo Blahnik
* Tod's
* Roger Vivier
* Berluti
* Church's
* Santoni
* Giuseppe Zanotti
* Golden Goose
* Sergio Rossi
* Ferragamo

Mais également les activités chaussures de Maisons plus généralistes telles que Dior, Chanel, Hermès, Louis Vuitton, Prada ou Gucci.

---

## Joaillerie

Exemples :

* Cartier
* Van Cleef & Arpels
* Bulgari
* Tiffany & Co.
* Chaumet
* Boucheron
* Messika
* Piaget
* Chopard
* Graff
* Buccellati
* Pomellato
* Fred
* Repossi
* David Yurman

---

## Horlogerie

Cette verticale doit impérativement être couverte.

Exemples :

* Rolex
* Patek Philippe
* Audemars Piguet
* Richard Mille
* Omega
* TAG Heuer
* Hublot
* Zenith
* Vacheron Constantin
* Jaeger-LeCoultre
* IWC Schaffhausen
* Panerai
* A. Lange & Söhne
* Cartier
* Piaget
* Breguet
* Blancpain
* Longines
* Tissot
* Swatch
* Breitling
* Tudor
* Chopard
* Hermès Horloger
* Chanel Horlogerie
* Bulgari Horlogerie

Il faut également penser aux groupes horlogers et à leurs différentes Maisons.

---

## Beauté & Cosmétiques

Exemples :

* L'Oréal Luxe
* Lancôme
* Yves Saint Laurent Beauté
* Giorgio Armani Beauty
* Kiehl's
* Helena Rubinstein
* La Mer
* MAC Cosmetics
* Bobbi Brown
* Clinique
* Estée Lauder
* Shiseido
* Clé de Peau Beauté
* NARS
* Sisley
* Clarins
* Guerlain
* Dior Beauty
* Chanel Beauty
* Givenchy Beauty
* Charlotte Tilbury
* By Terry
* Augustinus Bader
* La Prairie

---

## Parfumerie

Exemples :

* Guerlain
* Dior Parfums
* Chanel Parfums
* Hermès Parfums
* Maison Francis Kurkdjian
* Byredo
* Diptyque
* Frédéric Malle
* Jo Malone London
* Le Labo
* Kilian Paris
* Creed
* Acqua di Parma
* Penhaligon's
* Serge Lutens
* Parfums de Marly
* Maison Margiela Fragrances
* Tom Ford Beauty

La parfumerie de niche doit également être couverte.

---

## Lunetterie

Exemples :

* Ray-Ban
* Persol
* Oliver Peoples
* Oakley
* Alain Mikli
* Cutler and Gross
* Mykita
* Lindberg
* Moscot
* Gentle Monster
* Kering Eyewear
* Thélios

Ainsi que les activités eyewear de grandes Maisons comme :

* Dior
* Celine
* Fendi
* Givenchy
* Loewe
* Bulgari
* Louis Vuitton
* Gucci
* Saint Laurent
* Cartier

---

## Maison & Lifestyle

Exemples :

* Hermès Maison
* Dior Maison
* Louis Vuitton Objets Nomades
* Fendi Casa
* Armani/Casa
* Versace Home
* Ralph Lauren Home
* Baccarat
* Lalique
* Christofle
* Bernardaud
* Villeroy & Boch
* Roche Bobois
* Ligne Roset
* Poltrona Frau
* Cassina
* B&B Italia
* Kartell
* Flos

Cette verticale peut notamment couvrir :

* mobilier ;
* décoration ;
* art de la table ;
* linge de maison ;
* design intérieur ;
* objets lifestyle.

---

## Vins & Spiritueux

Exemples :

* Moët & Chandon
* Dom Pérignon
* Veuve Clicquot
* Krug
* Ruinart
* Hennessy
* Château d'Yquem
* Château Cheval Blanc
* Château Galoupet
* Armand de Brignac
* Rémy Martin
* Louis XIII
* Martell
* Perrier-Jouët
* Mumm
* Glenmorangie
* Belvedere
* Clase Azul

Il faut également raisonner par portefeuille de Maisons lorsque celles-ci appartiennent à de grands groupes.

---

## Hospitality / Hôtellerie de luxe

Exemples :

* Cheval Blanc
* Belmond
* Four Seasons
* Mandarin Oriental
* Rosewood
* Aman
* Ritz Paris
* Hôtel de Crillon
* The Peninsula
* Shangri-La
* Dorchester Collection
* Oetker Collection
* Raffles
* One&Only
* Six Senses
* Bulgari Hotels & Resorts
* Armani Hotels
* Airelles

Cette verticale peut également comprendre :

* palaces ;
* resorts ;
* restauration de luxe liée à l'hospitality ;
* conciergerie ;
* expériences premium.

---

## Automobile & Mobilité de luxe

Exemples :

* Ferrari
* Lamborghini
* Bentley
* Rolls-Royce
* Aston Martin
* Porsche
* Maserati
* McLaren
* Bugatti
* Lotus
* Range Rover
* Mercedes-Maybach

Selon le périmètre pertinent, inclure également le yachting, l'aviation privée et la mobilité premium.

Exemples :

* Riva
* Ferretti Group
* Azimut
* Gulfstream
* Bombardier Business Aircraft
* Dassault Falcon

---

## Art & Design

Exemples :

* Sotheby's
* Christie's
* Phillips
* Gagosian
* Perrotin
* David Zwirner
* Hauser & Wirth

Ainsi que les acteurs pertinents de :

* design ;
* mobilier premium ;
* architecture intérieure ;
* scénographie ;
* galeries ;
* maisons de ventes ;
* fondations ;
* métiers artistiques liés au luxe.

---

## Retail

Exemples :

* Galeries Lafayette
* Printemps
* Le Bon Marché
* La Samaritaine
* Harrods
* Selfridges
* Liberty London
* Saks Fifth Avenue
* Neiman Marcus
* Bergdorf Goodman
* Bloomingdale's
* Nordstrom
* Sephora
* Douglas
* DFS
* Avolta

Également :

* concept stores ;
* department stores ;
* travel retail ;
* duty free ;
* retailers multimarques spécialisés.

Attention à ne pas confondre **Retail comme secteur d'entreprise** avec **Retail comme famille métier**.

---

## Luxury Tech & Services

Exemples :

* Farfetch
* Mytheresa
* Net-a-Porter
* Mr Porter
* Vestiaire Collective
* The RealReal
* StockX
* Launchmetrics
* Lectra
* Centric Software
* Contentsquare
* Mirakl

Ainsi que les acteurs pertinents de :

* Fashion Tech ;
* Beauty Tech ;
* Retail Tech ;
* marketplaces spécialisées ;
* seconde main premium ;
* solutions SaaS sectorielles ;
* services B2B structurants du secteur.

---

# 4.3 — Ne pas oublier les grands groupes

La discovery doit également être réalisée au niveau des grands groupes afin de découvrir leurs différentes Maisons.

Exemples structurants :

* LVMH
* Kering
* Richemont
* Prada Group
* OTB
* Moncler Group
* Chanel
* Hermès
* L'Oréal
* Estée Lauder Companies
* Puig
* Shiseido
* Coty
* Swatch Group
* Rolex
* Audemars Piguet
* Capri Holdings
* Tapestry
* EssilorLuxottica
* Ermenegildo Zegna Group

Pour chaque groupe, vérifier notamment :

* les Maisons réellement détenues ou exploitées ;
* celles qui entrent dans notre périmètre ;
* celles déjà présentes chez nous ;
* celles absentes ;
* leurs différents portails de recrutement ;
* les éventuelles plateformes communes au groupe ;
* les éventuels portails spécifiques par Maison ou zone géographique.

Le but est d'éviter par exemple :

> Groupe connu mais plusieurs Maisons oubliées.

ou :

> Portail du groupe identifié mais certaines marques ne sont jamais récupérées.

---

# 4.4 — Discovery proactive : ne pas se limiter à notre BDD ou à FashionJobs

Nous devons **chercher les entreprises que nous ne connaissons pas encore**.

Les 1 653 libellés FashionJobs constituent une source de contrôle très importante, mais pas une limite.

La discovery doit pouvoir s'appuyer sur toutes les sources fiables pertinentes permettant d'identifier des acteurs du marché :

* FashionJobs ;
* sites officiels des groupes ;
* portfolios de marques ;
* moteurs de recherche ;
* résultats Jobs ;
* associations professionnelles ;
* fédérations ;
* salons ;
* annuaires sectoriels ;
* retailers ;
* marketplaces ;
* presse spécialisée ;
* listes publiques pertinentes ;
* toute autre source permettant de découvrir des acteurs appartenant réellement au périmètre.

À la fin, nous devons être capables de répondre :

> **Quelles entreprises pertinentes existent dans notre marché et lesquelles ne sont pas encore couvertes ?**

---

# 4.5 — Audit exhaustif des 1 653 libellés FashionJobs

En parallèle de cette discovery proactive, les **1 653 libellés FashionJobs doivent être traités exhaustivement**.

Pour chacun :

1. déterminer ce que représente réellement le libellé ;
2. identifier l'entreprise correspondante ;
3. vérifier s'il s'agit d'une Maison, marque, enseigne, groupe ou autre acteur ;
4. déterminer s'il appartient à notre périmètre ;
5. le rapprocher de l'entité canonique correspondante ;
6. vérifier qu'il ne s'agit pas d'un doublon ou d'un alias déjà présent ;
7. retrouver son site officiel ;
8. rechercher son portail carrière ;
9. déterminer le groupe parent éventuel ;
10. déterminer ses secteurs ;
11. qualifier sa source d'offres ;
12. contrôler ensuite sa présence réelle dans notre agrégateur.

FashionJobs doit ici servir de **contre-audit de couverture**.

Nous devons pouvoir savoir :

* acteurs FashionJobs déjà couverts ;
* acteurs FashionJobs pertinents mais absents ;
* acteurs non pertinents ;
* doublons ;
* aliases ;
* erreurs de libellés ;
* acteurs pour lesquels la source officielle reste à trouver.

---

# 4.6 — Recherche systématique du portail carrière officiel

Pour **chaque acteur pertinent**, fournir un effort maximal afin de retrouver sa véritable source d'offres.

Une recherche superficielle ne suffit pas.

Il faut notamment rechercher :

* page Careers ;
* page Jobs ;
* Join Us ;
* Work With Us ;
* Talents ;
* portail carrière dédié ;
* sous-domaine carrière ;
* domaine carrière distinct ;
* portail du groupe ;
* portail régional ;
* portail spécifique à une marque ;
* plateforme externe liée depuis le site officiel ;
* résultats indexés permettant de retrouver une source officielle ;
* éventuelles variations de portail selon les pays.

Le fait que la page d'accueil ne contienne pas immédiatement un bouton `Careers` ne constitue pas une preuve d'absence.

Une source ne doit être déclarée introuvable qu'après un **effort réel et documenté de recherche**.

---

# 4.7 — Identifier systématiquement l'ATS, l'API et les endpoints

Une fois le portail carrière retrouvé, l'analyse doit aller jusqu'à la source technique réelle des offres.

Pour chaque source, nous devons déterminer autant que possible :

* ATS ou moteur utilisé ;
* API utilisée ;
* endpoint(s) ;
* paramètres nécessaires ;
* pagination ;
* géographies ;
* langues ;
* marques ;
* business units ;
* filtres ;
* mécanisme permettant d'obtenir l'intégralité des offres.

Nous devons arriver à un niveau de qualification permettant de répondre :

> **Savons-nous concrètement récupérer les offres de cette source de manière fiable ?**

La simple découverte d'une URL Careers ne suffit pas.

---

# 4.8 — Vérifier les connectors / adapters déjà présents

Lorsqu'un ATS ou moteur est identifié, vérifier si notre système sait déjà le prendre en charge.

Il faut **tester réellement**, et non considérer qu'un ATS est couvert simplement parce qu'un connector portant son nom existe dans le code.

Pour chaque source, vérifier notamment :

* récupération effective ;
* pagination ;
* volume ;
* détails des offres ;
* localisation ;
* contrat ;
* titre ;
* description ;
* identifiant ;
* URL ;
* statut actif ;
* éventuelle marque ou business unit ;
* toutes les informations nécessaires à notre pipeline.

Si l'intégration existante est partielle, il faut l'identifier et la corriger.

---

# 4.9 — Sources non encore prises en charge

Si le système ne sait pas encore récupérer correctement une source, cela doit déclencher une véritable investigation.

Ne pas simplement classer la source :

`UNKNOWN`

`UNSUPPORTED`

`BLOCKED`

puis passer à la suivante.

Il faut :

* comprendre pourquoi ;
* investiguer le fonctionnement du portail ;
* trouver l'accès pertinent lorsqu'il existe ;
* tester ;
* corriger ou compléter ce qui doit l'être ;
* valider ensuite sur la source réelle.

Les décisions d'architecture et d'implémentation appartiennent au développeur.

Ce brief fixe **le résultat attendu**, pas la manière dont il doit organiser son code.

---

# 4.10 — Tester la complétude réelle de chaque source

Une source qui renvoie quelques offres n'est pas nécessairement une source correctement couverte.

Pour chaque entreprise, nous devons comparer autant que possible :

**ce qui existe réellement sur la source officielle**

avec :

**ce que nous récupérons réellement dans notre agrégateur.**

Il faut rechercher notamment les pertes dues à :

* pagination ;
* limites de résultats ;
* pays ;
* langues ;
* catégories ;
* marques ;
* filtres implicites ;
* sous-portails ;
* endpoints incomplets ;
* parsing ;
* normalisation ;
* déduplication ;
* enregistrement ;
* publication front-end.

Chaque différence significative doit être expliquée.

---

# 4.11 — Passe complète d'ingestion obligatoire

Une fois la discovery, la qualification et les corrections nécessaires réalisées, effectuer **une passe complète d'ingestion sur l'ensemble des sources validées**.

C'est une étape essentielle.

Il ne suffit pas de tester quelques offres ou quelques entreprises.

Nous devons vérifier le comportement réel du système sur l'ensemble du périmètre nouvellement qualifié.

Nous devons pouvoir mesurer au minimum :

* offres découvertes ;
* offres récupérées ;
* offres parsées ;
* offres rejetées ;
* offres normalisées ;
* offres enregistrées ;
* offres actives ;
* offres réellement visibles sur le front-end.

Le volume final ne doit pas être considéré comme un succès en lui-même.

**100 000 mauvaises offres ne valent pas mieux que 50 000 offres propres.**

Le but est à la fois :

**couverture + complétude + qualité.**

---

# 4.12 — Audit qualité après ingestion

Après la passe complète, auditer sérieusement les données produites.

Vérifier notamment :

* Maison ;
* marque ;
* groupe ;
* secteur ;
* titre ;
* métier ;
* ville ;
* pays ;
* localisation ;
* contrat ;
* séniorité ;
* description ;
* URL ;
* source ;
* dates ;
* statut actif ;
* déduplication.

Il faut notamment rechercher :

* doublons ;
* offres fantômes ;
* offres expirées ;
* mauvaises localisations ;
* mauvais pays ;
* mauvais rattachement à une Maison ;
* titres pollués ;
* descriptions cassées ;
* valeurs parasites ;
* offres dupliquées entre plusieurs portails ;
* trous manifestes de couverture.

Le contrôle qualité doit être effectué **sur la donnée réellement ingérée**, pas uniquement sur le code ou sur des tests unitaires.

---

# 4.13 — Ne pas répéter les problèmes d'identité déjà identifiés

Ce lot doit impérativement utiliser le travail réalisé précédemment sur la canonisation des entreprises.

Nous avons déjà observé des anomalies telles que :

```text
Promod 53
Jules 73
Baccarat 19
La Redoute 5
```

ainsi que :

```text
PROMOD
PROMOD MAGASIN
```

La discovery massive ne doit surtout pas multiplier ce problème.

Une source nouvellement découverte doit être rapprochée de l'acteur réel avant de créer arbitrairement une nouvelle entité.

Nous devons conserver les alias utiles à la traçabilité mais éviter de fragmenter artificiellement les offres d'une même enseigne entre plusieurs entreprises.

---

# 4.14 — Tableau de suivi obligatoire

Ce gros lot doit produire un référentiel de suivi suffisamment précis pour savoir où nous en sommes.

Pour chaque acteur pertinent, nous devons pouvoir retrouver au minimum :

```text
Acteur / libellé source
Entreprise canonique
Type : Groupe / Maison / Marque / Enseigne / Retailer / autre
Groupe parent éventuel
Secteur(s)
Pays / périmètre éventuel
Site officiel
Portail carrière
ATS / moteur identifié
API / endpoint identifié
Source exploitable
Connector / adapter disponible
Test effectué
Nombre d'offres source
Nombre d'offres récupérées
Nombre d'offres actives chez nous
Écart de couverture
Qualité validée
Statut
Cause du blocage éventuel
Preuve
Dernière vérification
Action restante
```

Les intitulés exacts peuvent évidemment être adaptés aux structures existantes du projet.

L'important est de disposer des informations nécessaires pour **piloter et prouver la couverture**.

---

# 4.15 — Métriques globales attendues

À la fin du lot, produire une synthèse permettant de savoir :

* combien d'acteurs ont été analysés ;
* combien proviennent des 1 653 libellés FashionJobs ;
* combien d'acteurs supplémentaires ont été découverts proactivement ;
* combien sont réellement pertinents ;
* combien de doublons / alias ont été détectés ;
* combien disposent d'un portail carrière officiel ;
* combien de portails restent réellement introuvables ;
* combien d'ATS différents ont été identifiés ;
* combien de sources sont correctement récupérées ;
* combien restent partielles ;
* combien restent non résolues ;
* combien d'offres officielles sont accessibles ;
* combien sont réellement récupérées ;
* combien sont réellement présentes et actives chez nous ;
* quel est le taux de couverture global ;
* quels sont les principaux écarts restants.

---

# 4.16 — Gestion stricte des cas non résolus

Je préfère un cas explicitement non résolu et documenté à une fausse certitude.

Si une source reste impossible à qualifier, il faut expliquer précisément :

* ce qui a été recherché ;
* ce qui a été trouvé ;
* ce qui manque ;
* pourquoi nous ne pouvons pas encore conclure ;
* quelles preuves soutiennent cette conclusion.

Un statut du type :

`UNKNOWN`

ne suffit pas seul.

Il faut impérativement :

**statut + cause + preuve + recherches effectuées + prochaine action éventuelle.**

---

# 4.17 — Critères de sortie du LOT 4

Le lot ne peut être considéré comme terminé simplement parce qu'un grand nombre d'entreprises ont été ajoutées.

Nous devons pouvoir démontrer que :

1. les **1 653 libellés FashionJobs** ont été traités ;
2. nous avons également effectué une **discovery proactive au-delà de FashionJobs** ;
3. les acteurs pertinents ont été identifiés et rapprochés correctement de leurs entités réelles ;
4. les grands groupes et leurs portefeuilles de Maisons ont été examinés ;
5. un effort maximal a été fourni pour trouver les portails carrière officiels ;
6. les ATS / moteurs ont été identifiés lorsque cela est techniquement possible ;
7. les API / endpoints utiles ont été recherchés et identifiés lorsque disponibles ;
8. les integrations déjà existantes ont été réellement testées ;
9. les intégrations absentes ou partielles ont été investiguées et traitées ;
10. les sources ont été testées sur leurs volumes réels ;
11. une **passe complète d'ingestion** a été réalisée ;
12. les données ingérées ont fait l'objet d'un contrôle qualité réel ;
13. les doublons et anomalies importantes ont été investigués ;
14. les écarts entre sources officielles et notre base sont mesurés ;
15. les écarts restants disposent d'une explication ;
16. nous disposons d'une vision chiffrée de la **couverture réelle de notre marché**.

---

# Résultat attendu du LOT 4

À la sortie de ce lot, je ne veux pas simplement entendre :

> « Nous avons ajouté beaucoup de Maisons et beaucoup d'offres. »

Je veux pouvoir dire :

> **« Nous avons réalisé une discovery proactive du marché cible mondial, traité exhaustivement les 1 653 acteurs FashionJobs comme référentiel de contrôle, découvert des acteurs supplémentaires, recherché systématiquement leurs portails carrière officiels, identifié les sources techniques permettant de récupérer leurs offres, testé les intégrations nécessaires, effectué une ingestion complète et contrôlé la fiabilité réelle des données obtenues. Nous savons également précisément ce qui reste non couvert et pourquoi. »**

Ce lot doit donc être traité comme un **chantier majeur de couverture marché et de fiabilité data**, avec des preuves et des métriques, et non comme une simple opération d'ajout de sources.
