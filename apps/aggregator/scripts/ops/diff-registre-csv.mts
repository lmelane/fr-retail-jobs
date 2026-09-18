/**
 * CE QU'UN IMPORT DU TABLEAU CHANGERAIT — lecture seule, N'ÉCRIT RIEN.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/diff-registre-csv.mts <fichier.csv>
 *
 * ── POURQUOI ───────────────────────────────────────────────────────────────────────────────────
 *
 * Un tableau relu à la main porte des corrections précieuses ET des changements de statut : ici
 * 108 RETIRED contre 96 en base. Importer sans regarder, c'est retirer des sources sans savoir
 * lesquelles — et un RETIRED ne se re-promeut pas tout seul.
 *
 * Ce script compare colonne par colonne et classe les écarts. Il n'écrit rien : c'est le rapport
 * qu'on lit AVANT de décider ce qu'on importe.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const fichier = process.argv[2];
if (!fichier) {
  console.error('Usage : diff-registre-csv.mts <fichier.csv>');
  process.exit(2);
}

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

/* Un séparateur `;` et un BOM : le tableau vient d'un tableur, pas d'un export machine. */
const texte = readFileSync(fichier, 'utf8').replace(/^﻿/, '');
const lignes = texte.split(/\r?\n/).filter((l) => l.trim());
const entetes = lignes[0].split(';').map((h) => h.trim());
const csv = lignes.slice(1).map((l) => {
  const cases = l.split(';');
  return Object.fromEntries(entetes.map((h, i) => [h, (cases[i] ?? '').trim()])) as Record<string, string>;
});

type Source = { key: string; status: string; careersDomain: string | null };
const base = new Map<string, Source>(
  (await prisma.$queryRawUnsafe<Source[]>(`SELECT key, status, "careersDomain" FROM "Source"`))
    .map((s) => [s.key, s]));

const absentes: string[] = [];
const statutChange: Array<{ key: string; avant: string; apres: string }> = [];
const inconnues: string[] = [];

for (const r of csv) {
  const s = base.get(r.cle);
  if (!s) { inconnues.push(r.cle); continue; }
  if (r.statut && r.statut !== s.status) statutChange.push({ key: r.cle, avant: s.status, apres: r.statut });
}
for (const key of base.keys()) if (!csv.some((r) => r.cle === key)) absentes.push(key);

console.log(`\n${csv.length} ligne(s) dans le tableau · ${base.size} source(s) en base\n`);

if (inconnues.length) {
  console.log(`   ${inconnues.length} clé(s) du tableau ABSENTE(S) de la base (seraient créées) :`);
  for (const k of inconnues.slice(0, 20)) console.log(`      ${k}`);
  console.log('');
}
if (absentes.length) {
  console.log(`   ${absentes.length} source(s) en base absente(s) du tableau (inchangées) :`);
  for (const k of absentes.slice(0, 20)) console.log(`      ${k}`);
  console.log('');
}

/*
 * Le changement de statut est le seul écart DESTRUCTIF de ce tableau : une source passée en
 * RETIRED cesse d'être collectée, et rien ne la ressuscite automatiquement. On le sort en premier
 * et en entier — jamais tronqué.
 */
if (statutChange.length) {
  console.log(`   ${statutChange.length} CHANGEMENT(S) DE STATUT :`);
  const vers = new Map<string, number>();
  for (const c of statutChange) {
    const cle = `${c.avant} → ${c.apres}`;
    vers.set(cle, (vers.get(cle) ?? 0) + 1);
  }
  for (const [k, n] of vers) console.log(`      ${k.padEnd(24)} ${n}`);
  console.log('');
  for (const c of statutChange.filter((c) => c.apres === 'RETIRED')) {
    console.log(`      RETIRE : ${c.key.padEnd(28)} (était ${c.avant})`);
  }
  console.log('');
}

const scope = csv.filter((r) => r.portail_une_seule_marque);
const domaine = csv.filter((r) => r.domaine_officiel);
console.log(`   ${scope.length} ligne(s) portent portail_une_seule_marque`);
console.log(`   ${domaine.length} ligne(s) portent domaine_officiel`);
console.log(`   ${csv.filter((r) => r.identite === 'VERIFIED').length} ligne(s) marquées identite=VERIFIED (information, jamais importée : seule une capture prouve l'identité)\n`);

await prisma.$disconnect();
