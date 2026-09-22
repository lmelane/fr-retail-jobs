/**
 * L'IMPACT DU CORRECTIF GÉOGRAPHIQUE — simulé, avant toute réingestion.
 *
 * On rejoue `resolveGeography` + `countryIntegrityOf` sur le champ pays NATIF tel qu'il est
 * archivé dans `JobSource.raw`, et on compare au couple (countryCode, countryIntegrity) stocké.
 * Rien n'est écrit : le but est de savoir CE QUI CHANGERAIT avant de laisser le pipeline écrire.
 *
 * Le résultat idéal, et le seul acceptable sans arbitrage :
 *
 *   même `countryCode`, la preuve seule devient positive (`null → RAW_COUNTRY`).
 *
 * Tout changement de PAYS est signalé à part : il faudrait alors s'arrêter et diagnostiquer.
 */
import { PrismaClient } from '@prisma/client';
import { resolveGeography } from '../../../src/normalize/geography.js';
import { countryIntegrityOf } from '../../../src/normalize/countryIntegrity.js';

const url = process.env.DATABASE_URL ?? '';
if (!url) { console.error('DATABASE_URL requise.'); process.exit(2); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Le champ pays natif, cherché récursivement — il vit parfois sous `_jobposting.jobLocation[]`. */
function paysNatif(valeur: unknown, profondeur = 0): string | undefined {
  if (profondeur > 6 || valeur == null) return undefined;
  if (Array.isArray(valeur)) { for (const v of valeur.slice(0, 3)) { const r = paysNatif(v, profondeur + 1); if (r) return r; } return undefined; }
  if (typeof valeur !== 'object') return undefined;
  for (const [k, v] of Object.entries(valeur as Record<string, unknown>)) {
    /* Un champ dont le pays est l'objet — jamais `countryRegion` ni un libellé de lieu. */
    if (/^(country|addressCountry)$/i.test(k) && typeof v === 'string' && v.trim()) return v.trim();
  }
  for (const v of Object.values(valeur as Record<string, unknown>)) {
    const r = paysNatif(v, profondeur + 1); if (r) return r;
  }
  return undefined;
}

/*
 * Le pays natif est extrait EN SQL : rapatrier 40 000 RAW complets dépasse la conversion du
 * client (« Failed to convert rust String into napi string »). On ne ramène que la valeur utile.
 */
const offres = await prisma.$queryRawUnsafe<Array<{
  id: string; cc: string | null; ci: string | null; natif: string | null; location: string | null; city: string | null;
}>>(`
  SELECT j.id, j."countryCode" AS cc, j."countryIntegrity" AS ci, j.location, j.city,
         coalesce(js.raw->>'country',
                  js.raw->'_jobposting'->'jobLocation'->0->'address'->>'addressCountry',
                  js.raw->'location'->>'country',
                  js.raw->'address'->>'addressCountry') AS natif
    FROM "Job" j
    JOIN LATERAL (SELECT raw FROM "JobSource" WHERE "jobId" = j.id AND "isActive" LIMIT 1) js ON true
   WHERE j."isActive" AND j."mergedIntoId" IS NULL
     AND EXISTS (SELECT 1 FROM "JobSource" x WHERE x."jobId" = j.id AND x."isActive"
                   AND (x."expiresAt" IS NULL OR x."expiresAt" > now()))`);
await prisma.$disconnect();

const transitions = new Map<string, number>();
const paysChanges: Array<{ id: string; de: string | null; vers: string; libelle: string }> = [];
const echantillon: Array<string> = [];

for (const o of offres) {
  const natif = o.natif?.trim();
  if (!natif) continue;
  const geo = resolveGeography({ rawCountry: natif, location: o.location, city: o.city } as never);
  const cc = geo.countryCode;
  if (!cc) continue;
  const verdict = cc === o.cc ? countryIntegrityOf(geo, natif) : countryIntegrityOf(geo, natif);

  if (cc !== o.cc) {
    /* UN PAYS QUI CHANGE n'est pas le but du lot : on le compte et on le montre. */
    transitions.set('PAYS CHANGÉ', (transitions.get('PAYS CHANGÉ') ?? 0) + 1);
    if (paysChanges.length < 12) paysChanges.push({ id: o.id, de: o.cc, vers: cc, libelle: natif });
    continue;
  }
  const avant = o.ci ?? 'null', apres = verdict ?? 'null';
  if (avant === apres) { transitions.set('inchangé', (transitions.get('inchangé') ?? 0) + 1); continue; }
  const cle = `${o.cc ?? 'UNKNOWN'} : ${avant} → ${apres}`;
  transitions.set(cle, (transitions.get(cle) ?? 0) + 1);
  if (echantillon.length < 10 && avant === 'null') echantillon.push(`${o.cc} « ${natif} » ${avant} → ${apres}`);
}

console.log(`\n═══ IMPACT SIMULÉ DU CORRECTIF GÉO · ${offres.length} offres publiables examinées ═══\n`);
console.log(`| transition | offres |`);
console.log(`|---|---:|`);
for (const [k, v] of [...transitions].sort((a, b) => b[1] - a[1])) {
  if (k === 'inchangé') continue;
  console.log(`| ${k} | ${v} |`);
}
console.log(`| *(inchangé)* | ${transitions.get('inchangé') ?? 0} |`);

const gagnees = [...transitions].filter(([k]) => k.includes('null → ')).reduce((s, [, v]) => s + v, 0);
const perdues = [...transitions].filter(([k]) => / → null$/.test(k)).reduce((s, [, v]) => s + v, 0);
console.log(`\n   PREUVE GAGNÉE (null → verdict positif) : ${gagnees}`);
console.log(`   PREUVE PERDUE (verdict → null)          : ${perdues}${perdues ? '  ← À DIAGNOSTIQUER' : '  ✓'}`);
console.log(`   PAYS CHANGÉ                             : ${transitions.get('PAYS CHANGÉ') ?? 0}${transitions.get('PAYS CHANGÉ') ? '  ← À DIAGNOSTIQUER' : '  ✓'}`);

if (echantillon.length) {
  console.log(`\n   échantillon de transformations :`);
  for (const e of echantillon) console.log(`      ${e}`);
}
if (paysChanges.length) {
  console.log(`\n   échantillon de PAYS CHANGÉS :`);
  for (const p of paysChanges) console.log(`      ${p.de ?? 'UNKNOWN'} → ${p.vers}  « ${p.libelle} »`);
}
