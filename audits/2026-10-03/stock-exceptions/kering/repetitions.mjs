// Répétitions et absents entre deux extractions de pages de liste Kering (sorties de ../extraire-capture.mts --motif=pcsx/search).
//   node repetitions.mjs <dossier-capture-A> <dossier-capture-B>
import fs from 'node:fs';
const load = (dir) => JSON.parse(fs.readFileSync(`${dir}/index.json`)).map((r) => JSON.parse(fs.readFileSync(`${dir}/${r.file}`)).data);
const [a, b] = process.argv.slice(2).map(load);
for (const [name, pages] of [['A', a], ['B', b]]) {
  const where = new Map();
  pages.forEach((d, i) => d.positions.forEach((p, j) => { const k = String(p.id); (where.get(k) ?? where.set(k, []).get(k)).push(`${i * 10 + j}`); }));
  console.log(name, 'pages', pages.length, 'count', [...new Set(pages.map((d) => d.count))], 'sortBy', pages[0].sortBy, 'distincts', where.size,
    'répétées', [...where].filter(([, v]) => v.length > 1));
}
const ids = (pages) => new Set(pages.flatMap((d) => d.positions.map((p) => String(p.id))));
const A = ids(a), B = ids(b);
console.log('dans A pas dans B', [...A].filter((x) => !B.has(x)), 'dans B pas dans A', [...B].filter((x) => !A.has(x)));
