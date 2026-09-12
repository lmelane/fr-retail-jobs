# P7 — les preuves techniques, bloc par bloc

> Document de travail du LOT P7. Chaque affirmation renvoie à une mesure ou à un test exécuté, jamais à une
> relecture de code. Les chiffres sont datés du 2026-09-12.

## Ce qu'une absence exige, et pourquoi ces exigences existent

Fermer une offre revient à dire à un candidat qu'un poste n'existe plus. La chaîne P7 refuse donc de le faire
tant que quatre choses ne sont pas démontrées **ensemble** :

1. la source a **parcouru** tout son board (terminaison probante, P4) ;
2. la preuve archive les identifiants **canoniques** — ceux que la base stocke, pas une autre unité ;
3. la preuve appartient au **même cycle** que le run jugé (`runId`) ;
4. l'identifiant historique ne figure **pas** dans cet ensemble, et n'a **aucune** autre disposition.

Chacune a été ajoutée après un défaut mesuré. Aucune n'est théorique.

---

## Bloc 1 — l'absence ne se déduit pas d'un `lastSeenAt` ancien

**Le défaut.** La première prévisualisation posait `presentInLastCollectedSet = false` dès que
`lastSeenAt < cutoff`. C'est une preuve de **non-ré-attestation**, pas de disparition : une offre peut n'avoir
pas été ré-écrite tout en étant parfaitement présente dans le balayage.

**Le correctif.** L'ensemble observé est **lu** dans `pageEvidence[].canonicalIds`, corrélé au run par `runId`.
Cinq états explicites, **un seul** autorise une désactivation :

| État | Mutation |
|---|---|
| `PRESENT_AND_REATTESTED` | aucune |
| `PRESENT_BUT_HELD` | aucune |
| `PRESENT_BUT_WRITE_FAILED` | aucune |
| `PRESENT_BUT_REJECTED` | aucune |
| **`ABSENT_FROM_PROVEN_ENUMERATION`** | **désactivation** |
| `UNVERIFIABLE` | aucune |

**Effet mesuré d'un second défaut du même module** : la survie d'une offre était jugée sur la *fraîcheur* des
autres sources au lieu du plan. Une source active hors périmètre n'étant jamais désactivée, elle maintient
l'offre ouverte — **14 offres** sont passées de « fermées » à « conservées ».

---

## Bloc 2 — le vocabulaire des identifiants

**Le défaut, trouvé en vérifiant un chiffre qui ne collait pas.** `american-vintage-dr` affichait **37 absences
pour 37 représentations** : la source entièrement vidée, juste après avoir lu 31 offres sans une erreur.

Cause : l'adaptateur archivait la **diffusion** (une par lieu) là où la base stocke l'**annonce**.

| Source | Observés | Stockés | Recouvrement |
|---|--:|--:|--:|
| dr-pierre-ricaud | 64 | 72 | 89 % |
| lagardere-travel-retail | 109 | 130 | 84 % |
| urbn-hub | 1 372 | 1 558 | 88 % |
| lindex-easycruit | 43 | 50 | 86 % |
| saltrock-harri | 32 | 36 | 89 % |
| **american-vintage-dr** | 31 | 37 | **0 %** |

L'écart de 11–16 % sur les cinq premières **est** la disparition réelle. Zéro n'est pas une disparition de
masse : c'est un vocabulaire différent.

**Pourquoi pas un seuil de recouvrement.** Un ratio ne distingue pas « 20 % d'offres disparues » de « 20 %
d'identifiants cassés ». Et « un seul recouvrement suffit » laisserait passer 1 ancien format contre 99
nouveaux — 99 fausses absences. La règle est donc **structurelle**.

### Le contrat, bidirectionnel

```
candidateExternalIds ⊆ canonicalObservedIds
disposedIds          ⊆ canonicalObservedIds
canonicalObservedIds ⊆ candidateExternalIds ∪ dispositions
```

La deuxième inclusion n'est pas décorative : sans elle, un adaptateur peut faire disparaître un trou de sa
preuve en le rebaptisant « rejet ». Contre-exemple testé : `observed=['a']`, `candidates=['a']`,
`rejected=['b']` → **contrat rompu**, `b` nommé.

### Présence ≠ contenu

La présence du contrat se lit sur `Object.hasOwn(pe, 'canonicalIds')`, jamais sur `length > 0`.

| Situation | Verdict |
|---|---|
| propriété absente partout | adaptateur pas au contrat → aucune absence démontrable |
| propriété sur **certaines** pages | contrat **PARTIEL** → rompu (les pages muettes cacheraient des offres) |
| présente, vide, **avec** des offres | contrat **rompu** |
| présente, vide, board **réellement vide** + terminaison prouvée | **preuve VALIDE** |

