/**
 * IMPORTER LE TABLEAU RELU À LA MAIN — inspection par défaut, écriture sur `--ecrire`.
 *
 *   # inspection, n'écrit RIEN :
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/importer-registre-csv.mts <fichier.csv>
 *
 *   # exécution :
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/importer-registre-csv.mts <fichier.csv> --ecrire
 *
 * ── CE QU'IL IMPORTE, ET CE QU'IL REFUSE D'IMPORTER ────────────────────────────────────────────
 *
 *   `domaine_officiel`          → `Company.domain` de la Maison, via le nom. C'est la donnée qui
 *                                 manquait le plus : la campagne refuse une source dont la Maison
 *                                 n'a pas de domaine officiel résolu.
 *   `portail_une_seule_marque`  → `Source.portalScope`. Une DÉCISION de périmètre relue par un
 *                                 humain, pas une preuve : la campagne la lira pour renseigner la
 *                                 revue d'identité, dont la preuve reste la capture archivée.
 *   `statut` = RETIRED          → `Source.status`. SEUL changement destructif de cet import : une
 *                                 source retirée cesse d'être collectée et ne revient pas seule.
 *
 *   `identite` = VERIFIED       → JAMAIS IMPORTÉ. Dans ce système une identité ne se déclare pas,
 *                                 elle se prouve par une capture (page officielle → lien vers le
 *                                 portail → hash). La colonne dit au relecteur où chercher ; elle
 *                                 ne peut pas se substituer à `SourceIdentityReview`.
 *   `portail_url`, `ats`, `palier` → non importés ici : ils décrivent la configuration technique,
 *                                 qui a son propre chemin (`config`) et ses propres garde-fous.
 *
 * Aucune valeur n'est devinée : une case vide laisse la donnée existante intacte.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const ECRIRE = process.argv.includes('--ecrire');
const fichier = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!fichier) {
  console.error('Usage : importer-registre-csv.mts <fichier.csv> [--ecrire]');
  process.exit(2);
}

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

/* Séparateur `;` et BOM : le tableau vient d'un tableur, pas d'un export machine. */
const texte = readFileSync(fichier, 'utf8').replace(/^﻿/, '');
const lignes = texte.split(/\r?\n/).filter((l) => l.trim());
const entetes = lignes[0].split(';').map((h) => h.trim());
const csv = lignes.slice(1).map((l) => {
  const cases = l.split(';');
  return Object.fromEntries(entetes.map((h, i) => [h, (cases[i] ?? '').trim()])) as Record<string, string>;
});

const SCOPES = new Set(['SINGLE_BRAND', 'MULTI_BRAND']);

type Source = { key: string; maison: string; status: string; portalScope: string | null };
const base = new Map<string, Source>(
  (await prisma.$queryRawUnsafe<Source[]>(`SELECT key, maison, status, "portalScope" FROM "Source"`))
    .map((s) => [s.key, s]));

const scopes: Array<{ key: string; valeur: string }> = [];
const retraits: Array<{ key: string; avant: string }> = [];
const domaines = new Map<string, string>();
const refuses: string[] = [];

for (const r of csv) {
  const s = base.get(r.cle);
  if (!s) { refuses.push(`${r.cle} : absente du registre`); continue; }

  const scope = r.portail_une_seule_marque;
  if (scope) {
    if (!SCOPES.has(scope)) refuses.push(`${r.cle} : portail_une_seule_marque « ${scope} » invalide`);
    else if (s.portalScope !== scope) scopes.push({ key: r.cle, valeur: scope });
  }

  if (r.statut === 'RETIRED' && s.status !== 'RETIRED') retraits.push({ key: r.cle, avant: s.status });

  /*
   * Le domaine officiel vit sur la Maison, pas sur la source : plusieurs sources d'une même Maison
   * doivent en partager un seul. On rapproche par NOM, comme la requête des candidats.
   */
  if (r.domaine_officiel) {
    const attendu = domaines.get(s.maison);
    if (attendu && attendu !== r.domaine_officiel) {
      refuses.push(`${s.maison} : deux domaines différents dans le tableau (${attendu} ≠ ${r.domaine_officiel})`);
    } else domaines.set(s.maison, r.domaine_officiel);
  }
}

console.log(`\nIMPORT DU TABLEAU — ${csv.length} ligne(s) lue(s), ${base.size} source(s) en base\n`);
console.log(`   ${scopes.length} portalScope à écrire`);
console.log(`   ${retraits.length} source(s) à RETIRER  ← seul changement destructif`);
console.log(`   ${domaines.size} Maison(s) avec un domaine officiel déclaré`);
if (refuses.length) {
  console.log(`\n   ${refuses.length} REFUS (rien ne sera écrit pour ces lignes) :`);
  for (const m of refuses.slice(0, 25)) console.log(`      ${m}`);
}
for (const r of retraits) console.log(`   RETIRE ${r.key.padEnd(28)} (était ${r.avant})`);

if (!ECRIRE) {
  console.log(`\nINSPECTION SEULEMENT — rien n'a été écrit. Ajouter --ecrire pour appliquer.\n`);
  await prisma.$disconnect();
  process.exit(0);
}

let nScope = 0, nRetrait = 0, nDomaine = 0;
await prisma.$transaction(async (tx) => {
  for (const s of scopes) {
    nScope += await tx.$executeRawUnsafe(`UPDATE "Source" SET "portalScope" = $1 WHERE key = $2`, s.valeur, s.key);
  }
  for (const r of retraits) {
    // `status <> 'RETIRED'` dans le WHERE : si une autre exécution l'a déjà retirée, on ne rejoue rien.
    nRetrait += await tx.$executeRawUnsafe(
      `UPDATE "Source" SET status = 'RETIRED' WHERE key = $1 AND status <> 'RETIRED'`, r.key);
  }
  for (const [maison, domaine] of domaines) {
    // Le domaine ne s'écrit que s'il MANQUE : une valeur déjà posée par un humain prime sur l'import.
    nDomaine += await tx.$executeRawUnsafe(
      `UPDATE "Company" SET domain = $1, "domainSource" = 'registre-relu-2026-09-18'
        WHERE name = $2 AND (domain IS NULL OR domain = '')`, domaine, maison);
  }
}, { maxWait: 30_000, timeout: 600_000 });

console.log(`\n   ${nScope} portalScope écrits`);
console.log(`   ${nRetrait} source(s) retirée(s)`);
console.log(`   ${nDomaine} domaine(s) officiel(s) écrit(s) sur des Maisons qui n'en avaient pas`);
console.log(`\n✔ Aucune identité créée : seule une capture archivée peut prouver une identité.\n`);

await prisma.$disconnect();
