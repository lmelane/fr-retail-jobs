/**
 * DRY-RUN de la priorité de preuve — combien de Jobs changeraient de valeur si
 * l'on écartait les champs démontrés faux ? LECTURE SEULE, sans réseau.
 *
 * Exigé avant toute modification (Loïc, 2026-09-08) : nombre de Jobs impactés,
 * ventilation par source, et exemples réels avant/après.
 *
 *   DATABASE_URL=<prod> npx tsx src/trust/dryrun-precedence.mts
 */

import { PrismaClient } from '@prisma/client';
import { createObserver, EVALUATOR_VERSION, OBSERVED_DIMENSIONS, type ObservedDimension } from './contradictions.js';
import { evaluate, precedenceFor, type TrustLevel } from './verdict.js';
import { readEmployment, decomposeCompositeCode, extractEmployment, type Employment } from '../normalize/employment.js';

const prisma = new PrismaClient();
const BATCH = 5000;

const RAW_KEYS = [
  'employment_type_code', 'fullTimePartTimeFilter', 'employmentType', 'employment_type',
  'contractType', 'contract_type', 'timeType', 'jobType', 'job_type',
  'bulletFields', 'category', 'categories', 'tags1', 'tags2', 'tags3', 'tags4', 'tags5', 'tags6',
] as const;

function pathsAt(payload: Record<string, unknown>, key: string): { path: string; value: string }[] {
  const v = payload[key];
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) {
    return v.map((e, i) => ({ path: `${key}[${i}]`, value: String(e ?? '').trim() })).filter((c) => c.value !== '');
  }
  const t = String(v).trim();
  return t ? [{ path: key, value: t }] : [];
}

const readValue = (value: string): Employment => ({ ...decomposeCompositeCode(value), ...readEmployment(value) });

type Row = {
  id: string; title: string; description: string | null; raw: unknown; lastSeenAt: Date | null;
  employmentTerm: string | null; workTime: string | null; programType: string | null; engagementType: string | null;
  sources: { sourceKey: string }[];
};

/**
 * La valeur qu'une dimension prendrait, et LE VERDICT QUI L'A DÉCIDÉE.
 *
 * Renvoyer le verdict avec la valeur est indispensable pour auditer : sans lui,
 * on ne peut pas prouver qu'aucun changement n'est imputable à un chemin
 * INSUFFICIENT_EVIDENCE. C'est exactement le contrôle demandé.
 */
