# D-517 — toutes les sources significatives découvertes en quelques heures

Production en lecture seule (`db.py readonly`), le 02/10/2026 entre 12:17 et 12:29 UTC, hors fenêtre du RUN. Tout se
rejoue depuis ce dossier, depuis la racine du checkout de référence. **Rien n'est activé en production** : la passe
reste inerte tant que le cron du worker n'est pas changé, geste de release sous GO. Les délais ci-dessous sont des
**projections** d'un modèle (`projection.py`), pas des mesures.

| Fichier | Contenu |
|---|---|
| `mesure.sql` → `.out` | F0 dernier RUN ; F1 nouvelles publications par source sur 7 jours ; F2 requêtes du dernier RUN par forme d'adresse (liste ou fiche) ; F3 rang des publications nouvelles dans la sortie des 3 derniers RUN ; F4 flux de chaque source à l'instant de la mesure (la colonne « retenue » est l'ancien seuil d'une par jour) |
| `projection-donnees.sql` → `offres.csv`, `collectes.csv` | les 11 301 nouvelles offres du 25/09 au 02/10 (sources présentes avant le 24/09) et les collectes achevées : même population que `cadence-r143/` (CSV non versionnés, `.gitignore`) |
| `projection.py` → `projection.out` | sélection, coût d'une passe incrémentale, découverte projetée (modèle et hypothèses en tête du fichier, graine fixe) |
| `mutations.sh` → `.out` | chaque garde retirée par un sed aller-retour : ses témoins passent au rouge, l'arbre revient à l'identique |

## 1. La sélection : toute source qui a du neuf

**Règle** (`significantSources`, `src/pipeline/lightPass.ts`) : une source ACTIVE entre dans la passe dès qu'elle a
fait paraître **au moins une publication nouvelle sur les 7 derniers jours** (`JobSource.firstSeenAt`), lue en base à
chaque passe. Le premier chargement d'une source est un stock, pas un flux : pour une source enregistrée dans la
fenêtre, le flux se compte depuis le lendemain de sa première publication, avec au moins un jour de flux. Le
02/10/2026 : **285 sources, 100 % des nouvelles publications** (lecture R-143 §1 : 40 sources choisies par coût,
20,5 %).

| Seuil mesuré | Sources | Part des nouvelles publications | Requêtes par passe |
|---|---|---|---|
| 2 / jour | 103 | 93,2 % | 5 141 |
| 1 / jour | 147 | 96,6 % | 6 470 |
| 0,5 / jour | 200 | 98,7 % | 7 422 |
| **≥ 1 sur 7 jours (retenu)** | **285** | **100 %** | **8 160** |

Pourquoi aucun seuil de volume : en lecture incrémentale, une source calme ne coûte que sa liste (en moyenne
6 requêtes pour les 138 sources sous une par jour). Le seuil d'une par jour économisait 1 690 requêtes par passe et
écartait Audemars Piguet (0,9 / jour), Mulberry, L'Occitane (0,9), Zegna (0,8), Sisley (0,7), Breitling, Brunello
Cucinelli, Dolce & Gabbana (0,6), Patek Philippe, Stella McCartney (0,3) : le luxe calme, découvert le lendemain, est
exactement ce que D-517 refuse. Une source muette depuis 7 jours sort d'elle-même (le RUN la lit toujours), une Maison
qui se remet à publier y rentre à la passe suivante. Seule exception : les sources à amorçage anti-robot
(`WAF_BOOTSTRAP_SOURCES`, Ralph Lauren aujourd'hui, en pause) restent au RUN tant que D-483 et l'enquête de D-516 §1
jugent leurs collectes ; une passe y ajouterait cinq amorçages par jour.

## 2. Le moyen, par famille d'adaptateur : la lecture incrémentale

**La liste entière, puis le détail des seules publications jamais vues, et l'écriture de ces seules publications**
(`src/lib/incrementalReading.ts`). « Première page triée par date, puis arrêt à la première offre connue » a été
examiné et **écarté par la mesure** : aucun des adaptateurs concernés n'envoie de tri par date (Jibe trie par
pertinence, SuccessFactors RMK et Phenom sont documentés instables), et dans les collectes des 3 derniers RUN (F3), une
publication nouvelle se trouve au-delà de 90 % de la sortie pour Tapestry (rang p90 0,97), adidas (0,97), Sephora
France (0,99), Skechers (0,97), PVH (0,95), Rituals (0,96), WTTJ (0,86) : un arrêt anticipé en perdrait. La liste coûte
une requête pour 10 à 100 offres ; c'est la fiche, une par offre, qui coûte.

