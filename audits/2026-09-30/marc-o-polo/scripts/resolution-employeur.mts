/**
 * MARC O'POLO (D-489) — LA CHAÎNE DE RÉSOLUTION DE L'EMPLOYEUR, EXÉCUTÉE EN LECTURE SEULE SUR LA PRODUCTION.
 *
 *   PYTHONDONTWRITEBYTECODE=1 python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/2026-09-30/marc-o-polo/scripts/resolution-employeur.mts
 *
 * Reconstruit, hors réseau, les 116 offres du lecteur dédié à partir des réponses réelles du 30/09 (fixtures du dépôt :
 * liste et fiches de l'API, pages d'offre 2026-4270 et 2026-4271 lues pour l'employeur), puis fait passer chacune par
 * le VRAI chemin d'écriture jusqu'à l'identité : `toCandidate` (pipeline/ingest.ts) puis `resolveEmployer`
 * (identity/resolve.ts), dans une transaction `READ ONLY` (le résolveur ne fait que lire ; la transaction l'impose).
 * Rend la société obtenue et la règle, et les compare à la société des publications en ligne.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { readEmployerFromJobPage, readMarcOPoloRaw, vacancyPageUrl } from '../../../../apps/aggregator/src/ats/adapters/marcOPolo.js';
import { toCandidate } from '../../../../apps/aggregator/src/pipeline/ingest.js';
import { resolveEmployer } from '../../../../apps/aggregator/src/identity/resolve.js';
import { createHash } from 'node:crypto';

const fx = (name: string) => gunzipSync(readFileSync(new URL(`../../../../apps/aggregator/src/ats/adapters/__fixtures__/${name}`, import.meta.url))).toString('utf8');
const archive = JSON.parse(fx('marc-o-polo-reponses-20260930.json.gz')) as Array<{ url: string; status: number; body: string }>;
const API = 'https://vhfco59ro6.execute-api.eu-central-1.amazonaws.com/production';
const body = (url: string) => archive.find((r) => r.url === url && r.status === 200)!.body;
const list = JSON.parse(body(`${API}/vacancies?language=en`)) as Array<Record<string, unknown> & { id: string; title: string }>;
const pages = [['2026-4270', fx('marc-o-polo-fiche-4270-20260930.html.gz')], ['2026-4271', fx('marc-o-polo-fiche-4271-20260930.html.gz')]] as const;
const statement = { pages: [] as Array<{ url: string; sha256: string }>, names: new Set<string>() };
for (const [id, html] of pages) {
  const row = list.find((r) => r.id === id)!;
  const detail = JSON.parse(body(`${API}/vacancies/${id}?language=en`));
  const read = readEmployerFromJobPage(html, detail.title);
  if ('problem' in read) throw new Error(`page ${id} : ${read.problem}`);
  statement.names.add(read.name);
  statement.pages.push({ url: vacancyPageUrl('en', row.title, id), sha256: createHash('sha256').update(html).digest('hex') });
}
if (statement.names.size !== 1) throw new Error('pages en désaccord');
const employer = { name: [...statement.names][0], pages: statement.pages };

const prisma = new PrismaClient({ log: [] });
try {
  const [source] = await prisma.$queryRawUnsafe<Array<{ maison: string; tier: string; careersDomain: string | null }>>(
    `SELECT maison, tier, "careersDomain" FROM "Source" WHERE key = 'marc-o-polo'`);
  const online = new Map((await prisma.$queryRawUnsafe<Array<{ externalId: string; companyId: string }>>(
    `SELECT s."externalId", j."companyId" FROM "JobSource" s JOIN "Job" j ON j.id = s."jobId" WHERE s."sourceKey" = 'marc-o-polo' AND s."isActive"`))
    .map((row) => [row.externalId, row.companyId]));
  const resultats: Record<string, number> = {};
  const societes = new Set<string>();
  let enLigne = 0, memeSociete = 0;
  // Prémisse : la même chaîne SANS nom lu (page illisible) — les offres doivent être refusées pour identité.
  const sansNom: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    for (const row of list) {
      const detail = JSON.parse(body(`${API}/vacancies/${row.id}?language=en`));
      const retained = { source: 'marc-o-polo-vacancies-v1', language: 'en', pageUrl: vacancyPageUrl('en', row.title, row.id), listing: row, detail };
      const orphan = readMarcOPoloRaw({ ...retained, employer: { problem: 'EMPLOYER_PAGE_FETCH_FAILED', pages: [] } })!;
      const orphanDef = { key: 'marc-o-polo', company: source.maison, tier: source.tier as never, careersDomain: source.careersDomain ?? undefined };
      try { const r = await resolveEmployer(tx, toCandidate(orphan, orphanDef, orphan.company || orphanDef.company, 'GENERIC_JSONLD')); sansNom[r.rule] = (sansNom[r.rule] ?? 0) + 1; }
      catch (error) { const code = (error as { motif?: string }).motif ?? (error as Error).name; sansNom[`REFUS:${code}`] = (sansNom[`REFUS:${code}`] ?? 0) + 1; }
      const job = readMarcOPoloRaw({ ...retained, employer })!;
      const def = { key: 'marc-o-polo', company: source.maison, tier: source.tier as never, careersDomain: source.careersDomain ?? undefined };
      const candidate = toCandidate(job, def, job.company || def.company, 'GENERIC_JSONLD');
      try {
        const resolution = await resolveEmployer(tx, candidate);
        resultats[resolution.rule] = (resultats[resolution.rule] ?? 0) + 1;
        if (resolution.company) societes.add(`${resolution.company.id} ${resolution.company.name}`);
        if (online.has(job.externalId)) { enLigne++; if (resolution.company?.id === online.get(job.externalId)) memeSociete++; }
      } catch (error) { const code = (error as { motif?: string }).motif ?? (error as Error).name; resultats[`REFUS:${code}`] = (resultats[`REFUS:${code}`] ?? 0) + 1; }
    }
  }, { timeout: 120_000 });
  console.log(JSON.stringify({ premisseSansNom: sansNom, employeurLu: employer.name, pages: employer.pages.map((p) => p.url), offres: list.length, resultats,
    societesObtenues: [...societes], societesDesOffresEnLigne: [...new Set(online.values())], offresEnLigneRetrouvees: enLigne, rattacheesALaMemeSociete: memeSociete }, null, 1));
} finally {
  await prisma.$disconnect();
}
