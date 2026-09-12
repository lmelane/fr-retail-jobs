# Operations — the versioned, reviewable executables

Everything indispensable to operating and proving the pipeline lives here, in the repository, so a chain can be
**reviewed, diffed and replayed**. What stays out, always: cassettes (third-party response bodies), database
dumps, and credentials. They are named by argument or by a host-local access file, never embedded.

The rule this directory exists to enforce: **no program that the operation depends on may live only in
`backups/` or as a `.txt`.** Fifty-three execution chains once sat in `backups/` (gitignored); each lot copied
the previous one, the procedure drifted, and no chain could be diffed against another.

## Mutating production

| | |
|---|---|
| [`mutation.sh`](mutation.sh) | The single entry point for any production data mutation: guards → perimeter → backup → **restore** (the restore *is* the proof the backup is usable) → rehearsal on the clone → gate → before → apply → after + replay → archive. Resume is fingerprint-based, not marker-based. Still qualified as a **prototype not validated for exploitation**. |
| [`gate.mts`](gate.mts) | The blocking check between rehearsal and production. Exits non-zero when the replay changed anything, when the touched identifiers are not the declared perimeter, or when an invariant fails. Compares **sets**, and treats a **missing declaration as unverifiable, never as zero**. Tested in [`src/ops/gate.test.ts`](../../src/ops/gate.test.ts) — nine tests, all asserting exit 1. |
| [`deploy-guard.py`](deploy-guard.py) | Refuses a merge while a deployment or a production run is in flight. A run may be exempted explicitly with `--allow-running <id>`, never by a hard-coded id. |
| [`db.py`](db.py) | Which database, read-only or not, how the URL is built — `production` / `readonly` / `clone` / `test`. Secrets come from a host-local file named by `CATWALKS_DB_ACCESS`. |
| [`read-crons.py`](read-crons.py), [`running-pipeline-runs.mts`](running-pipeline-runs.mts) | Read the frozen cron schedules and any run still in flight. |

## Un cycle P7 borné : ingestion, preuve, manifeste, refresh

Un cycle ne se déclare pas terminé parce qu'il a tourné : chaque étape doit avoir produit sa preuve, et le
refresh ne touche que ce qui a été revu.

| | |
|---|---|
| [`ingest-preflight.py`](ingest-preflight.py) | Impose les étapes 1 à 8 et **refuse en exit 1** : commit figé, arbre propre, aucun run en vol, les **deux** services vérifiés séparément (`DEPLOYED_AT_COMMIT` / `SAME_CODE_FOR_THIS_SERVICE` démontré par le diff / `STALE_CODE`), allowlist exacte, sauvegarde **restaurée** et comparée sur six grandeurs, canaux d'alerte **testés par émission réelle**. |
| [`bounded-ingest.sh`](bounded-ingest.sh) | Une ingestion bornée, sans aucun tube — le code de sortie d'un tube est celui de sa dernière commande. Pose la commande bornée, attend le SUCCESS sur CE commit, exécute, attend un statut **terminal** (restaurer plus tôt tuerait le run), restaure, contrôle les variables et les crons. |
| [`bounded-command.py`](bounded-command.py), [`bounded-refresh-command.py`](bounded-refresh-command.py) | Les commandes de démarrage, échappées par `shlex` — assemblées en shell elles se cassent en silence, et une commande malformée qui se déploie remplace la commande normale par quelque chose qui échoue. Le refresh y embarque le **manifeste en clair**. |
| [`cycle-contracts.mts`](cycle-contracts.mts) | Les deux contrats d'un cycle, lus sur la base : `canonicalObservedIds = persistés ∪ retenus ∪ échecs ∪ rejets ∪ erreurs`. Tout est corrélé au **même `runId`** — une retenue historique n'est pas une retenue du cycle. |
| [`refresh-preview.mts`](refresh-preview.mts) | Ce que le refresh ferait, par identifiant, sur le planificateur **commun**. Lit `canonicalIds`, jamais `ids`. |
| [`freeze-manifest.mts`](freeze-manifest.mts) | Fige et hache le plan. **Refuse** une entrée d'une source non recevable, un état n'autorisant pas la désactivation, une ligne déjà inactive. |
| [`bounded-refresh.sh`](bounded-refresh.sh) | Le refresh borné. **Refuse de démarrer si `INGEST_ONLY_KEYS` est posé** : un refresh ne collecte rien. Un manifeste vide arrête la chaîne en succès. |
| [`refresh-audit.mts`](refresh-audit.mts) | `touchedIds` = manifeste par **ensembles**, conséquences offre par offre, invariants, retenues, runs orphelins. |
| [`refresh-parity.mts`](refresh-parity.mts) | Les dix situations qui comptent, contre le **vrai** `runRefresh` sur clone — dont « état modifié après le manifeste » et « ligne hors manifeste ». |
| [`cycle-compare.mts`](cycle-compare.mts) | Cycle 1 contre cycle 2, **par identifiant**. Seule l'intersection des absences des deux cycles peut fonder une fermeture. |
| [`record-employer-alias.mts`](record-employer-alias.mts) | Une décision d'identité : libellé **exact**, portée **source**, preuve archivée dont le sha256 est vérifié. Refuse un alias global. |

