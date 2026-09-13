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
