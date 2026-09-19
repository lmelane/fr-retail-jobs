/**
 * APPLIQUER LES DÉCISIONS SUR LES DOMAINES DIVERGENTS — inspection par défaut.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/appliquer-domaines-divergents.mts <fichier.csv>
 *
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/appliquer-domaines-divergents.mts <fichier.csv> --ecrire
 *
 * ── LE PROBLÈME ────────────────────────────────────────────────────────────────────────────────
 *
 * La campagne rend DOMAINE_OFFICIEL_DIVERGENT quand le portail est servi sous un autre domaine
 * d'employeur que celui du registre. Elle a raison de ne pas trancher seule : accepter n'importe
 * quel domaine servi reviendrait à publier les offres d'une Maison sous le nom d'une autre.
 *
 * Mais la plupart de ces écarts sont légitimes, et seul un humain peut le dire. Mesuré le
 * 19/09/2026 sur 19 cas relus un par un : 17 domaines appartiennent bien à la Maison — variantes
 * d'extension (`nikin.com`/`nikin.ch`), domaines carrières dédiés (`carrieres-rolex.com`),
 * hébergeurs RH (`molton-brown.voyse.io`), ou société mère (Elli est la marque cœur de
 * JULIE & GRACE GmbH, vérifié sur l'adresse de retour du site). Un seul relève d'un distributeur
 * tiers, un autre d'un domaine de registre déjà correct.
 *
 * ── CE QUE CHAQUE DÉCISION FAIT ────────────────────────────────────────────────────────────────
 *
 *   ACCEPTER   le domaine servi devient un domaine officiel de la Maison, À CÔTÉ de celui du
 *              registre. Une Maison peut en avoir plusieurs ; on n'écrase jamais le premier.
 *   REGISTRE   le domaine du registre reste seul valide. Rien n'est écrit — c'est déjà l'état.
 *   RETIRER    la source pointe sur une autre entreprise : elle passe en RETIRED et cesse d'être
 *              collectée. SEUL changement destructif de ce script.
 *
 * Une décision vide laisse la source intacte.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const ECRIRE = process.argv.includes('--ecrire');
const fichier = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!fichier) { console.error('Usage : appliquer-domaines-divergents.mts <fichier.csv> [--ecrire]'); process.exit(2); }

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

const DOMAINE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
type Action = { key: string; maison: string; decision: string; domaine: string; etat: string; detail?: string };
const actions: Action[] = [];

for (const r of csv) {
  const d = r.decision;
  if (!d) continue;
  const [s] = await prisma.$queryRawUnsafe<Array<{ maison: string; status: string }>>(
    `SELECT maison, status FROM "Source" WHERE key=$1`, r.cle);
  if (!s) { actions.push({ key: r.cle, maison: '', decision: d, domaine: '', etat: 'REFUS', detail: 'source absente' }); continue; }

  if (d === 'REGISTRE') { actions.push({ key: r.cle, maison: s.maison, decision: d, domaine: '', etat: 'RIEN', detail: 'le registre reste seul valide' }); continue; }
  if (d === 'RETIRER') {
    actions.push({ key: r.cle, maison: s.maison, decision: d, domaine: '',
      etat: s.status === 'RETIRED' ? 'RIEN' : 'RETIRER', detail: s.status === 'RETIRED' ? 'déjà retirée' : `était ${s.status}` });
    continue;
  }
  if (d !== 'ACCEPTER') { actions.push({ key: r.cle, maison: s.maison, decision: d, domaine: '', etat: 'REFUS', detail: `décision « ${d} » inconnue` }); continue; }

  const domaine = r.domaine_servi.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!DOMAINE.test(domaine)) { actions.push({ key: r.cle, maison: s.maison, decision: d, domaine, etat: 'REFUS', detail: 'domaine servi illisible' }); continue; }

  /*
   * Le domaine servi devient une Maison À PART ENTIÈRE portant le libellé de la source, si aucune
   * ne le porte déjà. C'est le chemin que la campagne emprunte (`Company.name = Source.maison`),
   * et celui que `poser-domaine-source` a ouvert pour les 15 domaines relus hier.
   */
  const [existante] = await prisma.$queryRawUnsafe<Array<{ name: string; domain: string | null }>>(
    `SELECT name, domain FROM "Company" WHERE name=$1 LIMIT 1`, s.maison);
  actions.push({ key: r.cle, maison: s.maison, decision: d, domaine,
    etat: !existante ? 'CREER' : existante.domain === domaine ? 'RIEN' : existante.domain ? 'AJOUTER' : 'COMPLETER',
    detail: existante?.domain ? `Maison porte déjà ${existante.domain}` : undefined });
}

