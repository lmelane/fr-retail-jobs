# P6 — le registre des sources admissibles à la reprise

Mesures du 2026-09-12, **production en lecture seule**. Aucune écriture, aucun run, crons gelés, catalogue
inchangé. Registre régénérable : `apps/aggregator/scripts/coverage/p6-register.mts` → `register.json`.

> **Le statut historique `ACTIVE` n'est pas une preuve de fiabilité, et aucune source n'est admise parce qu'elle
> l'est.** La décision se dérive de ce qui est réellement prouvé ; le défaut est conservateur.

## 1. Le périmètre, et son dénominateur

| | Sources |
|---|---:|
| Catalogue complet | **532** |
| **ACTIVE + PAUSED — le périmètre de décision** | **440** |
| RETIRED (documentées, non candidates) | 92 |

**440/440 ont une décision. 440/440 ont une prochaine action.** *(532/532 en comptant les retirées.)*

## 2. Les décisions

| Décision | ACTIVE+PAUSED | Ce qu'elle autorise |
|---|---:|---|
| **A — ADMISE À LA REPRISE** | **50** | collecte **et** publication, dans le périmètre démontré |
| **B — COLLECTE AUTORISÉE, PUBLICATION RETENUE** | **385** | la collecte tourne pour **produire** les preuves ; rien de neuf n'est publié |
| **C — SUSPENDUE** | **5** | aucun traitement jusqu'à la levée du blocage nommé |
| **D — RETIRÉE AVEC PREUVE** | 92 *(hors périmètre)* | sortie administrative, sans fermeture employeur inventée |

**Garde-fous vérifiés, par mesure et non par affirmation :**

| Contrôle | Résultat |
|---|---:|
| Sources admises **par défaut** | **0** |
| Admises **sans certification d'identité** | **0** |
| Admises **sans exhaustivité prouvée** | **0** |
| Admises **sans verdict d'accès ALLOWED** | **0** |

## 3. Les motifs, nommés

### Les 385 en publication retenue

| Motif | Sources |
|---|---:|
| Identité non certifiée sous le contrat strict (aucune revue) | **297** |
| `robots.txt` absent ou injoignable : aucune autorisation lue | **49** |
| Exhaustivité sans trace : la source ne peut pas attester l'absence | **38** |
| Exhaustivité **réfutée** (`UNPARTITIONED_UNDER_CAP` — Tapestry) | **1** |

### Les 5 suspendues

| Source | Offres | Blocage |
|---|---:|---|
| `l-oreal-professionnel` | 1 804 | dernière collecte en **ÉCHEC BROKEN** |
| `dim`, `siebel-juweliers`, `yaya`, `cotton-on` | 98 au total | verdict d'accès `UNKNOWN (no domain)` |

> **Une erreur de ma première passe, corrigée.** J'avais suspendu **49 sources** pour « verdict d'accès non
> établi » alors que leur verdict *est* daté : `robotsVerdict` est un **texte libre**, pas un énuméré, et
> `« ALLOWED (no robots.txt reachable) »` ne se lit pas comme `« ALLOWED »`. C'est la NATURE du verdict qui
> diffère, pas son absence. Reclassé en **B** conformément à D60 — un robots.txt absent n'autorise rien, mais ce
> n'est pas un refus d'accès : cela suspend la publication, pas la collecte de preuves.

## 4. Les familles prioritaires, dans l'ordre du brief

### a. Contradictions d'identité et mauvais tenants — **0 revue périmée**

Aucune source ACTIVE ou PAUSED ne porte de revue d'identité invalidée par un changement de configuration. Les
297 non certifiées n'ont **jamais** eu de revue : c'est une absence de preuve, pas une contradiction. Les
dossiers de contradiction traités en B6 (Ysé, On, La Prairie, UNIQLO, homonymes `loft`/`b2`/`vitamin-a`) restent
résolus.

### b. Forts volumes avec preuves existantes — 38 sources > 500 offres, 59 628 offres

