/**
 * LE PÉRIMÈTRE D'ACCÈS D'UNE CAPTURE COUVRE-T-IL UNE CAPTURE PLUS RÉCENTE ? — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/mesures/perimetre-reutilise.mts [--sources=a,b] [--ecart-heures=6]
 *   … --exporter=<lotA>,<lotB> --out=<fichier.json.gz>
 *
 * Au RUN, une autorisation d'accès en vigueur est GARDÉE tant que la qualification native de la source a moins de
 * 24 heures (`maintainSourceAccess`) : la collecte du soir est alors contrôlée contre un périmètre dérivé d'une capture
 * plus ancienne. urbn-hub, le 30/09 : autorisation dérivée à 09:16, collecte refusée à 18:04 (ACCESS_SCOPE), une fiche
 * publiée entre-temps sur une origine dont les fiches étaient toutes déclarées en EXACT.
 *
 * Pour chaque source active dont la dernière autorisation est ALLOWED, ce programme prend sa dernière capture d'offres
 * extraite (B) et la dernière capture d'offres extraite commencée au moins `--ecart-heures` avant (A), dérive le
 * périmètre de A avec la dérivation ACTUELLE du code (`deriveAccessScopes`), et compte les requêtes de B qu'il refuse
 * (`matchingAccessScope`). Lancé avant et après un changement de la dérivation, il en mesure l'effet sur toute la
 * flotte, sans aucune requête vers les éditeurs.
 *
 * Les requêtes sont lues dans leur enveloppe native (chaque saut, adresse réelle), par lot : une requête SQL par
 * capture, dans une transaction `READ ONLY`. Une enveloppe archivée hors base (sans corps en base) est comptée à part.
 *
 * `--exporter` écrit, pour deux lots, les requêtes observées { lot, method, url, contentType } dans un fichier gzip :
 * la fixture d'un témoin sur des adresses réelles. N'écrit rien en base, ne contacte personne.
 */
import { writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { PrismaClient, type Prisma } from '@prisma/client';
import { matchingAccessScope, type AccessScope } from '../../../src/connectors/accessScope.js';
import { deriveAccessScopes, type ObservedRequest } from '../../../src/connectors/accessScopeDerivation.js';
import { CRAWLER_IDENTITY } from '../../../src/lib/crawlerIdentity.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const filtre = (arg('sources') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const ecart = Number(arg('ecart-heures') ?? 6);
const prisma = new PrismaClient({ log: [] });

type Hop = { request: { method: string; url: string }; responseHeaders: Record<string, string> };

/** Les requêtes observées d'une capture, chaque saut de chaque réponse, dans l'ordre ; `archivees` : enveloppes hors base. */
async function requetes(tx: Prisma.TransactionClient, lot: string) {
  const rows = await tx.$queryRawUnsafe<{ sequence: number; gzip: Uint8Array | null }[]>(`
    SELECT r.sequence, b.gzip FROM "RawCapture" r LEFT JOIN "RawBlobBody" b ON b.hash = r."requestDataHash"
     WHERE r."batchId" = $1 ORDER BY r.sequence`, lot);
  const liste: ObservedRequest[] = [];
  let archivees = 0;
  for (const row of rows) {
    if (!row.gzip) { archivees++; continue; }
    const value = JSON.parse(gunzipSync(row.gzip).toString('utf8')) as { hops: Hop[] };
    for (const hop of value.hops) liste.push({ method: hop.request.method, url: new URL(hop.request.url), contentType: String(hop.responseHeaders['content-type'] ?? '') });
  }
  return { liste, archivees };
}

const refusees = (scopes: readonly AccessScope[], liste: ObservedRequest[]) => liste.filter((r) => {
  try {
    matchingAccessScope(scopes, { url: r.url.toString(), method: r.method, format: 'HTTP_RESPONSE', userAgent: CRAWLER_IDENTITY } as never);
    return false;
  } catch { return true; }
});
const lecture = <T,>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  return fn(tx);
}, { timeout: 120_000, maxWait: 30_000 });

