# LOT 0 — restitution consolidée

**Date : 2026-09-20. Accès production : SUSPENDU** (aucune lecture depuis la consigne).
Ce document est le **seul livrable de référence** du LOT 0. Les sorties CSV et leur statut sont
décrits dans [LOT0-REGISTRE-DES-SORTIES.md](LOT0-REGISTRE-DES-SORTIES.md).

Statuts employés, à distinguer partout : **CONFIRMÉ** (prouvé par lecture de code ou exécution) ·
**À INSTRUIRE** (hypothèse étayée, non tranchée) · **NON MESURÉ** (nommé et chiffré comme tel).

---

## 1. Ce qui invalide l'audit précédent

### 1.1 La protection en lecture seule n'existait pas — CONFIRMÉ

`db.py readonly` pose `PGOPTIONS`, lu par `libpq` (donc `psql`) et **jamais par le moteur Rust de
Prisma**. Les 143 scripts d'audit passent par Prisma. Mesuré : `CREATE TEMP TABLE` a **réussi** en
production.

Trois couches de défaut, chacune vérifiée :

| # | Défaut | Preuve |
|---|---|---|
| 1 | `PGOPTIONS` ignoré par Prisma | `CREATE TEMP TABLE` réussi sous `db.py readonly` |
| 2 | Le correctif par `SET` de session ne tient pas sur le POOL | 8 requêtes concurrentes → **1** connexion verrouillée, **7** ouvertes en écriture |
| 3 | `default_transaction_read_only` n'est **pas un privilège** | réglage par défaut, modifiable par la session ; et le rôle est `postgres`, **superutilisateur**, qu'aucun GRANT ne contraint |

**Correction de ma restitution antérieure.** J'ai écrit « aucune écriture n'a eu lieu » : c'est
faux. **Des `CREATE TEMP TABLE` ont réussi en production**, produits par mes propres scripts de
vérification. Ce que je peux affirmer, et seulement cela : je n'ai pas constaté de modification de
données métier, mes scripts de mesure n'émettant que des `SELECT`. **Je n'ai aucune preuve
indépendante au-delà de ces scripts.**

**État du correctif** : plus aucune tentative d'écriture au démarrage ; contrôle par **lecture** du
catalogue (identité, `rolsuper`, `has_table_privilege`, `default_transaction_read_only`,
`statement_timeout`) ; toute exception d'inspection **bloque** au lieu d'autoriser ;
`urlVerrouillee()` lève sur une valeur contradictoire au lieu de valider sur la présence du nom.
Un témoin a attrapé au passage un défaut d'encodage (`URLSearchParams` produit `+`, que PostgreSQL
ne retraduit pas dans `options`) qui rendait l'URL potentiellement invalide.

**BLOQUANT** : il n'existe **aucun accès d'audit** aux droits limités. Voir décision D-1.

### 1.2 La population mesurée n'est pas le catalogue exposé — CONFIRMÉ

Les mesures portent sur `Job.isActive = true` (34 883). C'est une **population parfaitement
définie et légitime** — offres actives au sens du modèle — et son comptage n'est pas erroné.

Mais ce n'est **pas** le catalogue exposé au candidat. Le prédicat du produit est
`publicJobWhere()` — `packages/db/availability.ts:13` :

```ts
{ isActive: true, mergedIntoId: null, sources: { some: availableSourceWhere(at) } }
```

Il exige en plus `mergedIntoId IS NULL` **et** une publication `JobSource` active non expirée.
`isActive` est donc un **sur-ensemble** du catalogue publiable.

**Conséquence : un taux calculé sur `isActive` ne doit pas être présenté comme un taux du
catalogue exposé.** L'écart entre les deux populations est **NON MESURÉ** (accès suspendu) : il
peut être nul comme important, rien ne permet de le préjuger.

### 1.3 `externalId` n'est jamais unique seul — CONFIRMÉ

