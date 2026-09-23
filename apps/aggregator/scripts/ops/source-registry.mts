import { identityReviewOrder } from '../../src/connectors/sourceIdentity.js';
import { readIdentitySources } from '../../src/connectors/sourceRegistryRead.js';
/**
 * LE REGISTRE OPÉRATIONNEL DES SOURCES — lecture seule, une décision par source, aucune par défaut.
 *
 * Il répond à une question que `status = ACTIVE` ne sait pas trancher : **qu'est-ce que cette source a le
 * droit de faire quand le cron tournera ?** Publier ? Fermer des offres ? Seulement collecter des preuves ?
 *
 * C'est ce registre — et non une liste maintenue à la main dans plusieurs fichiers — qui doit produire les
 * périmètres d'exécution. Une liste recopiée diverge ; une liste dérivée ne peut pas.
 *
 * La photographie est prise dans UNE transaction `REPEATABLE READ, READ ONLY` : classer des sources lues
 * dans des instantanés différents produirait un registre qui n'a jamais existé.
 *
 * usage: db.py readonly npx tsx scripts/ops/source-registry.mts [--out=<f.json>] [--md=<f.md>]
 *        [--mode=FULL_AUTOMATION]   n'imprimer que les clés d'un mode (pour dériver un périmètre)
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { accessStatus, readLatestSourceAccess } from '../../src/connectors/sourceAccess.js';
import { readOperationalMode, type OperationalMode } from '../../src/registry/operationalMode.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const outJson = arg('out');
const outMd = arg('md');
const onlyMode = arg('mode') as OperationalMode | undefined;

const p = new PrismaClient();
type Row = Record<string, any>;

const rows = await p.$transaction(async (tx) => {
  await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');

  // Le périmètre du registre : tout ce qui peut collecter un jour. RETIRED est hors sujet.
  const sources = (await readIdentitySources(tx)).filter(source => ['ACTIVE', 'PAUSED'].includes(source.status));

  /** La revue LA PLUS RÉCENTE par source — une contradiction postérieure prime sur une vérification. */
  const reviews = await tx.sourceIdentityReview.findMany({ orderBy: identityReviewOrder, distinct: ['sourceKey'] });
  const reviewOf = new Map(reviews.map((r) => [r.sourceKey, r]));
  const accessOf = await readLatestSourceAccess(tx, sources.map(source => source.key));

  /** Le dernier run RÉEL par source : `Source.lastRun*` est dénormalisé, `SourceRun` fait foi. */
  const runs = await tx.$queryRawUnsafe<Row[]>(
    `SELECT DISTINCT ON (sr."sourceKey") sr."sourceKey", sr.status, sr.complete, sr."canAttestAbsence",
            sr."ranAt", sr.fetched, sr."declaredTotal", sr.truncated
     FROM "SourceRun" sr ORDER BY sr."sourceKey", sr."ranAt" DESC`);
  const runOf = new Map(runs.map((r) => [r.sourceKey, r]));

  /** Ce que chaque source publie réellement aujourd'hui — pour mesurer ce qu'un mode met en jeu. */
  const published = await tx.$queryRawUnsafe<Row[]>(
    `SELECT js."sourceKey", COUNT(*)::int n FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
     WHERE js."isActive" AND j."isActive" GROUP BY 1`);
  const publishedOf = new Map(published.map((r) => [r.sourceKey, Number(r.n)]));

  /** Les pays servis, pour que le canari du Bloc 5 puisse être représentatif sans être deviné. */
  const countries = await tx.$queryRawUnsafe<Row[]>(
    `SELECT js."sourceKey", COUNT(DISTINCT j."countryCode")::int n FROM "JobSource" js
     JOIN "Job" j ON j.id = js."jobId" WHERE js."isActive" AND j."isActive" GROUP BY 1`);
  const countriesOf = new Map(countries.map((r) => [r.sourceKey, Number(r.n)]));

  return await Promise.all(sources.map(async (s) => {
    const rev = reviewOf.get(s.key);
    const access = accessStatus(s, accessOf.get(s.key) ?? null);
    const run = runOf.get(s.key);
    const cfg = (s.config ?? {}) as Record<string, unknown>;
    const decision = await readOperationalMode(tx, s);

    return {
      sourceKey: s.key, maison: s.maison, ats: s.kind,
      dialecte: (cfg.dialect as string) ?? null,
      tenant: s.tenantKey, careersDomain: s.careersDomain, tier: s.tier,
      statutCatalogue: s.status,
      identite: rev ? { verdict: rev.verdict, methode: rev.method, le: rev.checkedAt,
                        couvreLaConfig: rev.sourceRevisionId === s.currentRevisionId } : null,
      acces: access,
      dernierRun: run ? { statut: run.status, le: run.ranAt, servies: run.fetched,
                          annonce: run.declaredTotal, complete: run.complete,
                          tronque: run.truncated, peutAttesterUneAbsence: run.canAttestAbsence } : null,
      offresPubliees: publishedOf.get(s.key) ?? 0,
      paysCouverts: countriesOf.get(s.key) ?? 0,
      modeOperationnel: decision.mode,
      motifs: decision.reasons,
      prochaineAction: decision.nextAction,
    };
  }));
}, { timeout: 180_000 });
await p.$disconnect();