function resolve(
  row: Row,
  sourceKey: string,
  dim: ObservedDimension,
  trust: Map<string, TrustLevel>,
): { value: string | undefined; decidedBy: TrustLevel | 'NO_STRUCTURED_EVIDENCE' | 'AMBIGUOUS_STRUCTURED'; titleQuality: 'TITLE_EXPLICIT' | 'TITLE_INFERRED' } {
  const raw = row.raw;
  const payload = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const titleRead = extractEmployment(row.title, row.description);
  const fromTitle = titleRead[dim];
  /**
   * La NATURE de la preuve du titre. Seul `workTime` porte aujourd'hui la
   * distinction (« Part-Time » déclaré vs « 21h » déduit) ; pour les autres
   * dimensions, un mot de contrat dans un titre est toujours explicite.
   */
  const titleQuality: 'TITLE_EXPLICIT' | 'TITLE_INFERRED' =
    dim === 'workTime' && titleRead.workTimeEvidence === 'INFERRED' ? 'TITLE_INFERRED' : 'TITLE_EXPLICIT';

  // Les preuves structurées disponibles, chacune avec le verdict de SON chemin.
  const structured: { value: string; level: TrustLevel | undefined }[] = [];
  for (const key of RAW_KEYS) {
    for (const { path, value } of pathsAt(payload, key)) {
      const v = readValue(value)[dim];
      if (v) structured.push({ value: v, level: trust.get(`${sourceKey} ${path} ${dim}`) });
    }
  }

  // Aucune preuve structurée : la priorité de confiance n'a rien à arbitrer.
  if (structured.length === 0) {
    return { value: fromTitle, decidedBy: 'NO_STRUCTURED_EVIDENCE', titleQuality };
  }

  /**
   * LE VERDICT QUI DÉCIDE est celui du chemin le PLUS DÉFAVORABLE parmi ceux
   * qui se prononcent sur cette dimension.
   *
   * Le premier jet lisait `usable[0].level` APRÈS avoir filtré les chemins
   * UNTRUSTED : la priorité était donc calculée sur le verdict du chemin
   * SUIVANT — souvent INSUFFICIENT_EVIDENCE — alors qu'un chemin démontré faux
   * venait d'être écarté. Un triplet sous le seuil pouvait ainsi influencer la
   * décision, ce que la règle interdit absolument.
   */
  const RANK: Record<string, number> = { UNTRUSTED: 0, DEGRADED: 1, TRUSTED: 2, INSUFFICIENT_EVIDENCE: 2 };
  const worst = structured.reduce((acc, s) => {
    const lvl = s.level ?? 'INSUFFICIENT_EVIDENCE';
    return RANK[lvl] < RANK[acc] ? lvl : acc;
  }, 'TRUSTED' as TrustLevel);

  /**
   * INSUFFICIENT_EVIDENCE et TRUSTED partagent le comportement par DÉFAUT
   * (`structured > title > description`) : un champ qu'on n'a pas prouvé faux
   * n'est jamais déclassé. `precedenceFor` le garantit déjà ; on le rend
   * explicite ici pour que l'audit puisse l'attribuer.
   */
  /**
   * UN CHAMP QUI SE CONTREDIT LUI-MÊME NE TRANCHE RIEN.
   *
   * Cas réel (element-6 / Groupe Beaumanoir) : `contract_type: ["CDD", "CDI"]`
   * — deux durées incompatibles dans le même champ. Prendre « la première »
   * était arbitraire, et produisait 31 changements sur des champs pourtant
   * TRUSTED, alors que le titre disait « CDI ». Ce n'est pas au trust
   * d'arbitrer une ambiguïté interne : on s'abstient, et la valeur existante
   * reste. Mieux vaut null qu'un tirage au sort.
   */
  const usableValues = new Set(structured.filter((s) => s.level !== 'UNTRUSTED').map((s) => s.value));
  const structuredValue = usableValues.size === 1 ? [...usableValues][0] : undefined;
  const ambiguous = usableValues.size > 1;

  const order = precedenceFor(worst);
  for (const kind of order) {
    if (kind === 'STRUCTURED') {
      if (ambiguous) return { value: undefined, decidedBy: 'AMBIGUOUS_STRUCTURED', titleQuality };
      if (structuredValue) return { value: structuredValue, decidedBy: worst, titleQuality };
    }
    /**
     * L'étape ne consomme la preuve du titre QUE si sa nature correspond
     * exactement. Une preuve inférée ne peut donc jamais être servie à l'étape
     * `TITLE_EXPLICIT` — et c'est ce qui fait qu'elle passe après un champ
     * seulement DEGRADED.
     */
    if ((kind === 'TITLE_EXPLICIT' || kind === 'TITLE_INFERRED') && kind === titleQuality && fromTitle) {
      return { value: fromTitle, decidedBy: worst, titleQuality };
    }
  }
  return { value: undefined, decidedBy: worst, titleQuality };
}

