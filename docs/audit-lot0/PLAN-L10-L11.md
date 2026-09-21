# L10 / L11 — récupération du catalogue par automatisation

**Mesuré le 2026-09-21** sur le corpus `corpus-2026-09-21T06-07-42` et l'accès d'audit en lecture
seule. Aucune modification applicative. Ce plan attend validation avant implémentation.

---

## 1. Le gisement, correctement compté

| | |
|---|---|
| occurrences d'extraction | 88 148 |
| **annonces distinctes** `[sourceKey, externalId]` | **36 544** (ratio 2,41×) |
| déjà au catalogue (même `externalId` **et** même Maison) | 456 |
| **gain brut** | **36 088** |
| dont vues il y a moins de 2 jours | 36 062 |

**La récence borne la validité, elle ne la démontre pas.** L'état réel d'une annonce (ouverte /
fermée) exige de lire son RAW ou de recollecter — **non fait**.

### Ventilation par cause — la priorité s'inverse

| Cause | Sources | Annonces | Lot |
|---|---|---|---|
| **lots sans décision d'accès** | 92 | **30 612** | **L11** |
| `portalScope` NULL | 27 | 5 231 | L10 |
| `MULTI_BRAND` | 6 | 471 | L10 |
| `SINGLE_BRAND` + Company présente, blocage ailleurs | 11 | 151 | L10 |
| source non `ACTIVE` | 7 | 79 | hors périmètre (exclusion volontaire) |

**L11 porte 84 % du gisement, pas L10.** Mon ordre précédent était faux.

---

## 2. L11 — la décision d'accès n'est pas manquante, elle n'est pas liée

### Cause racine, établie dans le code

`captureSourceForValidation` (`sourceValidation.ts:152`) appelle `captureExtraction` avec
`{ revisionId }` **sans `requireActive`**. Dans `batch.ts:31` :

```ts
const access = expected?.requireActive && sourceRevisionId
  ? await requireSourceAccess(tx, { key: sourceKey, currentRevisionId: sourceRevisionId }) : null;
```

La condition est donc fausse : ni accès ni admission ne sont demandés, et le lot naît avec
`accessDecisionId = NULL`.

**Ce n'est pas un défaut.** C'est le chemin de **qualification** — il vérifie qu'une source sait
collecter, ce n'est pas une collecte destinée à publier. Les 30 612 annonces sont un **effet de
bord de la campagne de qualification des 18-20 septembre**.

### L'autorisation existe déjà

Sur les 143 sources concernées :

| État de la dernière décision d'accès | Sources |
|---|---|
| **`ALLOWED`, révision courante, non expirée** | **108** |
| aucune décision | 29 |
| révision différente | 6 |
| refusée | **0** |
| expirée | **0** |

**Il manque la liaison, pas le droit.** Aucune décision n'est refusée, aucune n'est expirée.

### Ce que L11 fait, et ne fait pas

**Ne fait pas** : rejouer 356 lots, rattacher rétroactivement une décision à une collecte qu'elle
n'a pas gouvernée, modifier une capture immuable, créer une décision fictive.

**Fait** : pour les sources dont la décision d'accès est **déjà valide**, lancer une **collecte
d'ingestion** (`requireActive: true`) au lieu d'une qualification. Le parcours existe et est déjà
ciblable par `INGEST_ONLY_KEYS` (`ingestOrchestrator.ts:85`).

| Population | Volume | Action |
|---|---|---|
| accès valide, `portalScope` renseigné, `ACTIVE` | **43 sources** | collecte d'ingestion — **rien d'autre à faire** |
| accès valide, `portalScope` NULL | **64 sources** | dépend de L10 |
| aucune décision d'accès | 29 sources | revue d'accès préalable (parcours existant) |
| révision différente | 6 sources | renouveler la décision sur la révision courante |

**Dépendance réelle** : L11 sur les **43 sources prêtes** ne dépend **pas** de L10. Les deux lots
sont parallélisables ; seules les 64 sources à `portalScope` NULL attendent L10.

