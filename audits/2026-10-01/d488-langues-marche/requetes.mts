/**
 * D-488 : MÊMES RÉSULTATS POUR LE MARCHÉ ? Écrit le SQL de comparaison, rejoué ensuite en LECTURE SEULE sur la base de
 * production (`psql`, transaction en lecture seule par défaut, que des SELECT ; voir `README.md`).
 *
 * Pour chaque marché et chaque métier, la requête que tape une personne (le libellé du métier dans la langue du marché)
 * est interprétée par le VRAI modèle (`snapshotModel`, manifeste v3 actif, empreinte vérifiée) et traduite par le VRAI
 * SQL (`searchSql`) deux fois : entière (avant D-488) et restreinte aux langues du marché (après). Sur tous les documents
 * de la génération servie dans les pays du marché qui répondent à la requête entière, on compte :
 *   - ceux que la requête restreinte ne trouve plus (`perdus`) ;
 *   - ceux dont le score quantifié change (`scores`) : l'ordre servi en dépend.
 * `perdus = 0` et `scores = 0` : mêmes offres, même ordre. Une deuxième partie chronomètre la requête servie (condition
 * et score) entière puis restreinte, trois tours.
 *
 * Usage (racine du dépôt) : npx tsx audits/2026-10-01/d488-langues-marche/requetes.mts <contentHash actif> > requetes.sql
 */
import { readFileSync } from 'node:fs';
import { Prisma } from '@catwalks/db';
import { MARCHES, type CodeMarche } from '@catwalks/db/marches';
import { occupationManifestHash, type OccupationManifest } from '@catwalks/db/occupations';
import { langueDesLibelles } from '@catwalks/db/presentation';
import { snapshotModel, type SnapshotMetadata } from '../../../apps/api/lib/search-model';
import { searchSql } from '../../../apps/api/lib/search-sql';
import { SEARCH_VERSION } from '../../../apps/api/lib/search-index';

const manifest = JSON.parse(readFileSync(new URL('../../2026-09-28/curation-v3/6-manifeste-v3.json', import.meta.url), 'utf8')) as OccupationManifest;
const attendu = process.argv[2];
if (occupationManifestHash(manifest) !== attendu) throw new Error(`Manifeste différent de la version active (${attendu})`);
const sectors = JSON.parse(readFileSync(new URL('../../../packages/db/data/sectors-v1.json', import.meta.url), 'utf8'));
const model = snapshotModel({ asOf: new Date().toISOString(), occupationRelease: { id: manifest.id, manifest }, companies: [], aliases: [],
  sectorConcepts: sectors.map((s: { code: string; labels: Record<string, string> }) => ({ code: s.code, labels: s.labels })) } as SnapshotMetadata);

/** Les 15 marchés au plus grand volume d'offres actives (production, 30/09/2026 20:50 UTC), et les 12 métiers les plus portés. */
const MARCHES_MESURES: CodeMarche[] = ['US', 'FR', 'GB', 'DE', 'CA', 'IT', 'ES', 'NL', 'CH', 'CN', 'BE', 'JP', 'KR', 'HK', 'AE'];
const METIERS = ['sales-advisor', 'beauty-consultant', 'hairdresser', 'store-manager', 'assistant-store-manager', 'manager-floor',
  'stock-associate', 'keyholder', 'retail-sales-lead', 'cashier', 'visual-merchandiser', 'head-cashier'];

/** Un `Prisma.Sql` en texte exécutable par psql : chaque valeur liée devient un littéral. */
const texte = (s: Prisma.Sql) => s.strings.reduce((acc, part, i) => acc + part + (i < s.values.length ? litteral(s.values[i]) : ''), '');
function litteral(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  throw new Error(`Valeur non prévue : ${typeof v}`);
}
const cleLibelle = (l: string) => (l === 'zh' ? 'zh-CN' : l);

const sortie: string[] = ["\\pset footer off", "\\pset tuples_only on"];
const chrono: string[] = [];
for (const code of MARCHES_MESURES) {
  const m = MARCHES[code];
  const pays = m.pays.map((p) => `'${p}'`).join(',');
  for (const cle of METIERS) {
    const o = manifest.occupations.find((x) => x.key === cle)!;
    const q = o.labels[cleLibelle(langueDesLibelles(m.localeParDefaut))] ?? o.labels.en;
    const entiere = model.resolver.resolve(q);
    const [c] = entiere.clauses;
    if (entiere.clauses.length !== 1 || c.kind !== 'role' || c.keys[0] !== cle) {
      sortie.push(`SELECT '${code}|${cle}|${q.replace(/'/g, "''")}|non résolu en un seul métier';`);
      continue;
    }
    const restreinte = model.intention(q, m);
    const [a, b] = [searchSql(entiere), searchSql(restreinte)];
    const la = texte(a.condition).length, lb = texte(b.condition).length;
    sortie.push(`WITH d AS (SELECT (${texte(b.condition)}) AS garde, (${texte(a.score)}) AS sa, (${texte(b.score)}) AS sb
  FROM "SearchDocument" s WHERE s.version = '${SEARCH_VERSION}' AND s.country IN (${pays}) AND ${texte(a.condition)})
SELECT '${code}|${cle}|${q.replace(/'/g, "''")}|' || count(*) || '|' || count(*) FILTER (WHERE NOT garde) || '|' || count(*) FILTER (WHERE sa <> sb)
  || '|${c.phrases.length}|${restreinte.clauses[0].phrases.length}|${la}|${lb}' FROM d;`);
    if (['sales-advisor', 'store-manager', 'visual-merchandiser'].includes(cle) && ['FR', 'US', 'DE', 'JP', 'CN'].includes(code))
      for (const [etiquette, x] of [['entiere', a], ['restreinte', b]] as const)
        chrono.push(`SELECT '${code}|${cle}|${etiquette}|' || count(*) || '|' || coalesce(sum(${texte(x.score)}), 0) FROM "SearchDocument" s
  WHERE s.version = '${SEARCH_VERSION}' AND s.country IN (${pays}) AND ${texte(x.condition)};`);
  }
}
console.log([...sortie, "\\echo '--- chrono'", '\\timing on', ...chrono, ...chrono, ...chrono].join('\n'));
