/**
 * LE BILAN DE LA QUALIFICATION — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/bilan-qualification.mts [<fichier de verdicts>]
 *
 * ── CE QU'IL RASSEMBLE ─────────────────────────────────────────────────────────────────────────
 *
 * Trois populations, mesurées en base (donc vraies quoi qu'il arrive aux journaux du conteneur) :
 *
 *   1. CE QUI EST ACQUIS       sources qualifiées, offres publiées, couverture native
 *   2. CE QUI RESTE BLOQUÉ     sources sans décision d'accès, par famille
 *   3. CE QUI DEMANDE UN ARBITRAGE
 *        · domaines divergents  — le portail est servi sous un autre domaine que le registre
 *        · conflits de tenantKey — deux sources visent le même feed, dont une RETIRED
 *        · portails dormants    — un portail existe, en PAUSED, sans raison consignée
 *
 * Le fichier de verdicts, quand il est fourni, ajoute le détail source par source que seule la
 * campagne connaît (raison exacte du refus). Son absence ne fausse rien : elle enlève du détail.
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';

const fichier = process.argv[2];
const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T,>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

const ligne = (l: string, v: bigint | number | string, marque = '') =>
  console.log(`   ${l.padEnd(46)} ${String(v).padStart(8)}  ${marque}`);

console.log('\n╔══ 1. CE QUI EST ACQUIS ══╗\n');
const acquis = await q<{ quoi: string; n: bigint }>(`
  SELECT 'sources ACTIVE au registre' AS quoi, count(*) AS n FROM "Source" WHERE status='ACTIVE'
  UNION ALL SELECT 'avec une décision d''accès', count(DISTINCT "sourceKey") FROM "SourceAccessDecision"
  UNION ALL SELECT 'offres actives au catalogue', count(*) FROM "Job" WHERE "isActive"
  UNION ALL SELECT 'dont en France', count(*) FROM "Job" WHERE "isActive" AND "countryCode"='FR'
  UNION ALL SELECT 'sources qui publient', count(DISTINCT "sourceKey") FROM "JobSource" js
    WHERE EXISTS (SELECT 1 FROM "Job" j WHERE j.id=js."jobId" AND j."isActive")
  UNION ALL SELECT 'captures RAW conservées', count(*) FROM "RawBlob"
`);
for (const r of acquis) ligne(r.quoi, r.n);

const [trou] = await q<{ n: bigint }>(`
  SELECT count(*) AS n FROM "Job" j WHERE j."isActive"
    AND NOT EXISTS (SELECT 1 FROM "JobSource" js WHERE js."jobId"=j.id AND js."captureBatchId" IS NOT NULL)`);
ligne('offres sans capture native', trou.n, trou.n === 0n ? '✓ rejeu hors réseau garanti' : '← TROU');

console.log('\n╔══ 2. CE QUI RESTE BLOQUÉ ══╗\n');
const bloque = await q<{ kind: string; n: bigint }>(`
  SELECT s.kind, count(*) AS n FROM "Source" s
   WHERE s.status='ACTIVE'
     AND NOT EXISTS (SELECT 1 FROM "SourceAccessDecision" d WHERE d."sourceKey"=s.key)
   GROUP BY 1 ORDER BY count(*) DESC`);
const totalBloque = bloque.reduce((n, r) => n + Number(r.n), 0);
console.log(`   ${totalBloque} source(s) sans décision d'accès, par famille :\n`);
for (const r of bloque.slice(0, 12)) ligne(`   ${r.kind}`, r.n);

console.log('\n╔══ 3. CE QUI DEMANDE UN ARBITRAGE ══╗\n');

/* Conflits de tenantKey : deux sources visant le même feed, dont au moins une non-ACTIVE. */
console.log('   ── Conflits de feed (une source non-ACTIVE occupe la clé) ──\n');
const conflits = await q<{ tenantKey: string; sources: string }>(`
  SELECT "tenantKey", string_agg(key || ' [' || status || ']', ', ' ORDER BY status, key) AS sources
    FROM "Source" GROUP BY "tenantKey" HAVING count(*) > 1 ORDER BY "tenantKey" LIMIT 20`);
if (!conflits.length) console.log('      aucun');
for (const c of conflits) console.log(`      ${c.tenantKey.slice(0, 44).padEnd(46)} ${c.sources.slice(0, 80)}`);

/* Portails dormants sans raison : un portail prêt, en pause, que rien n'explique. */
console.log('\n   ── Portails dormants sans raison consignée ──\n');
const dormants = await q<{ key: string; maison: string; kind: string; status: string }>(`
  SELECT s.key, s.maison, s.kind, s.status FROM "Source" s
   WHERE s.status <> 'ACTIVE' AND (s.note IS NULL OR s.note='')
     AND NOT EXISTS (SELECT 1 FROM "SourceRun" r WHERE r."sourceKey"=s.key)
   ORDER BY s.key`);
console.log(`      ${dormants.length} portail(s) — jamais exécutés, aucune note\n`);
for (const d of dormants.slice(0, 20))
  console.log(`      ${d.key.padEnd(26)} ${d.status.padEnd(9)} ${d.kind.padEnd(28)} ${d.maison.slice(0, 32)}`);
if (dormants.length > 20) console.log(`      … et ${dormants.length - 20} autre(s)`);

/* Le détail des verdicts, si la campagne en a laissé. */
if (fichier && existsSync(fichier)) {
  const lignes = readFileSync(fichier, 'utf8').split('\n').filter((l) => l.trim());
  console.log(`\n   ── Verdicts de campagne archivés (${lignes.length}) ──\n`);
  const parType = new Map<string, string[]>();
  for (const l of lignes) {
    const m = l.match(/\b([A-Z_]{4,})\b/);
    const type = m ? m[1] : 'AUTRE';
    parType.set(type, [...(parType.get(type) ?? []), l.trim()]);
  }
  for (const [type, xs] of [...parType].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`      ${type.padEnd(30)} ${xs.length}`);
    if (type !== 'QUALIFIEE') for (const x of xs.slice(0, 8)) console.log(`         ${x.slice(0, 150)}`);
  }
}

console.log('');
await prisma.$disconnect();
