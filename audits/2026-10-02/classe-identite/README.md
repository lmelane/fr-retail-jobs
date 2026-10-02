# D-520, classe « identité d'employeur » : ce qui se prouve est absorbé, le reste est retenu en file de revue

Mesures en lecture seule de la production, le 02/10/2026 entre 14:53 et 15:13 UTC, hors fenêtre du RUN. Code sur `development`, rien en production.

## Fichiers

| Fichier | Contenu |
|---|---|
| `echecs.sql` → `echecs.csv.gz` | chaque refus d'identité (`job.write_failed`) des 8 RUN du 24/09 au 01/10, par RUN, source, motif et libellé |
| `preuves.sql` → `preuves.csv.gz` | chaque offre refusée : sa dernière observation attribuée avant le RUN, ses témoins D-506, son employeur actuel |
| `sources.sql` → `sources.out` | registre des 27 sources en cause et libellés observés depuis le 01/09 |
| `sporadiques.sql` → `sporadiques.out` | les refus d'une ou deux offres sur des sources à libellé natif |
| `sourcerun.sql` → `sourcerun.csv.gz` | offres publiées par RUN (échéance de la file) |
| `veille.sql` → `veille.out` | le RUN du 23/09, avant la fenêtre, et l'état des RUN |
| `alias-relus.sql` | les décisions d'alias relues après coup (b-s-international, funky-buddha) |
| `rejeu.py` → `rejeu.out` | les règles du lot rejouées sur les 8 RUN : sous-causes, absorbé, file, interventions par RUN |
| `relecture.py` → `relecture-30.tsv`, `relecture-30.txt` | 30 résolutions automatiques relues à la main |
| `temoin-avant-apres.test.ts.txt` → `temoins-avant-apres.out` | les trois comportements, rouges sur `cd85f41`, verts sur ce lot |

## Sous-causes mesurées (106 occurrences source × RUN, 8 625 refus d'offres)

| Sous-cause | Occurrences | Sources | Offres | Traitement |
|---|---|---|---|---|
| S4 portail jamais relu, offres sans employeur nommé | 70 | 12 | 918 | file : « SINGLE_BRAND ou MULTI_BRAND ? » (R-142 §3) |
| S1 libellé omis, offre déjà nommée par l'éditeur | 13 | 8 | 13 | **absorbé** (règle 1) |
| S3 changement d'employeur, employeur déjà publié par la source | 8 | 4 | 4 | **absorbé** (D-506 §3, déjà construit) |
| S2 nouvelle graphie de la Maison du registre | 6 | 1 | 59 | **absorbé** (règle 2, R-143 §5) |
| S5 job board, offres sans employeur | 6 | 1 | 477 | file : retirer la source (R-142 §1-2) |
| S6 entité juridique sans le nom de la Maison | 6 | 1 | 15 | file : « ALTEX S.A. est-il Funky Buddha ? » |
| S7 changement d'employeur, témoins renommés pendant la collecte | 1 | 1 | 1 | file |

Une occurrence est absorbée quand toutes ses offres le sont : 23 sur 106 (règle 1 : 9, règle 2 : 6, D-506 : 8). Les quatre occurrences de sephora-france mêlent des offres absorbées et deux offres neuves sans employeur : elles vont en file.

## Interventions par RUN (`rejeu.out`)

Avant : chaque occurrence faisait échouer le RUN et demandait une enquête. Après : aucune ne le fait échouer ; une intervention est une entrée de file **ouverte** (une question) ou **escaladée** à son échéance.

| RUN | avant | après |
|---|---|---|
| 24/09 | 20 | 14 (démarrage à file vide) |
| 25/09 | 18 | 0 |
| 26/09 | 17 | 1 |
| 27/09 | 16 | 9 (escalades à 48 h des portails qui ne publient rien) |
| 28/09 | 15 | 0 |
| 29/09 | 18 | 0 |
| 30/09 | 0 | 0 |
| 01/10 | 2 | 0 |
| total | 106 | 24, soit 15 questions distinctes |

## Les règles

- **Règle 1, libellé omis** (`identity/ordinaryIdentity.ts`) : une offre que l'éditeur avait nommée, et que ce libellé natif a rattachée à l'employeur qu'elle porte, garde cet employeur quand sa page ne nomme plus personne (R-143 §10, D-515 §1 : une donnée absente n'est pas une donnée contraire). Rien n'est gardé si la dernière déclaration native de l'offre a été refusée ou désigne un autre employeur.
- **Règle 2, même Maison du registre** : l'ancien et le nouveau libellé désignent la Maison au registre de la source (mêmes mots, ou nom complet prolongé : R-143 §5), hors portail de groupe, et l'offre est encore sur l'employeur que l'ancien libellé lui avait donné. L'offre ne bouge pas.
- **File de revue** (`identity/reviewQueue.ts`, table `EmployerIdentityQueue`) : une entrée par source, motif, libellé et employeur en jeu ; offres en jeu, preuve qui manque, question. Échéance : 7 jours, 48 h si la source ne publie plus rien (celles de `pipeline/sourceState.ts`). Une collecte complète qui ne refuse plus le libellé résout l'entrée. Commande `file-identite`.

## Approximations du rejeu

L'employeur « actuel » est celui du 02/10 ; les témoins D-506 sont les observations attribuées sous ce libellé avant le RUN, sans relire la collecte ; tapestry (26/09) est rangée en file parce que l'audit de D-506 a établi que ses témoins avaient été renommés pendant la collecte. Le rejeu démarre à file vide le 24/09 : les 14 entrées de ce jour existaient déjà au RUN du 23/09 (`veille.out`).

## Écarts connus

- La règle 1 ne sait pas pourquoi le libellé manque. Une offre pourvue dont la page ne nomme plus l'employeur (Crocs, 24/09) est réécrite au lieu d'être refusée ; sa fermeture dépend du lecteur, corrigé depuis D-480.
- La règle 2 garde le nom du registre : « B's » reste affiché tant que le registre n'est pas corrigé (la revue du 29/09 a établi qu'il s'agit du même employeur).
- Aucune garde système : un défaut du résolveur qui refuserait d'un coup l'identité de nombreuses sources ne ferait plus échouer le RUN ; il ouvrirait autant d'entrées, nommées dans le bilan (`identityReview`) et au journal (`employer.identity_review_opened`).
- `alias-relus.out` est à reproduire après 18:30 UTC (la sortie du 02/10 à 14:59 n'a pas été enregistrée).
