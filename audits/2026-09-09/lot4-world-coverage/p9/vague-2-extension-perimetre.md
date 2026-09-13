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

## Hugo Boss et Skechers : le portail est prouvé, l'ADAPTATEUR ne suffit pas

| | Hugo Boss | Skechers |
|---|---|---|
| Portail | `careers.hugoboss.com` | `careers.skechers.com` |
| Depuis | `group.hugoboss.com/en/career` (redirection officielle) | `about.skechers.com/careers/` |
| ATS | Phenom (tenant `HUBOGLOBAL`) | Phenom |
| Domaine officiel | ✔ | ✔ |

Les deux sont sur leur propre domaine, et Phenom est une famille **déjà maîtrisée** — Foot Locker en tire
2 842 offres. L'hypothèse « configuration + preuve, sans code » était donc raisonnable.

**Elle est fausse, et c'est mesuré :**

```
careers.footlocker.com/api/jobs?limit=5&page=1  ->  HTTP 200
careers.hugoboss.com/api/jobs?limit=5&page=1    ->  HTTP 500
careers.skechers.com/api/jobs?limit=5&page=1    ->  HTTP 500
```

**Phenom n'est pas une API uniforme** : chaque tenant déploie sa propre variante. L'adaptateur actuel encode
le dialecte de Foot Locker.

**Verdict : `BLOQUÉ — NOUVELLE VARIANTE ATS À DÉVELOPPER` (catégorie F).** Le développement s'isole et
n'empêche aucun autre dossier — c'est précisément la règle du brief §8.

*Ce que ce constat évite* : configurer les deux sources « comme Foot Locker » les aurait fait entrer BROKEN au
catalogue, avec deux Maisons majeures affichant zéro offre.

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
| `BLOQUÉ — NOUVELLE VARIANTE ATS` | 2 (Hugo Boss, Skechers) |
| `BLOQUÉ — PORTAIL NON ÉTABLI` | 3 (Zadig & Voltaire, Armor Lux, Gérard Darel) |

**Aucune offre unique ajoutée par cette vague en l'état.** Le vivier « le plus proche de l'intégration » ne
contenait aucun dossier intégrable sans travail supplémentaire — c'est le fait mesuré, et il oriente la suite
bien mieux qu'un dossier facile choisi ailleurs.