Toujours unique par paire : `@@unique([sourceKey, externalId])` sur `JobSource`
(`schema.prisma:418`) et `RawCapture` (`:997`), `@@unique([sourceKey, externalId, observationHash])`
(`:371`). Tout comptage d'`externalId` distincts **sans** `sourceKey` confond des offres de sources
différentes.

**Le ratio « 242 775 captures vs 72 907 externalId distincts = 3,33× » est RETIRÉ** : calculé sans
ce contexte, il ne mesure rien. À recompter par paire.

### 1.4 Le lecteur jugeait par chemin, la production juge par dimension — CONFIRMÉ

`apps/aggregator/src/normalize/employment-paths.json` déclare **une seule liste de chemins**
(`tags1`…`tags6`, `contract`, `schedule`, `typeOfEmployment.label`…) lue pour **toutes** les
dimensions d'emploi ; chaque valeur est ensuite décomposée par `readEmployment` +
`decomposeCompositeCode`, qui rendent un objet **multi-dimensions**.

Mon lecteur assignait un chemin à **une** dimension et ne lisait jamais *ce que dit* la valeur
(`lot0-lecteurs.ts:123-135`, `:157-160`). **Il mesurait un produit plus pauvre que celui qui
tourne.**

---

## 2. Requalification des pertes

### 2.1 Faux positifs confirmés

| Cas | Offres classées « perte » | Verdict | Preuve |
|---|---|---|---|
| **Région hors US/CA** | ~8 000 | **FAUX POSITIF** | `geography.ts:284-287` : `SUBDIVISIONS = {US, CA}` seulement. `null` ailleurs est une **règle validée du 2026-09-08**, imposée après un backfill ayant produit 702 lignes fausses (`geography.ts:308-322`) |
| **Expérience (rang → années)** | 2 088 | **FAUX POSITIF** | `experience.ts:34-47` : abstention explicite — « la source dit un RANG → on ne l'écrit PAS ». SmartRecruiters ne lit jamais `experienceLevel` (0 occurrence) ; Recruitee non plus (`recruitee.ts:18-22`) |
| **Secteur LVMH → `jobFunction`** | 6 141 | **FAUX POSITIF** | `Job.jobFunction` a **5 sites d'écriture**, tous alimentés par `classifyOccupationContent` ; `classifyJob` ne reçoit que `title`/`department`/`description` (`taxonomy.ts:49-55`). `businessGroup` meurt dans `NormalizedJob.group` (`lvmhAlgolia.ts:172`) |
| **Région : chemins RAW erronés** | inclus ci-dessus | **FAUX POSITIF** | Workday : le chemin déclaré porte **un pays** (`workday.ts:520`). LVMH `countryRegion` = `"United States"`, `geographicArea` = `"America"` — macro-région **explicitement bannie** par `schema.prisma:478-481` |

**Attention à la lecture de ces nombres.** Chaque ligne compte des **couples (offre, dimension)**,
pas des offres uniques : une même offre peut figurer dans plusieurs lignes. Les additionner ne
produit **pas** un nombre d'offres. Le volume d'offres distinctes concernées n'est **pas mesuré**.

Dans ces quatre cas, **le produit fait ce qu'il doit**, et plusieurs de ces refus sont des
décisions validées et documentées.

**Nature de ces requalifications, à distinguer** :

| Cas | Classe |
|---|---|
| Région hors US/CA | **limitation volontaire du modèle** — conforme au comportement prévu, mais pertinente pour une cible mondiale (voir §6bis) |
| Expérience (rang) | **information RAW utile non exploitée** — le rang existe dans `raw`, il n'est pas canonisé (décision D-3) |
| Secteur LVMH | **conformité** — le signal est traité au bon niveau (`Company.sectorCodes`) |
| Région : chemins erronés | **erreur de l'audit**, pas du produit |

### 2.2 Constat étayé, conservé séparément

**`workingMode` LVMH → `Job.workplaceType`** : le champ nomme bien un mode de travail et la
colonne l'attend — **établi par lecture de code**. Ce constat ne relève d'aucun des quatre faux
positifs.

