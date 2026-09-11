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
