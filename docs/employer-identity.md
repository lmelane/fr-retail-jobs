# Employer identity decisions

The employer ID is `Company.id`. A source key identifies a connector/tenant; an ATS identifies software. Neither is a Maison. `Company.kind` and `Company.sector` answer different questions. `parentGroupId` is a reviewed relationship to a separate GROUP record, never an alias.

## Resolution boundary

`toCandidate` preserves `rawEmployerName` and its origin before the historical name normalizer. Workday also preserves the full detail response and the original field used (`logoImage.alt` or `hiringOrganization.name`). `normalizedEmployerName` performs Unicode NFKC, whitespace and case normalization only. It does not remove numbers, punctuation, countries, legal forms or words such as Maison/Retail.

`identity/resolve.ts` looks up a reviewed `CompanyAlias` in the source scope (or an explicitly reviewed global scope). Conflicting scopes fail; they do not silently override each other. A reviewed alias points to a stable Company ID. Merged IDs are retained as redirects. The resolved canonical key, rather than a display-name heuristic, controls matching.

Historical assignments remain explicitly `LEGACY_UNREVIEWED`. This is not an evidence-backed confidence level. A new posting cannot acquire a different employer name by the old stripping rules without a review, nor can an unreviewed new source adopt an existing employer merely by name. Such writes raise `EmployerIdentityReviewRequired`; RAW and a `REVIEW_REQUIRED` observation are archived after rollback. Ingest counts the error, so the source run cannot attest absence/close missing offers. A new unaliased identity uses a stable key scoped to its source and normalized label, preventing cross-source homonyms from becoming implicit company merges.

`EmployerObservation` records the original label, origin, normalized label, canonical ID, rule, alias/review ID and RAW hash per version. Missing historical evidence is not reconstructed from a canonical label. Reviews and observations are append-only in PostgreSQL. Company names and parent relationships no longer change as a side effect of ingesting one offer.

Both ingest and weekly reconciliation require the same actual `Job.companyId` before comparing postings. A historical cluster-key collision is insufficient. Employer identity repair never merges job records.

## Reviewed repairs

Use `src/identity/cli.mts`:

```
node --import tsx apps/aggregator/src/identity/cli.mts plan spec.json plan.json
node --import tsx apps/aggregator/src/identity/cli.mts apply plan.json EXPECTED_SHA256 DEPLOYED_COMMIT
```

The specification contains:

- a dated review and explicit identity statement;
- official/structured evidence: URL, exact archived text and matching SHA-256, explanation of the association;
- explicit `fromId → toId` decisions; never a fuzzy name predicate;
- scoped raw aliases;
- optional canonical name/kind and parent relationships.

The plan captures all affected companies, predecessor redirects, offers (including closed ones), representations and events. Its hash and expected before-state must match at application time. A catalogue lock drains identity writes before the atomic transaction. Source/company locks follow the same ordering as ingestion. Conflicting ATS posting IDs abort with the two job IDs; they are never deleted or silently fused.

Changes produce append-only `DataCorrection` entries and `CORRECTED` job events. Old Company rows survive. Alias owners and predecessor redirects are flattened when roots are merged again. Every existing Job ID, non-identity field, JobSource, RAW payload and event must survive unchanged. Counts alone are insufficient: postconditions compare individual rows and histories. Re-applying the same reviewed batch is idempotent; changing its content is rejected.

Take a current database backup, rehearse on a restored copy, run regressions, commit/review/merge and deploy before applying to production. Compare front results, counts and old URLs with the repaired DB. Do not resume a massive ingestion while outstanding review blocks are unmeasured. A compensating repair must use the preserved before-state and an explicit new review; never edit old audit evidence.

## Front and monitoring

Directory search, filters and the indexed results query recognize reviewed aliases and historical names. Old Maison URLs redirect to the canonical profile. Indexed text search expands aliases to canonical names before its trigram prefilter; adding an unindexed OR on the entire Job table would cause a scan of the corpus.

`health-report` exposes root/redirect counts, reviewed versus legacy aliases, unclassified roots, unlinked parent labels, jobs incorrectly attached to merged companies, and versioned identity observations. Root count is a catalogue count, not a claim that every employer has been independently validated.

The six pre-existing unreviewed aliases and historical free-text parent values are not silently upgraded to verified facts. Their migration requires evidence. The old name-only `ops-merge-company.mts` procedure is disabled.

For repeatable read-only measurements, run `identity/audit.mts <output-directory>`. It reports candidate pairs separately from proven merges and labels its RAW coverage as non-exhaustive.

Company intelligence resolves redirects and the latest correction revision before using its profile cache. Historical snapshots remain intact; comparisons for a merged company start with the first full day after the identity cutover, with an explicit explanation in the page. Summing medians or treating an old partial company count as the current consolidated perimeter would invent historical comparability.
