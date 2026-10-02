#!/usr/bin/env node
/**
 * Preuve d'exhaustivité d'UNE lecture (D-493), hors réseau, à partir des sorties de `lecture-langue.mjs`.
 *
 * Usage : node preuve.mjs <etiquette-preuve> <fichier-liste-complete.json> <fichier-partition.json>…
 *
 * Conditions, toutes requises :
 *  1. chaque lecture a sa forme (pages pleines sauf la dernière, de 1 à 10 liens, la suivante vide), et toutes ses
 *     pages qui portent un lien « Dernier » annoncent la même dernière page ;
 *  2. la somme des totaux des partitions égale le total de la liste complète ;
 *  3. les partitions sont disjointes ;
 *  4. l'union de toutes les lectures compte exactement le total de la liste complète.
 * Écrit `../preuves/<etiquette>.json` et l'ensemble trié des identifiants.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [label, fullFile, ...partFiles] = process.argv.slice(2);
if (!label || !fullFile || partFiles.length === 0) { console.error('usage: node preuve.mjs <etiquette> <complete.json> <partition.json>…'); process.exit(2); }
const load = (f) => JSON.parse(readFileSync(join(HERE, '..', 'lectures', f), 'utf8'));
const idsOf = (read) => read.pages.flatMap((p) => p.links.map((l) => l.split(':')[1]));
const check = (read) => ({ shape: read.summary.shape, lastPages: read.summary.lastPageEverywhere, oneLastPage: read.summary.lastPageEverywhere.length <= 1,
  announced: read.summary.announced, distinct: new Set(idsOf(read)).size, repeated: read.summary.repeated, cdn: read.summary.cdn });

const full = load(fullFile);
const parts = partFiles.map(load);
const fullIds = new Set(idsOf(full));
const partIds = parts.map((p) => new Set(idsOf(p)));
const union = new Set([...fullIds, ...partIds.flatMap((s) => [...s])]);
const overlaps = [];
for (let i = 0; i < partIds.length; i += 1) for (let j = i + 1; j < partIds.length; j += 1) for (const id of partIds[i]) if (partIds[j].has(id)) overlaps.push(id);
const sumParts = parts.reduce((n, p) => n + p.summary.announced, 0);
const conditions = {
  formes: [full, ...parts].every((r) => r.summary.shape && r.summary.lastPageEverywhere.length <= 1),
  sommePartitionsEgaleTotal: sumParts === full.summary.announced,
  partitionsDisjointes: overlaps.length === 0,
  unionEgaleTotal: union.size === full.summary.announced,
};
const sorted = [...union].map(Number).sort((a, b) => a - b);
const result = { label, at: full.summary.startedAt, until: parts.at(-1).summary.endedAt,
  complete: { file: fullFile, ...check(full) }, partitions: parts.map((p, i) => ({ file: partFiles[i], extra: p.summary.extra, ...check(p) })),
  total: full.summary.announced, sumPartitions: sumParts, union: union.size, overlaps,
  hiddenByFullRead: sorted.filter((id) => !fullIds.has(String(id))),
  conditions, proven: Object.values(conditions).every(Boolean),
  unionSha256: createHash('sha256').update(sorted.join(',')).digest('hex'), ids: sorted };
mkdirSync(join(HERE, '..', 'preuves'), { recursive: true });
writeFileSync(join(HERE, '..', 'preuves', `${label}.json`), JSON.stringify(result, null, 1));
const { ids: _ids, ...head } = result;
console.log(JSON.stringify(head, null, 1));
