/**
 * MARC O'POLO (D-485) — LES PUBLICATIONS EN LIGNE QUE LE LECTEUR DÉDIÉ RETROUVE, lecture seule.
 *
 *   PYTHONDONTWRITEBYTECODE=1 python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/2026-09-30/marc-o-polo/scripts/publications-retrouvees.mts
 *
 * Compare les `JobSource` actives de la source à la liste de l'API de la lecture directe du 30/09 (fixture du dépôt) :
 * l'identifiant du lecteur dédié est `sha1` de l'adresse recalculée depuis le titre de la liste. Rend, pour chaque
 * publication, si elle est retrouvée (même identifiant), renommée (offre encore listée, adresse différente) ou fermée.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { vacancyExternalId, vacancyPageUrl } from '../../../../apps/aggregator/src/ats/adapters/marcOPolo.js';

const FIXTURE = new URL('../../../../apps/aggregator/src/ats/adapters/__fixtures__/marc-o-polo-reponses-20260930.json.gz', import.meta.url);
const archive = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString('utf8')) as Array<{ url: string; status: number; body: string }>;
const list = JSON.parse(archive.find((r) => r.url.endsWith('/vacancies?language=en') && r.status === 200)!.body) as Array<{ id: string; title: string }>;
const byId = new Map(list.map((row) => [row.id, row]));
const prisma = new PrismaClient({ log: [] });
try {
  const actives = await prisma.$queryRawUnsafe<Array<{ externalId: string; url: string }>>(
    `SELECT "externalId", url FROM "JobSource" WHERE "sourceKey" = 'marc-o-polo' AND "isActive"`);
  const verdicts = actives.map((p) => {
    const id = /(\d{4}-\d{4})$/.exec(p.url)?.[1];
    const row = id ? byId.get(id) : undefined;
    if (!row) return { ...p, verdict: 'FERMEE' };
    const url = vacancyPageUrl('en', row.title, row.id);
    return { ...p, verdict: vacancyExternalId(url) === p.externalId ? 'RETROUVEE' : 'RENOMMEE', nouvelleAdresse: url };
  });
  const compte: Record<string, number> = {};
  for (const v of verdicts) compte[v.verdict] = (compte[v.verdict] ?? 0) + 1;
  console.log(JSON.stringify({ actives: actives.length, listeApi: list.length, compte,
    ecarts: verdicts.filter((v) => v.verdict !== 'RETROUVEE') }, null, 1));
} finally {
  await prisma.$disconnect();
}
