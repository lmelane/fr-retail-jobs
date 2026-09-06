import { readFileSync } from 'node:fs';
import { parseMicrodataDetail } from '../ats/adapters/successfactors.js';
/** Audit a4 — rejoue le parseur SuccessFactors actuel sur la page adidas sauvegardée (aucun réseau). */
const html = readFileSync(process.argv[2], 'utf8');
const d = parseMicrodataDetail(html);
const desc = d.description ?? '';
console.log(JSON.stringify({ title: d.title, city: d.city, country: d.country, postedAt: d.postedAt, validThrough: d.validThrough, descLen: desc.length, newlines: (desc.match(/\n/g) ?? []).length, head: desc.slice(0, 200) }, null, 1));
