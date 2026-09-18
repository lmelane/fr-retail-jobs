/**
 * POSER LE DOMAINE OFFICIEL RELU SUR LA MAISON D'UNE SOURCE — inspection par défaut.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/poser-domaine-source.mts <fichier.csv>
 *
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/poser-domaine-source.mts <fichier.csv> --ecrire
 *
 * ── LE PROBLÈME QUE CE SCRIPT RÉSOUT ───────────────────────────────────────────────────────────
 *
 * La campagne résout le domaine officiel par égalité EXACTE entre `Source.maison` et
 * `Company.name` (`source-campaign-candidates.sql`), et son commentaire dit pourquoi : « un
 * rapprochement flou attribuerait le domaine d'une Maison à une autre, et c'est précisément ce que
 * la preuve d'identité existe pour empêcher ». Cette prudence est juste, on n'y touche pas.
 *
 * Mais elle laisse 46 sources sans domaine, non parce que la donnée manque — `Groupe Clarins` porte
 * bien `groupeclarins.com` — mais parce que la source se libelle `Clarins`. Mesuré le 18/09/2026 :
 * 354 sources ACTIVE sur 400 trouvent leur Maison par nom exact, 46 non.
 *
 * Ce script écrit le domaine RELU PAR UN HUMAIN sur une Maison portant EXACTEMENT le libellé de la
 * source — en la créant si elle n'existe pas. Le rapprochement cesse d'être une devinette de
 * machine : c'est une décision tracée, et la campagne la lira par son chemin normal, inchangé.
 *
 * ── CE QU'IL NE FAIT PAS ───────────────────────────────────────────────────────────────────────
 *
 * Il ne fusionne aucune Maison, n'en renomme aucune, n'écrase aucun domaine existant, et ne touche
 * ni aux offres ni aux identités. Une Maison déjà pourvue d'un domaine est laissée telle quelle et
 * le rapport le dit.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const ECRIRE = process.argv.includes('--ecrire');
const fichier = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!fichier) {
  console.error('Usage : poser-domaine-source.mts <fichier.csv> [--ecrire]');
  process.exit(2);
}

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL (ou DATABASE_URL) manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

const texte = readFileSync(fichier, 'utf8').replace(/^﻿/, '');
const lignes = texte.split(/\r?\n/).filter((l) => l.trim());
const entetes = lignes[0].split(';').map((h) => h.trim());
const csv = lignes.slice(1).map((l) => {
  const cases = l.split(';');
  return Object.fromEntries(entetes.map((h, i) => [h, (cases[i] ?? '').trim()])) as Record<string, string>;
});

/** Un domaine, pas une URL : la campagne compare des hôtes. */
const DOMAINE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

type Action = { key: string; maison: string; domaine: string; etat: 'CREER' | 'COMPLETER' | 'DEJA_POSE' | 'REFUS'; detail?: string };
const actions: Action[] = [];

for (const r of csv) {
  if (r.action !== 'DOMAINE' || !r.domaine_officiel) continue;
  const domaine = r.domaine_officiel.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!DOMAINE.test(domaine)) {
    actions.push({ key: r.cle, maison: r.maison, domaine, etat: 'REFUS', detail: 'ne ressemble pas à un domaine' });
    continue;
  }
  const [source] = await prisma.$queryRawUnsafe<Array<{ maison: string }>>(
    `SELECT maison FROM "Source" WHERE key=$1`, r.cle);
  if (!source) { actions.push({ key: r.cle, maison: r.maison, domaine, etat: 'REFUS', detail: 'source absente du registre' }); continue; }

  // La Maison portant EXACTEMENT le libellé de la source — le seul chemin que la campagne emprunte.
  const [exacte] = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; domain: string | null }>>(
    `SELECT id, name, domain FROM "Company" WHERE name=$1 LIMIT 1`, source.maison);

  if (!exacte) actions.push({ key: r.cle, maison: source.maison, domaine, etat: 'CREER' });
  else if (!exacte.domain) actions.push({ key: r.cle, maison: source.maison, domaine, etat: 'COMPLETER' });
  else actions.push({ key: r.cle, maison: source.maison, domaine, etat: 'DEJA_POSE', detail: exacte.domain });
}

