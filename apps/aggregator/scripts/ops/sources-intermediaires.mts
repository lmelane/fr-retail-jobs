/**
 * LES SOURCES QUI NE SONT PAS DES EMPLOYEURS (cabinets, job boards) — lecture seule, en production.
 *
 * D-453 §4 (24/09/2026) : « la source Luxe Talent est supprimée » ; le CEO a rappelé le 29/09/2026 que le seul job board
 * ou cabinet qui reste est WTTJ. Ce lecteur rend, pour chaque niveau de source (`tier`), les sources et leur statut, et
 * pour chaque source hors employeur : ses offres actives, publiées et ses refus d'identité du dernier jour. Il mesure
 * l'écart entre la décision et la production avant tout retrait.
 *
 * Accès et garde : ceux de `scripts/taxonomie/mesure-application-2b.mts` (rôle `catwalks_audit`, identifiants hors dépôt
 * jamais affichés, transaction `READ ONLY` vérifiée AVANT toute lecture).
 *
 *   node --import tsx apps/aggregator/scripts/ops/sources-intermediaires.mts
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

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
SELECT json_build_object(
  'parNiveau', (SELECT json_object_agg(tier, n) FROM (SELECT tier || ' / ' || status AS tier, count(*) AS n FROM "Source" GROUP BY 1 ORDER BY 1) x),
  'horsEmployeur', (SELECT json_agg(json_build_object('cle', s.key, 'maison', s.maison, 'niveau', s.tier, 'type', s.kind, 'statut', s.status,
     'offresActives', (SELECT count(*) FROM "JobSource" js WHERE js."sourceKey" = s.key AND js."isActive"),
     'offresPubliees', (SELECT count(DISTINCT j.id) FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId" WHERE js."sourceKey" = s.key AND j."isActive" AND j."mergedIntoId" IS NULL),
     'refusIdentite24h', (SELECT count(*) FROM "PipelineEvent" e WHERE e."sourceKey" = s.key AND e.event = 'job.write_failed' AND e.at > now() - interval '24 hours'))
     ORDER BY s.tier, s.key)
     FROM "Source" s WHERE s.tier NOT IN ('ATS_OFFICIAL', 'EMPLOYER_DIRECT') OR s.key ILIKE '%luxe%' OR s.key ILIKE '%wttj%'),
  -- Ce que le retrait (\`retire-source\`) toucherait pour une source : ses attestations, et les offres qu'aucune autre source
  -- n'atteste (supprimées par le mécanisme), actives ou fermées.
  'retrait', (SELECT json_object_agg(k, json_build_object(
     'attestations', (SELECT count(*) FROM "JobSource" WHERE "sourceKey" = k),
     'offresSansAutreSource', (SELECT count(DISTINCT js."jobId") FROM "JobSource" js WHERE js."sourceKey" = k
        AND NOT EXISTS (SELECT 1 FROM "JobSource" o WHERE o."jobId" = js."jobId" AND o."sourceKey" <> k)),
     'dontActives', (SELECT count(DISTINCT j.id) FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId" WHERE js."sourceKey" = k AND j."isActive"
        AND NOT EXISTS (SELECT 1 FROM "JobSource" o WHERE o."jobId" = js."jobId" AND o."sourceKey" <> k))))
     FROM unnest(ARRAY['luxe-talent']) k),
  -- Le registre des portails refusés pour identité (D-453 §4) : propriétaire, domaine officiel, éditeur, périmètre déclaré,
  -- et les adresses de la configuration (jamais ses valeurs secrètes : seules les clés au nom d'URL, d'hôte ou de tenant).
  'portails', (SELECT json_agg(json_build_object('cle', s.key, 'maison', s.maison, 'domaine', s."careersDomain", 'type', s.kind,
     'niveau', s.tier, 'statut', s.status, 'perimetre', s."portalScope", 'revision', s."currentRevisionId" IS NOT NULL,
     'adresses', (SELECT json_object_agg(c.key, c.value) FROM jsonb_each_text(s.config) c
        WHERE c.key ~* '(url|host|tenant|site|domain|board|company|index)' AND c.key !~* '(key|token|secret|password)'),
     'refus24h', (SELECT json_object_agg(m, n) FROM (SELECT e.payload->'error'->>'motif' AS m, count(*) AS n FROM "PipelineEvent" e
        WHERE e."sourceKey" = s.key AND e.event = 'job.write_failed' AND e.at > now() - interval '24 hours' GROUP BY 1) r),
     'libelles', (SELECT json_agg(DISTINCT e.payload->'error'->>'rawEmployerName') FROM "PipelineEvent" e
        WHERE e."sourceKey" = s.key AND e.event = 'job.write_failed' AND e.at > now() - interval '24 hours')) ORDER BY s.key)
     FROM "Source" s WHERE s.key = ANY(ARRAY['tiffany-oracle','rivoli-typesense','brown-thomas-taleo','beauty-success-geodir','groupe-printemps',
       'hot-topic','lagardere-travel-retail','lagardere-travel-retail-de','lagardere-duty-free','b-s-international','funky-buddha','browns','lvmh'])));
\\else
SELECT 'REFUS';
\\endif
ROLLBACK;
`;
const { PATH, HOME, LANG } = process.env;
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script, maxBuffer: 64 * 1024 * 1024,
  env: { PATH, HOME, LANG, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'sources-intermediaires' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.split('\n')[0]}`);
const sortie = run.stdout.trim();
if (sortie === 'REFUS' || !sortie.startsWith('{')) refus('garde de lecture seule non vérifiée');
console.log(JSON.stringify(JSON.parse(sortie), null, 1));