| Source | Offres | ATS | Identité | Exhaustivité | Décision |
|---|---:|---|---|---|---|
| `ulta-jibe` | 10 290 | jibe | certifiée | **aucune trace** | B |
| `lvmh` | 6 078 | lvmh_algolia | certifiée | **aucune trace** | B |
| `foot-locker-france` | 2 859 | phenom | certifiée | **aucune trace** | B |
| `tapestry` | 2 183 | workday | certifiée | **réfutée** | B |
| `pandora-talenthub` | 2 077 | generic-listing | certifiée | **aucune trace** | B |
| `wttj-sector` | 2 002 | wttj-sector | **aucune revue** | aucune trace | B |
| **`knitwell-us-retail`** | **1 997** | workday | certifiée | **PROVEN** | **A** |
| `l-oreal-professionnel` | 1 804 | avature | certifiée | aucune trace | **C** |
| **`mango`** | **1 697** | workday | certifiée | **PROVEN** | **A** |
| **`nordstrom`** | **1 575** | workday | certifiée | **PROVEN** | **A** |

Le motif dominant est **« aucune trace d'énumération »** : l'événement `source.enumeration_observed` n'existe que
depuis le 2026-09-09 et ne couvre que 87 sources. Ces sources ne sont pas défaillantes — **leur preuve n'a pas
encore été produite**, et une ingestion bornée avec le code actuel suffit à la produire.

### c. Portails de groupe et attribution par marque

Les portails de groupe admis portent leur attribution par facette native, déjà prouvée en B6 : `richemont-workday`
(1 433 offres, 33 pays), `richemont` (478, 21 pays), `mango` (1 697, 31 pays, 27 retenues), `urbn-hub` (1 476,
15 pays). Le cas `tapestry` reste **retenu** : ses partitions se recollent, mais 5 offres hors facette sont
inatteignables sous le plafond du site — décision honnête, pas un défaut de configuration.

### d. Vérifications officielles ciblées

**297 sources sans revue d'identité** sont le premier gisement : chacune exige une page officielle archivée
nommant le board configuré. C'est un travail de dossier, source par source, et le registre en donne la liste
nominative avec sa condition de résolution.

### e. Cabinets, jobboards et règles produit

- **FashionJobs** : décision **D**, définitive — *ne peut jamais alimenter une offre, justifier une offre
  publiée, ni permettre l'admission d'une source d'offres*. La découverte de Maisons reste conservée.
- **WTTJ** : reste autorisé comme source d'offres. `wttj-sector` (2 002 offres) est en **B** faute de revue
  d'identité, soumis aux mêmes contrôles que les autres — aucun régime dérogatoire.

## 5. Le sous-ensemble nominatif proposé pour P7

**50 sources · 13 223 offres · 9 familles ATS**

| Famille ATS | Sources | Familles représentées |
|---|---:|---|
| `workday` | 31 | la famille la mieux prouvée (total déclaré + partitions) |
| `successfactors` | 11 | totaux par locale réconciliés |
| `talentsoft` | 2 | total annoncé atteint |
| `icims`, `generic-listing`, `easycruit`, `digitalrecruiters`, `harri`, `talentrecruiter` | 1 chacune | représentativité des protocoles |

**Les dix premières par volume** : `knitwell-us-retail` 1 997 · `mango` 1 697 (31 pays) · `nordstrom` 1 575 ·
`urbn-hub` 1 476 (15 pays) · `richemont-workday` 1 433 (33 pays) · `saks` 835 · `vf-corporation` 578 (20 pays) ·
`richemont` 478 (21 pays) · `deckers` 424 (14 pays) · `uniqlo-us-retail` 347.

| Caractéristique | Valeur |
|---|---|
| **Périmètres** | 1 à 36 pays selon la source ; `beiersdorf` couvre 36 pays, `richemont-workday` 33, `mango` 31 |
| **Statut d'énumération** | **PROVEN pour les 50** — aucune UNKNOWN, aucune REFUTED |
| **Capacité à attester l'absence** | **23 selon l'état persisté · 27 à RECALCULER** |
| **Retenues** | 5 sources en portent : `vf-corporation` 695, `aptar-beauty` 38, `mango` 27, `nordstrom` 3, `knitwell-us-retail` 1 |
| **Fréquence proposée** | **24 h** (D36) ; aucune mesure ne justifie moins (renouvellement < 2 % par run sur ces familles) |

### Risques identifiés, par source

