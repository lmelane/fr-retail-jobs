/**
 * L1 §3 — LES HUIT CONTRÔLES DE L'ACCÈS D'AUDIT, affichés.
 *
 *   AUDIT_DATABASE_URL='postgresql://catwalks_audit:...' \
 *     npx tsx apps/aggregator/scripts/ops/audit-verifier-acces.mts
 *
 * Ce script ne fait qu'AFFICHER ce que `audit-acces.ts` vérifie déjà à chaque ouverture : il sert
 * à consigner le résultat des contrôles après provisionnement. Les scripts de mesure n'ont pas
 * besoin de l'appeler — ils obtiennent leur connexion par `ouvrirAccesAudit`, qui refuse d'en
 * rendre une si un seul contrôle échoue.
 */
import { ouvrirAccesAudit, verifierPrivileges } from './audit-acces.ts';
import { PrismaClient } from '@prisma/client';

const url = process.env.AUDIT_DATABASE_URL;
if (!url) {
  console.error('AUDIT_DATABASE_URL absente. Voir docs/audit-lot0/L1-PROCEDURE-ACCES-AUDIT.md §2.');
  process.exit(2);
}

/*
 * Ici on veut AFFICHER le détail même en cas d'échec — d'où la connexion directe suivie de
 * `verifierPrivileges`, au lieu de `ouvrirAccesAudit` qui lève. C'est le seul endroit du dépôt où
 * ce contournement est justifié : ce script ne mesure rien, il diagnostique.
 */
const prisma = new PrismaClient({ datasources: { db: { url } } });
let profil;
try {
  profil = await verifierPrivileges(prisma);
} catch (e) {
  console.error(`✗ Impossible de vérifier les privilèges : ${String(e)}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
}
await prisma.$disconnect();

console.log(`\n═══ L1 §3 — ACCÈS D'AUDIT ═══\n  rôle : ${profil.role} · base : ${profil.base}\n`);
for (const c of profil.controles)
  console.log(`  ${c.ok ? '✓' : '✗'} ${c.nom.padEnd(30)} ${c.observe.padEnd(40)} (attendu : ${c.attendu})`);

const echecs = profil.controles.filter((c) => !c.ok);
if (echecs.length) {
  console.log(`\n✗ ${echecs.length} contrôle(s) en échec — aucune mesure ne doit démarrer.`);
  console.log('  Ne pas contourner, ne pas se rabattre sur `postgres`.');
  process.exit(1);
}

// Preuve que l'ouverture normale — celle qu'utilisent les scripts de mesure — passe aussi.
const { prisma: ouvert } = await ouvrirAccesAudit();
await ouvert.$disconnect();
console.log('\n✓ Les huit contrôles passent. L\'accès est utilisable pour les mesures.\n');
