import { PrismaClient } from '@prisma/client';
import { resolveCompany } from '../normalize/company.js';

/**
 * Opération unique (2026-09-06) : les offres du portail groupe careers.loreal.com
 * étaient créditées à « L'Oréal Professionnel » (clé `l-oreal-professionnel`,
 * étiquette héritée d'un fichier) alors que c'est le portail de TOUT le groupe.
 * Après `retire-source loreal` (la route sitemap en doublon, 1 788 offres sans
 * lieu ni description), on déplace les offres vers la société « L'Oréal » en
 * gardant id, URL et firstSeenAt (stabilité D22) : la clé de cluster et
 * l'empreinte commencent par l'identité de société, on remplace ce préfixe.
 *
 * Usage : DATABASE_URL=… npx tsx src/discovery/ops-loreal-merge.mts [--apply]
 * Sans --apply : mesure seulement.
 */
const apply = process.argv.includes('--apply');
const from = resolveCompany("L'Oréal Professionnel");
const to = resolveCompany("L'Oréal");
const p = new PrismaClient();

const fromCo = await p.company.findUnique({ where: { fashionjobsUrl: `resolved:${from.companyId}` } });
const toCo = await p.company.findUnique({ where: { fashionjobsUrl: `resolved:${to.companyId}` } });
if (!fromCo || !toCo) throw new Error(`sociétés introuvables: from=${fromCo?.id} to=${toCo?.id}`);

const stillLoreal = await p.jobSource.count({ where: { sourceKey: 'loreal', isActive: true } });
if (stillLoreal > 0) throw new Error(`retire-source loreal d'abord : ${stillLoreal} rattachements encore actifs`);

const jobs = await p.job.findMany({ where: { companyId: fromCo.id }, select: { id: true, clusterKey: true, fingerprint: true } });
const bad = jobs.filter((j) => !j.clusterKey.startsWith(`${from.companyId}|`));
console.log(`à déplacer: ${jobs.length} offres (${bad.length} sans le préfixe attendu) — ${fromCo.name} → ${toCo.name}`);
if (!apply) { await p.$disconnect(); process.exit(0); }

let moved = 0;
for (const j of jobs) {
  await p.job.update({
    where: { id: j.id },
    data: {
      companyId: toCo.id,
      clusterKey: j.clusterKey.replace(`${from.companyId}|`, `${to.companyId}|`),
      fingerprint: j.fingerprint ? j.fingerprint.replace(`${from.companyId}|`, `${to.companyId}|`) : undefined,
    },
  });
  moved++;
}
await p.source.updateMany({ where: { key: 'l-oreal-professionnel' }, data: { maison: "L'Oréal" } });
const left = await p.job.count({ where: { companyId: fromCo.id } });
if (left === 0) await p.company.delete({ where: { id: fromCo.id } });
console.log(JSON.stringify({ moved, left, deletedCompany: left === 0, target: toCo.id }));
await p.$disconnect();
