import { PrismaClient } from '@prisma/client';
/** Audit I-1 : isFrance vrai (code postal, département, région reconnus par isFranceJob) mais pays vide → FR, sauf un préfixe pays explicite étranger (« US-LA-New Orleans »). */
const p = new PrismaClient();
const rows = await p.job.findMany({ where: { isActive: true, isFrance: true, countryCode: null }, select: { id: true, location: true } });
let fixed = 0, notFrance = 0;
for (const r of rows) {
  const m = /^([A-Z]{2})-/.exec(r.location ?? '');
  if (m && m[1] !== 'FR') { await p.job.update({ where: { id: r.id }, data: { isFrance: false } }); notFrance++; continue; }
  await p.job.update({ where: { id: r.id }, data: { countryCode: 'FR' } });
  fixed++;
}
console.log(JSON.stringify({ scanned: rows.length, setFR: fixed, unsetIsFrance: notFrance }));
await p.$disconnect();
