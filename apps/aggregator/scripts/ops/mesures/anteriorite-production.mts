/**
 * ANTÉRIORITÉ DE PUBLICATION EN PRODUCTION — la mesure qui tranche `SOURCE_NEVER_PUBLISHED_FOR_HOUSE`.
 *
 * ── LA QUESTION ────────────────────────────────────────────────────────────────────────────────
 *
 * En development, la base est vierge : aucune source n'a d'antériorité, donc le garde-fou
 * anti-usurpation refuse la PREMIÈRE offre de chaque source. La question est de savoir si ce refus
 * est un ARTEFACT D'ENVIRONNEMENT (la production, elle, a publié cette source pour cette Maison)
 * ou un BLOCKER RÉEL (elle ne l'a jamais publiée nulle part).
 *
 *   antériorité en production OUI → ENVIRONMENT_ARTIFACT, la règle produit reste inchangée
 *   antériorité en production NON → blocker réel, à instruire
 *
 * ── L'ACCÈS : `catwalks_audit`, JAMAIS `postgres` ──────────────────────────────────────────────
 *
 * Toute lecture de production passe par le rôle `catwalks_audit`, dont le mot de passe vit hors
 * dépôt (`~/.catwalks/audit-access.json`, permissions 600).
 *
 * Le compte `postgres` est SUPERUTILISATEUR et reste interdit pour un audit applicatif, même
 * « avec précaution » : mesuré le 2026-09-21, un `CREATE TEMP TABLE` est passé en production
 * malgré `SET ROLE catwalks_audit` ET `default_transaction_read_only = on` — un superutilisateur
 * n'est contraint par aucun `GRANT` ni par un réglage de session. Le sujet n'est pas PostgreSQL,
 * c'est le rayon d'action en cas d'erreur humaine.
 *
 * `catwalks_audit` porte la protection dans le COMPTE, pas dans la discipline de l'appelant :
 * 43 tables lisibles, 0 inscriptible, `default_transaction_read_only=on` appliqué d'office,
 * `statement_timeout=60s`. Vérifié le 2026-09-22 : `CREATE TABLE` y est refusé sans rien demander.
 *
 * Le contrôle ci-dessous reste néanmoins : il vérifie que le verrou est EFFECTIF plutôt que de le
 * supposer, et refuse de mesurer sinon.
 *
 *   PROD_DATABASE_URL=... npx tsx <ce fichier> <sourceKey...>
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.PROD_DATABASE_URL ?? '';
if (!url) { console.error('PROD_DATABASE_URL requis.'); process.exit(2); }
const cles = process.argv.slice(2);
if (!cles.length) { console.error('usage : anteriorite-production.mts <sourceKey...>'); process.exit(2); }

const prisma = new PrismaClient({ datasources: { db: { url } } });

const lignes = await prisma.$transaction(async tx => {
  /*
   * LE GARDE, ÉPROUVÉ AVANT LA MESURE. On ne se contente pas de DEMANDER la lecture seule : on
   * vérifie que le serveur l'a bien appliquée. Sans cette lecture, un `SET` silencieusement ignoré
   * laisserait croire à une protection qui n'existe pas.
   */
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const [etat] = await tx.$queryRawUnsafe<Array<{ transaction_read_only: string }>>(
    `SELECT current_setting('transaction_read_only') AS transaction_read_only`);
  if (etat?.transaction_read_only !== 'on') throw new Error('Transaction non verrouillée en lecture seule : mesure refusée');

  return tx.$queryRawUnsafe<Array<{ sourceKey: string; maison: string | null; offres: bigint; publiees: bigint }>>(`
    SELECT s.key                                   AS "sourceKey",
           s.maison                                AS maison,
           count(js.id)                            AS offres,
           /* ANTERIORITE AU SENS EXACT DE LA REGLE (identity/resolve.ts) : existe-t-il une offre
            * de CETTE source rattachee a la Maison visee ? Ce lien, et lui seul, est ce que le
            * garde-fou exige. */
           count(js.id) FILTER (WHERE c.name = s.maison) AS publiees
      FROM "Source" s
      LEFT JOIN "JobSource" js ON js."sourceKey" = s.key
      LEFT JOIN "Job"       j  ON j.id = js."jobId"
      LEFT JOIN "Company"   c  ON c.id = j."companyId"
     WHERE s.key = ANY($1::text[])
     GROUP BY s.key, s.maison
     ORDER BY 4 DESC, 3 DESC`, cles);
});

console.log(`\n═══ ANTÉRIORITÉ EN PRODUCTION — ${cles.length} source(s) ═══\n`);
console.log(`${'source'.padEnd(24)} ${'maison'.padEnd(24)} ${'offres'.padStart(7)} ${'même maison'.padStart(12)}  verdict`);
let artefacts = 0, reels = 0;
for (const cle of cles) {
  const l = lignes.find(x => x.sourceKey === cle);
  if (!l) { console.log(`${cle.padEnd(24)} ${'(absente du registre prod)'.padEnd(24)}`); continue; }
  const publiees = Number(l.publiees);
  const verdict = publiees > 0 ? 'ENVIRONMENT_ARTIFACT' : 'BLOCKER_REEL';
  publiees > 0 ? artefacts++ : reels++;
  console.log(`${l.sourceKey.padEnd(24)} ${(l.maison ?? '—').padEnd(24)} ${String(l.offres).padStart(7)} ${String(publiees).padStart(12)}  ${verdict}`);
}
console.log(`\n  ENVIRONMENT_ARTIFACT : ${artefacts}   ·   BLOCKER_REEL : ${reels}\n`);

await prisma.$disconnect();
