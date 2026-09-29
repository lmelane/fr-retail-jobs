/**
 * EXPORT DE LA VERSION SERVIE DE LA TAXONOMIE (D-475 lot 2, sous-lot 2A ; plan §3.1).
 *
 * La taxonomie v3 part de la version ACTIVE en production, pas du fichier du dépôt (`packages/db/data/occupations-v1.json`
 * porte une version 62 métiers jamais activée ; la production sert `catwalks-occupations-20260909-v1`, 61 métiers,
 * mesuré le 28/09/2026). Ce script lit le manifeste actif en base et l'écrit tel quel, avec son empreinte, dans
 * `audits/2026-09-28/curation-v3/entrees/<id>.json` (entrée datée de la passe de curation, sans secret).
 *
 * Accès et garde : ceux de `audits/2026-09-28/scripts/rattachement-metier-offres.mts` (rôle `catwalks_audit`,
 * identifiants hors dépôt jamais affichés, transaction `READ ONLY`, garde éprouvée AVANT toute lecture).
 *
 *   node --import tsx apps/aggregator/scripts/taxonomie/exporter-version-servie.mts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const BASE = 'railway';
const fichier = process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
\\if :garde_ok
SELECT 'M' || E'\\t' || json_build_object('id', r.id, 'contentHash', r."contentHash", 'manifest', r.manifest)::text
FROM "OccupationRelease" r JOIN "OccupationState" s ON s."releaseId" = r.id;
\\else
SELECT 'REFUS' || E'\\t' || 'garde';
\\endif
ROLLBACK;
`;
const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script, maxBuffer: 64 * 1024 * 1024,
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'exporter-version-servie' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim()}`);
const lignes = run.stdout.trim().split('\n').map((l) => l.split('\t'));
if (lignes.some(([t]) => t === 'REFUS')) refus('garde non satisfaite');
const ligne = lignes.find(([t]) => t === 'M');
if (!ligne) refus('aucune version active');
const { id, contentHash, manifest } = JSON.parse(ligne![1]) as { id: string; contentHash: string; manifest: { id: string; occupations: unknown[]; families: unknown[]; groups: unknown[] } };
if (manifest.id !== id) refus(`identifiant incohérent : ${manifest.id} ≠ ${id}`);
const dossier = fileURLToPath(new URL('../../../../audits/2026-09-28/curation-v3/entrees/', import.meta.url));
mkdirSync(dossier, { recursive: true });
const texte = JSON.stringify(manifest, null, 1) + '\n';
writeFileSync(`${dossier}${id}.json`, texte);
console.log(JSON.stringify({ fichier: `audits/2026-09-28/curation-v3/entrees/${id}.json`, contentHashEnBase: contentHash,
  sha256Fichier: createHash('sha256').update(texte).digest('hex'), metiers: manifest.occupations.length,
  familles: manifest.families.length, domaines: manifest.groups.length }, null, 1));
