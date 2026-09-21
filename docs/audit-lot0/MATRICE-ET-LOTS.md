# Matrice Pays × Filtres et lots proposés

**Mesuré le 2026-09-21 sur le corpus réel** `corpus-2026-09-21T06-07-42`, instantané
`REPEATABLE READ`, code déployé `0f22b49`, rôle `catwalks_audit` (huit contrôles passés).

**Population de référence : 34 852 offres PUBLIABLES** — `isActive` ET `mergedIntoId IS NULL` ET
au moins une publication active non expirée. Tous les taux ci-dessous portent sur elle.

---

## 1. Trois réserves de l'audit, levées par la mesure

| Réserve | Verdict |
|---|---|
| L'écart `isActive` → publiable invaliderait toutes les couvertures | **31 offres, 0,1 %.** Zéro fusionnée. Négligeable — les mesures antérieures tenaient. |
| `extractedCount` serait gonflé d'un facteur 3,33 | **Concordance exacte** : 88 148 `extractedCount` = 88 148 lignes `SourceExtraction`. Dénominateur mal choisi de ma part, pas une inflation. **Clos.** |
| `DirectOffer` fausserait la couverture `metier` | **0 ligne.** Sans objet. |

---

## 2. Le catalogue réel

**84 codes pays** observés, plus `INCONNU` (589 offres — catégorie de diagnostic, jamais un marché).

Concentration forte : **US 52,7 % · FR 12,7 %** — les deux font 65 %, les 25 premiers pays 95 %.

### Couverture des dimensions FILTRABLES (les seules exposables aujourd'hui)

| pays | offres | contrat | temps | programme | métier | langue |
|---|---|---|---|---|---|---|
| US | 18 359 | 12 % | **83 %** | 0 % | **59 %** | **100 %** |
| FR | 4 441 | **59 %** | **72 %** | **32 %** | **41 %** | **98 %** |
| GB | 1 239 | **26 %** | **41 %** | 1 % | **40 %** | **100 %** |
| IT | 1 126 | **41 %** | **71 %** | 17 % | **52 %** | **98 %** |
| ES | 958 | **23 %** | **39 %** | 8 % | **43 %** | **99 %** |
| CA | 928 | **33 %** | **75 %** | 3 % | **35 %** | **99 %** |
| CN | 823 | **54 %** | **95 %** | **20 %** | **31 %** | **96 %** |
| DE | 777 | **44 %** | **61 %** | 13 % | **41 %** | **98 %** |
| NL | 725 | **45 %** | **62 %** | 6 % | **30 %** | **99 %** |
| AU | 601 | 14 % | **59 %** | 0 % | **21 %** | **100 %** |
| CH | 497 | 17 % | **62 %** | 20 % | **23 %** | **92 %** |