---

## 3. L10 — le scope se mesure, il ne s'arbitre pas

### Ce que le code exige réellement

J'ai d'abord conclu qu'une revue humaine était obligatoire. **C'est faux.**
`certifiedPortalIdentity` (`sourceIdentity.ts:182`) **ne consulte aucune revue** : elle lit trois
champs de `Source` — `currentRevisionId`, `maison`, `portalScope` — et rend `null` si le scope
n'est ni `SINGLE_BRAND` ni `MULTI_BRAND`.

Et la branche qui bloque (`resolve.ts:40`) n'est empruntée **que si l'employeur vient du
registre** (`SOURCE_CATALOGUE_LABEL`) — c'est-à-dire **quand la page native ne nomme aucun
employeur**. Preuve : **145 sources publient avec `portalScope = NULL`**.

**La règle est juste** : attribuer une annonce anonyme au propriétaire du portail exige de
prouver que ce portail ne sert qu'une Maison. Sur un multimarque, ce serait faux.

### Le scope est une donnée factuelle, lisible dans le RAW

Mesuré sur les corps de capture :

| Source | Employeurs distincts dans le RAW | Verdict |
|---|---|---|
| `tapestry` | **9** — Tapestry Inc., Coach Vietnam, Coach Singapore, Tapestry Japan, Coach Korea… | **MULTI_BRAND** |
| `knitwell-us-retail` | 1 — « The Talbots LLC » | **SINGLE_BRAND** |
| `mango` | 1 — « MANGO MNG, S.A. » | **SINGLE_BRAND** |
| `parfums-chanel` | **0** — la page ne nomme personne | certification requise |

Le référentiel concorde : `tapestry.maison` vaut déjà
« Tapestry (Coach, Kate Spade, Stuart Weitzman) ».

### Mesure à l'échelle — 93 sources à `portalScope` NULL

| Verdict depuis le RAW | Sources | Annonces | Suite |
|---|---|---|---|
| **MONO** — un seul employeur nommé | **25** | 4 623 | `SINGLE_BRAND` déductible |
| **MULTI** — plusieurs employeurs | **20** | 8 111 | `MULTI_BRAND` déductible |
| **ANONYME** — la page ne nomme personne | 12 | 4 542 | certification requise |
| **NON LISIBLE** — corps HTML | **36** | **15 589** | **NON MESURÉ** |

**45 sources sur 93 (12 734 annonces) ont un scope déductible automatiquement.**

### Le plus gros bloc n'est pas déductible

Les 36 sources à corps HTML portent **15 589 annonces** — le bloc le plus important. Vérifié sur
trois d'entre elles :

| Source | JSON-LD | `hiringOrganization` |
|---|---|---|
| `boots` | 3 blocs | **présent** (pas dans le premier) |
| `adidas` | 0 bloc | **absent** |
| `pvh` | 1 bloc | **absent** |

**Le scope de ces sources ne se déduit pas par une sonde générique.** Chaque portail expose son
employeur autrement, quand il l'expose. Ces 15 589 annonces restent **NON MESURÉES** — ni
bloquées définitivement, ni récupérables sans instruction par famille d'adaptateur.

### Limites de cette sonde, assumées

- **un échantillon ne prouve pas l'absence** : « aucun employeur vu » ≠ « aucun déclaré » ;
- **les corps HTML ne sont pas analysés** — la sonde est JSON ; 6 sources sur 12 testées
  renvoient du HTML, et restent **NON MESURÉES** ;
- **des raisons sociales voisines** (« Coach Vietnam », « Coach Korea ») peuvent être des
  filiales d'une même Maison : le comptage brut **surestime** la pluralité.

### Règles proposées

