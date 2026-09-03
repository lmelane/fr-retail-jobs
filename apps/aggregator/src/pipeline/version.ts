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
 *   2  2026-09-02 — isFrance actually written (v1 rows all sat at the schema
 *      default false, which an isFrance:true front end renders as an empty
 *      board), and nothing is discarded at ingest any more: France and sector
 *      are stored, filtering happens on the web.
 *   3  2026-09-02 — descriptions decode numeric entities and keep bullet/line
 *      structure; contract falls back to title/description; the UNKNOWN
 *      non-answer is stored as null instead of a truthy string the UI printed.
 *   4  2026-09-02 — entities decoded BEFORE tags are stripped: Teamtailor
 *      escapes its JSON-LD, and the old order recreated the markup after the
 *      strip, storing literal HTML (base64 figures included) on every
 *      Galeries Lafayette offer.
 *   5  2026-09-02 — contract read from the whole posting (GL announces "contrat
 *      en CDI" in its closing lines, past any head-window), salary extracted
 *      from prose when the structured field is empty, and Teamtailor's
 *      baseSalary band finally read instead of dropped.
 *   6  2026-09-02 — a wave of correctness fixes the earlier rows cannot carry:
 *      contract no longer lets the role word win ("Consultant … CDI" was
 *      FREELANCE, "Chef de Mission" INTERIM, "qualité de vie" a V.I.E); salary
 *      requires a pay context (a turnover was read as pay); isFrance matches on
 *      word boundaries with foreign-place signals ("Venice", "Varennes" were
 *      French); location no longer yields "ARRONDISSEMENT"/"REMOTE -" as a city;
 *      sector rejects ambiguous tokens; Job.source stores the real ATS; HTML is
 *      cleaned once at ingest for every source. Older rows re-fetch cleanly as
 *      each source's next run stamps generation 6.
 */
/**
 *   7  2026-09-03 — attribution par MARQUE sur les flux de groupe (audit A-01,
 *      D11) : Workday lit logoImage.alt / hiringOrganization, Eightfold lit
 *      efcustomTextBrand (et sa description, perdue par un champ snake_case
 *      obsolète), WTTJ lit organization.name, Magnet lit brand. Richemont ne
 *      passe plus que par la route autorisée par robots (broadbean_external) ;
 *      la ligne « Cartier +3 » (route Disallow) est supprimée. Les lignes
 *      étiquetées à la marque de tête (« Cartier », « Dr. Jart+ »…) se
 *      réécrivent à la vraie Maison au run suivant.
 */
export const PIPELINE_VERSION = 7;
