/**
 * AUDIT DÉFENSIF DU PAYS — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/audit-pays.mts
 *
 * ── CE QU'ON CHERCHE À CASSER ──────────────────────────────────────────────────────────────────
 *
 * `champs-par-marche.mts` compte un taux de remplissage. Il ne dit RIEN de la justesse : une
 * offre peut porter un pays FAUX et compter comme « remplie ». Un filtre bâti là-dessus enverrait
 * un candidat parisien sur un poste texan.
 *
 * Cet audit cherche donc les contradictions, pas les absences :
 *
 *   1. LE DRAPEAU D'INTÉGRITÉ    `countryIntegrity = AMBIGUOUS` dit que la valeur est conservée
 *                                mais peut être fausse (le cas `CA` = Canada ou Californie).
 *   2. VILLE CONTRE PAYS         une ville française déclarée hors de France, et l'inverse.
 *   3. SUFFIXE D'ÉTAT AMÉRICAIN  « Paris, TX » lu comme la France — le faux positif classique.
 *   4. PAYS ABSENT               combien, et sur quelles sources — un trou concentré est un défaut
 *                                d'adaptateur, un trou diffus est une limite des sources.
 *   5. LE LIBELLÉ NATIF          ce que `JobSource.raw` disait, quand le pays canonique est absent :
 *                                la donnée existait-elle ?
 *
 * Aucune correction ici. On mesure, on nomme, on chiffre.
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T,>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);
const ligne = (l: string, v: bigint | number | string, m = '') =>
  console.log(`   ${l.padEnd(48)} ${String(v).padStart(7)}  ${m}`);

console.log('\n╔══ 1. LE DRAPEAU D\'INTÉGRITÉ ══╗\n');
const integrite = await q<{ etat: string; n: bigint }>(`
  SELECT coalesce("countryIntegrity", '(sain)') AS etat, count(*) AS n
    FROM "Job" WHERE "isActive" GROUP BY 1 ORDER BY count(*) DESC`);
for (const r of integrite) ligne(r.etat, r.n, r.etat === 'AMBIGUOUS' ? '← valeur conservée mais douteuse' : '');

console.log('\n╔══ 2. VILLE CONTRE PAYS ══╗\n');
/*
 * Des villes dont le pays ne fait AUCUN doute. La liste est courte et sûre à dessein : un
 * rapprochement large produirait des faux positifs (Toledo existe en Espagne ET dans l'Ohio) et
 * l'audit perdrait sa valeur de preuve.
 */
const VILLES: Array<[string, string]> = [
  ['Paris', 'FR'], ['Lyon', 'FR'], ['Marseille', 'FR'], ['Bordeaux', 'FR'], ['Lille', 'FR'],
  ['Londres', 'GB'], ['London', 'GB'], ['Manchester', 'GB'],
  ['Milano', 'IT'], ['Milan', 'IT'], ['Roma', 'IT'],
  ['Madrid', 'ES'], ['Barcelona', 'ES'],
  ['Berlin', 'DE'], ['München', 'DE'], ['Hamburg', 'DE'],
  ['Amsterdam', 'NL'], ['Bruxelles', 'BE'], ['Genève', 'CH'], ['Zürich', 'CH'],
  ['Tokyo', 'JP'], ['Shanghai', 'CN'], ['Seoul', 'KR'], ['Sydney', 'AU'],
];
let contradictions = 0;
const detail: string[] = [];
for (const [ville, pays] of VILLES) {
  const rows = await q<{ countryCode: string | null; n: bigint }>(`
    SELECT "countryCode", count(*) AS n FROM "Job"
     WHERE "isActive" AND city IS NOT NULL AND lower(city) = lower($1)
     GROUP BY 1 ORDER BY count(*) DESC`, ville);
  for (const r of rows) {
    if (r.countryCode === pays || r.countryCode === null) continue;
    contradictions += Number(r.n);
    detail.push(`${ville} déclarée ${r.countryCode} (attendu ${pays}) : ${r.n} offre(s)`);
  }
}
ligne('offres dont la ville contredit le pays', contradictions, contradictions === 0 ? '✓' : '← À INSTRUIRE');
for (const d of detail.slice(0, 20)) console.log(`      ${d}`);

console.log('\n╔══ 3. SUFFIXE D\'ÉTAT AMÉRICAIN LU COMME UN PAYS ══╗\n');
/*
 * Le faux positif classique : « Paris, TX » ou « Florence, AL ». Si le pays est FR ou IT alors
 * que le lieu porte un suffixe d'État US, la lecture est fausse.
 *
 * ── LE PIÈGE DE CE CONTRÔLE LUI-MÊME (mesuré le 2026-09-22) ────────────────────────────────────
 *
 * Neuf abréviations d'États sont AUSSI des codes pays ISO : DE (Delaware / Allemagne), IN
 * (Indiana / Inde), LA, MA, MD, MO, NE, PA, et CA déjà écarté. Sans cette exclusion, le contrôle
 * signalait « Darmstadt, DE » → DE comme une erreur — alors que c'est l'Allemagne, correctement
 * lue. 141 offres étaient accusées à tort, dont 139 allemandes.
 *
 * Un suffixe ne prouve une erreur que s'il CONTREDIT le pays déclaré. Quand le suffixe est le
 * code du pays lui-même, il le confirme.
 */