### Ce qu'une absence exige

Une absence n'est jamais déduite d'un `lastSeenAt` ancien — ce serait une preuve de **non-ré-attestation**.
Elle exige que l'identifiant ne figure pas dans l'ensemble **réellement observé**, lu dans
`pageEvidence[].canonicalIds` et corrélé au run par `runId`. Et cet ensemble doit parler le même langage que la
base : mesuré le 2026-09-12, un adaptateur archivait des *diffusions* là où la base stocke des *annonces* —
recouvrement nul, 37 offres vivantes déclarées absentes.


## Integrating a source, and proving it

The five reception scenarios of P3 run on **archives and clones**, never against production, and never with a
script that re-implements a pipeline rule.

| | |
|---|---|
| [`offline-transport.ts`](offline-transport.ts) | Replaces the network transport and **nothing else**: the seam is at `globalThis.fetch`, *under* the adapters, so the ATS adapter, the normalisers, the identity gate, the scope rules, the dedup and the upsert all run for real. An unrecorded request **fails loudly** — returning an empty body would fabricate a source with no postings. |
| [`record-cassette.mts`](record-cassette.mts) | Online, once per source: runs the real adapter through the production dispatch table and saves every response, robots.txt included. Writes to no database. |
| [`make-candidate.mts`](make-candidate.mts) | Clone only. Turns an existing source back into a **not-yet-integrated candidate** so onboarding starts from `exists:false`. Orphan Jobs are deactivated, not deleted. |
| [`onboard-source.mts`](onboard-source.mts) | The full path — `register → validate → certify → promote → ingest` — calling only maintained pipeline functions, with the state **re-read from the database after every transition**. |
| [`replay-ingest.mts`](replay-ingest.mts) | `ingestAllBySource` itself, offline, on a clone. `--crash-after=N` kills the process after N **committed transactions** (the ingest persists through `$transaction`, not `job.update`) to produce a genuinely partial write. Separates observed identifiers from those actually written. |
| [`config-change.mts`](config-change.mts) | Changes a real `Source.config` and shows the certification stop applying, because `sourceIdentityHash` binds the review to the configuration. |
| [`validator-regression.mts`](validator-regression.mts) | Applies an **earlier and a corrected version of a shared control** (`classifyLabel`) to the same archived proofs, and names the certifications that exist only because of the correction. Locked by [`src/ops/validator-regression.test.ts`](../../src/ops/validator-regression.test.ts). |
| [`onboarding-proof.mts`](onboarding-proof.mts) | The proof, read back from the clone: state transitions, `JobSource` representations as well as `Job` rows, identifiers **observed** vs **created/modified**, and values field by field. |

### Two distinctions the proofs depend on

**Representations are not canonical rows.** A posting attested by several sources is one `Job` and several
`JobSource`. Counting only `Job` hides whether the source's own attestations exist at all.

**Observed is not written, and `updatedAt` does not separate them.** A re-attestation stamps `updatedAt` on every
row it re-sees, so on an idempotent second pass "touched" equals "observed" while nothing changed — measured: 6
and 6, with zero field differences. `firstSeenAt` is the unambiguous one: it only moves when a row is born.
Whether anything *changed* is answered by comparing values between two passes, not by a count.

### Preserve the real exit code

An interruption is only proven if its exit code survives. `cmd | grep | tail` reports the exit code of `tail`;
the measured crash exits **137** and must be read directly, or captured with `PIPESTATUS`/a temporary file.