| Famille | Sources | Ce que lit la passe | Requêtes par passe (lecture complète → incrémentale) |
|---|---|---|---|
| Workday | 38 | liste paginée (20) entière, fiche du seul neuf | 42 514 → 1 595 |
| SuccessFactors | 25 | liste (RMK, balayages jusqu'au total) entière, page du seul neuf | 14 449 → 492 |
| SmartRecruiters | 17 | liste (100) entière, annonce du seul neuf | 10 019 → 655 |
| Phenom | 4 | liste entière, fiche du seul neuf (CareerConnect) | 7 618 → 69 |
| generic-listing | 12 | pages de liste, page du seul lien neuf | 6 354 → 475 |
| Eightfold (Estée Lauder, Kering) | 2 | recherche (10) entière, fiche du seul neuf | 5 499 → 322 |
| WTTJ, DigitalRecruiters, JobAffinity, iCIMS, Oracle, Swatch | 17 | liste entière, détail du seul neuf | 17 327 → 798 |
| Teamtailor, Greenhouse, Recruitee, Lever, Workable, Jibe, LVMH, Rituals… | 143 | la liste porte tout : relue, seul le neuf est écrit | inchangé (936) |
| Personio, Eqwa, Talent Funnel, Talentview, Talentsoft, Taleo, Altamira… | 27 | lecteur non adapté : relu en entier, seul le neuf est écrit | inchangé (2 815) |

Une passe : **8 160 requêtes** au lieu de 107 531 pour lire les mêmes sources en entier, projetée à une douzaine de
minutes à quatre sources en parallèle, hors ouverture et validation des collectes ; budget de 90 minutes.

**Ce qu'une lecture incrémentale n'est jamais** (chaque garde a son témoin, `mutations.out`) :
- une preuve d'absence : son résultat est scellé `incremental` (avec l'ensemble trié des connues laissées de côté),
  `complete: false`, `truncated: true` ; la capture attestante le refuse (`attestingCapture.ts`), la revue de
  disponibilité ne la juge jamais crédible, aucune garde du RUN ne la prend pour référence (`referenceRuns.ts`) ;
- une écriture de l'existant : une publication connue (déjà dans `JobSource`, ou rendue par une collecte des 48 h)
  n'est ni relue, ni réécrite ; son `lastSeenAt` ne bouge pas, rien n'est fermé, retenu ni masqué ;
- une rupture de la chaîne de qualification : la capture est validée par son rejeu exact, sous l'ensemble scellé
  (`capture/batch.ts`) ; « rien de neuf à publier » (la liste n'a montré que des connues, plus d'éventuelles nouvelles
  retenues) est validé comme tel (`incrementalNothingNew`), une liste vide reste un flux vide non prouvé, et la
  tolérance des lignes illisibles se calcule sur toute la liste lue, comme au RUN (`incrementalKnown`) ;
- un état de source : sa ligne `SourceRun` ne se compare à rien, n'atteste rien et ne touche pas `Source.lastRun*`
  (ordre et budget du RUN, back-office), en réussite comme en échec ; le rapport de santé lit la ligne du RUN, et
  l'alerte de couverture (R-143 §11) garde pour référence la qualification du RUN, jamais celle d'une passe.
- une connaissance acquise à tort : une sortie de passe non publiée (fiche en échec, retenue) n'est pas « connue », la
  passe suivante relit sa fiche ; les publications connues laissées de côté sont une disposition nommée du contrat des
  identifiants canoniques.
