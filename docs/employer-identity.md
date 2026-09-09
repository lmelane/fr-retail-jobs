# Employer identity decisions

The employer ID is `Company.id`. A source key identifies a connector/tenant; an ATS identifies software. Neither is a Maison. `Company.kind` and `Company.sector` answer different questions. `parentGroupId` is a reviewed relationship to a separate GROUP record, never an alias.

## Resolution boundary

`toCandidate` preserves `rawEmployerName` and its origin before the historical name normalizer. Workday also preserves the full detail response and the original field used (`logoImage.alt` or `hiringOrganization.name`). `normalizedEmployerName` performs Unicode NFKC, whitespace and case normalization only. It does not remove numbers, punctuation, countries, legal forms or words such as Maison/Retail.

`identity/resolve.ts` looks up a reviewed `CompanyAlias` in the exact source scope, bound to the reviewed source/tenant/configuration hash. Global aliases cannot justify ingestion. A changed source binding fails explicitly. A reviewed alias points to a stable Company ID. Merged IDs are retained as redirects. The resolved canonical key, rather than a display-name heuristic, controls matching.

Historical assignments remain explicitly `LEGACY_UNREVIEWED`. This is not an evidence-backed confidence level. A new posting cannot acquire a different employer name by the old stripping rules without a review, nor can an unreviewed new source adopt an existing employer merely by name. A changed RAW label on an existing posting also needs review; the observation is read after serializing writes to that posting. Such writes raise `EmployerIdentityReviewRequired`; RAW and a `REVIEW_REQUIRED` observation are archived after rollback. Ingest counts the error, so the source run cannot attest absence/close missing offers. A new unaliased identity uses a stable key scoped to its source and normalized label, preventing cross-source homonyms from becoming implicit company merges.

`EmployerObservation` records the original label, origin, normalized label, canonical ID, rule, alias/review ID and RAW hash per version. Missing historical evidence is not reconstructed from a canonical label. Reviews and observations are append-only in PostgreSQL. Company names and parent relationships no longer change as a side effect of ingesting one offer.

Both ingest and weekly reconciliation require the same actual `Job.companyId` before comparing postings. A historical cluster-key collision is insufficient. An employer merge does not authorize posting consolidation. An explicit posting decision additionally needs matching native issuer and requisition witnesses in the two archived RAW representations.

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

The plan captures all affected companies, predecessor redirects, offers (including closed ones), representations and events. Its hash and expected before-state must match at application time. A catalogue lock drains identity writes before the atomic transaction. Source/company locks follow the same ordering as ingestion. Conflicting ATS posting IDs abort with the two job IDs unless the plan includes a separately witnessed posting consolidation; records are never deleted or silently fused.

Changes produce append-only `DataCorrection` entries and `CORRECTED` job events. Old Company rows survive. Alias owners and predecessor redirects are flattened when roots are merged again. Every existing Job ID, RAW payload and prior event must survive unchanged. In an explicit posting consolidation only the reviewed JobSource ownership, posting redirect/activity and canonical first/last observation envelope may change, in addition to employer fields. Postconditions reconstruct these exact changes and compare all remaining fields. Counts alone are insufficient: postconditions compare individual rows and histories. Re-applying the same reviewed batch is idempotent; changing its content is rejected.

Take a current database backup, rehearse on a restored copy, run regressions, commit/review/merge and deploy before applying to production. Compare front results, counts and old URLs with the repaired DB. Do not resume a massive ingestion while outstanding review blocks are unmeasured. A compensating repair must use the preserved before-state and an explicit new review; never edit old audit evidence.

## Front and monitoring

Directory search, filters and the indexed results query recognize reviewed aliases and historical names. Old Maison URLs redirect to the canonical profile. Indexed text search expands aliases to canonical names before its trigram prefilter; adding an unindexed OR on the entire Job table would cause a scan of the corpus.

`health-report` exposes root/redirect counts, reviewed versus legacy aliases, unclassified roots, unlinked parent labels, jobs incorrectly attached to merged companies, and versioned identity observations. Root count is a catalogue count, not a claim that every employer has been independently validated.

Legacy aliases can be migrated in place only through an explicit reviewed plan with the original alias ID and unchanged target and normalized label. The six pre-existing aliases have five archived official source reviews, revalidated against the current source configuration before preparing their migration. Historical free-text parent values still require their own evidence. The old name-only `ops-merge-company.mts` procedure is disabled.

For repeatable read-only measurements, run `identity/audit.mts <output-directory>`. It reports candidate pairs separately from proven merges and labels its RAW coverage as non-exhaustive.

Company intelligence resolves redirects and the latest correction revision before using its profile cache. Historical snapshots remain intact; comparisons for a merged company start with the first full day after the identity cutover, with an explicit explanation in the page. Summing medians or treating an old partial company count as the current consolidated perimeter would invent historical comparability.

Workday listings without a successful detail and employer field carry an explicit publication hold. Fetch, schema, missing-path and missing-employer failures are distinguished and preserved in RAW. A later successful detail clears only its Workday hold; unrelated holds remain. Incomplete retrieval cannot attest absence.

When a source configuration changes, revalidate the official employer link and create a new repair plan for its existing alias. Applying that explicit decision updates the configuration binding in place and records the previous binding and review in DataCorrection. An unchanged alias is not automatically rebound during ingestion.

TalentView passes the native `entity.name` claim to the reviewed resolver while retaining the configured employer as the unresolved candidate. An operational unit is not automatically a new Company. Teamtailor passes its explicit `_jobposting.hiringOrganization.name` and field provenance. Both preserve RAW before normalization; the audit inventories those native paths.


## Business identity and recurrence

The objective is fidelity to the employer’s organization, not fewer catalogue rows. Group, brand, retailer, hiring legal entity and operational unit are different concepts. A shared domain, parent or ATS does not authorize their merger. Preserve separate employers when that reflects the business. A verified rebrand can justify an alias/redirect; posting equality is reviewed independently of that business decision.

`Job.mergedIntoId` preserves an absorbed posting and its old public URL. PostgreSQL forbids an active redirect, sources owned by a redirect, a missing MERGED event, cycles, a change of redirect target, and cross-employer redirects. Canonical lifecycle checks follow the target. Consolidation retains the prior closedAt on the absorbed row; it does not invent a source closure. Ingestion finds moved source representations by their existing stable IDs, so a replay cannot reactivate the absorbed row. Reconciliation writes the same redirect relation.

The FashionJobs directory importer updates discovery metadata only. It never rewrites an existing employer name or canonical key, follows an existing employer redirect, archives each distinct raw observation in EmployerObservation, and surfaces changed labels as REVIEW_REQUIRED. A directory observation is not an official identity verification. No FashionJobs job offers are fetched by this workflow.
