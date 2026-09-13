# P9 · l'inventaire candidat, consolidé et mesuré

> 2026-09-13, lecture seule sur la production et sur l'inventaire unique de D60. Aucune collecte, aucune
> mutation. Crons gelés, réserve stockage objet en vigueur.

## L'état de départ, mesuré

| | |
|---|--:|
| Acteurs dédupliqués (inventaire unique) | **2 488** |
| Acteurs **avec** une source active | 858 |
| Acteurs **sans aucune source active** | **1 630** |
| Sources `ACTIVE` | 433 |
| Sources actives **non certifiées** | 343 |
| Offres actives | ~79 500 |

**La lacune de couverture, c'est 1 630 acteurs sans source.** Mais leur traitement n'est pas uniforme :

| Étape (découverte FashionJobs) | Acteurs |
|---|--:|
| `RESEARCH_NOT_STARTED` | 720 |
| `RESEARCH_INCOMPLETE` | 573 |
| hors FashionJobs | 270 |
| `CAREER_LINK_REVIEW_REQUIRED` | 50 |
| validation technique requise | 9 |
| identité ambiguë | 7 |

**1 292 acteurs demandent d'abord une recherche de portail officiel** — un travail de découverte, pas
d'intégration. Ils sont l'inventaire des vagues suivantes, pas de la première.

## Les 343 sources actives non certifiées, par famille

| Famille | Sources | Offres | Ce qui bloque |
|---|--:|--:|---|
| `E_RESEARCH_NEEDED` | 189 | 8 610 | aucune provenance officielle vérifiée |
| **`B_OFFICIAL_DOMAIN_PORTAL`** | **83** | **9 858** | **rien — portail hébergé sur le domaine officiel** |
| `G_GROUP_PORTAL` | 30 | 9 421 | certification MULTI_BRAND + alias revu par libellé |
| `A_HOMONYM_SUSPECT` | 26 | 1 510 | l'identité peut être fausse |
| `C_RECIPROCAL_LINK_VERIFIED` | 12 | 333 | rien — lien réciproque archivé |
| `D_BOARD_OR_AGENCY` | 3 | 2 490 | décision propriétaire |

## Ce que la vérification a corrigé dans l'inventaire

Trois constats lus en base **contredisent** une lecture naïve du fichier, et il faut les nommer avant de
bâtir dessus :

1. **`parentGroup` est `null` presque partout.** Une requête par groupe rend « L'Oréal 0 offre » et
   « Tapestry 0 offre » — **faux** : L'Oréal publie 1 804 offres actives sous « L'Oréal », Tapestry 136 sous
   son nom plus Coach et Kate Spade séparément. *Un groupe absent d'une colonne n'est pas un groupe absent du
   catalogue.*
2. **Les 167 « marques de portefeuille sans source active » ne sont pas 167 lacunes.** LVMH (50), L'Oréal
   (47), Richemont (8), Kering (3) sont déjà collectés **par leur portail de groupe** — leurs marques n'ont
   pas besoin d'une source propre. Les traiter comme des acteurs manquants aurait créé des doublons, c'est-à-
   dire exactement le cas D34.
3. **Deux sources actives sont en échec au dernier run**, portant 3 596 offres encore publiées :
   `l-oreal-professionnel` (BROKEN, Cloudflare — l'intermittence de D51) et `mango` (BROKEN, **et c'est notre
   propre arrêt 429 de l'A/B P8**, pas un défaut de la source). Aucune des deux n'est un trou de couverture à
   combler par une nouvelle source.

## La priorisation, et pourquoi elle ne prend pas le plus facile

Les critères du brief, appliqués aux six familles :

| Critère | Ce qu'il désigne |
|---|---|
| Preuves officielles disponibles | `B` et `C` : la preuve **existe déjà**, elle n'est pas à chercher |
| ATS déjà maîtrisé | `B` couvre 12 familles d'adaptateurs **toutes existantes** |
| Offres réellement uniques | `B` porte 9 858 offres **déjà collectées** mais non certifiées |
| Effort d'intégration | `E` (189 sources) demande une recherche par acteur : hors première vague |
| Risque d'attribution | `A` (26) et `G` (30) portent un risque d'identité : après la première vague |

**La famille `B` n'est pas choisie parce qu'elle est facile : elle est choisie parce qu'elle transforme
9 858 offres déjà collectées en offres *certifiées*.** C'est le seul endroit où le passage à l'échelle ne
dépend d'aucune découverte préalable.

**Ce que la première vague ne fait PAS** : elle ne transforme pas les 343 sources en une vague unique. Le
brief l'interdit, et la mesure le confirme — 189 d'entre elles n'ont aucune provenance vérifiée.
