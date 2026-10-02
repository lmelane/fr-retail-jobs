# D-517 — toutes les sources significatives découvertes en quelques heures

Production en lecture seule (`db.py readonly`), le 02/10/2026 entre 12:17 et 12:29 UTC, hors fenêtre du RUN. Tout se
rejoue depuis ce dossier, depuis la racine du checkout de référence :

| Fichier | Contenu |
|---|---|
| `mesure.sql` → `.out` | F0 dernier RUN ; F1 nouvelles publications par source sur 7 jours ; F2 requêtes du dernier RUN par forme d'adresse (liste ou fiche) ; F3 rang des publications nouvelles dans la sortie des 3 derniers RUN ; F4 la règle exacte de sélection de la passe, à l'instant de la mesure |
| `projection-donnees.sql` → `offres.csv`, `collectes.csv` | les 11 301 nouvelles offres du 25/09 au 02/10 (sources présentes avant le 24/09) et les collectes achevées : même population que `cadence-r143/` (CSV non versionnés, `.gitignore`) |
| `projection.py` → `projection.out` | sélection, coût d'une passe incrémentale, découverte projetée (modèle en tête du fichier, graine fixe) |
| `mutations.sh` → `.out` | chaque garde retirée par un sed aller-retour : ses témoins passent au rouge, l'arbre revient à l'identique |

## 1. La sélection : l'importance pour le candidat, plus le coût

**Règle** (`significantSources`, `src/pipeline/lightPass.ts`) : une source ACTIVE entre dans la passe quand elle a fait
paraître au moins **une publication nouvelle par jour** en moyenne sur les 7 derniers jours (`JobSource.firstSeenAt`),
lue en base à chaque passe. Le premier chargement d'une source est un stock, pas un flux : pour une source enregistrée
dans la fenêtre, le flux se compte depuis le lendemain de sa première publication, avec au moins un jour de flux.

| Seuil | Sources | Part des nouvelles publications |
|---|---|---|
| 0,5 / jour | 200 | 98,7 % |
| **1 / jour** | **147** | **96,6 %** |
| 2 / jour | 103 | 93,2 % |
| *lecture R-143 §1 : 40 sources choisies par coût* | *40* | *20,5 %* |

Pourquoi 1 par jour : c'est le point où la courbe s'aplatit (de 1 à 0,5 : +53 sources pour +2,1 points) ; en deçà, une
passe sur quatre trouverait une offre, et le RUN la voit dans la journée. Toutes les Maisons nommées par le CEO y
sont, luxe (Prada 8,9 / jour, Rolex 4,4, Burberry 2,9, Clarins 2,4, Valentino 2,1, Swatch 13,6) comme volume (H&M 127,7,
Ulta 97,0, Knitwell 88,7, Nordstrom 70,6, WTTJ 61,1, Tapestry 52,0), et les grandes sources enregistrées la veille
(Estée Lauder 59,4, Kering 29,6, PVH 17,5) y entrent dès leur premier jour de flux. Premières sources écartées, à
0,8-0,9 / jour : Audemars Piguet, Mulberry, L'Occitane, SSENSE, Uniqlo US, Zegna. Une règle lue à chaque passe suit le
marché : une Maison qui se met à recruter y entre d'elle-même (la liste figée de la lecture R-143 §1 ne le faisait pas).

## 2. Le moyen, par famille d'adaptateur : la lecture incrémentale

**La liste entière, puis le détail des seules publications jamais vues, et l'écriture de ces seules publications**
(`src/lib/incrementalReading.ts`). « Première page triée par date, puis arrêt à la première offre connue » a été
examiné et **écarté par la mesure** : aucun des adaptateurs concernés n'envoie de tri par date (Jibe trie par
pertinence, SuccessFactors RMK et Phenom sont documentés instables), et dans les collectes des 3 derniers RUN (F3), une
publication nouvelle se trouve au-delà de 90 % de la sortie pour Tapestry (rang p90 0,97), adidas (0,97), Sephora
France (0,99), Skechers (0,97), PVH (0,95), Rituals (0,96), WTTJ (0,86) : un arrêt anticipé en perdrait. La liste coûte
une requête pour 10 à 100 offres ; c'est la fiche, une par offre, qui coûte.