try {
  if (arg('exporter')) {
    const out = arg('out');
    if (!out) { console.error('usage: --exporter=<lotA>,<lotB> --out=<fichier.json.gz>'); process.exit(2); }
    const export_: { lot: string; method: string; url: string; contentType: string }[] = [];
    for (const lot of arg('exporter')!.split(',')) {
      const { liste, archivees } = await lecture((tx) => requetes(tx, lot));
      if (archivees) throw new Error(`${lot} : ${archivees} enveloppe(s) hors base, export incomplet`);
      export_.push(...liste.map((r) => ({ lot, method: r.method, url: r.url.toString(), contentType: r.contentType })));
    }
    writeFileSync(out, gzipSync(JSON.stringify(export_), { level: 9 }));
    console.log(JSON.stringify({ out, requetes: export_.length }));
    process.exit(0);
  }
  const sources = await prisma.$queryRawUnsafe<{ sourceKey: string; kind: string }[]>(`
    SELECT DISTINCT ON (d."sourceKey") d."sourceKey", s.kind, d.verdict
      FROM "SourceAccessDecision" d JOIN "Source" s ON s.key = d."sourceKey" AND s.status = 'ACTIVE'
     ${filtre.length ? 'WHERE d."sourceKey" = ANY($1::text[])' : ''}
     ORDER BY d."sourceKey", d.sequence DESC`, ...(filtre.length ? [filtre] : []))
    .then((rows) => (rows as { sourceKey: string; kind: string; verdict: string }[]).filter((row) => row.verdict === 'ALLOWED'));
  const lignes: Record<string, unknown>[] = [];
  let sansPaire = 0; let archivees = 0;
  for (const { sourceKey, kind } of sources) {
    const ligne = await lecture(async (tx) => {
      const lots = await tx.$queryRawUnsafe<{ id: string; startedAt: Date }[]>(`
        SELECT b.id, b."startedAt" FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId" = b.id AND o.status = 'EXTRACTED'
         WHERE b."sourceKey" = $1 AND b.purpose = 'JOBS' ORDER BY b."startedAt" DESC LIMIT 40`, sourceKey);
      const b = lots[0];
      const a = lots.find((lot) => b && b.startedAt.getTime() - lot.startedAt.getTime() >= ecart * 3_600_000);
      if (!a || !b) return null;
      const [ra, rb] = [await requetes(tx, a.id), await requetes(tx, b.id)];
      if (ra.archivees || rb.archivees) return { source: sourceKey, archivees: ra.archivees + rb.archivees };
      try {
        const hors = refusees(deriveAccessScopes(kind, ra.liste), rb.liste);
        return { source: sourceKey, type: kind, a: a.id, b: b.id, ecartHeures: Math.round((b.startedAt.getTime() - a.startedAt.getTime()) / 360_000) / 10,
          requetes: rb.liste.length, refusees: hors.length, exemple: hors[0] ? `${hors[0].method} ${hors[0].url.origin}${hors[0].url.pathname}` : null };
      } catch (error) { return { source: sourceKey, erreur: (error as Error).message.slice(0, 160) }; }
    });
    if (!ligne) { sansPaire++; continue; }
    if ('archivees' in ligne) { archivees++; continue; }
    lignes.push(ligne);
  }
  const touchees = lignes.filter((l) => Number(l.refusees) > 0);
  console.log(JSON.stringify({ ecartMinimalHeures: ecart, sources: sources.length, mesurees: lignes.length, sansPaire, archivees,
    sourcesRefusees: touchees.length, requetesRefusees: touchees.reduce((n, l) => n + Number(l.refusees), 0),
    erreurs: lignes.filter((l) => l.erreur).length,
    detail: [...touchees, ...lignes.filter((l) => l.erreur)].sort((x, y) => String(x.source).localeCompare(String(y.source))) }, null, 1));
} finally {
  await prisma.$disconnect();
}