**Chiffrage : RETIRÉ.** Les nombres cités antérieurement (3 977 / 6 141) proviennent d'une sortie
**périmée**, calculée sur la population `isActive` avec l'ancien lecteur par chemin. Ils ne sont
pas réconciliés et ne doivent pas être repris. Voir le lot **L6**, qui sépare explicitement la
preuve locale du chiffrage sur le catalogue publiable.

### 2.3 Périmètre de perte réelle restant — À INSTRUIRE

**Région US/CA uniquement** : 4 494 offres US + 574 CA en perte. Là, le pays a une table, la
subdivision est attendue, la colonne est vide. **NON MESURÉ** : combien portent un token réellement
résoluble par `resolveSubdivision` (`geography.ts:323-329`). C'est **le seul chiffre qui décide**
s'il y a un lot.

**Contrat / temps, toutes sources** : les pertes affichées doivent être rejouées avec le lecteur
par dimension. **Aucune ne doit être citée comme établie** avant ce rejeu.

---

## 3. Défauts produits réels découverts pendant la requalification

Tous **CONFIRMÉS**, aucun n'était visible dans l'audit initial.

| # | Défaut | Preuve | Impact mesuré |
|---|---|---|---|
| D-A | **`"PT Temp/Seasonal"` perd le temps partiel.** Le décodeur rend `FIXED_TERM` + `isSeasonal` mais **pas** `PART_TIME` : l'abréviation `PT` n'est attrapée par aucun motif, alors que `Part Time` l'est | **exécution** : `readEmployment('PT')` → `{}` | 89 offres Lever (+ 18 `FT Temp/Seasonal`) |
| D-B | **`"Non-guaranteed hours"` n'est décodé par rien**, alors que `"Zero hour"` l'est (`TEMPORARY`) — mêmes contrats | **exécution** : `readEmployment('Non-guaranteed hours')` → `{}` ; valeur réelle en fixture `l2-lvmh-hit.json:13` | 667 offres (US 523, CA 139, AU 5) — **à recompter** |
| D-C | **Le comptage gravé en commentaire est un artefact de sa méthode.** `employment.ts:160-175` conclut « zéro heure = 0 offres, la branche décrit une intention, pas un gisement » — mais il a cherché **les mots que le motif reconnaît déjà**, donc il ne pouvait pas trouver `"Non-guaranteed hours"` | fixture Sephora, poste saisonnier 0–14 h/semaine | invalide la conclusion « `TEMPORARY` à 96 % intérim français » |
| D-D | **Table LVMH clée en français, index interrogé en anglais.** `LVMH_BUSINESS_GROUP_SECTORS` = `'Distribution Sélective'` (`sector.ts:73-78`) ; `INDEX = 'PRD-en-us'` (`lvmhAlgolia.ts:34`) rend `"Selective Distribution"` | fixture `:27` | la table ne peut matcher aucun hit |
| D-E | **Chemin dormant sans témoin.** `classifySector` a une branche `businessGroup` (`sector.ts:197-200`) ; **aucun** des 3 appelants ne la nourrit, **aucun** test ne la couvre — elle pourrait être supprimée sans rougir | `ingest.ts:364`, `upsert.ts:157-165`, `owners.ts:46` | exclusion documentée « Vins & Spiritueux hors périmètre » **jamais appliquée** |
| D-F | **`programme` est une colonne d'ignorance.** Déclarée dimension mesurée (`lot0-v2-chaine.mts:26`), **zéro chemin** déclaré : 34 883 `NON_MESURE` sur 34 883 | `grep -c "programme" lot0-v2-chemins.ts` → 0 | lire son « 0 canonisé » comme un défaut serait une erreur |
| D-G | **Abstention non gardée.** La règle « un rang n'est pas une durée » est correcte et appliquée, mais **aucun témoin** ne la garde pour Recruitee — un rapport citait `recruitee.test.ts:28`, **ce test n'existe pas** | fichier lu | risque de régression silencieuse |

---

## 4. Matrice Pays × Dimensions — niveau de validation

