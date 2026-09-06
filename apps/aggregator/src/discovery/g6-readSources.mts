/**
 * g6 — lecture SEULE des lignes Source (+ 5 derniers SourceRun) des six
 * sources sans description. Aucune écriture.
 */
import { PrismaClient } from '@prisma/client';

const KEYS = ['hermes', 'loreal', 'kering', 'diptyque', 'jako', 'sephora-france', 'l-oreal-professionnel', 'foot-locker-france', 'parfums-chanel', 'adidas', 'crocs', 'avolta'];

const prisma = new PrismaClient();
try {
  const rows = await prisma.source.findMany({
    where: { OR: [{ key: { in: KEYS } }, { key: { startsWith: 'kering' } }] },
    orderBy: { key: 'asc' },
  });
  for (const r of rows) {
    console.log(
      `\n=== ${r.key} | kind=${r.kind} | status=${r.status} | tenant=${r.tenantKey}\n` +
        `maison=${r.maison} | jobUrlPattern=${r.jobUrlPattern ?? '-'}\n` +
        `config=${JSON.stringify(r.config)}\n` +
        `lastRun=${r.lastRunAt?.toISOString() ?? '-'} ${r.lastRunStatus ?? ''} jobs=${r.lastRunJobs ?? '-'} desc=${r.descriptionRate ?? '-'} date=${r.dateRate ?? '-'} country=${r.countryRate ?? '-'}\n` +
        `note=${r.note ?? '-'}`,
    );
    const runs = await prisma.sourceRun.findMany({
      where: { sourceKey: r.key },
      orderBy: { ranAt: 'desc' },
      take: 5,
    });
    for (const run of runs) {
      const anyRun = run as unknown as Record<string, unknown>;
      console.log(
        `   run ${run.ranAt.toISOString()} status=${anyRun.status} jobs=${anyRun.jobs} desc=${anyRun.descriptionRate} date=${anyRun.dateRate}`,
      );
    }
  }
} finally {
  await prisma.$disconnect();
}