async function main(): Promise<void> {
  // — Passe 1 : mesurer —
  const observer = createObserver();
  let cursor: string | undefined;
  const all: Row[] = [];
  for (;;) {
    const rows = (await prisma.job.findMany({
      where: { isActive: true },
      select: {
        id: true, title: true, description: true, raw: true, lastSeenAt: true,
        employmentTerm: true, workTime: true, programType: true, engagementType: true,
        sources: { where: { isActive: true }, select: { sourceKey: true }, take: 1 },
      },
      orderBy: { id: 'asc' }, take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })) as Row[];
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const r of rows) {
      all.push(r);
      observer.observe({
        sourceKey: r.sources[0]?.sourceKey ?? '(sans source)',
        title: r.title, description: r.description, raw: r.raw, lastSeenAt: r.lastSeenAt,
      });
    }
    process.stderr.write(`  … mesure ${all.length}\r`);
  }

  const trust = new Map<string, TrustLevel>();
  for (const o of observer.result()) {
    const v = evaluate(o, EVALUATOR_VERSION);
    trust.set(`${o.source} ${o.path} ${o.dimension}`, v.level);
  }

  // — Passe 2 : simuler —
  const changes = new Map<string, number>();
  const byDim = new Map<ObservedDimension, number>();
  const byVerdict = new Map<string, number>();
  const byTitleQuality = new Map<string, number>();
  const samplesByVerdict = new Map<string, string[]>();
  const samples: string[] = [];
  let jobsChanged = 0;

  for (const row of all) {
    const sourceKey = row.sources[0]?.sourceKey ?? '(sans source)';
    let touched = false;
    for (const dim of OBSERVED_DIMENSIONS) {
      const { value: next, decidedBy, titleQuality } = resolve(row, sourceKey, dim, trust);
      const current = row[dim];
      if (next && current && next !== current) {
        touched = true;
        byDim.set(dim, (byDim.get(dim) ?? 0) + 1);
        byVerdict.set(decidedBy, (byVerdict.get(decidedBy) ?? 0) + 1);
        // La nature de la preuve n'est comptée que quand le TITRE a décidé.
        if (next === extractEmployment(row.title, row.description)[dim]) {
          byTitleQuality.set(titleQuality, (byTitleQuality.get(titleQuality) ?? 0) + 1);
        }
        const bucket = samplesByVerdict.get(decidedBy) ?? [];
        if (bucket.length < 4) {
          bucket.push(`[${sourceKey}] ${dim} : ${current} → ${next}  « ${row.title.slice(0, 46)} »`);
          samplesByVerdict.set(decidedBy, bucket);
        }
        if (samples.length < 12) {
          samples.push(`[${sourceKey}] ${dim} : ${current} → ${next}  « ${row.title.slice(0, 52)} »`);
        }
      }
    }
    if (touched) {
      jobsChanged++;
      changes.set(sourceKey, (changes.get(sourceKey) ?? 0) + 1);
    }
  }

  console.log(`\n\n=== DRY-RUN PRIORITÉ DE PREUVE — ${all.length} offres, ${EVALUATOR_VERSION} ===\n`);
  console.log(`Jobs dont une valeur canonique CHANGERAIT : ${jobsChanged}`);
  console.log(`\nPar dimension :`);
  for (const [d, n] of [...byDim].sort((a, b) => b[1] - a[1])) console.log(`  ${d.padEnd(18)} ${n}`);
  console.log(`\n=== CONTRÔLE : à quel VERDICT chaque changement est-il imputable ? ===`);
  for (const level of ['UNTRUSTED', 'DEGRADED', 'TRUSTED', 'INSUFFICIENT_EVIDENCE', 'NO_STRUCTURED_EVIDENCE', 'AMBIGUOUS_STRUCTURED']) {
    const n = byVerdict.get(level) ?? 0;
    const verdict = level === 'INSUFFICIENT_EVIDENCE' && n > 0 ? '  ← ANOMALIE : doit être 0' : '';
    console.log(`  ${level.padEnd(26)} ${String(n).padStart(6)}${verdict}`);
    for (const s of samplesByVerdict.get(level) ?? []) console.log(`      ${s}`);
  }

  console.log(`\n--- Quand le TITRE décide, quelle est la qualité de la preuve ? ---`);
  for (const q of ['TITLE_EXPLICIT', 'TITLE_INFERRED']) {
    console.log(`  ${q.padEnd(26)} ${String(byTitleQuality.get(q) ?? 0).padStart(6)}`);
  }

  /**
   * LES INVARIANTS, vérifiés automatiquement. Si l'un tombe, l'écriture ne doit
   * pas avoir lieu — c'est le contrat passé avant d'autoriser l'application.
   */
  const insufficient = byVerdict.get('INSUFFICIENT_EVIDENCE') ?? 0;
  const ambiguous = byVerdict.get('AMBIGUOUS_STRUCTURED') ?? 0;
  const invariants: [string, boolean][] = [
    ['INSUFFICIENT_EVIDENCE ne change rien', insufficient === 0],
    ['AMBIGUOUS_STRUCTURED ne tranche jamais', ambiguous === 0],
    ['TRUSTED garde la priorité au champ structuré', precedenceFor('TRUSTED')[0] === 'STRUCTURED'],
    ['DEGRADED : une INFÉRENCE ne bat pas le champ',
      precedenceFor('DEGRADED').indexOf('TITLE_INFERRED') > precedenceFor('DEGRADED').indexOf('STRUCTURED')],
    ['UNTRUSTED : le champ n’est jamais consulté', !precedenceFor('UNTRUSTED').includes('STRUCTURED')],
  ];
  console.log(`\n=== INVARIANTS ===`);
  let allGreen = true;
  for (const [label, ok] of invariants) {
    if (!ok) allGreen = false;
    console.log(`  ${ok ? 'OK  ' : 'ÉCHEC'} ${label}`);
  }
  console.log(allGreen ? '\n  → tous verts : application autorisée' : '\n  → UN INVARIANT EST TOMBÉ : ne pas appliquer');

  console.log(`\nPar source :`);
  for (const [s, n] of [...changes].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${s.padEnd(28)} ${n}`);
  console.log(`\nExemples réels (avant → après) :`);
  for (const s of samples) console.log(`  ${s}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