| Famille | Sources retenues | Ce que lit la passe | Requêtes par passe (lecture complète → incrémentale) |
|---|---|---|---|
| Workday | 29 | liste paginée (20) entière, fiche du seul neuf | 38 578 → 1 435 |
| SuccessFactors | 17 | liste (RMK, balayages jusqu'au total) entière, page du seul neuf | 13 499 → 437 |
| SmartRecruiters | 12 | liste (100) entière, annonce du seul neuf | 9 624 → 451 |
| Phenom (CareerConnect) | 4 | widgets entiers, fiche du seul neuf | 7 618 → 69 |
| generic-listing | 8 | pages de liste, page du seul lien neuf | 6 147 → 393 |
| Eightfold (Estée Lauder, Kering) | 2 | recherche (10) entière, fiche du seul neuf | 5 499 → 322 |
| WTTJ, iCIMS, Oracle, DigitalRecruiters, Swatch, JobAffinity | 12 | liste entière, détail du seul neuf | 16 881 → 682 |
| Teamtailor, Greenhouse, Lever, Recruitee, Workable, Jibe, LVMH, Rituals… | 52 | la liste porte tout : relue, seul le neuf est écrit | inchangé (633) |
| Eqwa, Talent Funnel, Talentview, Taleo, Talentsoft, Easycruit, Bash Talents, Harri, Jobylon | 11 | lecteur non adapté : relu en entier, seul le neuf est écrit | inchangé (2 047) |

Une passe : **6 470 requêtes** au lieu de 100 526 pour lire les mêmes sources en entier, environ **12 minutes** à
quatre sources en parallèle (plus longue : psycho-bunny, 6 min) ; budget de 90 minutes.

**Ce qu'une lecture incrémentale n'est jamais** (chaque garde a son témoin, `mutations.out`) :
- une preuve d'absence : son résultat est scellé `incremental` (avec l'ensemble trié des connues laissées de côté),
  `complete: false`, `truncated: true` ; la capture attestante le refuse (`attestingCapture.ts`), la revue de
  disponibilité ne la juge jamais crédible, aucune garde du RUN ne la prend pour référence (`referenceRuns.ts`) ;
- une écriture de l'existant : une publication connue (déjà dans `JobSource`, ou rendue par une collecte des 48 h)
  n'est ni relue, ni réécrite ; son `lastSeenAt` ne bouge pas, rien n'est fermé, retenu ni masqué ;
