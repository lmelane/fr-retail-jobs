// Audit 3 (D-472 §3) — la FORME des salaires que l'en-tête de la fiche affichera : fourchette, minimum seul, maximum
// seul, montant unique ; devises ; périodes. Offres publiables seulement, celles que l'API sert avec un salaire
// (devise ET période présentes : `jobs.ts` et `direct-offers.ts`). Lecture seule, rôle catwalks_audit, garde
// éprouvée avant la mesure (même accès que `audits/2026-09-27/scripts/maisons-catwalks-registre.mts`).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
const refus = (m) => { console.error(`REFUS : ${m}`); process.exit(3); };
const BASE = 'railway';
const acces = JSON.parse(readFileSync(`${homedir()}/.catwalks/audit-access.json`, 'utf8'));
if (acces.PGDATABASE !== BASE || acces.PGUSER !== 'catwalks_audit') refus('accès inattendu');
const MAINT = `(now() AT TIME ZONE 'UTC')`;
const PUBLIABLE = `j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id
  AND a."isActive" AND (a."expiresAt" IS NULL OR a."expiresAt" > ${MAINT}))`;
const DIRECTE = `d.eligible AND (d."validThrough" IS NULL OR d."validThrough" > ${MAINT})`;
const forme = (t) => `CASE WHEN ${t}."salaryMin" IS NOT NULL AND ${t}."salaryMax" IS NOT NULL AND ${t}."salaryMin" <> ${t}."salaryMax" THEN 'fourchette'
  WHEN ${t}."salaryMin" IS NOT NULL AND ${t}."salaryMax" IS NOT NULL THEN 'unique' WHEN ${t}."salaryMin" IS NOT NULL THEN 'min_seul'
  WHEN ${t}."salaryMax" IS NOT NULL THEN 'max_seul' ELSE 'aucun' END`;
const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || jsonb_build_object('base', current_database(), 'role', current_user, 'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
SELECT 'A' || E'\\t' || jsonb_build_object('publiables', count(*), 'avecSalaireServi', count(*) FILTER (WHERE j."salaryCurrency" IS NOT NULL AND j."salaryPeriod" IS NOT NULL AND (j."salaryMin" IS NOT NULL OR j."salaryMax" IS NOT NULL)))::text FROM "Job" j WHERE ${PUBLIABLE};
SELECT 'AF' || E'\\t' || jsonb_build_object('forme', ${forme('j')}, 'devise', j."salaryCurrency", 'periode', j."salaryPeriod", 'n', count(*))::text
FROM "Job" j WHERE ${PUBLIABLE} AND j."salaryCurrency" IS NOT NULL AND j."salaryPeriod" IS NOT NULL AND (j."salaryMin" IS NOT NULL OR j."salaryMax" IS NOT NULL)
GROUP BY ${forme('j')}, j."salaryCurrency", j."salaryPeriod" ORDER BY count(*) DESC;
SELECT 'AX' || E'\\t' || jsonb_build_object('periode', j."salaryPeriod", 'devise', j."salaryCurrency", 'min', j."salaryMin", 'max', j."salaryMax", 'pays', j."countryCode")::text
FROM "Job" j WHERE ${PUBLIABLE} AND j."salaryCurrency" IS NOT NULL AND j."salaryPeriod" IS NOT NULL AND (j."salaryMin" IS NOT NULL OR j."salaryMax" IS NOT NULL)
AND ((j."salaryPeriod" = 'YEAR' AND coalesce(j."salaryMax", j."salaryMin") < 5000) OR (j."salaryPeriod" = 'HOUR' AND coalesce(j."salaryMin", j."salaryMax") > 500)
  OR (j."salaryPeriod" = 'MONTH' AND coalesce(j."salaryMax", j."salaryMin") > 50000) OR (j."salaryMin" <> trunc(j."salaryMin")))
LIMIT 12;
SELECT 'D' || E'\\t' || jsonb_build_object('forme', ${forme('d')}, 'devise', d."salaryCurrency", 'periode', d."salaryPeriod", 'n', count(*))::text
FROM "DirectOffer" d WHERE ${DIRECTE} GROUP BY ${forme('d')}, d."salaryCurrency", d."salaryPeriod" ORDER BY count(*) DESC;
\\else
SELECT 'REFUS' || E'\\t' || 'garde';
\\endif
ROLLBACK;
`;
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: script, encoding: 'utf8',
  env: { ...env, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER), PGPASSWORD: String(acces.PGPASSWORD),
    PGDATABASE: BASE, PGSSLMODE: 'require', PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'audit3-salaires-d472' } });
if (run.status !== 0) refus(`psql : ${run.stderr.trim()}`);
const lignes = run.stdout.trim().split('\n').map((l) => l.split('\t'));
if (lignes.some(([t]) => t === 'REFUS')) refus('garde non satisfaite');
for (const [t, v] of lignes) console.log(`${t}\t${v}`);
