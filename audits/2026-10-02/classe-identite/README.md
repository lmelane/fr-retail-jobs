# D-520, classe « identité d'employeur » : ce qui se prouve est absorbé, le reste est retenu en file de revue

Mesures en lecture seule de la production, le 02/10/2026 entre 14:53 et 15:27 UTC, hors fenêtre du RUN. Code sur `development`, rien en production.

## Fichiers

| Fichier | Contenu |
|---|---|
| `echecs.sql` → `echecs.csv.gz` | chaque refus d'identité (`job.write_failed`) des 8 RUN du 24/09 au 01/10, par RUN, source, motif et libellé |
| `preuves.sql` → `preuves.csv.gz` | chaque offre refusée : sa dernière observation attribuée avant le RUN, ses témoins D-506, son employeur actuel |
| `sources.sql` → `sources.out` | registre des 27 sources en cause et libellés observés depuis le 01/09 |
| `sporadiques.sql` → `sporadiques.out` | les refus d'une ou deux offres sur des sources à libellé natif |
| `sourcerun.sql` → `sourcerun.csv.gz` | offres publiées par RUN (échéance de la file) |
| `veille.sql` → `veille.out` | le RUN du 23/09, avant la fenêtre, et l'état des RUN |
| `alias-relus.sql` | les décisions d'alias relues après coup (sortie non enregistrée, à rejouer après 18:30 UTC) |
| `rejeu.py` → `rejeu.out` | les règles du lot rejouées sur les 8 RUN : sous-causes, absorbé, file, interventions par RUN |
| `relecture.py` → `relecture.tsv`, `relecture.txt` | toutes les résolutions automatiques de la fenêtre (17), relues à la main |
| `temoin-avant-apres.test.ts.txt` → `temoins-avant-apres.out` | trois comportements, rouges sur `cd85f41`, verts sur ce lot |

## Sous-causes mesurées (106 occurrences source × RUN, 8 625 refus d'offres)

| Sous-cause | Occurrences | Sources | Offres | Traitement |
|---|---|---|---|---|
| S4 portail jamais relu, offres sans employeur nommé | 70 | 12 | 918 | file : périmètre du portail ; **déjà tranché le 29/09** (D-478, D-479) |
| S1 libellé omis, offre déjà nommée par l'éditeur | 13 | 8 | 13 | **absorbé** : gardée telle quelle, sans revue (règle 1) |
| S3 changement d'employeur, employeur déjà publié par la source | 8 | 4 | 4 | **absorbé** par D-506 §3 (construit avant ce lot, livré par r4 le 02/10) |
| S2 nouvelle graphie de la Maison, employeur précédent venu du registre | 6 | 1 | 59 | file (lecture de D-506 §3) : b-s-international |
| S5 job board, offres sans employeur | 6 | 1 | 477 | file : retrait **déjà décidé** (D-477, R-142 §2) ; luxe-talent retirée le 29/09 |
| S6 entité juridique sans le nom de la Maison | 6 | 1 | 15 | file : « ALTEX S.A. est-il Funky Buddha ? » |
| S7 changement d'employeur, témoins renommés pendant la collecte | 1 | 1 | 1 | file |

Une occurrence est absorbée quand toutes ses offres le sont : 17 sur 106 (règle 1 : 9, D-506 : 8). La règle 2 (même Maison du registre) n'a aucune occurrence sur la fenêtre. Les quatre occurrences de sephora-france mêlent des offres gardées et deux offres neuves sans employeur : elles vont en file.

## Interventions par RUN (`rejeu.out`)

Avant : chaque occurrence faisait échouer le RUN et demandait une enquête. Après : un refus d'identité ne fait pas échouer le RUN ; une intervention est une entrée de file **ouverte** (une question) ou **escaladée** à son échéance.

| RUN | avant | après |
|---|---|---|
| 24/09 | 20 | 15 (démarrage à file vide ; ces entrées existaient au RUN du 23/09) |
| 25/09 | 18 | 0 |
| 26/09 | 17 | 1 |
| 27/09 | 16 | 9 (escalades à 48 h des portails qui ne publient rien) |
| 28/09 | 15 | 0 |
| 29/09 | 18 | 0 |
| 30/09 | 0 | 0 |
| 01/10 | 2 | 0 |
| total | 106 | 25, soit 16 questions distinctes |