- une rupture de la chaîne de qualification : la capture est validée par son rejeu exact, sous l'ensemble scellé
  (`capture/batch.ts`) ; « rien de neuf » (la liste n'a montré que des connues) est validé comme tel
  (`incrementalNothingNew`), une liste vide reste un flux vide non prouvé ;
- un état de source : sa ligne `SourceRun` ne se compare à rien, n'atteste rien et ne touche pas `Source.lastRun*`
  (ordre et budget du RUN, back-office) ; le rapport de santé lit la dernière ligne du RUN.
- Une source dont la qualification ou l'autorisation d'accès expire dans l'heure n'est pas lue : la renouveler
  demanderait une lecture complète, qui est le travail du RUN.

**Politique d'accès** (D-483) : la passe lit par la collecte scellée sous la décision d'accès en vigueur, avec la porte
par hôte du RUN (concurrence et délai par site) ; robots et périmètre sont ceux de la décision. Elle n'ajoute aucune
adresse : la liste et les fiches sont celles que le RUN lit déjà. Fenêtre 15:30-18:30 UTC refusée, RUN ou autre passe
en cours refusés (`PipelineRun`, revérifié avant chaque source).

## 3. Découverte projetée et part couverte

Passes à 04, 10 et 22 UTC, RUN à 16:00 UTC (`projection.out`, population de `cadence-r143/`) :

| | Offres couvertes par la passe | Mesure du CEO (`firstSeenAt − postedAt`) médiane / p90 | Heure exacte (5 251 offres) médiane / p90 |
|---|---|---|---|
| RUN seul (aujourd'hui) | 0 % | 17,3 h / 42,0 h | 7,8 h / 20,9 h |
| lecture R-143 §1 (40 sources par coût) | 21,9 % | 17,0 h / 41,9 h | 5,8 h / 19,7 h |
| **D-517 (147 sources, incrémentale, toutes les 6 h)** | **96,5 %** | **6,5 h / 41,0 h** | **3,1 h / 6,1 h** |
| D-517 toutes les 4 h (00, 04, 08, 12, 20) | 96,5 % | 5,2 h / 40,4 h | 2,4 h / 4,7 h |

Lecture : le délai réel de découverte (heure exacte) passe de 7,8 h à **3,1 h de médiane et 6,1 h de p90**, pour la
quasi-totalité des nouvelles offres. Sur la mesure du CEO, la médiane passe de 17,3 h à 6,5 h ; le p90 reste à 41 h,
plafonné par les dates de publication sans heure (minuit, « Posted 3 Days Ago » de Workday) et antérieures à
l'apparition (republications) : aucune cadence ne le fait descendre, seule une datation plus fine des sources le
ferait (écart connu, R-143 §9). Population « heure exacte » biaisée (sans Workday ni SuccessFactors) : voir
`cadence-r143/README.md`.

## 4. Coût

| Par jour | RUN seul | + passes D-517 (6 h) | + passes D-517 (4 h) | *lecture R-143 §1 étendue à 6 sources lues en entier* |
|---|---|---|---|---|
| Requêtes | 111 186 | **+19 411 (+17 %)** | +32 352 (+29 %) | *+55 %* |
| Offres écrites | 81 338 réécritures | **+~1 320 (+1,6 %)**, le neuf seul | idem | *+73 %* |
| Worker | 2-4 h | ~3 × 12 min | ~5 × 12 min | — |

Cadence retenue : **toutes les 6 h**. Elle tient « quelques heures » (3,1 h de médiane réelle, 6,1 h de p90) ; 4 h ne
gagne que 0,7 h de médiane pour 67 % de requêtes en plus, et une passe de 20:00 tomberait sur la fin des RUN longs
(20:15 mesuré).

## 5. Écarts connus

- **La passe entretient la qualification native** : une collecte de passe validée la rafraîchit (24 h). Le RUN qui
  suit une passe de moins de 24 h ne refait donc pas sa capture de qualification et lit la source une seule fois ; le
  contrôle de périmètre `scopeOutgrown` ne s'exécute qu'avec une qualification. Une adresse nouvelle hors périmètre,
  apparue entre la dernière passe et le RUN, ferait échouer la source ce jour-là (comme le 29/09), jusqu'à la
  requalification du lendemain. Le même effet existait déjà pour les 40 sources de la lecture R-143 §1.
- Une collecte de passe dont la seule publication nouvelle n'est pas qualifiable est rejetée ; la source perd sa
  qualification jusqu'au RUN, qui la refait (lecture complète). Rien n'est perdu, la source n'est plus lue par les
  passes de ce jour-là.
- Entre une passe et le RUN suivant, la dernière collecte d'une source est incrémentale : une revue de disponibilité
  lancée à la main dans cet intervalle ne retient rien sur absence pour cette source (le plafond de 72 h s'applique).
- Lecteurs non adaptés (Eqwa, Talent Funnel, Talentview, Taleo, Talentsoft, Easycruit, Bash Talents, Harri, Jobylon ;
  11 sources retenues) : relus en entier, seul le neuf est écrit ; 2 047 requêtes par passe, un tiers du coût restant.
- Un RUN lancé à la main pendant une passe n'interrompt pas les sources en cours (au plus 4), seulement les suivantes.
- La mesure du CEO garde un p90 de 41 h (dates sans heure) : l'indicateur de santé R-143 §9 devra lire l'écart entre
  deux collectes, par Maison.
- Activation : geste de production sous GO (cron, images), étapes en lecture D-492.
