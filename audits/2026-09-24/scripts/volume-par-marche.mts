/**
 * VOLUME ET COUVERTURE PAR MARCHÉ — la prémisse des écarts entre le registre des 41 marchés
 * (packages/db/marches.ts) et la règle R-123 (D-436), mesurée avant de soumettre la carte.
 *
 * ── LA QUESTION ──────────────────────────────────────────────────────────────────────────────
 *
 * R-123 : « un marché existe parce qu'on y a des offres » et « une facette n'apparaît que si elle
 * est renseignée au-delà de 20 % ». Le registre ouvre 41 marchés et impose partout les facettes
 * d'emploi `contrat` et `temps`. Combien d'offres publiables chaque marché sert-il réellement, et
 * quelle part porte une durée de contrat (`employmentTerm`) ou un temps de travail (`workTime`) ?
 *
 * ── LA POPULATION ────────────────────────────────────────────────────────────────────────────
 *
 * Offres publiables = `publicJobSql` (packages/db/availability.ts), recopiée à l'identique
 * dans `multi-pays-mesure.mts`. Le périmètre d'un marché est la liste `pays` de son entrée du
 * registre (GB sert GB et IE, DE sert DE et AT). Les offres directes (`DirectOffer`) sont
 * comptées à part. La couverture `employmentTerm` ne mesure qu'un des trois axes de la nature
 * d'emploi (durée, programme, indépendant) : c'est une borne basse de la facette « contrat ».
 *
 * ── L'ACCÈS ──────────────────────────────────────────────────────────────────────────────────
 *
 * Le même que `multi-pays-mesure.mts` : production, rôle `catwalks_audit`, identifiants hors
 * dépôt (`~/.catwalks/audit-access.json`), jamais affichés ; `psql` reçoit les identifiants par
 * son environnement ; transaction `READ ONLY` et garde éprouvée AVANT toute mesure.
 *
 *   npx tsx audits/2026-09-24/scripts/volume-par-marche.mts [--json]
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { CODES_MARCHE, marche } from '@catwalks/db/marches';

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
const litteral = (codes: readonly string[]) => `ARRAY[${codes.map((c) => `'${c.replace(/[^A-Z]/g, '')}'`).join(',')}]::text[]`;
const perimetres = CODES_MARCHE.map((code) => `SELECT '${code}'::text AS marche, ${litteral(marche(code)!.pays)} AS pays`).join(' UNION ALL ');

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || json_build_object('base', current_database(), 'role', current_user,
  'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
WITH p AS (${perimetres}),
     pub AS (SELECT j."countryCode", j."employmentTerm", j."workTime" FROM "Job" j WHERE ${PUBLIABLE})
SELECT 'M' || E'\\t' || json_build_object('marche', p.marche, 'offres', count(pub.*),
  'avecDuree', count(pub."employmentTerm"), 'avecTemps', count(pub."workTime"))::text
FROM p LEFT JOIN pub ON pub."countryCode" = ANY (p.pays) GROUP BY p.marche;
SELECT 'T' || E'\\t' || json_build_object('publiables', count(*), 'sansPays', count(*) FILTER (WHERE j."countryCode" IS NULL))::text
FROM "Job" j WHERE ${PUBLIABLE};
SELECT 'D' || E'\\t' || json_build_object('directOffers', (SELECT count(*) FROM "DirectOffer"))::text;
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
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'volume-par-marche' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim()}`);
const lignes = run.stdout.trim().split('\n').map((l) => l.split('\t'));
if (lignes.some(([t]) => t === 'REFUS')) refus('garde non satisfaite');
const garde = JSON.parse(lignes.find(([t]) => t === 'G')?.[1] ?? 'null');
if (!garde || garde.lectureSeule !== 'on' || garde.base !== BASE || garde.role !== 'catwalks_audit') refus('garde absente');
const marches = lignes.filter(([t]) => t === 'M').map(([, v]) => JSON.parse(v))
  .map((m) => ({ ...m, tauxDuree: m.offres ? m.avecDuree / m.offres : 0, tauxTemps: m.offres ? m.avecTemps / m.offres : 0 }))
  .sort((a, b) => b.offres - a.offres);
const total = JSON.parse(lignes.find(([t]) => t === 'T')![1]);
const direct = JSON.parse(lignes.find(([t]) => t === 'D')![1]);

if (sortieJson) {
  console.log(JSON.stringify({ garde, total, direct, marches }, null, 1));
} else {
  console.log(`garde ${JSON.stringify(garde)}`);
  console.log(`publiables ${total.publiables} (sans pays ${total.sansPays}) · offres directes ${direct.directOffers}`);
  for (const m of marches) {
    console.log(`${m.marche}\t${m.offres}\tdurée ${(100 * m.tauxDuree).toFixed(1)} %\ttemps ${(100 * m.tauxTemps).toFixed(1)} %`);
  }
}
