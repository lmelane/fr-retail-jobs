# P9 · VAGUE 2 — la première vraie extension, périmètre figé

> Figé le 2026-09-14 avant toute mutation. Vivier initial : les 12 dossiers les plus proches de l'intégration
> (9 `OFFICIAL_PORTAL_TECHNICAL_VALIDATION_REQUIRED`, 1 `ACTIVE_SOURCE_CANDIDATE`, 2 `B6_CANDIDATE_TENANTS`).
> Crons gelés, réserve stockage objet en vigueur, exécutions manuelles et bornées.

## Le réexamen a éliminé 5 dossiers sur 12 — avant le gel, pas après

Le brief exige de confirmer l'absence de couverture **avant** admission. Vérifié en base, et cinq dossiers ne
sont pas des lacunes :

| Dossier | Réalité mesurée | Verdict |
|---|---|---|
| **BOMPARD** | déjà couvert : `Eric Bompard`, **34 offres**, 1 source active | **EXCLU — SOURCE_DÉJÀ_COUVERTE** |
| **CALZEDONIA** | couvert par le portail de groupe `oniverse` (**483 offres**, ACTIVE) | **EXCLU — SOURCE_DÉJÀ_COUVERTE** |
| **INTIMISSIMI** | même portail `oniverse` (Calzedonia Group) | **EXCLU — SOURCE_DÉJÀ_COUVERTE** |
| **TEZENIS** | même portail `oniverse` (Calzedonia Group) | **EXCLU — SOURCE_DÉJÀ_COUVERTE** |
| **Jean Paul Gaultier** | couvert par `jean-paul-gaultier-5` (**227 offres**), sous Puig | **EXCLU — SOURCE_DÉJÀ_COUVERTE** |

*Les trois marques Calzedonia sont exactement le cas D34* : leur créer une source par marque aurait dupliqué
483 offres déjà publiées sous le portail du groupe. C'est la vérification qui l'a évité, pas la prudence.

## Les 7 dossiers admis

