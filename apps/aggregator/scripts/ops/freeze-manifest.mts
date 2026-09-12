/**
 * FIGER LE MANIFESTE à partir d'une prévisualisation — lecture seule.
 *
 * La prévisualisation décrit ce qui SERAIT fait ; le manifeste est ce qui SERA fait. Le figer et le hacher est
 * ce qui permet, juste avant la mutation, de vérifier que l'état n'a pas bougé depuis la revue.
 *
 * Le programme REFUSE de figer un manifeste incohérent — c'est sa raison d'être :
 *  · une entrée dont la source n'est pas recevable ;
 *  · une entrée dont l'état n'est pas `ABSENT_FROM_PROVEN_ENUMERATION` ;
 *  · une ligne déjà inactive en base.
 *
 * usage: freeze-manifest.mts --preview=<f.json> --out=<f.json>
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { freezeManifest, verifyManifest, type ManifestEntry } from '../../src/pipeline/refreshManifest.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const previewFile = arg('preview');
const out = arg('out');
if (!previewFile || !out) { console.error('usage: freeze-manifest.mts --preview=<f.json> --out=<f.json>'); process.exit(2); }

const preview = JSON.parse(readFileSync(previewFile, 'utf8'));
const p = new PrismaClient({ log: [] });
try {
  const eligible: string[] = preview.eligible ?? [];
  const planned: any[] = preview.plannedDeactivations ?? [];

  const problems: string[] = [];
  const entries: ManifestEntry[] = [];
  for (const d of planned) {
    if (!eligible.includes(d.sourceKey)) {
      problems.push(`entrée d'une source NON recevable : ${d.sourceKey} / ${d.externalId}`);
      continue;
    }
    /** Seul cet état autorise une fermeture par absence : tout autre serait un plan mal formé. */
    if (d.state !== 'ABSENT_FROM_PROVEN_ENUMERATION') {
      problems.push(`entrée dont l'état n'autorise pas la désactivation : ${d.externalId} (${d.state})`);
      continue;
    }
    entries.push({
      jobSourceId: d.jobSourceId, sourceKey: d.sourceKey, externalId: d.externalId, jobId: d.jobId,
      state: d.state, consequence: d.consequence,
    });
  }

  const manifest = freezeManifest(eligible, entries);

  /** L'état de la base au moment du gel : une ligne déjà inactive rendrait le plan périmé dès sa naissance. */
  const active: any[] = entries.length ? await p.$queryRaw(Prisma.sql`
    SELECT id FROM "JobSource" WHERE "isActive" AND id = ANY(${entries.map((e) => e.jobSourceId)})`) : [];
  const check = verifyManifest(manifest, new Set(active.map((a) => a.id)));
  problems.push(...check.problems);

  writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({
    planHash: manifest.planHash, entries: manifest.entries.length,
    allowedSourceKeys: manifest.allowedSourceKeys,
    closures: manifest.entries.filter((e) => e.consequence === 'JOB_CANDIDATE_FOR_CLOSURE').length,
    kept: manifest.entries.filter((e) => e.consequence === 'JOB_KEPT_BY_ANOTHER_SOURCE').length,
    problems,
  }, null, 1));
  if (problems.length) process.exitCode = 1;
} finally {
  await p.$disconnect();
}
