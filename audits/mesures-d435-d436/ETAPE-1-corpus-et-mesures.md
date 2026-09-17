# Étape 1 — Fiabiliser les mesures et figer le corpus

**Date** 2026-09-17 · **Branche** `development` · **Commit** `bb00136` · **Révision du manifeste** `5ba53883a4fa`

Périmètre strictement respecté : aucun filtre, aucun seuil, aucune affectation géographique, aucune
règle de canonisation modifiés. Lecture seule sur la production, aucun backfill, aucune migration,
aucun CRON, aucun DNS. Rien sur `main`.

---

## 1. Ce qui était faux, et ce que ça a coûté

Le registre a été corrigé le 15/09 : la facette « métier » agrège `occupationCode`, pas
`jobFunction` — 42 points d'écart. **Les outils de mesure ne l'ont pas été.**

Les deux sondes qui servent à décider quels marchés ouvrir lisaient encore `jobFunction`, et elles
ont servi à qualifier 29 marchés routables.

| Marché | Annoncé (jobFunction) | Réel (occupationCode) | Conséquence |
|---|---|---|---|
| PL | « métier exposable » | **20,2 %** | tout juste au seuil |
| DK | « métier exposable » | **17,6 %** | sous le seuil, facette retirée |
| TH | « métier exposable » | **16,7 %** | sous le seuil, tombe à `ville` seule |
| VN | « métier exposable » | **19,6 %** | sous le seuil, tombe à `ville` seule |
| CL | « métier exposable » | 88,2 % mais 5 valeurs | perd `metier` sur la diversité |

**Le nombre de marchés routables ne change pas** (28 dans ce périmètre) : le critère est « au moins
une facette », et `ville` suffit. La correction change *quelles* facettes, pas *combien* de marchés.

### La cause n'était pas l'erreur, c'était la duplication

Trois fichiers déclaraient chacun leur correspondance dimension → colonne. Corriger l'un ne
corrigeait pas les autres. `packages/db/colonnes-facette.ts` devient la **seule déclaration**, et
les trois outils l'importent.

---

## 2. Trois écarts cherchés, un seul réel

Mesurés en production, pas supposés :

