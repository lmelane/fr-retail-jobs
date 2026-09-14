# P9 — BILAN FINAL

> Crons gelés du début à la fin (`0 0 29 2 *`, `PIPELINE_PAUSED=1`, relu après la dernière exécution).
> Aucune mutation de production hors protocole. Aucun déploiement pendant un run borné.

## Ce que P9 devait être, et ce qu'il a produit

P9 n'était pas un audit de plus : c'était **l'extension du catalogue par vagues bornées et mesurées**.

| | |
|---|--:|
| Offres actives | **82 114** |
| **Offres uniques et fiables réellement ajoutées** | **2 440** |
| Acteurs nouveaux publiant des offres | **2** (HUGO BOSS, Skechers) |
| Sources ACTIVE | 435 |
| Sources actives certifiées | 93 |

**2 440 est le nombre d'offres uniques ajoutées** — ni un volume collecté, ni un total servi. Les passages
d'ingestion suivants n'y ajoutent rien : mesurés, ils rendent **0 et 5 nouvelles**, le reste étant des
ré-attestations. *Ne jamais présenter 784 + 1 656 une seconde fois comme un ajout.*

## Les deux vagues

**Vague 1 — diagnostic du processus** (`bilan-vague-1.md`). 16 sources, **1 certifiée**. Aucune offre ajoutée,
par construction. Elle a produit la chaîne de preuve D60 (preuve de portail, référence de board dérivée de la
configuration, garde anti-circularité, échéance contraignante) sans laquelle la vague 2 n'aurait intégré
personne. `ralph-lauren-avature` reste `BLOQUÉ AVEC CONDITION DE REPRISE`, dans le périmètre.

**Vague 2 — extension réelle** (`vague-2-extension-perimetre.md`). 7 dossiers admis après élimination de 5
faux manques **avant le gel** (Calzedonia/Intimissimi/Tezenis étaient le cas D34 : leur créer une source par
marque aurait dupliqué 483 offres du portail de groupe).

| Verdict | Dossiers |
|---|--:|
| `INTÉGRÉ ET VALIDÉ` | **2** — HUGO BOSS 784, Skechers 1 656 |
| `EXCLU — HORS SECTEUR (décision antérieure)` | 1 |
| `BLOQUÉ — DÉCISION PROPRIÉTAIRE` | 1 |
| `BLOQUÉ — PORTAIL NON ÉTABLI` | 3 |

Aucun dossier « en cours ». Aucun dossier retiré après coup.

## Les contrôles terminaux (`controles-terminaux.md`)

| Contrôle | Résultat |
|---|---|
| Verdict complet d'ingestion | 11 grandeurs séparées ; `servies ≠ uniques` (121 et 97 doublons inter-pages) |
| Idempotence | **0 doublon JobSource · 0 identifiant sur deux Jobs · 0 fermeture par absence** ; 121 et 97 identifiants non re-servis **conservés** |
| URLs publiques 20+20 | **40/40** conformes (200 + identifiant porté + 0 page de recherche) |
| Teaser vs description | **0 offre sous 400 caractères** ; médianes 3 090 et 4 815 |
| Chemin commun | `promote` accepte les deux dossiers ; **état produit == état de production**, différence nulle |
| Contrôle public par identifiant | **2 440 ids d'API = 2 440 offres actives** ; 20/20 parcours conformes, 0 écart |
| Parité compteurs | base = API = fiche Maison (784 et 1 656) |
| Sitemap | 18 tranches lues en entier, 83 812 URLs, **0 problème** |

## Ce qui reste ouvert, nommé et non masqué

| Sujet | État |
|---|---|
| **`catwalks.io/bot`** | **rend 404.** D62 en fait un préalable bloquant à l'activation, et le User-Agent est déjà déployé. Le contenu est rédigé (`apps/web/app/bot/page.tsx`) et `botInfoUrlIsServed()` permet de le vérifier — mais `catwalks.io` est un autre dépôt : **la mise en ligne est hors de ce périmètre.** |
| Réserve stockage objet | non provisionné ; aucune purge d'observations n'a eu lieu |
| Crons | **gelés** ; leur reprise reste une décision propriétaire (D57) |
| `ralph-lauren-avature` | bloqué, condition de reprise écrite |
| Galderma (dermo-cosmétique) · KS Groupe (intérim) | décisions propriétaires |
| 3 portails non établis | Zadig & Voltaire, Armor Lux, Gérard Darel |

## La vague suivante — PROPOSÉE, NON LANCÉE

Périmètre suggéré, à figer et arbitrer par le propriétaire avant toute exécution :

1. **`ralph-lauren-avature`** — rejouer la validation depuis l'egress de production (1 104 offres en jeu).
2. **Les 3 portails non établis** — recherche de portail officiel, preuve par page archivée.
3. **La famille `C_RECIPROCAL_LINK_VERIFIED`** (12 sources, 333 offres) — lien réciproque déjà archivé,
   donc la preuve existe : c'est le prochain endroit où l'échelle ne dépend d'aucune découverte.

Rien n'est lancé. Les crons restent gelés.

## Ce que ce lot a appris, et qui vaut au-delà de P9

Six défauts ont été trouvés pendant P9. **Tous rendaient un résultat qui paraissait bon**, et aucun n'aurait
été vu par un contrôle de statut, de total ou de code de sortie :

- un curseur avançant de `size` perdait 137 offres **sans lever d'erreur** ;
- 19 URLs fausses derrière **19 HTTP 200** — seule la recherche de l'identifiant **dans la page** le montre ;
- des descriptions au teaser alors que la fiche publiait **7 646 caractères** ;
- D62 « opérationnel » alors que 17 adaptateurs gardaient leur UA Chrome ;
- un `git push -q` **réussi sans rien pousser** — vu en vérifiant le **contenu** du commit déployé ;
- un plafond de 50 pages dans l'outil de contrôle **fabriquant** l'absence qu'il mesurait.

*Une borne arbitraire dans un instrument de mesure produit le défaut qu'elle prétend constater — et une
garde qu'on croit armée est pire qu'une garde absente, parce qu'elle fait relire un run comme sûr.*
