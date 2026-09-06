import { PrismaClient } from '@prisma/client';
import { resolveCompany } from '../normalize/company.js';

/**
 * Fusion d'identité de société, en gardant id, URL et firstSeenAt des offres
 * (stabilité D22) : la clé de cluster et l'empreinte commencent par l'identité
 * de société, on remplace ce préfixe. Cas : « L'Oréal Professionnel » →
 * « L'Oréal » (étiquette héritée fausse sur le portail groupe, 2026-09-06),
 * « VanCleef-Aprels » → « Van Cleef & Arpels » (faute du flux Richemont).
 *
 * Usage : DATABASE_URL=… npx tsx src/discovery/ops-merge-company.mts "<de>" "<vers>" [--apply] [--source-maison=<clé>]
 * Sans --apply : mesure seulement.
 */
const args = process.argv.slice(2);
const apply = process.argv.includes('--apply');
const [fromName, toName] = args.filter((a) => !a.startsWith('--'));
if (!fromName || !toName) throw new Error('usage: ops-merge-company "<de>" "<vers>" [--apply] [--source-maison=<clé>]');
const sourceMaison = args.find((a) => a.startsWith('--source-maison='))?.slice('--source-maison='.length);
const from = resolveCompany(fromName);
const to = resolveCompany(toName);
const p = new PrismaClient();

// Si la table d'alias résout déjà « de » vers « vers » (faute corrigée dans le code), la ligne
// héritée se retrouve par son NOM tel qu'il est en base, pas par l'identité.
const fromCo =
  from.companyId === to.companyId
    ? await p.company.findFirst({ where: { name: fromName, NOT: { fashionjobsUrl: `resolved:${to.companyId}` } } })
    : await p.company.findUnique({ where: { fashionjobsUrl: `resolved:${from.companyId}` } });
if (!fromCo) throw new Error(`société source introuvable: ${from.companyId}`);
const toCo = (await p.company.findUnique({ where: { fashionjobsUrl: `resolved:${to.companyId}` } })) ?? (apply ? await p.company.create({ data: { name: to.displayName, canonicalKey: to.companyId, fashionjobsUrl: `resolved:${to.companyId}`, sector: fromCo.sector, parentGroup: to.group ?? fromCo.parentGroup, domain: fromCo.domain, domainSource: fromCo.domainSource } }) : null);
if (!toCo) { console.log(`société cible absente (${to.companyId}) : elle sera créée avec --apply`); }


const jobs = await p.job.findMany({ where: { companyId: fromCo.id }, select: { id: true, clusterKey: true, fingerprint: true } });
const fromKey = fromCo.canonicalKey;
const bad = jobs.filter((j) => !j.clusterKey.startsWith(`${fromKey}|`));
console.log(`à déplacer: ${jobs.length} offres (${bad.length} sans le préfixe attendu) — ${fromCo.name} → ${toCo?.name ?? to.displayName}`);
if (!apply || !toCo) { await p.$disconnect(); process.exit(0); }

let moved = 0;
for (const j of jobs) {
  await p.job.update({
    where: { id: j.id },
    data: {
      companyId: toCo.id,
      clusterKey: j.clusterKey.replace(`${fromKey}|`, `${to.companyId}|`),
      fingerprint: j.fingerprint ? j.fingerprint.replace(`${fromKey}|`, `${to.companyId}|`) : undefined,
    },
  });
  moved++;
}
if (sourceMaison) await p.source.updateMany({ where: { key: sourceMaison }, data: { maison: to.displayName } });
const left = await p.job.count({ where: { companyId: fromCo.id } });
if (left === 0) await p.company.delete({ where: { id: fromCo.id } });
console.log(JSON.stringify({ moved, left, deletedCompany: left === 0, target: toCo.id }));
await p.$disconnect();
