/** Pose `localePath` sur les sources CareerConnect : sans lui l'adaptateur ne construit AUCUNE URL. */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const LOCALES: Record<string, string> = { 'hugo-boss-phenom': 'global/en', 'skechers-phenom': 'us/en' };
for (const [key, localePath] of Object.entries(LOCALES)) {
  const s = await p.source.findUniqueOrThrow({ where: { key }, select: { config: true } });
  const config = { ...(s.config as Record<string, unknown>), localePath };
  await p.source.update({ where: { key }, data: { config } });
  console.log(`${key} -> localePath=${localePath}`);
}
await p.$disconnect();
