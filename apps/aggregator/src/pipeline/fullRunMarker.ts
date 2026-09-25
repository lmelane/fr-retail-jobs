/**
 * THE COMPLETE-RUN MARKER — the event only a collection over every ACTIVE source emits, once its loop is done:
 * `ingestAllBySource` without `INGEST_ONLY_KEYS`, and `runIngest` without `only`. A targeted run, a canary or
 * `ingest --source` never emits it. The negative-proof guard of `health.ts` takes its reference from the runs that
 * carry it. Emitted since `f1d16b4` (24/09/2026): earlier RUNs carry none, and give no reference.
 */
export const FULL_RUN_MARKER = 'sectors.qualification';
