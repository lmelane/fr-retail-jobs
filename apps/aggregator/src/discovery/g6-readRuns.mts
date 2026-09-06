import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  for (const key of ['loreal', 'kering', 'hermes']) {
    const runs = await prisma.sourceRun.findMany({ where: { sourceKey: key }, orderBy: { ranAt: 'desc' }, take: 6 });
    for (const r of runs) console.log(`${key} ${r.ranAt.toISOString()} ${r.status} jobs=${r.jobs} prev=${r.previousJobs} desc=${r.descriptionRate} date=${r.dateRate} country=${r.countryRate} url=${r.urlRate} note=${(r.note ?? '').slice(0, 160)}`);
  }
  const srcs = await prisma.source.findMany({ where: { key: { in: ['loreal', 'kering-2', 'hermes-2'] } } });
  console.log('sources found:', srcs.map((s) => s.key));
  const js = await prisma.jobSource.groupBy({ by: ['sourceKey'], where: { sourceKey: { in: ['loreal', 'kering', 'hermes'] } }, _count: true });
  console.log(JSON.stringify(js));
} finally { await prisma.$disconnect(); }