- Une source dont la qualification ou l'autorisation d'accès expire dans l'heure n'est pas lue : la renouveler
  demanderait une lecture complète, qui est le travail du RUN.

**Politique d'accès** (D-483) : la passe lit par la collecte scellée sous la décision d'accès en vigueur, avec la porte
par hôte du RUN (concurrence et délai par site) ; robots et périmètre sont ceux de la décision. Elle n'ajoute aucune
forme d'adresse : la liste et les fiches sont celles que le RUN lit déjà. Fenêtre 15:30-18:30 UTC refusée, RUN ou
autre passe en cours refusés (`PipelineRun`, revérifié avant chaque source).

## 3. Cadence : cinq passes, 01, 05, 09, 13 et 21 UTC

Au plus 4 h entre deux lectures d'une source (13 → RUN de 16-17 h → 21 → 01 → 05 → 09 → 13). La passe de 05:00 finit
avant les alertes de 07:30 à Paris ; celle de 13:00 finit bien avant 15:30 ; celle de 21:00 suit la fin ordinaire du
RUN et se refuse tant qu'il tourne (la plus longue fin mesurée : 20:15). Trois passes (04, 10, 22) coûteraient 40 % de
requêtes en moins pour un délai réel projeté de 3,0 h de médiane au lieu de 1,9 h : D-517 dit que l'infrastructure sert
la promesse, et le coût reste modéré (§5).

## 4. Découverte projetée et part couverte

RUN à 16:00 UTC, population de `cadence-r143/` (`projection.out`). **Borne haute** : le modèle suppose que chaque
passe lit chaque source ; au dernier RUN, 25 des sources retenues étaient DEGRADED et 2 en échec, et les sources
laissées au RUN (`QUALIFICATION_DUE`) ou dont la collecte de passe est rejetée ne sont pas modélisées.

| | Offres couvertes | Mesure du CEO (`firstSeenAt − postedAt`) médiane / p90 / ≤ 24 h | Heure exacte (5 251 offres) médiane / p90 |
|---|---|---|---|
| RUN seul (aujourd'hui) | 0 % | 17,3 h / 42,0 h / 74,9 % | 7,8 h / 20,9 h |
| lecture R-143 §1 (40 sources par coût, 3 passes) | 21,9 % | 17,0 h / 41,9 h / 75,6 % | 5,8 h / 19,7 h |
| seuil d'une par jour (147 sources, 3 passes) | 96,5 % | 6,5 h / 41,0 h / 76,6 % | 3,1 h / 6,1 h |
| **D-517 retenu (285 sources, 5 passes)** | **100 %** | **5,0 h / 37,1 h / 76,8 %** | **1,9 h / 3,7 h** |
| *Maisons de luxe phares¹, RUN seul → D-517* | — | *19,5 → 11,0 h / 43,8 → 35,0 h / 74,4 → 80,6 %* | *296 offres seulement* |

¹ Prada, Rolex, Burberry, Valentino, Clarins, Chanel Parfums, Richemont, Swatch, LVMH (1 190 offres).

Lecture honnête :
- Le délai **réel** de découverte se lit sur la colonne « heure exacte », la seule où l'heure de publication est
  connue. Cette population est biaisée : elle ne contient ni Workday ni SuccessFactors, donc presque aucune Maison de
  luxe phare (296 offres sur 1 190). Pour elles, seule la mesure du CEO existe : médiane 19,5 → 11,0 h projetée.
- Sur la mesure du CEO, la médiane tombe de 17,3 à 5,0 h, mais la part des offres vues en 24 h ou moins ne bouge
  presque pas (74,9 → 76,8 %) et le p90 reste à 37 h. Cela tient aux dates sans heure (minuit, « Posted 3 Days Ago » de
  Workday) et aux dates antérieures à l'apparition (republications), ET à une hypothèse du modèle (une offre n'apparaît
  jamais avant la collecte précédente de sa source) : ce p90 n'est pas une mesure de ce que la cadence ne peut pas
  faire. Seule une mesure après activation, par Maison, sur l'écart entre deux collectes, le dira (R-143 §9).
