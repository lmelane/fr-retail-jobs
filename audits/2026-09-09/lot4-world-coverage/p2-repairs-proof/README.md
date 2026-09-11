# What this directory is — and what it is not

These `.mts.txt` files are **evidence of what was executed**, kept next to `scripts.sha256` and the before/after
logs so a mutation already applied can be reviewed exactly as it ran. They are archives, deliberately not
executable: a `.txt` cannot be run by accident, and a one-off mutation must never be replayed casually.

**No indispensable program lives only here.** Everything generic — the part a future lot would need to run again —
is versioned under `apps/aggregator/scripts/ops/`:

| Archived here | Maintained program |
|---|---|
| `p9-record.mts.txt` | [record-cassette.mts](../../../../apps/aggregator/scripts/ops/record-cassette.mts) |
| `p9-integrate.mts.txt` | [replay-ingest.mts](../../../../apps/aggregator/scripts/ops/replay-ingest.mts) |
| `p9-config-change.mts.txt` | [config-change.mts](../../../../apps/aggregator/scripts/ops/config-change.mts) |
| `p9-validator.mts.txt` | [validator-regression.mts](../../../../apps/aggregator/scripts/ops/validator-regression.mts) |

The rest (`p2-repairs`, `p3-fj-detach`, `p4-*`, `p5-fj-withdraw`, `p7-*`, `p8-*`) are **one-off data mutations on
a stated set of identifiers**, already applied and already proven. They have no generic form to maintain: their
perimeter was the specific rows they repaired. The reusable part of their procedure — guards, backup, restore,
rehearsal, gate, apply, replay, archive — is
[mutation.sh](../../../../apps/aggregator/scripts/ops/mutation.sh), which they all ran under.

Cassettes, dumps and credentials stay outside the repository; only the executable and its fingerprints are
versioned.
