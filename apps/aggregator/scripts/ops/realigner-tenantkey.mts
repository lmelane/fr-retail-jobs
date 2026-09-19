/**
 * RÉALIGNER `tenantKey` SUR LA CONFIGURATION COURANTE — inspection par défaut.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/realigner-tenantkey.mts
 *
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/realigner-tenantkey.mts --ecrire
 *
 * ── LE DÉFAUT ──────────────────────────────────────────────────────────────────────────────────
 *
 * `tenantKey` identifie le FEED d'une source : deux sources qui le partagent visent le même flux,
 * et la campagne refuse la seconde (« Candidate conflicts with existing source »). Cette garde
 * existe pour empêcher de télécharger deux fois le même catalogue sous deux noms.
 *
 * Mais la clé est calculée À L'ENREGISTREMENT et ne suit pas la configuration. Mesuré le
 * 19/09/2026 : `alberto`, `oska`, `oniverse` et `bevilles-jewellers` portent une clé dérivée de
 * leur ANCIENNE URL de listing, alors que leur config est passée à un sitemap. La campagne
 * recalcule la clé depuis la config, ne reconnaît pas celle en base, et conclut au conflit — avec
 * une source qui n'existe pas.
 *
 * Vérifié : aucune de ces quatre n'a de véritable homonyme. Le conflit est un artefact.
 *
 * ── CE QU'IL FAIT, ET CE QU'IL REFUSE DE FAIRE ─────────────────────────────────────────────────
 *
 * Il recalcule la clé avec `tenantKeyOf` — la fonction que la campagne emploie — et l'écrit quand
 * elle diverge. Si la clé recalculée est DÉJÀ PORTÉE par une autre source, il REFUSE d'écrire et
 * le signale : ce serait alors un vrai doublon, qui demande un arbitrage, pas un réalignement.
 *
 * Le déclencheur de révision ne surveille pas `tenantKey` : l'écriture ne crée pas de révision et
 * n'invalide donc aucune preuve acquise.
 */
import { PrismaClient } from '@prisma/client';
import { tenantKeyOf } from '../../src/connectors/sourceStore.js';

const ECRIRE = process.argv.includes('--ecrire');

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL (ou DATABASE_URL) manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Source = { key: string; maison: string; kind: string; status: string; tenantKey: string; config: unknown; careersDomain: string | null };
/*
 * TOUS les statuts, pas seulement ACTIVE. La contrainte d'unicité de `tenantKey` porte sur la
 * table entière : une source RETIRED occupe sa clé et fait échouer l'écriture. Mesuré le
 * 19/09/2026 — `dr-jart-13` (RETIRED) tenait `eightfold:elcompanies.com`, que
 * `estee-lauder-companies` devait recevoir. Ne lire que les ACTIVE laissait passer ce conflit
 * jusqu'à l'erreur 23505.
 */
const sources = await prisma.$queryRawUnsafe<Source[]>(
  `SELECT key, maison, kind, status, "tenantKey", config, "careersDomain" FROM "Source" ORDER BY key`);

/* Qui porte quelle clé aujourd'hui, tous statuts confondus. */
const porteurs = new Map<string, string[]>();
for (const s of sources) porteurs.set(s.tenantKey, [...(porteurs.get(s.tenantKey) ?? []), `${s.key}[${s.status}]`]);

const aEcrire: Array<{ key: string; avant: string; apres: string }> = [];
const conflits: string[] = [];
const illisibles: string[] = [];

for (const s of sources) {
  let attendu: string;
  try { attendu = tenantKeyOf(s.kind, JSON.stringify(s.config), s.careersDomain ?? undefined, s.maison); }
  catch (error) { illisibles.push(`${s.key} : ${error instanceof Error ? error.message : String(error)}`); continue; }
  if (s.status !== 'ACTIVE' || attendu === s.tenantKey) continue;
  const deja = (porteurs.get(attendu) ?? []).filter((k) => !k.startsWith(`${s.key}[`));
  if (deja.length) {
    conflits.push(`${s.key} → « ${attendu} » déjà porté par ${deja.join(', ')} : vrai doublon, à arbitrer`);
    continue;
  }
  aEcrire.push({ key: s.key, avant: s.tenantKey, apres: attendu });
}

console.log(`\nRÉALIGNEMENT DE tenantKey — ${sources.length} source(s) ACTIVE\n`);
console.log(`   ${aEcrire.length} clé(s) à réaligner`);
console.log(`   ${conflits.length} vrai(s) doublon(s) — rien ne sera écrit pour eux`);
console.log(`   ${illisibles.length} configuration(s) illisible(s)`);
for (const a of aEcrire) {
  console.log(`\n   ${a.key}`);
  console.log(`      en base : ${a.avant.slice(0, 92)}`);
  console.log(`      calculé : ${a.apres.slice(0, 92)}`);
}
for (const c of conflits) console.log(`\n   ⚠ ${c}`);
for (const i of illisibles) console.log(`\n   ⚠ ${i}`);

if (!ECRIRE) {
  console.log(`\nINSPECTION SEULEMENT — rien n'a été écrit. Ajouter --ecrire pour appliquer.\n`);
  await prisma.$disconnect();
  process.exit(0);
}

let ecrites = 0;
for (const a of aEcrire) {
  // `tenantKey = avant` dans le WHERE : si une autre exécution l'a déjà réaligné, on ne rejoue rien.
  ecrites += await prisma.$executeRawUnsafe(
    `UPDATE "Source" SET "tenantKey" = $1 WHERE key = $2 AND "tenantKey" = $3`, a.apres, a.key, a.avant);
}
console.log(`\n   ${ecrites} clé(s) réalignée(s)\n`);

await prisma.$disconnect();
