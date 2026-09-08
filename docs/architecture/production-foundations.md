# Production foundations — 8 September 2026

Status: accepted for the current release. Owner: platform engineering, under the product owner's authorization to make architecture decisions.

- Keep the modular monorepo and PostgreSQL as the authoritative store. Separate web reads and scheduled collectors operationally; introduce additional storage or services only after capacity measurements justify them.
- External identity is `(sourceKey, externalId)`. Canonical offers aggregate observations, never erase the distinction between employer tenants. Company and source lifecycle locks coordinate ingestion, reconciliation and retirement.
- A canonical value needs an identifiable authority. Unknown geography stays unknown. Corpus-dependent ambiguity analysis belongs to a versioned audit, not a mutable dependency inside normalization.
- Preserve observations and offer lifecycle history. Generation cleanup and retirement deactivate attestations and close offers; they do not physically delete offer IDs or events. Existing cascades elsewhere and full replay context still require further work.
- Absence is actionable only after a complete, recent and trusted run. Unknown completeness protects offers and appears in health reporting. A source failure is not evidence that the employer stopped recruiting.
- The database catalogue is authoritative. CSV import seeds drafts and never overwrites operational configuration or fabricates dated evidence. Promotion remains explicit and guarded.
- Scheduled processes never migrate or baseline the database. Releases apply reviewed migrations explicitly, after backup restoration and a rehearsal on representative data. Schema checks fail closed in workers; web readiness verifies database/schema access.
- Separate additive DDL, projection backfill and concurrent index creation. Short DDL lock timeouts prevent a blocked migration from holding a long queue of application reads.
- Reproducible installs use the lockfile. Validate local tests, remote CI, build artifacts, migrations, live HTTP behavior and controlled collection before resuming all schedules.
- Healthcheck success is a deployment readiness signal, not continuous monitoring. Operational readiness additionally needs independent alerts, verified recovery, capacity budgets and sustained observed behavior.

## This release's database sequence

Apply the six `20260909000000` through `20260909050000` migrations in order using Prisma Migrate 6. The search backfill and `CREATE INDEX CONCURRENTLY` each have their own migration. Do not wrap the concurrent index migration in a transaction. On failure inspect the exact database state and index validity before any `migrate resolve`; there is no automatic baseline fallback.

Stop all old writers before removing the old Job uniqueness constraint. Deploy compatible workers before resuming their schedules. A rollback to the old writer is unsafe after new tenant identities have been admitted; prefer a reviewed forward correction. Restoring the backup is a distinct recovery operation with an explicit recovery point.

The planned SLOs and worldwide coverage requirements remain in the audit plan. Passing this release's tests is not a claim of zero failures or exhaustive worldwide coverage.
