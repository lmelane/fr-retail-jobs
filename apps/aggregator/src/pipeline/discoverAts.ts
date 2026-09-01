import { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { discoverAts } from '../ats/detect.js';
import { isSearchConfigured } from '../discovery/serper.js';

export async function discoverMissingAts(prisma: PrismaClient, force = false) {
  // Free slug probes still run without a key; only the search fallback is lost.
  // Warn explicitly so reduced coverage is never mistaken for "no ATS exists".
  if (!isSearchConfigured()) {
    console.warn(
      '[discover-ats] SERPER_API_KEY not set: using free ATS slug probes only. ' +
        'Companies not resolved this way will be marked NEEDS_REVIEW.',
    );
  }
  const companies = await prisma.company.findMany({
    where: force ? {} : { discoveryStatus: { in: ['PENDING', 'ERROR'] } },
    orderBy: [{ fashionjobsOfferCount: 'desc' }, { name: 'asc' }],
  });
  const limit = pLimit(Number(process.env.ATS_DISCOVERY_CONCURRENCY ?? 3));
  let found = 0;
  let unresolved = 0;

  await Promise.all(companies.map((company) => limit(async () => {
    try {
      const detection = await discoverAts(company.name, company.fashionjobsSlug ?? undefined);
      if (!detection) {
        unresolved++;
        await prisma.company.update({
          where: { id: company.id },
          data: { discoveryStatus: 'NEEDS_REVIEW', discoveryNote: 'No careers/ATS result found.', lastAtsDiscoveryAt: new Date() },
        });
        return;
      }
      found++;
      await prisma.company.update({
        where: { id: company.id },
        data: {
          careersUrl: detection.careersUrl,
          atsType: detection.type,
          atsConfig: detection.config as any,
          discoveryStatus: 'FOUND',
          discoveryNote: `${detection.note ?? ''} confidence=${detection.confidence}`.trim(),
          lastAtsDiscoveryAt: new Date(),
        },
      });
    } catch (error) {
      unresolved++;
      await prisma.company.update({
        where: { id: company.id },
        data: { discoveryStatus: 'ERROR', discoveryNote: error instanceof Error ? error.message.slice(0, 1000) : String(error), lastAtsDiscoveryAt: new Date() },
      });
    }
  })));

  return { total: companies.length, found, unresolved };
}