- La valeur candidat passe aujourd'hui par les alertes (mardi et vendredi, ou jeudi selon le marché, 07:30 locale,
  D-498) : une offre trouvée par la passe de 21:00, 01:00 ou 05:00 UTC part dans l'alerte du matin au lieu de la
  suivante. Le catalogue agrégé n'est pas encore servi sur catwalks.io.

## 5. Coût

| Par jour | RUN seul | + 5 passes (retenu) | + 3 passes (04, 10, 22) | *lecture R-143 §1 étendue à 6 sources lues en entier* |
|---|---|---|---|---|
| Requêtes | 111 186 | **+40 802 (+37 %)** | +24 481 (+22 %) | *+55 %* |
| Offres écrites | 81 338 réécritures | **au plus ~1 820 (+2,2 %)**, le neuf seul | idem | *+73 %* |
| Worker | 2-4 h | ~5 × 12 min (projeté) | ~3 × 12 min | — |

Par site, la passe ajoute cinq lectures de liste par jour : Knitwell, la plus chère des listes Workday, environ
5 × 200 requêtes, pour 4 200 au RUN.

## 6. Écarts connus

- **La passe entretient la qualification native.** Une collecte de passe validée la rafraîchit (24 h) : le RUN qui suit
  ne refait plus sa capture de qualification et lit chaque source une seule fois. Le contrôle de périmètre
  `scopeOutgrown` ne s'exécute qu'avec une qualification. Une adresse hors périmètre que lit une passe fait échouer sa
  collecte ; cette tentative échouée périme la validation, et le RUN suivant requalifie et redérive le périmètre le jour
  même. Reste le cas d'une adresse hors périmètre apparue entre la passe de 13:00 et le RUN : la source échoue au RUN ce
  jour-là (comme le 29/09), puis est requalifiée au RUN suivant (aucune offre fermée ni masquée par cet échec).
- Une collecte de passe dont une publication nouvelle est irrécupérable (ni qualifiée, ni retenue) est rejetée si elle
  dépasse la tolérance ; la source perd sa qualification jusqu'au RUN, qui la refait par une lecture complète. Rien
  n'est perdu ; les passes de la journée ne la lisent plus.
- Une source coupée par l'échéance de la passe laisse une tentative échouée, qui périme sa validation : le RUN la
  requalifie (lecture complète). Budget de 90 minutes pour une douzaine projetée.
- Une offre retenue par la revue de disponibilité que la source liste de nouveau n'est relâchée qu'au RUN (la passe ne
  relit pas les connues) ; la lecture R-143 §1, jamais activée, la relâchait à la passe.
- Entre une passe et le RUN suivant, la dernière collecte d'une source est incrémentale : une revue de disponibilité
  lancée à la main dans cet intervalle ne retient rien sur absence pour cette source (le plafond de 72 h s'applique).
- Une offre trouvée par une passe n'est géocodée qu'au RUN suivant : d'ici là, une alerte à rayon ne la trouve que par
  le nom de sa ville, pas dans les villes voisines.
- Une offre fermée puis republiée sous le même identifiant est « connue » : le RUN la rouvre, pas la passe.
- Lecteurs non adaptés (Personio, Eqwa, Talent Funnel, Talentview, Talentsoft, Taleo, Altamira, Easycruit, Bash
  Talents, Volcanic, Harri, Jobylon, TalentRecruiter ; 27 sources) : relus en entier, seul le neuf est écrit ; 2 815
  requêtes par passe, un tiers du coût restant.
- Un RUN lancé à la main pendant une passe n'interrompt pas les sources en cours (au plus 4), seulement les suivantes.
- Hors du lot : Hermès n'est pas une source ACTIVE (absent de F1).
- Activation : geste de production sous GO (cron, images, contrat d'exécution), étapes en lecture D-492.