// Un périmètre d'exécution se DÉRIVE du registre : c'est ce qui empêche une liste recopiée de diverger.
if (onlyMode) {
  console.log(rows.filter((r) => r.modeOperationnel === onlyMode).map((r) => r.sourceKey).join(','));
  process.exit(0);
}

const byMode = Object.fromEntries(
  (['FULL_AUTOMATION', 'PUBLISH_NO_CLOSE', 'EVIDENCE_ONLY', 'PAUSED_BLOCKED'] as const)
    .map((m) => [m, rows.filter((r) => r.modeOperationnel === m)]));

const resume = {
  at: new Date().toISOString(),
  sources: rows.length,
  parMode: Object.fromEntries(Object.entries(byMode).map(([m, v]) => [m, v.length])),
  offresParMode: Object.fromEntries(Object.entries(byMode)
    .map(([m, v]) => [m, v.reduce((s, r) => s + r.offresPubliees, 0)])),
  sansDecision: rows.filter((r) => !r.modeOperationnel).length,
  sansProchaineAction: rows.filter((r) => !r.prochaineAction?.trim()).length,
};

if (outJson) writeFileSync(outJson, JSON.stringify({ resume, sources: rows }, null, 1));

if (outMd) {
  const esc = (v: unknown) => String(v ?? '—').replace(/\|/g, '\\|');
  const lignes = rows.map((r) => [
    r.sourceKey, r.maison, r.ats, r.dialecte, r.tenant, r.paysCouverts,
    r.identite?.verdict ?? 'aucune', r.identite?.couvreLaConfig ? 'oui' : 'non',
    JSON.stringify(r.acces.observations), r.acces.passed ? 'ALLOWED' : r.acces.code,
    r.dernierRun?.statut ?? 'aucun', r.dernierRun?.complete ?? '—', r.dernierRun?.peutAttesterUneAbsence ?? '—',
    r.offresPubliees, r.modeOperationnel, r.prochaineAction,
  ].map(esc).join(' | '));
  writeFileSync(outMd,
    `# Registre opérationnel des sources\n\n> ${resume.at} — ${rows.length} sources ACTIVE et PAUSED.\n\n` +
    `| Source | Maison | ATS | Dialecte | Tenant | Pays | Identité | Couvre config | Robots | Accès | Dernier run | Complete | Peut attester | Offres | Mode | Prochaine action |\n` +
    `|---|---|---|---|---|--:|---|---|---|---|---|---|---|--:|---|---|\n` +
    lignes.map((l) => `| ${l} |`).join('\n') + '\n');
}

console.log(JSON.stringify(resume, null, 1));
