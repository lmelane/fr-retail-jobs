/**
 * ESSAI À BLANC DE `poser-domaines-relus.mts` SUR LA PRODUCTION, EN LECTURE SEULE (logos manquants, 25/09/2026)
 *
 * Lit l'état des sociétés de la liste relue (`id`, `name`, `domain`, `mergedIntoId`) par le rôle `catwalks_audit`
 * (garde du modèle `audits/2026-09-24/scripts/registre-catwalks.mts`), puis appelle le MÊME plan
 * (`apps/aggregator/scripts/ops/domaines-relus.ts`) que le script d'écriture : même rapport, même empreinte.
 * L'inspection de Loïc (`db.py readonly … poser-domaines-relus.mts`) doit imprimer cette empreinte ; si la base a
 * bougé entre-temps, elle en imprimera une autre, et l'écriture refusera toute empreinte périmée.
 *
 *   npx tsx audits/2026-09-25/scripts/domaines-relus-essai-a-blanc.mts [audits/2026-09-25/domaines-relus-logos.json]
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { empreinte, planifier, rapport, validerFichier, type EtatSociete } from '../../../apps/aggregator/scripts/ops/domaines-relus.ts';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const BASE = 'railway';
const chemin = process.argv[2] ?? new URL('../domaines-relus-logos.json', import.meta.url).pathname;
const fichier = validerFichier(JSON.parse(readFileSync(chemin, 'utf8')));
const ids = fichier.domaines.map((d) => d.id);
if (ids.some((id) => !/^[a-z0-9-]{20,40}$/.test(id))) refus('identifiant de société inattendu dans le fichier');

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || json_build_object('base', current_database(), 'role', current_user, 'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
SELECT 'C' || E'\\t' || json_build_object('id', c.id, 'name', c.name, 'domain', c.domain, 'mergedIntoId', c."mergedIntoId")::text
FROM "Company" c WHERE c.id IN (${ids.map((id) => `'${id}'`).join(',')});
SELECT 'P' || E'\\t' || json_build_object('enCours', count(*))::text FROM "PipelineRun"
WHERE status = 'RUNNING' AND "finishedAt" IS NULL AND "startedAt" > now() - interval '12 hours';
\\else
\\echo REFUS_GARDE
\\endif
COMMIT;`;

const acces: Record<string, unknown> = (() => {
  try { return JSON.parse(readFileSync(process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`, 'utf8')); }
  catch { return refus('fichier d’accès absent ou invalide'); }
})();
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');
const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'domaines-relus-essai-a-blanc' },
});
if (run.status !== 0) { console.error(run.stderr.replace(/password[^\n]*/gi, '<masqué>')); process.exit(run.status ?? 1); }
const lignes = run.stdout.split('\n').filter(Boolean);
if (lignes.includes('REFUS_GARDE')) refus('garde de lecture seule non satisfaite, aucune mesure exécutée');
const lire = (tag: string) => lignes.filter((l) => l.startsWith(`${tag}\t`)).map((l) => JSON.parse(l.slice(tag.length + 1)));
const [garde] = lire('G');
const [pipeline] = lire('P');
console.log(`base ${garde.base} · rôle ${garde.role} · lecture seule ${garde.lectureSeule} · ${garde.maintenant}`);
const actions = planifier(fichier, new Map<string, EtatSociete>((lire('C') as EtatSociete[]).map((c) => [c.id, c])));
console.log(`\n${rapport(fichier, actions)}\n\nempreinte du plan : ${empreinte(fichier.lot, actions)}`);
console.log(`exécutions du pipeline en cours (moins de 12 h) : ${pipeline.enCours} — l’écriture les refuse\n`);
