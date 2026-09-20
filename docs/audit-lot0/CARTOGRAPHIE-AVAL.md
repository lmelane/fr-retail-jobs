# Cartographie aval — canonisation → support API → filtre exposé

**Établie par lecture de code seule, le 2026-09-20, sur `development`.** Aucune lecture
production : l'accès d'audit n'est pas encore provisionné.

Cette moitié de la chaîne ne dépend d'aucune donnée — elle dit ce que le produit **peut** faire.
La moitié amont (RAW disponible → information exploitable → canonisation correcte) exige le
corpus et sera livrée ensuite. **Les volumes cités ici viennent de constantes du code ou de
commentaires : ce sont des témoignages, pas des mesures.**

---

## 1. Le verrou qui décide de tout

Avant les dimensions, le mécanisme — parce qu'il explique pourquoi une colonne remplie et un SQL
prêt ne suffisent pas.

`facettesDuMarche` (`packages/db/marches.ts:1462`) :

```ts
return DIMENSIONS_FACETTE.filter(
  (dimension) => m.couverture[dimension] >= SEUIL_AFFICHAGE_FACETTE   // 0.2
              && m.libelles[dimension] !== undefined,
);
```

**Deux conditions cumulatives, et la seconde n'est pas redondante.** La Chine a
`contrat: 0,471` et `temps: 0,819` — très au-dessus du seuil — mais `libelles` ne contient que
`metier` : elle n'expose donc qu'une facette. **L'absence de libellé est le mécanisme de refus.**

Puis `planifierRecherche` (`apps/api/lib/search-plan.ts:71`) **refuse** tout filtre dont la clé
n'est pas servie sur le marché courant : `motif: 'FACETTE_NON_SERVIE'`, remonté au candidat dans
`filtresRefuses`.

> **Conséquence directe** : un paramètre non déclaré en facette **n'a aucun effet**, même quand la
> colonne, l'index et le SQL existent. C'est pourquoi les classes (b) et (c) ci-dessous se
> comportent **identiquement** pour le candidat : rien.

---

## 2. Les quinze dimensions

| Dimension | Colonne canonique | Paramètre API | Facette déclarée | Classe |
|---|---|---|---|---|
| **contrat** | `employmentTerm` (indexé) | `?contrat=` / `?employmentTerm=` | FR GB CA DE IT ES NL AU BE (9) | **(a)** |
| **temps** | `workTime` (indexé) | `?temps=` / `?workTime=` | + US CH (11) | **(a)** |
| **programme** | `programType` | `?programme=` / `?programType=` | FR CH BE (3) | **(a)** |
| **langue** | `language` | `?langue=` | les 41 marchés (facette de site) | **(a)** |
| **teletravail** | `workplaceType` | ⚠️ `?lieu=télétravail` **seulement** | **aucun** | **(b)** |
| **saisonnier** | `isSeasonal` | non filtrable (retourné) | aucun | (c) |
| **experience** | `experienceYears` | non filtrable (retourné) | aucun | (c) |
| **seniorite** | `seniority` (indexé) | non filtrable (retourné) | aucun — **retirée par décision** | (c) |
| **salaire** | `salaryMin/Max` + devise + période | non filtrable (retourné sous garde) | aucun | (c) |
| **departement** | `department` (indexé) | non filtrable — **entrée de la classification métier** | aucun | (c) |
| **secteur** (`jobFunction`) | `jobFunction` (indexé) | **plus filtrable du tout** | aucun | (c) |
| **region** | `adminArea1` (indexé) | repli interne de `?lieu=ville` — **jamais retourné** | aucun | (c) |
| **etudes** | `educationLevel` | non filtrable — **valeur non canonique** (`RECRUITEE:bachelor_degree`) | aucun | (c) |
| **nature** | `engagementType` | non filtrable (retourné) | aucun — **exclue par décision** | (c) |
| **rythme** | `workSchedule` | **ZÉRO occurrence dans toute l'API** | aucun | **(c) extrême** |

*Note — la facette `?secteur=` existe bien, mais elle porte sur `Company.sectorCodes`, pas sur
`Job.jobFunction`. Deux notions distinctes qu'il ne faut pas confondre.*

**Aucune dimension de classe (d)** : les quinze ont une colonne canonique.

---

## 3. Le gisement, par ordre d'évidence

### 3.1 `workSchedule` — une chaîne ouverte à l'entrée, fermée à la sortie

**Le cas le plus net, et un défaut au sens du `CLAUDE.md`** (« ce qui entre doit pouvoir sortir »).

- colonne canonique `workSchedule` + `rawSchedule` (`schema.prisma:526,531`) ;
- trois valeurs : `FLEXIBLE_AVAILABILITY` · `EVENINGS_WEEKENDS` · `NIGHT_SHIFT` ;
- un normaliseur complet et documenté (`apps/aggregator/src/normalize/schedule.ts`) ;
- des producteurs dans le pipeline (`publication/content.ts`, `trust/resolve.ts`) ;
- **`grep -rn "workSchedule" apps/api` → 0 occurrence.** Vérifié.