const suffixes = await q<{ location: string; city: string | null; countryCode: string; n: bigint }>(`
  SELECT location, city, "countryCode", count(*) AS n FROM "Job"
   WHERE "isActive" AND location ~ ',\\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\\s*$'
     AND "countryCode" NOT IN ('US', 'CA')
     -- Le suffixe CONFIRME le pays au lieu de le contredire : ce n'est pas un défaut.
     AND upper(substring(location from ',\\s*([A-Z]{2})\\s*$')) IS DISTINCT FROM upper("countryCode")
   GROUP BY 1,2,3 ORDER BY count(*) DESC LIMIT 15`);
ligne('lieux à suffixe d\'État US déclarés hors US/CA', suffixes.reduce((n, r) => n + Number(r.n), 0),
  suffixes.length ? '← À INSTRUIRE' : '✓');
for (const r of suffixes) console.log(`      « ${r.location} » → ${r.countryCode} (${r.n} offre(s))`);

console.log('\n╔══ 4. LE PAYS ABSENT — OÙ SE CONCENTRE-T-IL ? ══╗\n');
const [sans] = await q<{ n: bigint }>(`SELECT count(*) AS n FROM "Job" WHERE "isActive" AND "countryCode" IS NULL`);
const [tot] = await q<{ n: bigint }>(`SELECT count(*) AS n FROM "Job" WHERE "isActive"`);
ligne('offres sans pays', sans.n, `${((Number(sans.n) / Number(tot.n)) * 100).toFixed(1)} % du catalogue`);

const concentration = await q<{ sourceKey: string; kind: string; sans: bigint; total: bigint }>(`
  SELECT js."sourceKey", s.kind,
         count(*) FILTER (WHERE j."countryCode" IS NULL) AS sans, count(*) AS total
    FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" JOIN "Source" s ON s.key=js."sourceKey"
   WHERE j."isActive"
   GROUP BY 1,2 HAVING count(*) FILTER (WHERE j."countryCode" IS NULL) > 0
   ORDER BY count(*) FILTER (WHERE j."countryCode" IS NULL) DESC LIMIT 15`);
console.log('\n   les sources qui en portent le plus :\n');
for (const r of concentration)
  console.log(`      ${r.sourceKey.padEnd(26)} ${r.kind.padEnd(20)} ${String(r.sans).padStart(5)} / ${r.total} ` +
    `(${Math.round((Number(r.sans) / Number(r.total)) * 100)} %)`);

console.log('\n╔══ 5. LA DONNÉE EXISTAIT-ELLE DANS LA SOURCE ? ══╗\n');
/*
 * Pour les offres sans pays, le libellé de lieu natif dit si l'information ÉTAIT là. Un lieu
 * renseigné sans pays canonique est un défaut de NOTRE lecture ; un lieu vide est une limite de
 * la source.
 */
const [natif] = await q<{ avec: bigint; sans: bigint }>(`
  SELECT count(*) FILTER (WHERE j.location IS NOT NULL AND j.location <> '') AS avec,
         count(*) FILTER (WHERE j.location IS NULL OR j.location = '') AS sans
    FROM "Job" j WHERE j."isActive" AND j."countryCode" IS NULL`);
ligne('sans pays MAIS avec un lieu natif', natif.avec, '← notre lecture, récupérable');
ligne('sans pays ET sans lieu natif', natif.sans, 'la source ne dit rien');

const exemples = await q<{ location: string; n: bigint }>(`
  SELECT location, count(*) AS n FROM "Job"
   WHERE "isActive" AND "countryCode" IS NULL AND location IS NOT NULL AND location <> ''
   GROUP BY 1 ORDER BY count(*) DESC LIMIT 12`);
console.log('\n   les lieux les plus fréquents sans pays :\n');
for (const r of exemples) console.log(`      ${String(r.n).padStart(5)}×  « ${r.location.slice(0, 60)} »`);

writeFileSync('backups/audit-pays.csv',
  ['type;valeur;detail',
    ...detail.map((d) => `ville_contre_pays;;${d}`),
    ...suffixes.map((r) => `suffixe_etat_us;${r.n};${r.location} → ${r.countryCode}`),
    ...concentration.map((r) => `sans_pays;${r.sans};${r.sourceKey} (${r.kind}) ${r.sans}/${r.total}`),
  ].join('\n') + '\n', 'utf8');
console.log('\n   → backups/audit-pays.csv\n');

await prisma.$disconnect();
