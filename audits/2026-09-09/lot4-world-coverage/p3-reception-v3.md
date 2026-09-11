# P3 — réception finale : le parcours d'intégration complet et la correction d'un validateur (2026-09-11)

Ce bloc complète la réception v2. Il n'ajoute aucun dossier P2. **Aucune écriture de production**, crons gelés,
catalogue inchangé.

## 1. Le parcours complet `register → validate → certify → promote → ingest`

Point de départ exigé : **une source non encore intégrée**, pas une source déjà ACTIVE possédant des offres.

Le clone est restauré depuis un dump frais (`before-p7-scenario-075416-production.dump`, 494 Mo) — **la
restauration est la preuve que la sauvegarde est utilisable** — puis `make-candidate.mts` retire entièrement
`nikin` et `damart` (JobSource, SourceIdentityReview, SourceRun, Source ; les Jobs orphelins sont **désactivés,
pas supprimés**). Les dossiers repartent donc de `exists:false`.

Chaque étape appelle **la fonction de pipeline maintenue**, jamais une copie :

| Étape | Fonction appelée |
|---|---|
| register | `registerSourceCandidate` (connectors/sourceCandidate) |
| validate | `readRobots` + `requestTarget` + `scopeEvidence` (lib/candidateChecks) + `fetchAtsJobs` (ats/index) |
| certify | `recordSourceIdentityReview` (connectors/sourceIdentity) |
| promote | `promoteSource` (connectors/sourceStore) |
| ingest | `ingestAllBySource` (pipeline/ingestOrchestrator) |

L'état est **relu en base après chaque transition** — une étape « réussie » sans déplacer la source serait
visible :

```
=== p10-nikin  (recruitee)
initial:—/NO_REVIEW/0r0j | register:DRAFT/NO_REVIEW/0r0j | validate:DRAFT/NO_REVIEW/0r0j
certify:DRAFT/CERTIFIED/0r0j | promote:ACTIVE/CERTIFIED/0r0j | ingest:ACTIVE/CERTIFIED/3r3j

=== p10-damart (teamtailor)
initial:—/NO_REVIEW/0r0j | register:DRAFT/NO_REVIEW/0r0j | validate:DRAFT/NO_REVIEW/0r0j
certify:DRAFT/CERTIFIED/0r0j | promote:ACTIVE/CERTIFIED/0r0j | ingest:ACTIVE/CERTIFIED/3r3j
```

Une garde a refusé la promotion au premier essai — `promote: "p10-nikin" has no dated robots verdict` : c'est la
garde qui fonctionne. Le verdict robots est désormais **persisté** (`robotsVerdict`, `robotsCheckedAt`) comme le
fait `validate-candidate`, pas contourné.

## 2. Identifiants observés ≠ identifiants créés, et les représentations comptent

| | p10-nikin | p10-damart |
|---|---:|---:|
| Représentations `JobSource` observées | 3 | 3 |
| Offres canoniques `Job` observées | 3 | 3 |
| **Représentations créées** | **3** | **3** |
| **Offres canoniques créées** | **3** | **3** |
| Offres modifiées (préexistantes) | 0 | 0 |

Les identifiants sont **nommés**, pas comptés : `cmtwtoifo000ie2jgygfwp5lc`, `cmtwtoiex000ce2jgkg37ykds`,
`cmtwtoicy0006e2jggrio7abc` pour nikin ; externalIds `2016082`, `2728472`, `2738338`.

L'instant de départ est lu **en base** (`Source.createdAt`, posé par `registerSourceCandidate`), pas dans le
fichier de run, dont l'horodatage est écrit à la fin et daterait le départ après toutes ses propres écritures.
Une première version faisait exactement cette erreur et rapportait `createdJobs: []` pour trois offres créées.

## 3. L'interruption : le vrai code de sortie, sans tube

L'ingestion persiste par `$transaction`, pas par `job.update` : l'injection est placée là. Après 2 transactions
**commises**, le processus sort.

```
REAL_EXIT_CODE=137
SIMULATED CRASH after 2 committed transactions
```

Lu **sans tube** (`cmd > out 2> err; echo $?`) : `cmd | grep | tail` rendrait le code de `tail`, soit 0.

État partiel mesuré ensuite : `modifiedJobs: 1` par source, **0 ligne créée**, runs `NEW (3,3)`. La reprise, même
point d'entrée sans injection : `{total 2, ok 2, failed 0}`.

## 4. Absence de double écriture, prouvée par valeurs

Second passage complet, comparé au premier **ligne à ligne** :

```
identifiants pass1 == pass2 : True (6 vs 6)
jobIds identiques           : True
jobSourceIds identiques     : True
différences de champ        : 0
offres canoniques créées    : 0
nouvelles représentations   : 0
```