Pas même en lecture : le candidat ne peut ni le filtrer, ni le voir. **Volume : NON MESURÉ**
(l'en-tête de `schedule.ts` cite 54 % des offres US — c'est un commentaire, pas une preuve).

### 3.2 `teletravail` — une capacité complète, atteignable par devinette

Le SQL est strict et branché : `workplaceType = 'REMOTE'` (`job-search-query.ts:145`). Mais le
seul chemin d'accès est `?lieu=télétravail|remote|à distance|home office|full remote|100 % remote`
(`lieu.ts:34`) — **le champ « ville »**.

Aucune facette, aucun comptage, aucune option affichée : `workplaceType` n'est ni dans
`CLES_FACETTE`, ni dans `DIMENSIONS`, ni dans la CTE `base`.

**Un candidat qui cherche du télétravail doit deviner qu'il faut l'écrire dans le champ ville.**
C'est le gisement le plus immédiat : la capacité existe entièrement, seule l'exposition manque.

### 3.3 Les quatre exclusions documentées — à ne pas traiter comme des défauts

| Dimension | Raison écrite | Verdict |
|---|---|---|
| `seniorite` | retirée le 15/09 : déduite à 99,97 % du titre, contredit la source à 80 % | **décision validée**, à ne pas rouvrir sans mesure |
| `nature` | 162 offres sur 83 431 (0,19 %), 2 valeurs distinctes | **ne partitionne rien** |
| `saisonnier` | zéro `false` en base → ne partitionne pas | **conforme** |
| `etudes` | valeur **non canonique**, préfixée par référentiel (`WTTJ:bac_5`) | **infiltrable en l'état** — un lot devrait d'abord canoniser |

### 3.4 Les cinq sans décision écrite

`region` · `departement` · `salaire` · `experience` · `rythme` — **aucune décision ne les exclut**.
Trois ont déjà un index posé (`department`, `adminArea1`, `jobFunction`), donc pas de coût de
schéma. Leur gisement réel est **NON MESURÉ**.

### 3.5 Les 29 marchés routables — zéro facette de dimension, par construction

`marcheEnRepli` (`marches.ts:1344`) construit chaque marché routable avec `libelles: {}` et une
`couverture` à **zéro sur toutes les dimensions**. Les deux conditions du verrou échouent donc
systématiquement.

`JP KR PT MX SG DK HK PL SE CL TR TH MY AE NO TW BR GR ZA VN CZ PE NZ HU SA RO PR PH LU`

Ils n'exposent que les 5 facettes de site (`secteur`, `ville`, `maison`, `groupe`, `langue`).
**Les colonnes sont remplies et le SQL est prêt — seule la MESURE manque pour lever le seuil.**
C'est un gisement distinct : il ne demande aucun développement, seulement des couvertures à jour.

---

## 4. Correction d'un chiffre que j'avais donné

**Le registre compte 41 marchés, pas 43.** Recompté depuis les tables : 12 localisés + 29
routables. AT et IE n'ont pas d'entrée propre — ils sont servis dans les périmètres de DE
(`pays: ['DE','AT']`) et GB (`pays: ['GB','IE']`). Les mentions « trente et un routables » et
« quarante-trois » étaient des résidus de rédaction, corrigés dans `marches.ts`.

## 5. Trois écarts de documentation corrigés

Chacun aurait induit en erreur une lecture future ; le premier m'aurait fait classer `jobFunction`
en (b) si je l'avais cru sur parole.

| Écart | Réalité vérifiée |
|---|---|
| `marches.ts:321` annonçait un paramètre `?fonction=` | **n'existe nulle part** — `parseFilters` ne le lit pas. `jobFunction` n'est plus filtrable du tout |
| `marches.ts:319` citait `facettes-marche.ts:116` | **fichier inexistant** — le mapping vit dans `colonnes-facette.ts` |
| `marches.ts:362` et `:1160` citaient `CORRESPONDANCE_FACETTE` | **symbole inexistant** — renommé `EXPRESSION_FACETTE` |

---

## 6. Ce que cette cartographie ne peut pas trancher

| Question | Pourquoi | Bloque |
|---|---|---|
| Les `couverture` sont-elles encore justes ? | constantes recopiées d'une mesure du 15/09 | une facette peut être exposée à tort, ou cachée à tort, **sans qu'aucun code ne le signale** |
| Le gisement réel de chaque dimension (c) | volumes inconnus | la priorisation des lots |
| `DirectOffer` fausse-t-elle la couverture `metier` ? | `direct-offers.ts` met 5 dimensions à `null` en dur ; `colonnes-facette.ts` la déclare vide au 17/09 | si elle ne l'est plus, **la couverture `metier` de tous les marchés est fausse** |

Les trois exigent le corpus. **Aucun échantillon cité ici n'est une mesure exhaustive.**
