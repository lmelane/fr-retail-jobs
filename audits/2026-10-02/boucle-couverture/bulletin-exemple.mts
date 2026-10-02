/**
 * Le bulletin du premier RUN de la release r6, sur des données réelles : l'alerte de couverture du scénario « première
 * revue de disponibilité à blanc, table des photographies vide » (`rejeu.mts` -> `rejeu-premier-run.json`,
 * `rejeu-masque.json`) et les indicateurs 1 à 6 lus sur la production, dans une transaction en LECTURE SEULE. Rien n'est
 * écrit, rien n'est envoyé. C'est une projection : le masquage à blanc a été mesuré le 02/10 vers 11:12 UTC.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx audits/2026-10-02/boucle-couverture/bulletin-exemple.mts
 *
 * Sorties : `bulletin-exemple.html` (le corps de l'e-mail) et, sur la console, l'objet et la version texte.
 *
 * AVANT r6, la production n'a pas la colonne `JobSource.availabilityHold` (migration `20261002140000`) : le seul
 * prédicat qui la lit (`publicJobSql`, « aucune retenue ») est retiré du texte des requêtes ; après la migration, toutes
 * les lignes y vaudraient NULL et il serait vrai partout. Rien d'autre n'est réécrit. La part masquée vaut donc 0.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import type { CoverageEvaluation } from '../../../apps/aggregator/src/coverage/coverageAlert.js';
import { bulletinHtml, bulletinSubject, bulletinText, summaryLines } from '../../../apps/aggregator/src/coverage/coverageBulletin.js';
import { readLoopIndicators } from '../../../apps/aggregator/src/coverage/loopIndicators.js';

const DATE_FIELDS = new Set(['windowStart', 'maskAt', 'lastSeenAt', 'takenAt']);
const masked = JSON.parse(readFileSync(new URL('./rejeu-masque.json', import.meta.url), 'utf8'));
const evaluation = JSON.parse(readFileSync(new URL('./rejeu-premier-run.json', import.meta.url), 'utf8'),
  (key, value) => DATE_FIELDS.has(key) && typeof value === 'string' ? new Date(value) : value) as CoverageEvaluation;

const prisma = new PrismaClient();
try {
  const at = new Date();
  const HOLD = /\s*AND available_source\."availabilityHold" IS NULL/g;
  const indicators = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const preR6 = new Proxy(tx, { get(target, prop, receiver) {
      if (prop !== '$queryRaw') return Reflect.get(target, prop, receiver);
      return (first: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
        const sql = 'raw' in first ? Prisma.sql(first, ...values) : first;
        return target.$queryRaw(Prisma.sql(sql.strings.map(part => part.replace(HOLD, "")), ...sql.values));
      };
    } });
    return readLoopIndicators(preR6, { at, probe: null, prisma });
  }, { isolationLevel: 'RepeatableRead', timeout: 180_000, maxWait: 10_000 });
  writeFileSync(new URL('./bulletin-exemple.html', import.meta.url), bulletinHtml(evaluation, indicators, { at, masked }));
  writeFileSync(new URL('./indicateurs.json', import.meta.url), JSON.stringify({ at, indicators }, null, 1));
  console.log(bulletinSubject(evaluation));
  for (const line of summaryLines(evaluation, masked)) console.log(line);
  for (const line of bulletinText(evaluation, indicators)) console.log(line);
} finally {
  await prisma.$disconnect();
}