| Écart potentiel | Mesure | Verdict |
|---|---|---|
| Chaîne vide comptée par `count()` mais exclue par la facette | **0** sur les six dimensions | nul aujourd'hui — règle reprise quand même |
| `DirectOffer` absent des sondes (l'API sert une UNION) | table **VIDE**, 0 ligne | nul — hypothèse gravée et gardée par témoin |
| `ville` agrégée sur `lower(trim(city))` | 7 398 → 7 391 distinctes | marginal, sur la diversité seulement |

La règle d'exclusion de la chaîne vide est reprise malgré un écart nul : le jour où une source en
écrit une, la mesure et la facette doivent diverger **par décision, pas par accident**.

---

## 3. Le garde de couverture

**Avant** : il comparait `CODES_MARCHE` (41 marchés) alors que seuls les 12 localisés portent une
mesure. Il rougissait sur 29 écarts attendus — les routables sont gravés à 0 délibérément — qui
noyaient les vrais.

**Après** : il compare `CODES_MARCHE_LOCALISES` et **passe au vert** contre la production.

```
✅ Couverture métier du registre conforme à la base, sur 12 marchés
   (colonne occupationCode, tolérance 3 pts).
```

### Mode `--ci`, sans accès à la production

Le CI dispose d'un Postgres de service **vide**. Le garde ne peut y prouver aucun chiffre — et sa
prémisse le détecte correctement (code 2, « PRÉMISSE ROUGE »).

Le mode `--ci` vérifie ce qui est vérifiable hors données : la requête s'exécute contre le schéma
réel (donc l'expression est valide et les colonnes existent), la population et l'expression sont
celles de la facette, le registre est lisible. **Il dit explicitement qu'aucun chiffre n'a été
comparé.** Un garde qui tairait cette limite ferait croire à une vérification qui n'a pas eu lieu.

> **NON VÉRIFIÉ** — le mode `--ci` n'a **pas** pu être exécuté ici : aucune base Postgres locale
> n'est configurée sur cette machine. Sa logique est typée et lue, son comportement réel sera
> constaté au premier passage du CI. Je ne l'affirme pas vert.

---

## 4. Le corpus de référence

`apps/aggregator/scripts/ops/corpus-reference.mts`

### Critères établis par lecture du code, pas supposés

`publicJobWhere` (`packages/db/availability.ts:13`) exige **trois** conditions, et « offre active »
n'en est qu'une :

1. `Job.isActive`
2. `Job.mergedIntoId IS NULL` — une offre fusionnée redirige, elle ne se sert pas
3. au moins une `JobSource` avec `isActive` **et** non expirée

**Mesuré : les trois rendent le même nombre (83 431).** `isActive` suffit *aujourd'hui*, par
coïncidence et non par construction. Les trois sont appliqués quand même.

### Instantané cohérent

Transaction **unique**, isolation `REPEATABLE READ`. Des requêtes successives sur une base mouvante
ne décrivent pas le même instant — deux totaux issus de deux requêtes ne seraient pas réconciliables.

**Reproductibilité prouvée** : deux exécutions consécutives rendent des manifestes **identiques**
hors horodatage.

### Volumes réconciliés

| Population | Compte |
|---|---|
| Offres éligibles | **83 431** |
| Publications éligibles | **85 327** (1,023 par offre) |
| RAW dérivés distincts | **82 467** |
| Offres avec ≥ 1 RAW | 82 402 |
| Offres sans aucun RAW | **1 029** |
| Références orphelines | **0** |
| Pays observés | 120 · dont **4 888 offres sans pays** |
| Sources distinctes | 486 |

Une offre porte 1..n publications : les deux totaux **ne peuvent pas** être égaux, et exiger qu'ils
le soient serait un faux contrôle. Ce qui est vérifié, c'est que la somme par pays retombe sur le
total — **réconciliation OK**.

---

## 5. Le RAW : ce dont nous disposons réellement

**C'est le résultat qui change l'étape 2.**

| Nature | Compte | Ce que ça permet |
|---|---|---|
| **NATIF** — réponse HTTP d'origine | **0** | rien : `RawCapture`, `RawBlob` et `captureOutputId` sont à zéro |
| **DÉRIVÉ** — `JobSource.raw`, sortie d'adaptateur | **84 173** / 85 327 (98,65 %) | prouve ce que **l'adaptateur a lu** |
| **ABSENT** | 1 154 publications · 1 029 offres | trou compté, jamais reconstitué |
| **INTÉGRITÉ NON VÉRIFIABLE** | 84 173 | aucune empreinte rattachable |

Un RAW dérivé prouve ce que **l'adaptateur a lu**, jamais ce que **la source a envoyé**. Confondre
les deux ferait passer une extraction pour une provenance — exactement l'erreur que l'étape 1 existe
pour éviter.

Les 1 029 offres sans RAW sont concentrées : `l-oreal-professionnel` 862, `hermes` 72,
`wttj-sector` 53, `kering` 47, `urbn-hub` 37, `lvmh` 16.

Aucun RAW n'a été reconstitué, aucune source relancée.

---

## 6. Mesures de référence (extrait)

Sur l'instantané, `countryCode` **enregistré** — valeur observée, non validée.

| Pays | Offres | Pays prouvé | Métier | Contrat | Temps | Programme |
|---|---:|---:|---:|---:|---:|---:|
| US | 36 942 | 29 % | 53,9 % | 19,2 % | 81,8 % | 0,3 % |
| FR | 11 026 | 21 % | 48,8 % | 69,2 % | 64,3 % | 22,2 % |
| **(sans pays)** | **4 888** | 0 % | 47,5 % | 13,8 % | 29,5 % | 6,3 % |
| GB | 3 305 | 30 % | 41,2 % | 38,9 % | 64,6 % | 0,6 % |
| DE | 3 080 | 13 % | 49,5 % | 32,5 % | 74,9 % | 8,0 % |
| CH | 1 220 | 23 % | 25,7 % | 17,2 % | 49,1 % | 26,3 % |

Le manifeste complet porte les 120 pays et les 486 sources.

**Une valeur normalisée renseignée ne prouve ni sa justesse ni son origine dans le RAW.** Cette
étape mesure l'existant ; elle ne certifie pas la qualité sémantique des filtres.

---

## 7. Fichiers modifiés

| Fichier | Nature |
|---|---|
| `packages/db/colonnes-facette.ts` | **créé** — la déclaration unique |
| `packages/db/package.json` | export du nouveau module |
| `apps/aggregator/scripts/ops/corpus-reference.mts` | **créé** — instantané rejouable |
| `apps/aggregator/src/normalize/__tests__/colonnes-facette.test.ts` | **créé** — 8 témoins |
| `apps/aggregator/scripts/ops/verif-couverture-registre.mts` | population corrigée, mode `--ci`, lit la primitive |
| `audits/mesures-d435-d436/qualification-marche-2026-09-17.mjs` | lit la primitive ; `seniorite` retirée ; dimensions non servies marquées `·` |
| `audits/mesures-d435-d436/marches-routables-2026-09-17.mts` | lit la primitive ; requête réécrite pour accepter une expression |
| `.github/workflows/ci.yml` | garde de couverture ajouté |
| `.gitignore` | `.corpus/` exclu — sortie de manifeste, jamais dans Git |

### Legacy supprimé dans ce périmètre

- `seniorite` retirée des deux sondes : la dimension a quitté les facettes le 15/09 (99,97 % déduite
  par regex). La mesurer décrivait une facette qui n'existe plus.
- Les correspondances dimension → colonne dupliquées dans trois fichiers : remplacées par l'import.
- L'ancienne requête de `marches-routables` interpolait `"${colonne}"` avec préfixe `j2.` — deux
  hypothèses qui tombent dès qu'une dimension est une expression (`lower(trim(city))`).

---

## 8. Contrôles exécutés

| Contrôle | Résultat |
|---|---|
| `npm run typecheck -w @catwalks/aggregator` (application + scripts) | **0** |
| `npx tsc --noEmit -p apps/api` | **0** |
| `npm run test:unit -w @catwalks/aggregator` | **2 758 passés**, 9 ignorés, 172 fichiers |
| Garde de couverture contre la production | **vert**, 12 marchés |
| Manifeste, deux exécutions | **identiques** hors horodatage |
| Contre-épreuve du témoin | **rouge** en réintroduisant `jobFunction`, avec fichier et ligne |

### Contre-épreuve

```
AssertionError: marches-routables-2026-09-17.mts mesure « jobFunction » comme une
dimension de facette :   metier: '"jobFunction"'
```

Le témoin ne peut pas passer au vert sur le défaut qu'il garde.

---

## 9. Limitations, dites explicitement

- **Le mode `--ci` n'a pas été exécuté** — aucune base locale sur cette machine. NON VÉRIFIÉ.
- **Aucun RAW natif n'existe** : l'étape 2 ne pourra pas prouver ce que la source a envoyé, seulement
  ce que l'adaptateur a lu. C'est une limite de la donnée, pas de la méthode.
- **`raw_distincts` est compté par lots de 10 000**, pas en une passe : `count(DISTINCT md5(raw::text))`
  sur 694 Mo fait échouer le serveur (code `53100`, mémoire partagée). Le chiffre est le même.
- **Le manifeste n'est pas versionné** (`.corpus/` exclu) : il porte la répartition par employeur de
  tout le catalogue. Le **script** est versionné — c'est lui qui permet de le rejouer.
- **L'intégrité du RAW dérivé n'est pas vérifiable** : `captureOutputId` absent partout.

---

## 10. Comment rejouer

```bash
# Le corpus de référence (lecture seule, transaction cohérente)
python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
  apps/aggregator/scripts/ops/corpus-reference.mts .corpus

# Le garde de couverture, contre la production
python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
  apps/aggregator/scripts/ops/verif-couverture-registre.mts

# Les sondes corrigées
python3 apps/aggregator/scripts/ops/db.py readonly node \
  audits/mesures-d435-d436/qualification-marche-2026-09-17.mjs US FR PL DK
python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
  audits/mesures-d435-d436/marches-routables-2026-09-17.mts 50

# Les témoins
npx vitest run apps/aggregator/src/normalize/__tests__/colonnes-facette.test.ts
```

---

## Verdict

**ÉTAPE 1 VALIDABLE**, avec une limitation nommée.

Vos trois critères :

- **Mêmes outils, même instantané, mêmes chiffres** — prouvé par deux exécutions consécutives
  rendant des manifestes identiques.
- **Sondes alignées sur les facettes réellement servies** — prouvé par l'exécution (53,9 % US sur
  les trois outils) et gardé par un témoin dont la contre-épreuve est rouge.
- **Aucune population dissuadée** — les 4 888 offres sans pays, les 1 029 sans RAW et les 120 pays
  observés sont comptés séparément et réconciliés.

La limitation : le mode `--ci` du garde **n'a pas pu être exécuté** faute de base locale. Son
comportement sera constaté au premier passage du CI. Si vous préférez que ce point soit prouvé
avant validation, je peux monter une base de test locale — c'est un travail à part.

**Je ne passe pas à l'étape 2 sans votre GO.**
