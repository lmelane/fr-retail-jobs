/**
 * D-488 : d'où vient un écart relevé par `requetes.mts` ? Pour un marché et un métier, chaque expression retirée par la
 * restriction, et le SQL qui compte, dans les documents du marché trouvés par la requête entière, ceux qui contiennent
 * cette expression dans leur intitulé ou leurs missions (poids A et C). Lecture seule, comme `requetes.mts`.
 *
 * Usage : npx tsx audits/2026-10-01/d488-langues-marche/ecarts.mts <contentHash> <MARCHE:metier>... > ecarts.sql
 */
import { readFileSync } from 'node:fs';
import { MARCHES, type CodeMarche } from '@catwalks/db/marches';
import { occupationManifestHash, type OccupationManifest } from '@catwalks/db/occupations';
import { langueDesLibelles } from '@catwalks/db/presentation';
import { snapshotModel, type SnapshotMetadata } from '../../../apps/api/lib/search-model';
import { searchSql } from '../../../apps/api/lib/search-sql';
import { SEARCH_VERSION } from '../../../apps/api/lib/search-index';

const manifest = JSON.parse(readFileSync(new URL('../../2026-09-28/curation-v3/6-manifeste-v3.json', import.meta.url), 'utf8')) as OccupationManifest;
if (occupationManifestHash(manifest) !== process.argv[2]) throw new Error('Manifeste différent de la version active');
const model = snapshotModel({ asOf: new Date().toISOString(), occupationRelease: { id: manifest.id, manifest }, companies: [], aliases: [], sectorConcepts: [] } as unknown as SnapshotMetadata);
const texte = (s: { strings: readonly string[]; values: readonly unknown[] }) =>
  s.strings.reduce((acc, part, i) => acc + part + (i < s.values.length ? (typeof s.values[i] === 'number' ? String(s.values[i]) : `'${String(s.values[i]).replace(/'/g, "''")}'`) : ''), '');
const out = ['\\pset footer off', '\\pset tuples_only on'];
for (const cible of process.argv.slice(3)) {
  const [code, cle] = cible.split(':') as [CodeMarche, string];
  const m = MARCHES[code];
  const o = manifest.occupations.find((x) => x.key === cle)!;
  const l = langueDesLibelles(m.localeParDefaut);
  const q = o.labels[l === 'zh' ? 'zh-CN' : l] ?? o.labels.en;
  const entiere = model.resolver.resolve(q), restreinte = model.intention(q, m);
  const retirees = entiere.clauses[0].phrases.filter((p) => !restreinte.clauses[0].phrases.includes(p));
  const pays = m.pays.map((p) => `'${p}'`).join(',');
  for (const p of retirees) {
    const tsq = '(' + p.split(' ').map((w) => `'${w.replace(/'/g, "''")}':AC`).join(' <-> ') + ')';
    out.push(`SELECT '${code}|${cle}|${p.replace(/'/g, "''")}|' || count(*) || '|' || coalesce(string_agg(s.document->>'title', ' ¦ '), '') FROM "SearchDocument" s
  WHERE s.version = '${SEARCH_VERSION}' AND s.country IN (${pays}) AND ${texte(searchSql(entiere).condition)}
  AND s.vector @@ to_tsquery('simple', '${tsq.replace(/'/g, "''")}') HAVING count(*) > 0;`);
  }
}
console.log(out.join('\n'));
