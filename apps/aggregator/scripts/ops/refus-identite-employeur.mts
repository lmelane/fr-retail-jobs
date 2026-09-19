/**
 * POURQUOI LE GARDE-FOU D'IDENTITÉ EMPLOYEUR REFUSE — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/refus-identite-employeur.mts [<heures>]
 *
 * ── CE QU'ON CHERCHE ───────────────────────────────────────────────────────────────────────────
 *
 * `EmployerIdentityReviewRequired` (identity/resolve.ts) est levée par NEUF chemins distincts, et
 * chacun appelle une action différente :
 *
 *   PORTAL_OWNER_NOT_CERTIFIED     le portail n'a pas de propriétaire certifié → registre à compléter
 *   ALIAS_SOURCE_OR_TENANT_CHANGED l'alias connu pointait ailleurs → à réexaminer
 *   CONFLICT: <ids>                plusieurs racines candidates → vrai conflit, arbitrage
 *   <un nom d'entreprise>          l'employeur observé diffère de celui attendu → le nom est la preuve
 *
 * Le dernier cas est le plus fréquent et le plus parlant : le message porte alors le nom de
 * l'entreprise en conflit. Les regrouper dit si 1 574 refus viennent d'un défaut unique ou de
 * 1 574 situations différentes.
 *
 * On ne force RIEN : ce garde-fou empêche de publier les offres d'une Maison sous le nom d'une
 * autre. On le lit pour savoir quoi instruire, pas pour le contourner.
 */
import { PrismaClient } from '@prisma/client';

const heures = Number(process.argv[2] ?? 24);
const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);

/*
 * Le message a la forme :
 *   « Employer identity needs evidence: source=<clé> external=<id> raw=<nom brut> expected=<raison> »
 * On extrait `raw` et `expected` par expression régulière côté base, sur `stack` (le champ qui
 * porte le message complet) — le payload n'expose pas la raison dans un champ propre.
 */
const refus = await q<{ sourceKey: string; brut: string | null; attendu: string | null; n: bigint }>(`
  SELECT "sourceKey",
         payload->'error'->>'rawEmployerName' AS brut,
         payload->'error'->>'proposedName' AS attendu,
         count(*) AS n
    FROM "PipelineEvent"
   WHERE at > now() - interval '${heures} hours'
     AND event = 'job.write_failed'
     AND payload->'error'->>'name' = 'EmployerIdentityReviewRequired'
   GROUP BY 1,2,3 ORDER BY count(*) DESC LIMIT 40`);

const total = refus.reduce((n, r) => n + Number(r.n), 0);
console.log(`\n═══ ${total} REFUS D'IDENTITÉ EMPLOYEUR SUR ${heures} h ═══\n`);
console.log(`   ${'source'.padEnd(24)} ${'refus'.padStart(6)}  employeur observé → attendu\n`);
for (const r of refus)
  console.log(`   ${r.sourceKey.padEnd(24)} ${String(r.n).padStart(6)}  ${(r.brut ?? '—').slice(0, 40).padEnd(42)} → ${(r.attendu ?? '—').slice(0, 45)}`);

/* La raison, agrégée : un défaut unique ou mille situations ? */
console.log(`\n── par type de raison ──\n`);
const types = await q<{ type: string; sources: bigint; n: bigint }>(`
  SELECT CASE
           WHEN payload->'error'->>'proposedName' = 'PORTAL_OWNER_NOT_CERTIFIED' THEN 'PORTAL_OWNER_NOT_CERTIFIED'
           WHEN payload->'error'->>'proposedName' = 'ALIAS_SOURCE_OR_TENANT_CHANGED' THEN 'ALIAS_SOURCE_OR_TENANT_CHANGED'
           WHEN payload->'error'->>'proposedName' LIKE 'CONFLICT:%' THEN 'CONFLICT (plusieurs racines)'
           ELSE 'NOM D''EMPLOYEUR DIVERGENT' END AS type,
         count(DISTINCT "sourceKey") AS sources, count(*) AS n
    FROM "PipelineEvent"
   WHERE at > now() - interval '${heures} hours'
     AND event = 'job.write_failed' AND payload->'error'->>'name' = 'EmployerIdentityReviewRequired'
   GROUP BY 1 ORDER BY count(*) DESC`);
for (const t of types)
  console.log(`   ${t.type.padEnd(34)} ${String(t.n).padStart(6)} offre(s)  ${String(t.sources).padStart(4)} source(s)`);

console.log(`\n── un exemple complet, pour lire la forme réelle du message ──\n`);
const [ex] = await q<{ stack: string }>(`
  SELECT payload->'error'->>'message' AS stack FROM "PipelineEvent"
   WHERE at > now() - interval '${heures} hours'
     AND event='job.write_failed' AND payload->'error'->>'name'='EmployerIdentityReviewRequired' LIMIT 1`);
if (ex) console.log(`   ${ex.stack}`);

console.log('');
await prisma.$disconnect();