**Aucune cellule n'est validée au niveau « catalogue exposé »**, puisque le dénominateur
(§1.2) n'est pas réconcilié. Le tableau ci-dessous donne le **niveau de confiance de la mesure**,
pas un taux de couverture.

| Dimension | Mesure actuelle | Niveau | Ce qui bloque |
|---|---|---|---|
| `teletravail` | partielle | **À INSTRUIRE** | constat LVMH `workingMode` étayé ; à rejouer par dimension |
| `contrat` | **invalide** | **À REJOUER** | lecteur par chemin ; champs mixtes |
| `temps` | **invalide** | **À REJOUER** | idem + défaut D-A |
| `programme` | **inexistante** | **NON MESURÉ** | D-F : aucun chemin déclaré |
| `experience` | requalifiée | **CONFIRMÉ faux positif** | — |
| `salaire` | partielle | **À INSTRUIRE** | sentinelles `0` validées, reste non rejoué |
| `departement` | contestée | **À INSTRUIRE** | même nature de soupçon que `region` |
| `secteur` | requalifiée | **CONFIRMÉ faux positif** | porté au niveau Maison (`Company.sectorCodes`) |
| `region` | requalifiée | **CONFIRMÉ faux positif hors US/CA** | reste US/CA : NON MESURÉ |
| `langue` | non instruite | **NON MESURÉ** | — |

**Pays** : **84 codes pays** distincts, **plus** une catégorie de diagnostic `INCONNU` (589 offres
sans `countryCode`). `INCONNU` **n'est pas un pays** et ne doit jamais être compté comme tel : les
totaux « 85 » cités antérieurement additionnaient 84 codes et 1 catégorie. 42 codes pays sont hors
registre. **Multilocalisation : NON MESURÉ**, et elle fait partie du périmètre de la mission.
## 5. Décisions à arbitrer

### 🔷 D-1 — Créer un accès d'audit en lecture seule (BLOQUANT)

**Contexte** : le seul accès production est `postgres`, superutilisateur ; 143 scripts d'audit
l'utilisent ; `CREATE TEMP TABLE` a réussi en production.
**Enjeu** : sans rôle aux droits limités, aucune mesure ne peut être déclarée incapable d'écrire,
et l'audit reste suspendu.
**Options** — **A** *(recommandé)* : créer `catwalks_audit`, `GRANT SELECT` seul, `ALTER ROLE … SET
default_transaction_read_only = on`. Réversible, ~10 min, **intervention autorisée requise** (je ne
crée ni ne modifie aucun rôle). · **B** : rester sur `postgres` en actant par écrit que la
protection est une discipline, pas une garantie. · **C** : auditer sur une copie restaurée.
**Impact si non tranché** : le LOT 0 ne peut pas se terminer — §1.2, §2.3 et toute la matrice
exigent des lectures.

### 🔷 D-2 — `programme` : déclarer les chemins ou retirer la dimension

**Contexte** : 0 chemin sur 16 sources, 34 883 `NON_MESURE`.
**Options** — **A** *(recommandé)* : déclarer les chemins manquants, par source. Le vocabulaire
canonique existe déjà (`programType` a ses motifs : `INTERNSHIP`, `APPRENTICESHIP`, `VIE`,
`GRADUATE_PROGRAM`) et le signal est présent dans les RAW (`Internship`, `Stage`, `Alternance`,
`V.I.E`). · **B** : laisser la dimension non mesurée et l'afficher comme telle.
**La dimension reste dans le périmètre : elle n'est pas retirée pour contourner l'absence de
lecteur.** Seul l'affichage trompeur d'un « 0 canonisé » est à corriger — c'est fait (le script
annonce désormais les dimensions sans chemin).

### 🔷 D-3 — Rangs de séniorité : brancher `Job.seniority` ?

