/**
 * CE QU'UNE ALERTE APPELLERAIT « NOUVEAU » — la prémisse de la question Q1 du lot parcours
 * (D-460 : l'e-mail d'alertes ne part que s'il y a du nouveau), mesurée avant de la soumettre.
 *
 * ── LA QUESTION ──────────────────────────────────────────────────────────────────────────────
 *
 * Une offre « nouvelle » pour une alerte peut se définir par son entrée au catalogue
 * (`Job.firstSeenAt`, posée à la première collecte) ou par sa date de publication déclarée par
 * la source (`Job.postedAt`, absente pour une partie des sources). Combien d'offres publiables
 * n'ont pas de date de publication ? Combien d'offres entrent chaque jour, et quelle part de
 * celles qui entrent était publiée depuis plus de 30 jours au moment de son entrée ?
 *
 * ── LA POPULATION ────────────────────────────────────────────────────────────────────────────
 *
 * Offres publiables = `publicJobSql` (packages/db/availability.ts), recopiée à l'identique de
 * `audits/2026-09-24/scripts/volume-par-marche.mts`. Le marché France est la liste `pays` de son
 * entrée du registre. Les entrées par jour comptent aussi les offres entrées puis fermées depuis
 * (colonne `entrees`), à côté de celles encore publiables (`publiables`) : lire les seules
 * survivantes sous-estimerait le flux. Une offre fusionnée dans une autre n'est jamais comptée.
 *
 * ── L'ACCÈS ──────────────────────────────────────────────────────────────────────────────────
 *
 * Le même que `volume-par-marche.mts` : production, rôle `catwalks_audit`, identifiants hors
 * dépôt (`~/.catwalks/audit-access.json`), jamais affichés ; `psql` reçoit les identifiants par
 * son environnement ; transaction `READ ONLY` et garde éprouvée AVANT toute mesure.
 *
 *   npx tsx audits/2026-09-25/scripts/nouveautes-catalogue.mts [--json]
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { marche } from '@catwalks/db/marches';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const sortieJson = process.argv.includes('--json');
const BASE = 'railway';
const fichier = process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');

const MAINTENANT = `(now() AT TIME ZONE 'UTC')`;
const PUBLIABLE = `j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id
  AND a."isActive" AND (a."expiresAt" IS NULL OR a."expiresAt" > ${MAINTENANT}))`;
const paysFrance = marche('FR')?.pays ?? refus('marché FR absent du registre');
const FR = `j."countryCode" = ANY (ARRAY[${paysFrance.map((c) => `'${c.replace(/[^A-Z]/g, '')}'`).join(',')}]::text[])`;
const ANCIENNE = `j."postedAt" < j."firstSeenAt" - interval '30 days'`;

const bilan = (perimetre: string, filtre: string) => `
SELECT 'B' || E'\\t' || json_build_object('perimetre', '${perimetre}',
  'publiables', count(*),
  'publiablesSansDate', count(*) FILTER (WHERE j."postedAt" IS NULL),
  'entrees7j', count(*) FILTER (WHERE j."firstSeenAt" >= now() - interval '7 days'),
  'entrees7jSansDate', count(*) FILTER (WHERE j."firstSeenAt" >= now() - interval '7 days' AND j."postedAt" IS NULL),
  'entrees7jAnciennes', count(*) FILTER (WHERE j."firstSeenAt" >= now() - interval '7 days' AND ${ANCIENNE}))::text
FROM "Job" j WHERE ${PUBLIABLE} AND ${filtre};`;

const parJour = (perimetre: string, filtre: string) => `
SELECT 'J' || E'\\t' || json_build_object('perimetre', '${perimetre}', 'jour', jour, 'entrees', entrees, 'publiables', publiables)::text
FROM (SELECT (j."firstSeenAt" AT TIME ZONE 'Europe/Paris')::date AS jour, count(*) AS entrees,
             count(*) FILTER (WHERE ${PUBLIABLE}) AS publiables
      FROM "Job" j
      WHERE j."mergedIntoId" IS NULL AND j."firstSeenAt" >= now() - interval '14 days' AND ${filtre}
      GROUP BY 1) t ORDER BY jour;`;

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || json_build_object('base', current_database(), 'role', current_user,
  'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
${bilan('FR', FR)}
${bilan('TOUS', 'true')}
${parJour('FR', FR)}
${parJour('TOUS', 'true')}
\\else
SELECT 'REFUS' || E'\\t' || 'garde';
\\endif
ROLLBACK;
`;

// Aucune variable `PG*` héritée (`PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`…) ne peut rediriger la connexion.
const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script,
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'nouveautes-catalogue' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim()}`);
const lignes = run.stdout.trim().split('\n').map((l) => l.split('\t'));
if (lignes.some(([t]) => t === 'REFUS')) refus('garde non satisfaite');
const garde = JSON.parse(lignes.find(([t]) => t === 'G')?.[1] ?? 'null');
if (!garde || garde.lectureSeule !== 'on' || garde.base !== BASE || garde.role !== 'catwalks_audit') refus('garde absente');
const bilans = lignes.filter(([t]) => t === 'B').map(([, v]) => JSON.parse(v));
const jours = lignes.filter(([t]) => t === 'J').map(([, v]) => JSON.parse(v));

if (sortieJson) {
  console.log(JSON.stringify({ garde, bilans, jours }, null, 1));
} else {
  console.log(`garde ${JSON.stringify(garde)}`);
  for (const b of bilans) {
    const part = (n: number, d: number) => (d ? `${(100 * n / d).toFixed(1)} %` : '—');
    console.log(`${b.perimetre}\tpubliables ${b.publiables}\tsans date ${b.publiablesSansDate} (${part(b.publiablesSansDate, b.publiables)})`
      + `\tentrées 7 j ${b.entrees7j}\tdont sans date ${b.entrees7jSansDate}\tdont publiées > 30 j avant l'entrée ${b.entrees7jAnciennes}`
      + ` (${part(b.entrees7jAnciennes, b.entrees7j)})`);
  }
  for (const j of jours) console.log(`${j.perimetre}\t${j.jour}\tentrées ${j.entrees}\tencore publiables ${j.publiables}`);
}
