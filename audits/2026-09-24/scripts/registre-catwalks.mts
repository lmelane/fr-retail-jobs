/**
 * LE REGISTRE CONNAÎT-IL DÉJÀ UNE SOCIÉTÉ « CATWALKS » ? (D-455 §1, annuaire)
 *
 * D-455 fait nommer « Catwalks » l'employeur affiché d'une offre Catwalks sans Maison publique, et compter ces
 * offres sous UNE ligne de l'annuaire. L'annuaire (`apps/api/lib/companies.ts`) rattache une offre directe à une
 * société du registre dont le nom est EXACTEMENT le sien (`idParNom`), et le bloc Maison d'une fiche
 * (`getCompanyAside`, `apps/api/lib/jobs.ts`) cherche la société par ce même nom. Si le registre contient une
 * société nommée « Catwalks », ces offres rejoindraient sa ligne, ses offres agrégées et son domaine.
 *
 * L'index de recherche (`apps/api/lib/search-model.ts`) rattache aussi une offre directe à une société par son nom
 * NORMALISÉ, par un alias revu (`CompanyAlias`) ou par l'ancien nom d'une société fusionnée ; un nom de groupe
 * (`parentGroup`) y devient aussi un nom cherchable.
 *
 * Mesure, en lecture seule : les sociétés dont le nom, la clé canonique, le domaine ou le groupe ressemble à
 * « catwalks » (motif large « cat…walk »), en signalant le nom EXACT (critère de l'annuaire et du bloc Maison), leur
 * fusion éventuelle et leurs offres publiables ; les alias qui lui ressemblent, revus ou non ; et les offres directes
 * (`DirectOffer`) par nom d'employeur.
 *
 * L'ACCÈS est celui de `pays-signaux-contradictoires.mts` : production, rôle `catwalks_audit`, identifiants hors
 * dépôt (`~/.catwalks/audit-access.json`), jamais affichés, transmis à `psql` par son environnement ; transaction
 * `READ ONLY` et garde éprouvée AVANT toute mesure (base attendue, lecture seule effective, rôle non
 * superutilisateur) ; sinon rien ne s'exécute.
 *
 *   npx tsx audits/2026-09-24/scripts/registre-catwalks.mts
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const BASE = 'railway';
const MAINTENANT = `(now() AT TIME ZONE 'UTC')`;
const PUBLIABLE = `j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id
  AND a."isActive" AND (a."expiresAt" IS NULL OR a."expiresAt" > ${MAINTENANT}))`;
const ligne = (tag: string, json: string) => `SELECT '${tag}' || E'\\t' || (${json})::text;`;

const MOTIF = `'%cat%walk%'`;
const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
${ligne('G', `json_build_object('base', current_database(), 'role', current_user, 'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())`)}
\\if :garde_ok
SELECT 'C' || E'\\t' || json_build_object('id', c.id, 'nom', c.name, 'nomExact', c.name = 'Catwalks', 'cle', c."canonicalKey", 'domaine', c.domain,
  'groupe', c."parentGroup", 'fusionneeDans', c."mergedIntoId",
  'offresPubliables', (SELECT count(*) FROM "Job" j WHERE j."companyId" = c.id AND ${PUBLIABLE}))::text
FROM "Company" c
WHERE c.name ILIKE ${MOTIF} OR c."canonicalKey" ILIKE ${MOTIF} OR coalesce(c.domain, '') ILIKE ${MOTIF} OR coalesce(c."parentGroup", '') ILIKE ${MOTIF};
SELECT 'A' || E'\\t' || json_build_object('id', a.id, 'alias', a."displayName", 'normalise', a."normalizedName", 'revu', a."reviewId" IS NOT NULL,
  'societe', a."companyId", 'source', a."sourceKey")::text
FROM "CompanyAlias" a
WHERE a."displayName" ILIKE ${MOTIF} OR coalesce(a."normalizedName", '') ILIKE ${MOTIF};
${ligne('D', `json_build_object('offresDirectes', (SELECT count(*) FROM "DirectOffer"),
  'parEmployeur', (SELECT coalesce(json_object_agg(company, n), '{}'::json) FROM (SELECT company, count(*) AS n FROM "DirectOffer" GROUP BY company) x))`)}
\\else
\\echo REFUS_GARDE
\\endif
COMMIT;`;

const fichier = process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');
// Aucune variable `PG*` héritée (`PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`…) ne peut rediriger la connexion.
const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script, encoding: 'utf8',
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'registre-catwalks' },
});
if (run.status !== 0) { console.error(run.stderr.replace(/password[^\n]*/gi, '<masqué>')); process.exit(run.status ?? 1); }
const lignes = run.stdout.split('\n').filter(Boolean);
if (lignes.includes('REFUS_GARDE')) refus('garde de lecture seule non satisfaite, aucune mesure exécutée');
const lire = (tag: string) => lignes.filter((l) => l.startsWith(`${tag}\t`)).map((l) => JSON.parse(l.slice(tag.length + 1)) as Record<string, unknown>);
const [garde] = lire('G');
console.log(`base ${String(garde.base)} · rôle ${String(garde.role)} · lecture seule ${String(garde.lectureSeule)} · ${String(garde.maintenant)}`);
const societes = lire('C');
console.log(`sociétés dont le nom, la clé, le domaine ou le groupe ressemble à « catwalks » (motif « cat…walk ») : ${societes.length}`);
for (const s of societes) console.log(`  ${JSON.stringify(s)}`);
console.log(`nom EXACT « Catwalks » (critère de fusion de l'annuaire et du bloc Maison) : ${societes.filter((s) => s.nomExact).length}`);
const alias = lire('A');
console.log(`alias qui ressemblent à « catwalks » (index de recherche : alias revus) : ${alias.length} · dont revus : ${alias.filter((a) => a.revu).length}`);
for (const a of alias) console.log(`  ${JSON.stringify(a)}`);
const [directes] = lire('D');
console.log(`offres directes : ${JSON.stringify(directes)}`);
