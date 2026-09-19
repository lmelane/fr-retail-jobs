/**
 * LIT UNE PAGE DE DÉTAIL ARCHIVÉE ET Y APPLIQUE LE LECTEUR — lecture seule.
 *
 * Quand une source échoue en CONTENT_MISSING alors que ses pages de détail SONT capturées, la
 * question devient : le lecteur trouve-t-il la description DANS cette page ? On ouvre donc la
 * capture réelle et on lui applique le lecteur, au lieu de raisonner sur le code.
 */
import { PrismaClient } from '@prisma/client';
import { gunzipSync } from 'node:zlib';

const cle = process.argv[2] ?? 'l-oreal-professionnel';
const p = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });

const [capture] = await p.$queryRawUnsafe<Array<{ requestUrl: string; blobHash: string | null; status: number | null }>>(
  `SELECT rc."requestUrl", rc."blobHash", rc.status FROM "RawCapture" rc
     JOIN "CaptureBatch" b ON b.id = rc."batchId"
    WHERE b."sourceKey" = $1 AND b.purpose = 'JOBS' AND rc."requestUrl" LIKE '%JobDetail%'
    ORDER BY b."startedAt" DESC, rc.sequence LIMIT 1`, cle);
if (!capture?.blobHash) { console.log('aucune page de détail capturée'); process.exit(0); }

console.log(`\n   page : ${capture.requestUrl}`);
console.log(`   statut HTTP : ${capture.status}`);

const [corps] = await p.$queryRawUnsafe<Array<{ gzip: Buffer }>>(
  `SELECT y.gzip FROM "RawBlobBody" y WHERE y.hash = $1`, capture.blobHash);
const brut = corps?.gzip ? gunzipSync(corps.gzip) : null;
if (!brut) { console.log('   corps absent'); process.exit(0); }
const html = brut.toString('utf8');
console.log(`   taille : ${html.length} caractères\n`);

for (const [nom, motif] of [
  ['itemprop="description"', /itemprop=["']description["']/i],
  ['JSON-LD JobPosting', /"@type"\s*:\s*"JobPosting"/i],
  ['JSON-LD description', /"description"\s*:\s*"/i],
  ['og:description', /property=["']og:description["']/i],
  ['meta description', /name=["']description["']/i],
] as const) console.log(`   ${motif.test(html) ? '✓' : '✗'}  ${nom}`);

console.log('\n   — 400 premiers caractères —');
console.log(`   ${html.slice(0, 400).replace(/\s+/g, ' ')}`);
console.log('');
await p.$disconnect();

/*
 * ET SURTOUT : ce que le LECTEUR en tire. Une page qui contient le marqueur ne prouve pas que le
 * lecteur sait l'extraire — c'est l'exécution qui le dit.
 */
const { parseMicrodataDescription } = await import('../../src/ats/adapters/successfactors.js');
const texte = parseMicrodataDescription(html);
console.log(`   parseMicrodataDescription → ${texte === undefined ? 'undefined' : `${texte.length} caractères`}`);
if (texte) console.log(`      « ${texte.slice(0, 160).replace(/\s+/g, ' ')} … »`);
console.log('');