const par = (e: Action['etat']) => actions.filter((a) => a.etat === e);
console.log(`\nDOMAINES RELUS — ${actions.length} ligne(s)\n`);
console.log(`   ${String(par('CREER').length).padStart(4)} Maison(s) à CRÉER au libellé exact de la source`);
console.log(`   ${String(par('COMPLETER').length).padStart(4)} Maison(s) existante(s) à compléter`);
console.log(`   ${String(par('DEJA_POSE').length).padStart(4)} déjà pourvue(s) — laissée(s) intacte(s)`);
console.log(`   ${String(par('REFUS').length).padStart(4)} refus`);
for (const a of actions) {
  const marque = a.etat === 'REFUS' ? '⚠' : ' ';
  console.log(`   ${marque} ${a.etat.padEnd(10)} ${a.key.padEnd(26)} "${a.maison}" → ${a.domaine}${a.detail ? `  (${a.detail})` : ''}`);
}

if (!ECRIRE) {
  console.log(`\nINSPECTION SEULEMENT — rien n'a été écrit. Ajouter --ecrire pour appliquer.\n`);
  await prisma.$disconnect();
  process.exit(0);
}

let crees = 0, completes = 0;
await prisma.$transaction(async (tx) => {
  for (const a of actions) {
    if (a.etat === 'CREER') {
      /*
       * `fashionjobsUrl` porte l'identifiant canonique de la Maison (`resolved:<clé>`) : c'est par
       * lui que `resolveEmployer` la retrouve. On le dérive du libellé, comme le fait le reste du
       * système, et on laisse la contrainte d'unicité refuser un doublon plutôt que de l'écraser.
       */
      const cle = a.maison.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
      /*
       * `canonicalKey` et `updatedAt` sont NOT NULL sans valeur par défaut — la première tentative
       * les avait omis (erreur 23502). Les autres colonnes requises ont leur défaut en base
       * (kind, sector, atsType à UNKNOWN, discoveryStatus à PENDING) : on les laisse, car inventer
       * un secteur ou un ATS pour une Maison qu'on crée pour son seul domaine serait une donnée
       * fabriquée.
       */
      await tx.$executeRawUnsafe(
        `INSERT INTO "Company" (id, name, "canonicalKey", domain, "domainSource", "fashionjobsUrl", "updatedAt")
         VALUES ($1, $2, $3, $4, 'registre-relu-2026-09-18', $5, CURRENT_TIMESTAMP)
         ON CONFLICT ("fashionjobsUrl") DO NOTHING`,
        randomUUID(), a.maison, cle, a.domaine, `resolved:${cle}`);
      crees++;
    } else if (a.etat === 'COMPLETER') {
      completes += await tx.$executeRawUnsafe(
        `UPDATE "Company" SET domain=$1, "domainSource"='registre-relu-2026-09-18'
          WHERE name=$2 AND (domain IS NULL OR domain='')`, a.domaine, a.maison);
    }
  }
}, { maxWait: 30_000, timeout: 300_000 });

console.log(`\n   ${crees} Maison(s) créée(s) · ${completes} complétée(s)`);

/* Contrôle : la campagne trouve-t-elle désormais un domaine pour ces sources ? */
const restantes = await prisma.$queryRawUnsafe<Array<{ key: string }>>(`
  SELECT s.key FROM "Source" s WHERE s.status='ACTIVE'
    AND NOT EXISTS (SELECT 1 FROM "Company" c WHERE c.name=s.maison AND c.domain IS NOT NULL)`);
console.log(`   ${restantes.length} source(s) ACTIVE encore sans domaine par le chemin de la campagne`);
if (restantes.length) for (const r of restantes.slice(0, 20)) console.log(`      ${r.key}`);
console.log('');

await prisma.$disconnect();
