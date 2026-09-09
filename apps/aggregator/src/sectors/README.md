# Business sectors (Lot 3)

SectorConcept is a data catalogue. Company.sectorCodes contains zero or more verified memberships. Company.sector is historical evidence only. An empty membership is an investigation queue, not an exclusion. Retail here is an employer activity, independent of the occupation group `retail`.

Use a JSON manifest with `reviewer`, optional `concepts` (code, slug, labels.fr/en, definition, position) and `companies` (id, canonicalKey, codes, evidence per code: source URL, statement, confidence, basis, checkedAt). `REFERENCE_LIST` means a documented historical reference; it is not a new official website verification. `OFFICIAL_SOURCE` requires an actually inspected official source. Record when the source was checked, not a future date. Do not infer every activity from a group's combined business division, nor assign the group's sectors to every subsidiary.

1. Resolve the employer through the Lot 1 procedure. Keep sources and occupations separate.
2. Prepare evidence and an exact canonical employer ID. For a new employer, create its identity first; offers remain visible while sector evidence is pending.
3. `npx tsx apps/aggregator/src/sectors/cli.mts preview manifest.json reviewed-plan.json`
4. Inspect the complete before/after plan. Unknown concepts, evidence gaps and duplicate memberships are rejected.
5. `npx tsx apps/aggregator/src/sectors/cli.mts apply reviewed-plan.json FULL_MERGED_COMMIT_SHA`
6. Reapply: zero writes. Read counts through DB/API and queue unresolved memberships with `cli.mts queue pending.json`.

No application deployment is needed for another reviewed membership, concept or translation. Changing the meaning/slug of an existing concept is forbidden; introduce a new concept and review the transition. Definitions and reviews cannot be deleted. A merge of employers must first review the union of proven memberships for the surviving identity; a DB guard prevents silently discarding a sector.

Every membership write must exactly match an immutable SectorReview manifest. All rows in a batch are locked and checked before writing, so a stale identity or before-image rejects the whole batch. New source runs neither erase memberships nor assign Retail from catalogue membership. Sector review invalidates intelligence caches. Statistics count each offer once per sector; multi-sector totals overlap. Global, country, occupation and contract counts never expand memberships. Historical sector comparisons start after the latest sector review, rather than presenting a taxonomy change as growth.

The initial 15 concepts implement the requested business scope. Coverage is not completeness: missing sectors stay queued, and one evidenced activity does not prove all other activities have been checked.
