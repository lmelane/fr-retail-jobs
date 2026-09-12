/**
 * ENREGISTRER UNE DÉCISION D'IDENTITÉ D'EMPLOYEUR — un libellé natif, une Maison, une preuve archivée.
 *
 * Le mécanisme existait mais ne vivait que dans `backups/` (`aliases-v3-apply.mts`, écrit pour un lot précis et
 * ses fichiers de décisions). Ce programme-ci est GÉNÉRIQUE et versionné : il n'appelle que les fonctions
 * maintenues `buildEmployerRepair` / `applyEmployerRepair` (`src/identity/repair.ts`), qui portent déjà les
 * verrous, le hachage du plan, l'idempotence par `batchId` et la vérification de l'empreinte de configuration
 * de la source.
 *
 * CE QU'IL N'AUTORISE PAS, et c'est le cœur de la décision du propriétaire :
 *  · pas d'alias GLOBAL — la portée est toujours la clé de source (`sourceKey`), jamais `*` ;
 *  · pas de généralisation par motif : on enregistre le libellé EXACT, jamais « tout ce qui contient MECCA » ;
 *  · pas de décision sans preuve : la fonction maintenue refuse un plan dont l'artefact ne correspond pas à son
 *    sha256, et refuse une URL non `https://`.
 *
 * La preuve, la méthode, la date et le périmètre restent traçables : ils sont écrits dans
 * `EmployerIdentityReview` (énoncé, relecteur, date, artefact complet) et l'alias y est rattaché.
 *
 * usage:
 *   record-employer-alias.mts --spec=<fichier.json> --phase=clone|production [--apply]
 *
 * Le fichier de spécification, volontairement explicite :
 *   {
 *     "batchId": "…", "reviewedBy": "…", "reviewedAt": "…ISO…", "statement": "…",
 *     "aliases":  [{ "sourceKey": "mecca", "rawName": "MECCA Brands NZ Pty Ltd", "targetCompany": "MECCA" }],
 *     "merges":   [{ "fromCompany": "MECCA Brands NZ Pty Ltd", "toCompany": "MECCA" }],
 *     "evidence": [{ "url": "https://…", "artifactFile": "…html", "explanation": "…" }]
 *   }
 * Sans `--apply`, RIEN n'est écrit : le plan est calculé, affiché et son empreinte donnée.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildEmployerRepair, applyEmployerRepair } from '../../src/identity/repair.js';
import { digest } from '../../src/remediation/plan.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const specFile = arg('spec');
const phase = arg('phase');
const apply = process.argv.includes('--apply');
if (!specFile || !['clone', 'production'].includes(phase ?? '')) {
  console.error('usage: record-employer-alias.mts --spec=<fichier.json> --phase=clone|production [--apply]');
  process.exit(2);
}

/** La phase DOIT correspondre à la base réellement ouverte : une répétition ne doit pas toucher la production. */
const url = new URL(process.env.DATABASE_URL!);
const isLocal = ['127.0.0.1', 'localhost'].includes(url.hostname);
if ((phase === 'clone') !== isLocal) throw new Error(`phase ${phase} incompatible avec la base ouverte (${url.hostname})`);

/** L'octet nul, que Postgres refuse dans une chaîne, et les substituts UTF-16 orphelins. */
const sanitize = (t: string) =>
  t.replace(/\u0000/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1');

const spec = JSON.parse(readFileSync(specFile, 'utf8'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const p = new PrismaClient({ log: [] });

try {
  const companyByName = async (name: string) => {
    const row = await p.company.findFirst({ where: { name, mergedIntoId: null } });
    if (!row) throw new Error(`société introuvable (ou déjà fusionnée) : ${name}`);
    return row;
  };

  const aliases = [];
  for (const a of spec.aliases ?? []) {
    if (!a.sourceKey || a.sourceKey === '*') throw new Error('un alias doit être porté par une clé de SOURCE, jamais global');
    const source = await p.source.findUniqueOrThrow({ where: { key: a.sourceKey }, select: { status: true } });
    if (source.status !== 'ACTIVE') throw new Error(`source ${a.sourceKey} en statut ${source.status}`);
    const target = await companyByName(a.targetCompany);
    aliases.push({ sourceKey: a.sourceKey, rawName: a.rawName, companyId: target.id });
  }

  const merges = [];
  const alreadyMerged: string[] = [];
  for (const m of spec.merges ?? []) {
    /**
     * Une origine DÉJÀ fusionnée n'est pas une erreur : c'est le résultat attendu d'une application
     * antérieure. `applyEmployerRepair` est idempotent par `batchId`, mais il ne peut l'être que si la
     * construction du plan survit au second passage — sinon le programme échoue AVANT d'atteindre cette garde,
     * et une reprise après interruption paraît cassée alors que tout est en place.
     */
    const from = await p.company.findFirst({ where: { name: m.fromCompany, mergedIntoId: null } });
    const to = await companyByName(m.toCompany);
    if (!from) { alreadyMerged.push(m.fromCompany); continue; }
    if (from.id === to.id) continue; // déjà la même identité : rien à fusionner
    merges.push({ fromId: from.id, toId: to.id });
  }

  // La preuve est LUE depuis son artefact archivé, et son empreinte recalculée : la fonction maintenue refuse
  // le plan si le sha256 ne correspond pas au texte. On ne peut donc pas déclarer une preuve qu'on n'a pas.
  const evidence = (spec.evidence ?? []).map((e: any) => {
    const text = sanitize(readFileSync(e.artifactFile, 'utf8'));
    return { url: e.url, sha256: createHash('sha256').update(text).digest('hex'), artifactText: text, explanation: e.explanation };
  });

  const plan = await buildEmployerRepair(p, {
    batchId: spec.batchId, reviewedBy: spec.reviewedBy, reviewedAt: spec.reviewedAt, statement: spec.statement,
    evidence, aliases, merges, companies: spec.companies ?? [],
  });
  const planHash = digest(plan);

  const summary = {
    phase, commit, planHash, batchId: plan.batchId,
    aliases: aliases.map((a) => `${a.sourceKey}: "${a.rawName}"`),
    merges: merges.length, alreadyMerged, evidence: evidence.map((e: any) => ({ url: e.url, bytes: e.artifactText.length })),
    companiesTouched: plan.companyIds.length, jobs: plan.jobCount, activeJobs: plan.activeJobCount,
  };
  console.log(JSON.stringify(summary, null, 1));

  const out = arg('out');
  if (out) writeFileSync(out, JSON.stringify({ ...summary, plan }, null, 2));

  if (!apply) { console.log('\n--apply absent : RIEN n\'a été écrit.'); }
  else {
    const result = await applyEmployerRepair(p, plan, planHash, commit);
    console.log('\nAPPLIQUÉ :', JSON.stringify(result));
  }
} finally {
  await p.$disconnect();
}