| Risque | Sources | Traitement à la reprise |
|---|---|---|
| **Droit de fermer hérité de l'ancienne règle** | 23 des 50 | **ne pas s'y fier** : l'ingestion P7 le recalcule, et c'est le recalcul qui décide |
| **695 retenues sur `vf-corporation`** | 1 | décision de Loïc appliquée : archivées et tenues, jamais créditées au groupe |
| **Sources à 1–6 offres** (`gu-*`, `uniqlo-*-headquarters`) | 14 | volume faible : la garde d'effondrement y est très sensible, surveiller les faux positifs |
| **`knitwell-us-retail` : 1 erreur de collecte au dernier run** | 1 | PROVEN mais `canAttestAbsence` refusé — comportement correct, à confirmer au recalcul |
| **`mango` : 31 pays, 27 retenues** | 1 | vérifier l'attribution par entité après ingestion (26 entités fusionnées en B6) |

## Tableau final — extrait (les 532 lignes sont dans `register.json`)

| Source | Maison/groupe | ATS | Board | Périmètre | Identité | Collecte | Exhaustivité | Attribution | Publication | Fraîcheur | Décision P6 | Blocage | Prochaine action | Condition de résolution |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `mango` | Mango | workday | tenant Workday | SINGLE_BRAND, 31 pays | **certifiée** | OK | **PROVEN** | 27 retenues | 1 697 offres | dernière obs. fiable datée | **A** | aucun | inclure au sous-ensemble P7 | sans objet |
| `nordstrom` | Nordstrom | workday | tenant Workday | 1 pays | **certifiée** | OK | **PROVEN** | 3 retenues | 1 575 offres | idem | **A** | aucun | idem | sans objet |
| `ulta-jibe` | Ulta Beauty | jibe | tenant Jibe | 1 pays | certifiée | DEGRADED tronquée | **aucune trace** | aucune | 10 290 offres | — | **B** | exhaustivité sans trace | ingestion bornée pour produire la preuve | un run rendant PROVEN |
| `tapestry` | Tapestry | workday | tenant partitionné | 3 marques | certifiée | OK | **REFUTED** | 5 retenues | 2 183 offres | — | **B** | 5 offres hors facette sous plafond | établir le parcours (facette ou plafond) | un run PROVEN |
| `wttj-sector` | multi-Maisons | wttj-sector | facettes WTTJ | secteur | **aucune revue** | OK | aucune trace | aucune | 2 002 offres | — | **B** | identité non certifiée | preuve officielle + revue | revue VERIFIED acceptée par la porte |
| `l-oreal-professionnel` | L'Oréal | avature | portail Avature | 1 pays | certifiée | **ÉCHEC BROKEN** | aucune trace | aucune | 1 804 offres | — | **C** | collecte en échec | diagnostiquer la cause nommée | un run sans erreur |
| `fashionjobs` | — | fashionjobs | — | découverte | — | — | — | — | — | — | **D** | règle produit définitive | aucune sur le circuit des offres | aucune |

## GO / NO-GO pour P7

**GO**, avec le sous-ensemble ci-dessus, **sous réserve de votre accord explicite sur le plan de reprise**.

Les critères de clôture P6 sont satisfaits :

- **440/440** sources du périmètre ont une décision **et** une prochaine action ;
- **0 admission par défaut**, **0 admise sans certification**, **0 admise sans exhaustivité prouvée** ;
- le sous-ensemble P7 est **nommé et justifié**, source par source ;
- les 390 autres restent **retenues ou suspendues avec leur condition de résolution**.

**Ce que P6 ne prétend pas avoir fait** : les 297 sources sans revue d'identité et les 38 sans trace
d'énumération n'ont pas été investiguées une par une — c'est le choix assumé du brief (décision conservatrice
motivée plutôt que 440 recherches manuelles). Leur condition de résolution est nommée et le travail est
énumérable.

**Rappel du prérequis bloquant P7**, inchangé : ingestion complète du sous-ensemble → vérification des
`countryIntegrity`, `complete` et `canAttestAbsence` **recalculés** → refresh seulement ensuite. **Jamais de
refresh seul sur les anciens états persistés** — 23 des 50 admises portent un droit de fermer hérité de
l'ancienne règle.