**Mesure honnête à déclarer** : une ré-attestation estampille `updatedAt` sur chaque ligne revue, donc au second
passage « touché » vaut « observé » (6 et 6) *alors que rien n'a changé*. `updatedAt` ne sépare donc pas les deux
notions ; `firstSeenAt` si (il ne bouge qu'à la naissance), et la question « quelque chose a-t-il changé ? » se
répond par la comparaison des valeurs, pas par un compteur. C'est écrit dans le script plutôt que sous-entendu.

## 5. Changement de configuration ≠ correction d'un validateur

**Changement de configuration** (`config-change.mts` sur `p10-damart`) : `maxPages` 1 → 2, empreinte
`b6b9259…` → `eda368c…`, verdict `CERTIFIED` → `INVALID`. La certification est liée à la configuration par
`sourceIdentityHash`, pas à une empreinte de fichier.

**Correction d'un validateur** (`validator-regression.mts`) — le scénario que le précédent ne couvrait pas. Deux
versions du **contrôle partagé** `classifyLabel` (appelé par `scopeEvidence`, que la certification utilise pour
décider si les libellés natifs contredisent SINGLE_BRAND) sont appliquées **aux mêmes preuves archivées** :

- la version antérieure au 2026-09-10 : identité exacte seulement ;
- la version maintenue, **importée** (jamais recopiée) : forme courte acceptée, forme juridique de la Maison
  retirée, garde sur les mots génériques.

Sur les cas revus, la décision change exactement où elle le doit, et **nulle part ailleurs** :

| Libellé / Maison | Avant | Après |
|---|---|---|
| `KnitWell` / KnitWell Group | OTHER | **OWNER_ENTITY** |
| `VF Outdoor, LLC` / VF Corporation | OTHER | **OWNER_ENTITY** |
| `Chico's FAS` / Chico's | OTHER | **OWNER_ENTITY** |
| `Group` / KnitWell Group | OTHER | OTHER *(garde contre la sur-acceptation)* |
| `GU USA LLC` / UNIQLO | OTHER | OTHER *(autre marque : SINGLE_BRAND reste contredit)* |

Rejoué ensuite sur les **revues d'identité réellement archivées** en base (`--reviews`), qui consignent les
libellés natifs lus à la validation et la classe donnée à chacun **à l'époque** :

- **15 revues** contiennent au moins un libellé que l'ancienne version aurait classé OTHER ;
- **11 certifications n'existent que grâce à la correction** — leur unique libellé natif aurait contredit
  SINGLE_BRAND sous l'ancienne version : `knitwell-us-distribution`, `fast-retailing-id-headquarters`,
  `fast-retailing-ph-headquarters`, `theory-us-retail`, `theory-eu`, `gu-hk-headquarters`,
  `uniqlo-th-headquarters`, `uniqlo-my-headquarters`, `uniqlo-graduates`, `uniqlo-headquarters`,
  `uniqlo-stores` ;
- **0 désaccord avec l'archive** : la version corrigée reproduit exactement la classe consignée pour chaque
  libellé. *(Une première lecture en annonçait 12 : mon analyseur découpait sur les virgules et fabriquait des
  fragments — « Ltd. », « Co. » — extraits de « VF (Cambodia) Sourcing Co., Ltd. ». Le défaut était dans
  l'analyseur, pas dans le validateur ; corrigé, il lit chaque entrée entière.)*

Verrouillé par `src/ops/validator-regression.test.ts` (3 tests), pour que le scénario ne cesse pas
silencieusement de démontrer quoi que ce soit.

## 6. Le harnais est versionné

Plus aucun programme indispensable dans `backups/` ni sous forme de `.txt`. Consolidé dans
`apps/aggregator/scripts/ops/` (voir son [README](../../../apps/aggregator/scripts/ops/README.md)) :
`record-cassette.mts`, `make-candidate.mts`, `onboard-source.mts`, `replay-ingest.mts`, `config-change.mts`,
`validator-regression.mts`, `onboarding-proof.mts`, aux côtés de `offline-transport.ts`, `gate.mts`,
`mutation.sh`, `db.py`, `deploy-guard.py`.

Les dix `p9-*.mts` / `p10-*.mts` de `backups/` sont **supprimés** (remplacés). Les `.txt` restants de
`p2-repairs-proof/` sont des **archives de mutations ponctuelles déjà appliquées**, conservées avec leurs
empreintes — un [README](p2-repairs-proof/README.md) les distingue explicitement d'une bibliothèque de
programmes. Cassettes, dumps et secrets restent hors du dépôt.

## Limites déclarées

- **Aucune écriture de production.** La production n'est pas le terrain de validation d'un processus.
- Les cassettes couvrent les requêtes que ces sources émettent ; un flux qui change doit être ré-enregistré. Une
  requête inconnue **échoue** au lieu de rendre du vide.
- Les certifications invalidées (`p10-damart`) l'ont été **sur le clone**.
- Le premier dossier essayé (`lightyear.recruitee.com`) était un sous-domaine inventé : HTTP 404. Les dossiers
  retenus utilisent des configurations réelles — une démonstration doit exercer le pipeline, pas un board fictif.

## Statut

Les cinq scénarios sont exercés sur le processus d'intégration réel, avec de vraies écritures sur clone, à partir
d'une source non intégrée. Typecheck 0 erreur (sources + scripts), **1 747 tests unitaires verts**.