Le dernier cas est le seul qui justifie de fermer un board entier. Le traiter en indisponibilité l'aurait rendu
infermable à jamais.

---

## Bloc 3 — parcours complet ≠ preuve d'absence exploitable

Une ligne Workday sans `externalPath` est **observée mais anonyme**. Il est interdit de lui fabriquer un
identifiant depuis le titre ou un hachage — ce serait inventer une preuve.

Deux champs distincts, et le premier peut être vrai quand le second est faux :

- `enumerationTraversalComplete` — le listing a été lu en entier ;
- `canonicalAbsenceProofUsable` — aucune ligne anonyme, une absence est démontrable.

Les offres identifiables du run sont **ingérées normalement** ; seule l'attestation d'absence est refusée.

**L'ordre compte aussi.** TalentRecruiter pousse désormais l'identifiant dans la preuve **avant** les
validations : après, une ligne rejetée sortait de la boucle sans figurer dans la preuve, et une `JobSource`
historique de même identifiant aurait paru absente, donc aurait été fermée.

---

## Bloc 4 — le contrat de persistance

Le contrat d'adaptateur démontre « sortie de l'adaptateur ↔ preuve ». Il ne dit rien de ce qui existe en base.

```
canonicalObservedIds =
  persistedJobSourceExternalIds ∪ heldIds ∪ writeFailedIds ∪ rejectedIds ∪ collectionErrorIds
```

Les deux sens comptent : un identifiant **observé** sans devenir connu est un trou ; une `JobSource` **active**
que la preuve n'a pas vue paraîtrait absente au refresh suivant.

**Trois pièges d'introspection, corrigés en lisant la base :**

| Supposition | Réalité |
|---|---|
| `source.rejected_rows` | **n'existe pas** — c'est `source.rows_rejected` ; la requête rendait un ensemble vide *en silence* |
| retenues bornées par une fenêtre de temps | `job.publication_held` est corrélé au `runId` et porte l'identifiant en colonne |
| `job.write_failed` à parser depuis `error.stack` | `sourceKey`/`jobId`/`runId` sont **déjà** des colonnes — 2 306 événements, **0** sans `jobId` |

Une erreur non rattachable ne devient **jamais** « zéro erreur » : elle retire la recevabilité de la source.

---

## Bloc 5 — le manifeste figé

| Propriété | Garantie |
|---|---|
| Figé | la liste exacte des `JobSource` revues |
| Haché | empreinte du plan **trié** ; l'heure exclue, sinon tout manifeste serait unique |
| Relu | refus si empreinte, activité ou périmètre ont changé |
| Borné | `in` par identifiant, **cumulé** avec l'allowlist par source |
| Comparé | `touchedIds` par **ensembles** — même nombre mais pas les mêmes est détecté |

Le filtre est répété sur la requête qui **écrit** : posé au seul endroit de la planification, le périmètre
fuirait au moment de la mutation.

---

## Bloc 6 — la parité, démontrée sur clone

`refresh-parity.mts` construit chaque situation, produit le plan par le planificateur commun, fige le
manifeste, exécute le **vrai** `runRefresh`, et compare par identifiants.

| # | Scénario | Résultat |
|---|---|---|
| 1 | absente et fermable | ✓ désactivée **et** fermée |
| 2 | autre source active hors allowlist | ✓ offre **conservée** |
| 3 | `PRESENT_BUT_REJECTED` | ✓ aucune mutation |
| 4 | `PRESENT_BUT_HELD` | ✓ aucune mutation |
| 5 | `PRESENT_BUT_WRITE_FAILED` | ✓ aucune mutation |
| 6 | source `UNVERIFIABLE` | ✓ aucune mutation |
| 7 | board vide **prouvé** | ✓ fermée, et non invérifiable |
| 8 | ligne anonyme | ✓ source non recevable |
| 9 | état modifié après le manifeste | ✓ **refus avant** mutation |
| 10 | ligne hors manifeste | ✓ jamais touchée |

**10/10.**

---

## Ce que la production dit aujourd'hui

**0/9 sources peuvent prouver une absence.** Les preuves archivées viennent du run du 2026-09-12, écrit par du
code qui n'émettait pas encore `canonicalIds`. La prévisualisation refuse donc de conclure — au lieu de le
faire sur les diffusions, comme avant les correctifs.

Seul un **nouveau run déployé** produira des preuves exploitables. Une cassette ne vaut pas admission.