**Gain réel, à ne pas surestimer.** S4 et S5 (76 occurrences sur 106) étaient déjà tranchés le 29/09 par D-477, D-478 et D-479 ; c'est pourquoi le RUN du 30/09 n'a aucune occurrence. Les 2 du 01/10 (Puma, Richemont) relèvent de D-506 §3, construit avant ce lot. Sur le 30/09 et le 01/10, le gain propre de ce lot est donc nul en occurrences ; il porte sur ce qui viendra : les 13 occurrences de S1 (24 au 29/09) ne demandent plus rien, et chaque cas qui reste arrive classé, avec sa question, sans faire échouer le RUN.

## Les règles

- **Règle 1, libellé omis** (`identity/ordinaryIdentity.ts`, motif `NATIVE_LABEL_OMITTED`) : une offre que l'éditeur avait nommée, et que ce libellé natif a rattachée à l'employeur qu'elle porte, n'est ni réécrite ni reconfirmée (R-143 §2) quand sa page ne nomme plus personne ; sa publication garde son employeur (D-515 §1) ; pas d'entrée de file. Vaut aussi sur un portail relu MULTI_BRAND (D-479 §2). Rien n'est gardé si la dernière déclaration native de l'offre a été refusée ou désigne un autre employeur.
- **Règle 2, même Maison du registre** (`SAME_REGISTRY_MAISON`) : ancien libellé NATIF, portail relu SINGLE_BRAND, ancien et nouveau libellé désignant la Maison au registre (R-143 §5), et les gardes de `attachToMaison` : accord de toutes les sources qui publient ces libellés, ni l'employeur actuel ni la ligne Maison ne sont un groupe, au plus une ligne Maison, pas de groupe parent contraire. L'offre ne bouge pas. Témoin : « Puma Energy » publié par une autre source ne va jamais sous Puma.
- **File de revue** (`identity/reviewQueue.ts`, table `EmployerIdentityQueue`) : une entrée par source, motif, libellé et employeur en jeu ; offres en jeu, preuve qui manque, question. Échéance : 7 jours, 48 h si la source ne publie plus rien (celles de `pipeline/sourceState.ts`). Une collecte complète qui ne refuse plus le libellé résout l'entrée ; une passe incrémentale ne refait ni le compte ni l'échéance. L'alerte du RUN a sa section « Employeur à identifier », avec les questions et les entrées échues ; la file complète : commande `file-identite`. Un job board hors WTTJ n'est jamais une question : son retrait est décidé (R-142 §2).
- **Ce que la file ne cache pas** : un refus d'identité ne coupe plus les autres contrôles de la source (troncature, liste non prouvée, volume, champs, retenue à instruire), qui restent bloquants ; les offres refusées comptent comme vues pour le volume. À partir de 10 sources qui ouvrent une entrée dans le même RUN, le verdict passe en panne du système (`IDENTITY_MASS`).

## Approximations du rejeu

L'employeur « actuel » est celui du 02/10. La règle 1 est rejouée sur la dernière observation **attribuée** avant le RUN, alors que le code lit la dernière observation **native**, refusée comprise : les 13 offres sont un maximum. Les témoins D-506 sont les observations attribuées sous ce libellé avant le RUN, sans relire la collecte ; tapestry (26/09) est rangée en file parce que l'audit de D-506 a établi que ses témoins avaient été renommés pendant la collecte. Le rejeu démarre à file vide le 24/09.

## Écarts connus

- Une offre gardée par la règle 1 laisse sa source sans preuve d'absence pour ce RUN (le refus compte comme erreur d'écriture), comme avant ce lot ; sa disponibilité suit le plafond de R-143 §2.
- Une entrée résolue puis rouverte repart de zéro : un cas intermittent peut retarder son escalade.
- La résolution d'une entrée suppose qu'une collecte complète ne refuse plus ce libellé ; elle ne vérifie pas que ses offres ont été écrites.
- `EmployerObservation` ne garde pas l'heure d'une ré-observation identique : dans une séquence B refusé, A accepté, B refusé à l'identique, la règle 1 lit A comme dernière déclaration.
