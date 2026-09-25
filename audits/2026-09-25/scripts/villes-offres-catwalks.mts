/**
 * LES VILLES DES OFFRES CATWALKS FACE AU VOCABULAIRE DU CATALOGUE — prémisse de D-468 §1, mesurée avant de brancher la
 * ville de la liste publique du backend sur la projection des offres directes.
 *
 * ── LA QUESTION ──────────────────────────────────────────────────────────────────────────────
 *
 * Le filtre « ville » de `/emplois` compare `lower(trim(city))` à l'identique, offres agrégées et directes confondues
 * (`apps/api/lib/job-search-query.ts`, `b.ville IN (...)`). Les 59 offres Catwalks en ligne portent 15 villes au backend
 * (`catwalks-backend/scripts/mesure-ville-cp-offres-catwalks-2026-09-25.mjs`), écrites en français : « Londres »,
 * « Pélissanne ». Combien d'offres agrégées publiables portent chacune de ces villes à l'identique, et combien la
 * portent sous une autre graphie (« London », « New York City », « Monte-Carlo ») ? Une ville écrite autrement que le
 * catalogue ferait deux valeurs de facette pour un même lieu.
 *
 * ── LA POPULATION ────────────────────────────────────────────────────────────────────────────
 *
 * Offres agrégées publiables = `publicJobSql` (packages/db/availability.ts), recopiée à l'identique. Aucune offre, aucun
 * identifiant : des comptes par graphie de ville et par pays.
 *
 * ── L'ACCÈS ──────────────────────────────────────────────────────────────────────────────────
 *
 * Le même que `audits/2026-09-24/scripts/volume-par-marche.mts` : production, rôle `catwalks_audit`, identifiants hors
 * dépôt (`~/.catwalks/audit-access.json`), jamais affichés ; transaction `READ ONLY` et garde éprouvée AVANT la mesure.
 *
 *   npx tsx audits/2026-09-25/scripts/villes-offres-catwalks.mts
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const BASE = 'railway';
const fichier = process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');

/** Les 15 villes du backend au 25/09/2026, et les autres graphies d'un même lieu à chercher au catalogue. */
const VILLES: Record<string, readonly string[]> = {
  'Paris': [], 'Berlin': [], 'Lyon': [], 'New York': ['New York City', 'NYC', 'Manhattan', 'Brooklyn'],
  'Aix-en-Provence': ['Aix en Provence'], 'Cannes': [], 'Lille': [], 'Londres': ['London', 'City of London'],
  'Marseille': [], 'Monaco': ['Monte-Carlo', 'Monte Carlo', 'Montecarlo'], 'Nice': [], 'Pélissanne': ['Pelissanne'],
  'Saint-Tropez': ['Saint Tropez', 'St Tropez', 'St-Tropez'], 'Salon-de-Provence': ['Salon de Provence'],
  'Tassin-la-Demi-Lune': ['Tassin la Demi-Lune', 'Tassin la Demi Lune', 'Tassin'],
};
const graphies = Object.entries(VILLES).flatMap(([ville, autres]) => [ville, ...autres].map((g) => ({ ville, graphie: g })));
const litteral = (s: string) => `'${s.replace(/'/g, "''")}'`;
const valeurs = graphies.map(({ ville, graphie }) => `(${litteral(ville)}, ${litteral(graphie)}, lower(trim(${litteral(graphie)})))`).join(',\n  ');

const MAINTENANT = `(now() AT TIME ZONE 'UTC')`;
const PUBLIABLE = `j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id
  AND a."isActive" AND (a."expiresAt" IS NULL OR a."expiresAt" > ${MAINTENANT}))`;

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || json_build_object('base', current_database(), 'role', current_user,
  'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
WITH g(ville, graphie, cle) AS (VALUES
  ${valeurs}
), pub AS (SELECT lower(trim(j.city)) AS cle, j."countryCode" FROM "Job" j WHERE ${PUBLIABLE} AND j.city IS NOT NULL)
SELECT 'V' || E'\\t' || json_build_object('ville', g.ville, 'graphie', g.graphie, 'offres', count(pub.*),
  'pays', (SELECT json_object_agg(p.pays, p.n) FROM (SELECT coalesce(pub2."countryCode", '?') AS pays, count(*) AS n
    FROM pub pub2 WHERE pub2.cle = g.cle GROUP BY 1) p))::text
FROM g LEFT JOIN pub ON pub.cle = g.cle GROUP BY g.ville, g.graphie, g.cle;
-- D-468 §2 : ce que le marché France gagnera avec Monaco, compté par PAYS (toutes graphies de ville confondues).
SELECT 'M' || E'\\t' || json_build_object('pays', 'MC', 'offres', count(*),
  'villes', (SELECT json_object_agg(v.ville, v.n) FROM (SELECT coalesce(trim(j2.city), '(sans ville)') AS ville, count(*) AS n
    FROM "Job" j2 WHERE ${PUBLIABLE.replaceAll('j.', 'j2.')} AND j2."countryCode" = 'MC' GROUP BY 1) v))::text
FROM "Job" j WHERE ${PUBLIABLE} AND j."countryCode" = 'MC';
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
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'villes-offres-catwalks' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim()}`);
const lignes = run.stdout.trim().split('\n').map((l) => l.split('\t'));
if (lignes.some(([t]) => t === 'REFUS')) refus('garde non satisfaite');
const garde = JSON.parse(lignes.find(([t]) => t === 'G')?.[1] ?? 'null');
if (!garde || garde.lectureSeule !== 'on' || garde.base !== BASE || garde.role !== 'catwalks_audit') refus('garde absente');

console.log(`garde ${JSON.stringify(garde)}`);
const mesures = lignes.filter(([t]) => t === 'V').map(([, v]) => JSON.parse(v) as { ville: string; graphie: string; offres: number; pays: Record<string, number> | null });
for (const ville of Object.keys(VILLES)) {
  const lignesVille = mesures.filter((m) => m.ville === ville).sort((a, b) => b.offres - a.offres);
  console.log(`${ville}\t${lignesVille.map((m) => `${m.graphie}=${m.offres}${m.pays ? ` ${JSON.stringify(m.pays)}` : ''}`).join(' · ')}`);
}
const monaco = lignes.find(([t]) => t === 'M');
if (!monaco) refus('compte de Monaco absent');
console.log(`pays MC (toutes villes)\t${monaco[1]}`);
