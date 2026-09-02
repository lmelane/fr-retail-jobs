/**
 * Generation of the ingest pipeline.
 *
 * Bump this when rows written by earlier code cannot be repaired in place, and
 * the next scheduled ingest deletes every older-generation row and refetches
 * it from source. The fix then ships with the deploy — no one has to remember
 * to run a purge, and a forgotten manual step cannot leave half the base
 * stale.
 *
 * History:
 *   0  implicit — rows from before versioning existed: no descriptions
 *      (adapters did not fetch them yet), sectors all UNKNOWN (written before
 *      Company.sector), "Full-time" stored as a contract.
 *   1  2026-09-02 — full descriptions, write-time sector classification,
 *      working time split from contract, parentGroup on Company.
 */
export const PIPELINE_VERSION = 1;