| Dossier | Domaine officiel | Catégorie présumée | Motif d'admission |
|---|---|---|---|
| `HUGO BOSS` | `hugoboss.com` | **A — NOUVEL_ACTEUR** | 0 offre, 0 source ; Maison majeure du périmètre |
| `ZADIG & VOLTAIRE` | `zadig-et-voltaire.com` | **A — NOUVEL_ACTEUR** | 0 offre, 0 source ; mode FR |
| `SKECHERS` | *(à établir)* | **A — NOUVEL_ACTEUR** | 0 offre, 0 source ; retail chaussure |
| `GALDERMA` | `galderma.com` | **A — NOUVEL_ACTEUR** | 0 offre ; tenant B6 connu `workday:galderma/external` |
| `ARMOR LUX` | *(à établir)* | **A — NOUVEL_ACTEUR** | 0 offre, 0 source ; mode FR |
| `GERARD DAREL` | *(à établir)* | **A — NOUVEL_ACTEUR** | 0 offre, 0 source ; mode FR |
| `KSI MODE` | `ks-groupe.com` | **F — À QUALIFIER** | tenant B6 `digitalrecruiters` ; **KS Groupe est une décision propriétaire ouverte** (cabinet d'intérim) |

**7 dossiers · 7 acteurs non couverts · 0 offre actuellement publiée pour eux.**

## Ce que la vague doit produire, et qui la distingue de la vague 1

La vague 1 ne pouvait ajouter ni acteur, ni source, ni offre : elle portait sur des sources déjà actives.
**Celle-ci ajoute de vrais acteurs et de vraies offres uniques** — c'est la condition de clôture de P9.

Parcours complet obligatoire par dossier :

```
découverte → rapprochement catalogue → preuve officielle (D60) → identité / groupe / secteur
  → configuration → validation réelle → certification → promotion → ingestion bornée
  → attribution → déduplication → publication → contrôle public → offres uniques mesurées
```

## Contraintes maintenues

| | |
|---|---|
| Crons | **gelés** (`0 0 29 2 *`) |
| Concurrence | **4** (décision P8) |
| Purge d'observations | **interdite** (réserve stockage objet) |
| Extension massive | **interdite** — cette vague est manuelle et bornée |
| Adaptateurs | ATS maîtrisé → configuration + preuve, **jamais un script par Maison** |

`KSI MODE` porte une **décision propriétaire ouverte** (KS Groupe, cabinet d'intérim) : il est admis au
périmètre pour qualification, mais ne sera ni promu ni ingéré sans arbitrage. Son blocage n'arrête aucun autre
dossier.

## Ce que le gel signifie

Les 7 dossiers reçoivent chacun un verdict final. Un dossier non recevable est **exclu avec motif exact**, et
**jamais remplacé en silence** par un autre après le gel.


---

# Résultats de la qualification (2026-09-14)

## Deux dossiers renvoyés à des décisions ANTÉRIEURES, non rouvertes

| Dossier | Verdict antérieur | Ce qu'il dit |
|---|---|---|
| **GALDERMA** | `sectorVerdict: OUT` | « dermatologie médicale et esthétique (Cetaphil, Restylane, injectables) — pharma/dispositifs, hors périmètre beauté grand public ; **à trancher si Loïc inclut la dermo-cosmétique** » |
| **KSI MODE** | `sectorVerdict: REVIEW` | « KS Groupe (KSI Mode, KSI Retail) : distributeur multimarque/franchisé de prêt-à-porter — à confirmer » |

Ces verdicts existaient avant P9. **Verdict : `EXCLU — HORS SECTEUR (décision antérieure)`** pour Galderma,
**`BLOQUÉ — DÉCISION PROPRIÉTAIRE`** pour KSI Mode. Aucun des deux n'est rouvert de ma propre initiative.

## Hugo Boss et Skechers — CORRECTION : le protocole réel est établi

### Ce que j'avais conclu à tort

J'avais testé `/api/jobs`, **extrapolé du déploiement Foot Locker**, obtenu HTTP 500, et conclu
« BLOQUÉ — nouvelle variante ATS ». *Un 500 sur un endpoint qu'on a deviné ne dit rien de la source* : il dit
seulement que l'adaptateur encode le dialecte de Foot Locker. Les URLs officielles n'avaient pas été
observées.

### Le protocole réellement observé

Les pages officielles déclarent elles-mêmes leur configuration `refineSearch` (facettes `category`,
`country`, `state`, `city`, `hiringType`, `workExperience`, `contractType`). L'endpoint est
**`POST /widgets`**, dialecte **CareerConnect** :

| | Hugo Boss | Skechers |
|---|---|---|
| Portail officiel | `careers.hugoboss.com/global/en` | `careers.skechers.com/fr/fr/search-results` |
| Endpoint **observé** | `POST https://careers.hugoboss.com/widgets` | `POST https://careers.skechers.com/widgets` |
| `ddoKey` | `refineSearch` | `refineSearch` |
| **Compteur éditeur** | **784** | **1 656** |
| Pagination | `from` / `size` — `from=700` rend 10 offres distinctes | idem |
| Identifiant natif | `jobSeqNo` (`HUBOGLOBAL142852EXTERNALENGLOBAL`) + `jobId` | idem |
| Champs | titre, `category`, `country`, `cityState`, `dateCreated`, `descriptionTeaser`, `hiringType` | idem |

### Le périmètre, mesuré et non supposé

**Skechers `/fr/fr` n'est PAS un sous-ensemble français** : `lang=fr country=France` et `lang=en
country=global` rendent tous deux **1 656**. Le backend sert le périmètre mondial quelle que soit la locale —
il n'y a donc pas de collecte multi-locale à construire, et la source ne sera pas réduite au marché français.

**Hugo Boss** : le compteur de 784 est celui du portail global, toutes catégories. Retail et Sales &
Omnichannel sont des **catégories**, pas la définition de la source ; la collecte partira de
`careers.hugoboss.com/global/en` sans filtre de catégorie.

### Verdict corrigé

**`PORTAIL OFFICIEL PROUVÉ · ADAPTATEUR PHENOM ACTUEL NON COMPATIBLE · PROTOCOLE RÉEL QUALIFIÉ`**

L'identité, le portail et désormais **le protocole** sont établis. Ce qui reste est l'enrichissement de
l'adaptateur **commun** : Phenom expose au moins deux dialectes — `FOOTLOCKER_API_JOBS` (`GET /api/jobs`) et
`CAREER_CONNECT_WIDGETS` (`POST /widgets` + `ddoKey`). Le dialecte se choisira par **configuration explicite**,
jamais par une cascade d'endpoints devinés.

Ni réfutés, ni abandonnés : intégrables dès l'adaptateur enrichi.

## Zadig & Voltaire, Armor Lux, Gérard Darel

Aucun lien carrière lisible depuis la page d'accueil (HTTP 200, aucun `href` correspondant). Le portail reste
à établir — recherche à mener, pas un refus.

**Verdict provisoire : `BLOQUÉ — PORTAIL OFFICIEL NON ÉTABLI`**, condition de reprise : identifier le portail
carrière officiel et le prouver par page archivée.

## État de la vague 2

| Verdict | Dossiers |
|---|--:|
| `EXCLU — SOURCE_DÉJÀ_COUVERTE` (au réexamen, avant gel) | 5 |
| `EXCLU — HORS SECTEUR (décision antérieure)` | 1 (Galderma) |
| `BLOQUÉ — DÉCISION PROPRIÉTAIRE` | 1 (KSI Mode) |
| `PORTAIL + PROTOCOLE PROUVÉS — adaptateur commun à enrichir` | 2 (Hugo Boss **784**, Skechers **1 656**) |
| `BLOQUÉ — PORTAIL NON ÉTABLI` | 3 (Zadig & Voltaire, Armor Lux, Gérard Darel) |

**2 440 offres publiques sont désormais atteignables** (Hugo Boss 784 + Skechers 1 656), sur des portails
officiels prouvés, avec un protocole qualifié. Elles ne sont pas encore collectées : l'adaptateur Phenom
commun doit porter le dialecte `CAREER_CONNECT_WIDGETS` en plus de `FOOTLOCKER_API_JOBS`.

C'est la prochaine action, et elle débloque deux Maisons majeures d'un coup.

---

# Bilan final de la vague 2 (2026-09-14)

## Les deux dossiers intégrés, de bout en bout

L'adaptateur Phenom porte désormais **deux dialectes explicites** — `FOOTLOCKER_API_JOBS` et
`CAREER_CONNECT_WIDGETS` — choisis par configuration, jamais devinés. Un nom de dialecte inconnu **lève**
plutôt que de retomber silencieusement sur l'autre. **Aucun script par Maison n'a été écrit** : les deux
sources sont de la configuration + de la preuve, comme le brief l'exige.

| | Hugo Boss | Skechers |
|---|--:|--:|
| portail officiel prouvé (D60) | `careers.hugoboss.com` | `careers.skechers.com` |
| revue d'identité | `VERIFIED` · `OFFICIAL_LINK` | `VERIFIED` · `OFFICIAL_LINK` |
| robots lu et daté | `ALLOWED` | `ALLOWED` |
| **offres uniques publiées** | **784** | **1 656** |
| URLs conformes (échantillon réparti) | 20/20 | 20/20 |
| descriptions sous 400 car. | **0** | **0** |
| médiane de description | 3 090 | 4 815 |
| parité base ↔ API ↔ fiche Maison | 784 = 784 = 784 | 1 656 = 1 656 = 1 656 |

**2 440 offres uniques et fiables réellement ajoutées**, sur deux Maisons majeures qui n'en publiaient
aucune. C'est l'indicateur que le brief retient — ni un volume collecté, ni un total servi.

## Verdicts définitifs des 7 dossiers admis

| Dossier | Verdict |
|---|---|
| **HUGO BOSS** | **`INTÉGRÉ ET VALIDÉ`** — 784 offres uniques publiées |
| **SKECHERS** | **`INTÉGRÉ ET VALIDÉ`** — 1 656 offres uniques publiées |
| GALDERMA | `EXCLU — HORS SECTEUR (décision antérieure)` — dermo-cosmétique, à trancher par le propriétaire |
| KSI MODE | `BLOQUÉ — DÉCISION PROPRIÉTAIRE` — KS Groupe, cabinet d'intérim |
| ZADIG & VOLTAIRE | `BLOQUÉ — PORTAIL OFFICIEL NON ÉTABLI` |
| ARMOR LUX | `BLOQUÉ — PORTAIL OFFICIEL NON ÉTABLI` |
| GERARD DAREL | `BLOQUÉ — PORTAIL OFFICIEL NON ÉTABLI` |

Aucun dossier ne reste « en cours ». Les cinq exclus au réexamen (Bompard, Calzedonia, Intimissimi, Tezenis,
Jean Paul Gaultier) l'ont été **avant le gel**, sur mesure en base — pas après coup pour améliorer un bilan.

## Ce que la vague a coûté en défauts, tous corrigés

| Défaut | Comment il a été trouvé |
|---|---|
| Curseur avançant de `size` au lieu des lignes rendues | 647/784 collectées **sans erreur levée** — le compteur déclaré mentait |
| URLs sans segment de locale | 19/19 « bonnes » derrière HTTP 200 ; la redirection vers `/global/en` ne se voit qu'en cherchant l'identifiant dans la page |
| Descriptions au teaser | médiane 313 et 287 ; la fiche publiait 7 646 caractères |
| D62 appliqué à moitié | 17 adaptateurs gardaient leur UA Chrome ; `candidateChecks` lisait robots sous le nom que D62 interdit |
| `git push -q` « réussi » sans rien pousser | vérification du **contenu** du commit déployé, pas du message de fusion |
| Plafond de 50 pages dans le contrôle public | fabriquait une absence d'API sur une offre parfaitement servie |

*Chacun de ces défauts rendait un résultat qui paraissait bon. Aucun n'aurait été vu par un contrôle de
statut, de total ou de code de sortie.*