| Preuve | Décision | Traçabilité |
|---|---|---|
| le RAW nomme **un seul** employeur, concordant avec `Source.maison` | `SINGLE_BRAND` automatique | règle + empreinte des captures ayant servi |
| le RAW nomme **plusieurs** employeurs distincts | `MULTI_BRAND` automatique — l'employeur est lu **par annonce** | idem |
| le RAW nomme **un seul** employeur, **divergent** de `Source.maison` | **cas isolé**, motif `EMPLOYER_LABEL_MISMATCH` | ne bloque aucune autre source |
| la page ne nomme **personne** | **cas isolé**, motif `PORTAL_OWNER_NOT_CERTIFIED` — le scope ne se déduit pas d'une absence | idem |
| corps non analysable (HTML) | **NON MESURÉ** — ni scope, ni blocage définitif | à instruire par une sonde HTML |

**Jamais une preuve** : un nom de marque ressemblant, un domaine seul, la notoriété de la Maison.
Sur un portail multimarque, l'attribution reste au niveau de l'annonce.

---

## 4. Un défaut de traçabilité à corriger d'abord

`resolve.ts` lève à **six endroits** avec des motifs distincts (`PORTAL_OWNER_NOT_CERTIFIED`,
`CONFLICT:`, `ALIAS_SOURCE_OR_TENANT_CHANGED`, nom de l'employeur précédent…). Le rapport de
complétion ne conserve que **le nom de la classe** :

```json
{"ordinal":0,"externalId":"1274215701","disposition":"WRITE_FAILED","reason":"EmployerIdentityReviewRequired"}
```

**L'information qui permettrait de trier automatisable vs ambigu est perdue à l'écriture.** J'ai
dû la reconstituer depuis l'état des données.

**L10 commence par là** : conserver le motif détaillé dans le rapport. Sans lui, aucune
automatisation ne se pilote et aucun cas ambigu ne se distingue d'une configuration absente.

---

## 5. Le pilote — trois cas représentatifs

Candidats vérifiés sur les données :

| Rôle | Source | Annonces | État |
|---|---|---|---|
| **mono-employeur clair** | `knitwell-us-retail` | 2 000 | accès **valide**, RAW nomme « The Talbots LLC » |
| **multimarque** | `tapestry` | 2 226 | RAW nomme **9** employeurs ; accès à renouveler |
| **réellement ambigu** | `parfums-chanel` | 1 154 | la page **ne nomme personne** ; accès à renouveler |

### Ce que le pilote doit démontrer

Parcours complet : **RAW → extraction → résolution employeur → contrôles de publication →
déduplication → offre canonique → API/recherche**.

| Critère | Comment il se vérifie |
|---|---|
| une annonce prouvée devient publiable **sans validation humaine** | `knitwell` publie ; aucune revue créée |
| une annonce ambiguë **n'est pas attribuée de force** | `parfums-chanel` reste retenue, motif exploitable |
| un multimarque attribue **par annonce**, jamais par portail | `tapestry` : chaque offre porte son employeur natif |
| un **second passage ne crée pas de doublon** | rejeu complet : le nombre d'offres canoniques ne bouge pas |
| les offres existantes **ne régressent pas** | comptage avant/après sur le catalogue publiable |
| **`writeFailed` à zéro ne suffit pas** | vérifier que `held` et `skipped` n'ont pas absorbé les échecs ; `published` doit augmenter |

**Environnement** : base isolée de development, schéma par `prisma migrate deploy`, corpus figé.
Aucune écriture en production.

---

## 6. Ce qui reste non mesuré

| Objet | État |
|---|---|
| Scope des sources à corps HTML | **NON MESURÉ** — sonde JSON seulement |
| Validité réelle des 36 088 annonces (ouverte/fermée) | **NON MESURÉE** — la récence borne, ne démontre pas |
| Doublons inter-sources par contenu | **NON MESURÉS** — 534 `externalId` communs, indice faible |
| Les 11 sources `SINGLE_BRAND` + Company qui bloquent quand même | **NON INSTRUITES** |
| Coût d'une revue d'accès pour les 29 sources sans décision | **NON MESURÉ** |

**Aucun de ces points ne conditionne le pilote**, qui porte sur trois sources instruites.
