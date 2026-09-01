import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

function csv(value: unknown) {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export async function exportCompanies(prisma: PrismaClient, output = 'fashionjobs-companies.csv') {
  const companies = await prisma.company.findMany({ orderBy: { name: 'asc' } });
  const rows = [
    ['name','fashionjobsUrl','fashionjobsOfferCount','kind','careersUrl','atsType','discoveryStatus','discoveryNote'],
    ...companies.map((c) => [c.name,c.fashionjobsUrl,c.fashionjobsOfferCount,c.kind,c.careersUrl,c.atsType,c.discoveryStatus,c.discoveryNote]),
  ];
  await writeFile(output, rows.map((r) => r.map(csv).join(',')).join('\n'), 'utf8');
  return { output, count: companies.length };
}
