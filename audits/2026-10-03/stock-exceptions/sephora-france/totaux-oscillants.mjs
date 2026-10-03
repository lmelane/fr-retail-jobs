// Totaux en_US page par page, par passe, dans un manifeste scellé (sortie de ../lire-manifeste.mts --pages).
//   node totaux-oscillants.mjs <manifeste.json> [locale]
import fs from 'node:fs';
const [file, locale = 'en_US'] = process.argv.slice(2);
const pe = JSON.parse(fs.readFileSync(file)).manifest.metadata.enumeration.pageEvidence.filter((p) => p.url.includes(`locale=${locale}`));
for (const [name, pass] of [['passe 1', pe.filter((p) => !p.url.includes('#pass=2'))], ['passe fraîche', pe.filter((p) => p.url.includes('#pass=2'))]]) {
  const seen = new Set(); let rep = 0; const flips = []; let prev;
  for (const p of pass) { p.ids.forEach((i) => { if (seen.has(i)) rep++; seen.add(i); }); const t = p.pagination?.total; if (prev !== undefined && t !== prev) flips.push(`${p.offset}:${prev}->${t}`); prev = t; }
  console.log(name, 'pages', pass.length, 'distincts', seen.size, 'répétés', rep, 'bascules', flips.length, flips.join(' '));
}
console.log('union', new Set(pe.flatMap((p) => p.ids)).size);