**Contexte** : `Job.seniority` existe (`schema.prisma:602-605`, 9 valeurs) mais n'est alimenté que
par le titre. Les rangs sources (`mid_senior_level`…) sont volontairement ignorés.
**Enjeu** : 2 088 offres portent un rang exploitable pour un filtre candidat.
**Classe** : *question métier à arbitrer* — **pas** un défaut du code.

### 🔷 D-4 — Chemin dormant `classifySector` / `businessGroup`

**Options** — **A** : brancher **et** corriger la langue (D-D). · **B** : supprimer la branche et
son commentaire. **Reco** : mesurer d'abord combien de Maisons LVMH sont à `sector = OTHER`
(**NON MESURÉ**) avant de trancher.

---

## 6. Lots ordonnés

### Lots de correction — défauts DÉMONTRÉS, prêts à ouvrir

| Lot | Statut | Contenu | Dépend de | Critère d'acceptation |
|---|---|---|---|---|
| **L2 — Abréviations `PT`/`FT`** | ✅ **LIVRÉ** (development) | reconnaissance bornée aux codes composites | aucune | 10 témoins ; 1 093 témoins `normalize` sans régression |
| **L4 — Témoins d'abstention expérience** | ✅ **LIVRÉ** (development) | grave « rang ≠ durée », SmartRecruiters + Recruitee | aucune | 8 témoins ; **preuve négative faite** : défaut réinjecté → 2 rouges |
| **L1 — Accès d'audit** | **à provisionner** | créer le rôle limité ; rebrancher `db.py` ; retirer la cible `readonly` trompeuse | **D-1** | un témoin sur base de test isolée prouve le refus **par privilège** ; `inspecterAcces` rend `ecritureImpossible: true` |
| **L6 — `workingMode` LVMH** | **proposé** | qualification des valeurs, mapping, tests, rejeu, mesure d'impact | L1, I3 | voir encadré ci-dessous |
| **L7 — Dimension `programme`** | **proposé** | déclarer les chemins RAW manquants (le vocabulaire `programType` existe déjà) | D-2 | la dimension cesse d'être 100 % `NON_MESURE` ; témoins par source |
| **L5 — Langue de la table LVMH** | **conditionnel** | aligner les clés sur l'index `en-us`, ou traduire à l'entrée | **D-4** — dépend du chemin sectoriel voulu | témoin : `"Selective Distribution"` → `RETAIL` |

**L2 et L4 sont livrés en development, testés, non déployés.**

#### L6 — `workingMode` LVMH (constat étayé, chiffrage à faire)

Le seul constat de perte qui ait survécu à la requalification, et il doit distinguer deux niveaux :

| Niveau | État |
|---|---|
| **Preuve locale** | le champ `workingMode` nomme bien un mode de travail, `Job.workplaceType` l'attend — **établi par lecture de code** |
| **Chiffrage sur le catalogue publiable** | **NON MESURÉ** — les nombres cités antérieurement (3 977 / 6 141) viennent d'une sortie **périmée**, sur une population `isActive`, avec l'ancien lecteur. **Retirés.** |

Étapes : (1) qualifier les valeurs réelles de `workingMode` par marché ; (2) proposer le mapping
vers `workplaceType` ; (3) témoins par valeur ; (4) rejeu avec le lecteur par dimension ;
(5) mesure d'impact sur le catalogue **publiable**, pas sur `isActive`.

### Investigations — à mener AVANT tout lot, sans devenir des migrations

