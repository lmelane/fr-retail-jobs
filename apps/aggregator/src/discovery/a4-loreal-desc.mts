import { readFileSync } from 'node:fs';
import { htmlToPlainText } from '../lib/html.js';
/** Audit a4 — rejoue htmlToPlainText sur le bloc itemprop=description de la page L'Oréal sauvegardée (aucun réseau). */
const h = readFileSync(process.argv[2], 'utf8');
const m = h.match(/itemprop="description"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
const txt = htmlToPlainText(m?.[1] ?? '');
console.log('plain chars', txt.length, 'newlines', (txt.match(/\n/g) ?? []).length, '| head:', JSON.stringify(txt.slice(0, 160)));