const par = (e: string) => actions.filter((a) => a.etat === e);
console.log(`\nDOMAINES DIVERGENTS — ${actions.length} décision(s)\n`);
for (const e of ['CREER', 'COMPLETER', 'AJOUTER', 'RETIRER', 'RIEN', 'REFUS']) {
  const xs = par(e);
  if (xs.length) console.log(`   ${e.padEnd(12)} ${String(xs.length).padStart(3)}`);
}
console.log('');
for (const a of actions) {
  console.log(`   ${a.etat.padEnd(11)} ${a.key.padEnd(26)} ${a.decision.padEnd(10)} ${a.domaine || '—'}${a.detail ? `  (${a.detail})` : ''}`);
}

if (!ECRIRE) {
  console.log(`\nINSPECTION SEULEMENT — rien n'a été écrit. Ajouter --ecrire pour appliquer.\n`);
  await prisma.$disconnect();
  process.exit(0);
}

let crees = 0, completes = 0, retires = 0, ajoutes = 0;
for (const a of actions) {
  if (a.etat === 'CREER') {
    const cle = a.maison.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Company" (id, name, "canonicalKey", domain, "domainSource", "fashionjobsUrl", "updatedAt")
       VALUES ($1, $2, $3, $4, 'domaine-divergent-relu-2026-09-19', $5, CURRENT_TIMESTAMP)
       ON CONFLICT ("fashionjobsUrl") DO NOTHING`,
      randomUUID(), a.maison, cle, a.domaine, `resolved:${cle}`);
    crees++;
  } else if (a.etat === 'COMPLETER') {
    completes += await prisma.$executeRawUnsafe(
      `UPDATE "Company" SET domain=$1, "domainSource"='domaine-divergent-relu-2026-09-19'
        WHERE name=$2 AND (domain IS NULL OR domain='')`, a.domaine, a.maison);
  } else if (a.etat === 'AJOUTER') {
    /*
     * La Maison porte déjà un domaine relu, qu'on n'écrase pas : `Company.domain` n'en tient qu'un.
     * Le domaine servi, lui, appartient à la SOURCE — c'est sous lui que SON portail est servi.
     * On l'inscrit donc dans sa note de registre, sous une forme que la campagne pourra lire :
     * `domaine-accepte:<domaine>`. Le domaine de la Maison reste la référence ; celui-ci dit
     * « ce domaine-là est aussi le sien, un humain l'a vérifié ».
     */
    ajoutes += await prisma.$executeRawUnsafe(
      `UPDATE "Source" SET note = CASE
          WHEN note IS NULL OR note = '' THEN $1
          WHEN position($1 in note) > 0 THEN note
          ELSE note || ' | ' || $1 END
        WHERE key = $2`, `domaine-accepte:${a.domaine}`, a.key);
  } else if (a.etat === 'RETIRER') {
    retires += await prisma.$executeRawUnsafe(
      `UPDATE "Source" SET status='RETIRED' WHERE key=$1 AND status<>'RETIRED'`, a.key);
  }
}

console.log(`\n   ${crees} Maison(s) créée(s) · ${completes} complétée(s) · ${retires} source(s) retirée(s)`);
if (ajoutes) console.log(`   ${ajoutes} domaine(s) accepté(s) sur une Maison qui en porte déjà un — non écrit(s), à arbitrer`);
console.log('');

await prisma.$disconnect();