| # | Question | Méthode | Pourquoi ce n'est pas un lot |
|---|---|---|---|
| **I0 — L3, ex-lot** | **Que signifie `"Non-guaranteed hours"` ?** Le décodeur ne la reconnaît pas : **établi**. Sa conversion en `TEMPORARY` n'est **pas** établie — et elle est refusée en l'état | documenter le sens du champ **par source et par marché** ; distinguer **garantie d'heures** · **volume horaire** · **durée du contrat** · **saisonnalité** — quatre notions que le modèle sépare déjà | mapper sans avoir qualifié le sens reviendrait à **inventer une durée**, exactement le défaut que `experience.ts` interdit. **Aucune modification de mapping avant cette investigation.** |
| **I1** | Écart `isActive` vs `publicJobWhere()` | comptage des deux prédicats | tant qu'il est inconnu, aucun taux n'est citable comme taux du catalogue exposé |
| **I2** | Sur 5 068 offres US/CA sans `adminArea1`, combien portent un token résoluble ? | rejouer `resolveSubdivision` sur le RAW | **décide s'il y a un lot** ; sinon il n'y a rien à corriger |
| **I3** | Rejeu complet avec le lecteur par dimension | `lot0-lecteur-dimension.ts` | les pertes `contrat`/`temps` sont aujourd'hui **non qualifiées** |
| **I4** | Volume réel de `"Non-guaranteed hours"` | comptage par paire `[sourceKey, externalId]` | le 667 vient d'un CSV daté |
| **I5** | Maisons LVMH à `sector = OTHER` | comptage | conditionne D-4 |
| **I6** | Contenu RAW des 144 sources à zéro publication | analyse de contenu, pas mots-clés | **NON MESURÉ** |
| **I7** | Multilocalisation sur les 84 codes pays, GB/IE et DE/AT traités séparément | cartographie complète | **NON MESURÉ**, dans le périmètre de la mission |

**Aucune hypothèse non résolue ne devient une migration de schéma.** Aucun changement de modèle de
données n'est justifié par ce dossier en l'état : les quatre cas examinés ont tous conclu que le
modèle actuel était correct et que c'est la **mesure** qui était fausse.

---

## 6bis. Capacités supplémentaires à développer par marché

Une limitation volontaire du modèle n'est pas un bug — mais elle reste un **écart à la cible
mondiale**, et c'est à ce titre qu'elle figure ici.

| Capacité | État actuel | Portée | Classe |
|---|---|---|---|
| **Subdivisions hors US/CA** | `SUBDIVISIONS = {US, CA}` ; `null` partout ailleurs par règle validée du 2026-09-08 | tous les marchés hors Amérique du Nord — FR, IT, GB, CN, JP… | **capacité à développer** : il faut des tables de subdivisions par pays, et la règle d'invariant (« une subdivision n'existe que sous son pays ») est déjà écrite pour les accueillir |
| **Rangs de séniorité** | ignorés ; `Job.seniority` existe mais n'est alimenté que par le titre | SmartRecruiters, Recruitee — tous marchés | **information RAW utile non exploitée** (D-3) |
| **Dimension `programme`** | aucun chemin déclaré | tous marchés | **mesure à compléter** (L7) — le vocabulaire canonique existe déjà |
| **Vocabulaire chinois** (`店铺职位`, `实习职位`, `办公室职位`) | non couvert par les motifs ; rangé à tort en « contrat » dans des mesures antérieures | marché CN | **capacité à développer** — volume à recompter |

Aucune de ces capacités n'est un défaut du code actuel. Toutes sont pertinentes pour une cible
mondiale, et aucune n'est arbitrée à ce jour.

---

---

## 7. Ce qui reste non mesuré, nommé et chiffré

| Objet | Volume | Statut |
|---|---|---|
| Écart `isActive` → catalogue exposé | 34 883 offres concernées | **NON MESURÉ** |
| Offres US/CA sans subdivision | 5 068 | **NON MESURÉ** (résolubilité) |
| Sources à zéro publication | 144 sources, 84 682 captures, 5,8 Go | **NON MESURÉ** (contenu) |
| Multilocalisation | 84 codes pays | **NON MESURÉ** |
| Offres sans `countryCode` | 589 (dont 540 avec libellé de lieu) | **NON MESURÉ** (résolubilité) |
| Granularité `CaptureOutcome.extractedCount` | — | **NON MESURÉ** ; ratio 3,33× retiré |
| Pertes `contrat` / `temps` | toutes sources | **NON QUALIFIÉES** |

**Le dossier n'est pas exhaustif** : son périmètre ne l'est pas. Les lots L2 et L4 sont néanmoins
justifiés et proposables dès maintenant.
