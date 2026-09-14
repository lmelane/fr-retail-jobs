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
| **`catwalks.io/bot`** | **LEVÉ le 2026-09-14.** La page est publiée dans le dépôt qui sert `catwalks.io` (`lmelane/catwalks-front-end`, commit `d17959a`) et répond **HTTP 200** sans authentification, prérendue en statique — donc lisible par un robot qui n'exécute pas JavaScript. Elle porte l'User-Agent **exact** (`CatwalksBot/1.0 (+https://catwalks.io/bot)`), nomme CATWALKS comme opérateur, décrit le périmètre collecté et ce qui ne l'est jamais, le comportement du robot, le contact relevé `contact@catwalks.io` et la procédure de retrait (courriel ou `robots.txt`). `botInfoUrlIsServed()` rend **true**. Preuve archivée et hachée : `p9/preuve-bot/`. |
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

---

# Addendum — publication de `catwalks.io/bot` (2026-09-14)

Le seul point qui empêchait la clôture est levé, et il l'a été **hors du dépôt de l'agrégateur** : la page
vit désormais dans `lmelane/catwalks-front-end` (`src/app/bot/page.tsx`, commit `d17959a`), le dépôt
Next.js/Vercel qui sert `catwalks.io`.

**La page n'est pas une copie de celle de `modecareers.com`.** La chaîne affichée est celle que le
collecteur présente réellement — `CatwalksBot/1.0 (+https://catwalks.io/bot)` — et l'ancienne URL n'y figure
nulle part (0 occurrence mesurée). *Une page qui afficherait un autre User-Agent que celui réellement
présenté serait pire que pas de page du tout.*

| Contrôle exigé | Résultat |
|---|---|
| HTTP 200 depuis l'extérieur | **oui** (`text/html`, 35 920 o, aucune redirection sortante) |
| Sans authentification | **oui** |
| Ne dépend pas exclusivement de JavaScript | **oui** — route `○ (Static)` prérendue, contenu lisible scripts retirés |
| User-Agent exact dans le corps | **oui** · `modecareers.com/bot` : **0 occurrence** |
| Opérateur identifié | **oui** — CATWALKS, lien vers les mentions légales |
| Périmètre public expliqué | **oui** — et ce qui n'est **jamais** collecté |
| Comportement du robot | **oui** — rythme limité, `Retry-After`, `429`, préférence aux flux publics |
| Contact réellement surveillé | **oui** — `contact@catwalks.io`, le support du site |
| Retrait et signalement | **oui** — courriel, et `User-agent: CatwalksBot / Disallow: /` |
| `botInfoUrlIsServed()` | **true**, code de sortie 0 |

Preuve archivée et hachée : `p9/preuve-bot/` — page complète + sha256
`bc33fe34b39bd152ec5d5c46aa49fca2bd1c9d09d6bf6450ac3a36fb94cfae5e` + en-têtes relevés.

**Aucune ingestion n'a été relancée**, aucun contrôle déjà validé n'a été refait, aucun travail réceptionné
n'a été rouvert.

## Ce que la clôture de P9 ne vaut PAS

Elle **n'autorise pas** la réactivation des crons, qui restent gelés (`0 0 29 2 *`, `PIPELINE_PAUSED=1`) et
dont la reprise demeure une décision propriétaire distincte (D57).

La **réserve de stockage objet distant** reste entière et continue de bloquer, indépendamment de P9 :
la réactivation automatique des crons · l'extension massive en production · toute purge réelle
d'observations. Aucune de ces trois opérations n'est engagée par la présente clôture.