*(gras = au-dessus du seuil d'affichage de 20 %)*

**`contrat` aux États-Unis : 12 %** — sur 53 % du catalogue. Le registre le déclarait à 19,2 %,
donc déjà caché : cohérent, mais c'est la dimension la plus faible du plus gros marché.

---

## 3. Le gisement — dimensions couvertes mais NON filtrables

| dimension | pays ≥ seuil | offres portant la donnée | instruction |
|---|---|---|---|
| **departement** | 33 | **15 347** | valeurs exploitables mais **hétérogènes** : 40 valeurs distinctes aux US, 34 en FR, sans vocabulaire commun |
| **region** (`adminArea1`) | 1 | **12 339** | **US seulement** (CA : 91). 54 valeurs **canoniques et propres** — California, Texas, Florida… |
| seniorite | 59 | 9 640 | **à ne pas rouvrir** — voir §5 |
| experience | 31 | 2 836 | années explicites uniquement, rangs volontairement non convertis |
| teletravail | 15 | 1 121 | **voir la correction ci-dessous** |
| rythme (`workSchedule`) | 5 | 567 | zéro consommateur API, pas même en lecture |
| saisonnier | 5 | 404 | dimension indépendante de la durée |
| salaire | 3 | 215 | sous garde d'intégrité (devise + période exigées) |
| etudes | 1 | 195 | valeur **non canonique** (`WTTJ:bac_5`) — infiltrable en l'état |

### Correction d'une affirmation que j'ai faite

J'avais présenté le **télétravail** comme « le gisement le plus immédiat ». **C'est faux, mesuré :**

```
workplaceType rempli : 2 897 offres sur 34 852
   ONSITE 2 165 · HYBRID 679 · REMOTE 53
```

**53 offres en télétravail.** Le filtre `?lieu=télétravail` ne peut retourner que celles-là. La
capacité existe et reste mal exposée, mais le volume ne justifie pas un lot prioritaire.

---

## 4. Les 144 sources muettes — cause racine

**Elles n'échouent pas à collecter** : 481 lots ont **extrait 88 148 offres**, aucune publiée.
La chaîne a été remontée barrière par barrière.

**Ce qui n'est pas la cause** : la validation (112/144 sont `VALIDATED`), la révision périmée
(10 lots), la source inactive (12 lots), une politique de rétention (`held` = 0, `skipped` = 0).

**Deux causes réelles :**

| # | Cause | Volume | Nature |
|---|---|---|---|
| 1 | **Décision d'accès manquante** — `accessDecisionId IS NULL`, exigé par `sourceRevision.ts:41` | **356 lots sur 481** | opérationnelle |
| 2 | **Revue d'identité employeur** — l'ingestion démarre, tente d'écrire, échoue sur chaque offre | **9 386 offres, 44 sources** | **décision métier** |

Motifs lus dans les 111 rapports de complétion :

```
9386 offres, 44 sources : EmployerIdentityReviewRequired
  12 offres,  1 source  : WORKDAY_EMPLOYER_ABSENT_IN_DETAIL
```

**Ce n'est pas un défaut** : c'est un garde-fou volontaire. Adidas, Penningtons,
Bloomingdale's, Crocs, Galeries Lafayette, Rituals, Rolex, Dolce & Gabbana sont bloquées là.

---

## 5. Le contrat des marchés est calibré sur un corpus disparu

**76 divergences** entre les `couverture` déclarées dans `marches.ts` et le corpus.

La cause est systématique : le registre déclare **13 715 offres là où il y en a 5 419** sur les
marchés divergents — un facteur ~2,5, cohérent avec le reset du 17/09.

Trois formes de divergence :

- **facette affichée sur donnée devenue rare** — AU `contrat` (36 % déclaré, **14 %** réel),
  CH `programme` (26 % → **20 %**) : le candidat obtient des listes vides ;
- **donnée suffisante, aucun libellé déclaré** — CN `contrat` 54 %, `temps` 95 % : la Chine a la
  donnée et n'expose rien ;
- **marchés routables** (SA, RO, PR, PH, LU…) : `contrat` et `temps` souvent au-dessus de 50 %,
  `libelles: {}` par construction.

### Ce qu'il ne faut PAS rouvrir

**`seniorite`** — 59 pays au-dessus du seuil, 9 640 offres. Mais la distribution mesurée confirme
la décision du 15/09 : `SENIOR` 4 544 · `MANAGER` 4 223 · **`MID` 4**. Une échelle où le niveau
intermédiaire compte 4 offres n'est pas une mesure de séniorité, c'est une déduction depuis le
titre. **Le retrait était justifié.**

---

## 6. Lots proposés — ordonnés par rapport valeur/risque

Aucun n'est implémenté. Chacun attend validation.

| Lot | Contenu | Volume | Dépend de | Critère d'acceptation |
|---|---|---|---|---|
| **L8 — Recalibrer le registre** | recalculer les 76 `couverture` depuis le corpus, sans toucher au seuil ni aux libellés | 41 marchés | corpus *(fait)* | plus aucune facette affichée sous le seuil réel ; témoin : AU `contrat` cesse d'être exposé |
| **L9 — Filtre région US** | exposer `adminArea1` en facette sur le marché US | **12 339 offres**, 54 valeurs canoniques | L8 | `facettesDuMarche('US')` rend `region` ; un filtre `?region=California` n'est pas refusé en `FACETTE_NON_SERVIE` ; non-régression hors US/CA (reste vide) |
| **L10 — Débloquer les 44 Maisons** | traiter la revue d'identité employeur | **9 386 offres** | **décision CEO** | `writeFailed` tombe à 0 sur ces sources ; les offres apparaissent au catalogue |
| **L11 — Recollecte avec décision d'accès** | rejouer les 356 lots sans `accessDecisionId` | 356 lots | L10 | les lots portent une décision ; l'ingestion n'échoue plus sur cette condition |
| **L12 — Libellés des marchés riches** | déclarer les libellés CN (`contrat` 54 %, `temps` 95 %) et les marchés routables au-dessus du seuil | ~15 marchés | L8 | chaque marché expose les facettes que sa couverture justifie |
| **L7 — Dimension `programme`** | déclarer les chemins RAW manquants | non mesuré | — | la dimension cesse d'être 100 % `NON_MESURE` |
| **L13 — `departement` : vocabulaire** | instruire l'harmonisation des 40 valeurs US / 34 FR | 15 347 offres | investigation | **pas un lot de filtre** tant que le vocabulaire diverge |

### Ce qui reste hors périmètre

- **L3** (`Non-guaranteed hours` → `TEMPORARY`) : investigation sémantique, aucun mapping automatique.
- **L5** (langue de la table LVMH) : conditionnel à la décision sur la logique sectorielle.
- **`workSchedule`** : zéro consommateur API, 567 offres — capacité à examiner, pas une urgence.

---

## 7. Décision à arbitrer

> 🔷 **La revue d'identité employeur bloque 9 386 offres sur 44 Maisons**
>
> **Contexte** : adidas, Bloomingdale's, Crocs, Galeries Lafayette, Rituals, Rolex,
> Dolce & Gabbana et 37 autres ont collecté et extrait ; le pipeline refuse de publier tant que
> l'identité de l'employeur n'est pas revue. Le garde-fou fonctionne comme prévu.
>
> **Enjeu** : +27 % de catalogue (9 386 sur 34 852), sans aucune nouvelle collecte. Le risque du
> garde-fou est réel : publier une offre sous le mauvais employeur trompe le candidat et engage
> les Maisons.
>
> **Options** — **A** : revue manuelle des 44, par ordre de volume (adidas 1 236, Penningtons
> 1 243, Bloomingdale's 1 019…) · **B** : revue automatisée sur critères, à définir, avec revue
> manuelle des cas ambigus · **C** : statu quo.
>
> **Ce qui m'échappe** : je n'ai pas instruit ce que la revue exige concrètement ni son coût
> unitaire. C'est à mesurer avant de choisir entre A et B.

---

## 8. Limites de ce dossier

| Objet | État |
|---|---|
| Contenu RAW des 144 muettes | **récupérable** (`audit-corps.mts` éprouvé) mais **non analysé** — les corps des 268 765 captures n'ont pas été téléchargés |
| Coût unitaire d'une revue d'identité | **non mesuré** — conditionne l'arbitrage ci-dessus |
| Vocabulaire `departement` | **non instruit** — 40 valeurs US, 34 FR, harmonisation à concevoir |
| Multilocalisation | **non mesurée** |
| Dimension `programme` | **non mesurée** — aucun chemin RAW déclaré |
| Rejeu du lecteur par dimension sur le corpus | **non fait** — les pertes `contrat`/`temps` restent non qualifiées |

**Le dossier n'est pas exhaustif et ne se présente pas comme tel.** Les lots L8 et L9 sont
néanmoins justifiés par des mesures, et proposables dès maintenant.
