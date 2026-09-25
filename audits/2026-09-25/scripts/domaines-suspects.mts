/**
 * DOMAINES POSÉS MAIS SUSPECTS : les preuves que porte la base (25/09/2026, logos manquants)
 *
 * `logos-societes.mts` a relevé des sociétés dont le domaine posé ne donne aucun logo (aucun fournisseur ne le
 * connaît) ou ne porte pas leur nom. Un domaine faux affiche le logo d'une AUTRE entreprise, ou rien. Ce script
 * rassemble, pour les sociétés nommées en argument, ce que la base sait : domaine et provenance, sources qui
 * portent leurs offres (et le domaine carrière de ces sources), hôtes de leurs liens de candidature.
 *
 * Accès : celui de `audits/2026-09-24/scripts/registre-catwalks.mts` (rôle `catwalks_audit`, transaction
 * `READ ONLY`, garde éprouvée avant toute mesure, variables `PG*` héritées retirées). Aucune écriture.
 *
 *   npx tsx audits/2026-09-25/scripts/domaines-suspects.mts "Talbots" "La casa de las Carcasas" …
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const BASE = 'railway';
const noms = process.argv.slice(2);
if (!noms.length) refus('nommer au moins une société');
// Littéraux SQL : apostrophes doublées, rien d'autre n'entre dans la requête.
const liste = noms.map((n) => `'${n.replace(/'/g, "''")}'`).join(',');

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || json_build_object('base', current_database(), 'role', current_user, 'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
SELECT 'S' || E'\\t' || json_build_object('id', c.id, 'nom', c.name, 'domaine', c.domain, 'provenance', c."domainSource",
  'groupe', c."parentGroup", 'fusionneeDans', c."mergedIntoId",
  'sources', (SELECT json_agg(json_build_object('cle', x.cle, 'offres', x.n, 'maison', s.maison, 'tier', s.tier, 'careersDomain', s."careersDomain"))
    FROM (SELECT a."sourceKey" AS cle, count(DISTINCT j.id) AS n FROM "Job" j JOIN "JobSource" a ON a."jobId" = j.id AND a."isActive"
          WHERE j."companyId" = c.id AND j."isActive" GROUP BY 1) x LEFT JOIN "Source" s ON s.key = x.cle),
  'hotes', (SELECT json_object_agg(h.hote, h.n) FROM (
    SELECT substring(a.url from '^https?://([^/?#:]+)') AS hote, count(*) AS n FROM "Job" j JOIN "JobSource" a ON a."jobId" = j.id AND a."isActive"
    WHERE j."companyId" = c.id AND j."isActive" GROUP BY 1 ORDER BY 2 DESC LIMIT 5) h),
  'exemple', (SELECT a.url FROM "Job" j JOIN "JobSource" a ON a."jobId" = j.id AND a."isActive" WHERE j."companyId" = c.id AND j."isActive" LIMIT 1))::text
FROM "Company" c WHERE c.name IN (${liste});
\\else
\\echo REFUS_GARDE
\\endif
COMMIT;`;

const fichier = process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');
const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'domaines-suspects' },
});
if (run.status !== 0) { console.error(run.stderr.replace(/password[^\n]*/gi, '<masqué>')); process.exit(run.status ?? 1); }
const lignes = run.stdout.split('\n').filter(Boolean);
if (lignes.includes('REFUS_GARDE')) refus('garde de lecture seule non satisfaite, aucune mesure exécutée');
const lire = (tag: string) => lignes.filter((l) => l.startsWith(`${tag}\t`)).map((l) => JSON.parse(l.slice(tag.length + 1)));
const [garde] = lire('G');
console.log(`base ${garde.base} · rôle ${garde.role} · lecture seule ${garde.lectureSeule} · ${garde.maintenant}`);
for (const s of lire('S')) console.log(JSON.stringify(s, null, 1));
const trouves = new Set(lire('S').map((s: { nom: string }) => s.nom));
for (const n of noms) if (!trouves.has(n)) console.log(`introuvable : « ${n} »`);
