/**
 * a2 — dérive de la clé de cluster (lecture seule).
 *
 * Pour chaque offre active : recalcule la clé que `blockingKey` produirait
 * AUJOURD'HUI (identité société + ville normalisée depuis `location`) et la
 * compare à `Job.clusterKey` gravée à la création. Une clé qui diverge envoie
 * chaque ré-attestation par le chemin de récupération P2002 (upsert.ts), qui ne
 * touche jamais la JobSource. Mesure aussi le sous-ensemble « offre active dont
 * toutes les JobSource sont inactives ».
 */
import { PrismaClient } from '@prisma/client';
import { normalizeLocationString } from '../normalize/location.js';

const prisma = new PrismaClient();
try {
  const rows = await prisma.$queryRawUnsafe<
    { id: string; clusterKey: string | null; location: string | null; canonicalKey: string; noActiveSource: boolean }[]
  >(`select j.id, j."clusterKey", j.location, c."canonicalKey",
        not exists (select 1 from "JobSource" s where s."jobId"=j.id and s."isActive") as "noActiveSource"
      from "Job" j join "Company" c on c.id=j."companyId" where j."isActive"`);

  let drift = 0;
  let driftNoActive = 0;
  let noActive = 0;
  const driftBySource = new Map<string, number>();
  for (const row of rows) {
    const city = normalizeLocationString(row.location).city ?? '';
    const expected = `${row.canonicalKey}|${city}`;
    if (row.noActiveSource) noActive++;
    if (expected !== row.clusterKey) {
      drift++;
      if (row.noActiveSource) driftNoActive++;
      const company = row.canonicalKey;
      driftBySource.set(company, (driftBySource.get(company) ?? 0) + 1);
    }
  }
  const top = [...driftBySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(JSON.stringify({ active: rows.length, clusterKeyDrift: drift, activeWithoutActiveSource: noActive, driftAmongThose: driftNoActive, topDriftCompanies: top }));
} finally {
  await prisma.$disconnect();
}
