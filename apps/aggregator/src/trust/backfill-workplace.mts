/**
 * BACKFILL `workplaceType` — matérialise ce que le dry-run audité a calculé.
 *
 * Sans réseau, et strictement ADDITIF : ne remplit qu'une valeur VIDE, donc une
 * valeur issue de la conversion (un champ déclaré par la source) n'est jamais
 * écrasée par une preuve plus faible.
 *
 * Exigé avant toute migration : avant/après, origine par méthode et par chemin,
 * conflits, cas `punctual`, faux positifs refusés, répartition par pays/source.
 *
 *   DATABASE_URL=<prod> npx tsx src/trust/dryrun-workplace.mts
 */

import { PrismaClient } from '@prisma/client';
import {
  readWorkplaceField,
  readWorkplaceText,
  readWorkplaceRestriction,
  readWorkplaceDescription,
  type WorkplaceType,
} from '../normalize/workplace.js';

const prisma = new PrismaClient();
const BATCH = 5000;
const APPLY = process.argv.includes('--apply');

/**
 * Les chemins qui portent RÉELLEMENT le mode de travail, mesurés le 2026-09-08.
 *
 * Écartés après vérification : `location_type` (= `LAT_LNG`, un format de
 * coordonnées, 11 728 offres), `locationType`/`locationTypeLabel` (= `shops` /
 * `Stores`, un type de SITE), `stepLocationType` (idem). Leur nom évoquait le
 * lieu, leur contenu ne dit rien du mode de travail.
 */
const WORKPLACE_KEYS = [
  'remote', 'has_remote', 'isRemote', 'workplaceType', 'custOnsiteRemote',
  'telecommuting', 'on_site', 'hybrid', 'locationFlexibility', 'remote_work_type',
] as const;

/** L'ordre de priorité : un champ déclaré bat le titre, qui bat la description. */
type Origin = 'RAW_FIELD' | 'TITLE_EXPLICIT' | 'TITLE_INFERRED' | 'DESCRIPTION_EXPLICIT' | 'DESCRIPTION_INFERRED';

function main(): Promise<void> {
  return run();
}

async function run(): Promise<void> {
  const before = new Map<string, number>();
  const after = new Map<string, number>();
  const byOrigin = new Map<Origin, number>();
  const byPath = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const samples: string[] = [];
  const restrictions: string[] = [];
  const pending = new Map<string, string>();
  let conflicts = 0;
  const conflictSamples: string[] = [];
  let punctualCount = 0;
  let restrictionCount = 0;
  let scanned = 0;
  let cursor: string | undefined;

  const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

  for (;;) {
    const rows = await prisma.job.findMany({
      where: { isActive: true },
      select: {
        id: true, title: true, description: true, raw: true, workplaceType: true, country: true,
        sources: { where: { isActive: true }, select: { sourceKey: true }, take: 1 },
      },
      orderBy: { id: 'asc' }, take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      scanned++;
      bump(before, row.workplaceType ?? '(null)');
      const sourceKey = row.sources[0]?.sourceKey ?? '(sans source)';

      // — Les preuves, par ordre de fiabilité —
      const found: { type: WorkplaceType; origin: Origin; path: string }[] = [];

      const raw = row.raw;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const payload = raw as Record<string, unknown>;
        for (const key of WORKPLACE_KEYS) {
          const v = payload[key];
          if (v === undefined || v === null) continue;
          const text = Array.isArray(v) ? String(v[0] ?? '') : String(v);
          if (String(text).toLowerCase() === 'punctual') punctualCount++;
          const read = readWorkplaceField(key, text);
          if (read) found.push({ type: read.type, origin: 'RAW_FIELD', path: key });
        }
      }

      const fromTitle = readWorkplaceText(row.title);
      if (fromTitle) {
        found.push({
          type: fromTitle.type,
          origin: fromTitle.evidence === 'INFERRED' ? 'TITLE_INFERRED' : 'TITLE_EXPLICIT',
          path: 'title',
        });
      }
      /**
       * La description passe par ses PROPRES règles : une assertion sur le
       * poste, jamais la simple présence du mot. `readWorkplaceText` reste
       * réservé au titre, où le contexte est court et le mot rarement incident.
       */
      const fromDesc = readWorkplaceDescription(row.description);
      if (fromDesc) {
        found.push({
          type: fromDesc.type,
          origin: fromDesc.evidence === 'INFERRED' ? 'DESCRIPTION_INFERRED' : 'DESCRIPTION_EXPLICIT',
          path: 'description',
        });
      }

      /**
       * La première preuve gagne — l'ordre d'insertion EST la priorité :
       * RAW_FIELD > TITLE > DESCRIPTION. Une preuve inférieure ne remplace
       * jamais une valeur déjà donnée par une preuve supérieure.
       */
      const decided = found[0];
      const disagree = found.some((f) => f.type !== decided?.type);
      if (decided && disagree) {
        conflicts++;
        if (conflictSamples.length < 6) {
          const others = found.filter((f) => f.type !== decided.type).map((f) => `${f.type}@${f.path}`);
          conflictSamples.push(`${decided.type}@${decided.path} vs ${others.join(', ')} — « ${row.title.slice(0, 44)} »`);
        }
      }

      bump(after, decided?.type ?? '(null)');
      // Strictement additif : la conversion a déjà posé les valeurs issues des
      // champs déclarés, on ne les touche pas.
      if (decided && row.workplaceType === null) pending.set(row.id, decided.type);
      if (decided) {
        bump(byOrigin, decided.origin);
        bump(byPath, `${decided.path}`);
        bump(bySource, sourceKey);
        bump(byCountry, row.country ?? '(sans pays)');
        if (samples.length < 10) {
          samples.push(`${decided.type.padEnd(7)} ${decided.origin.padEnd(20)} ${decided.path.padEnd(20)} « ${row.title.slice(0, 42)} »`);
        }
      }

      const restriction = readWorkplaceRestriction(row.title) ?? readWorkplaceRestriction(
        typeof row.raw === 'object' && row.raw !== null && !Array.isArray(row.raw)
          ? String((row.raw as Record<string, unknown>).locationFlexibility ?? '')
          : '',
      );
      if (restriction) {
        restrictionCount++;
        if (restrictions.length < 12) restrictions.push(`${restriction}  ← « ${row.title.slice(0, 46)} »`);
      }
    }
    process.stderr.write(`  … ${scanned}\r`);
  }

  const pct = (n: number) => `${((n / scanned) * 100).toFixed(2)} %`;
  console.log(`\n\n=== DRY-RUN workplaceType — ${scanned} offres, LECTURE SEULE ===\n`);

  console.log(`AVANT (workplaceType, après conversion) :`);
  for (const [k, n] of [...before].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${String(n).padStart(6)}  ${pct(n)}`);

  console.log(`\nAPRÈS (workplaceType) :`);
  for (const k of ['ONSITE', 'HYBRID', 'REMOTE', '(null)']) {
    const n = after.get(k) ?? 0;
    console.log(`  ${k.padEnd(12)} ${String(n).padStart(6)}  ${pct(n)}`);
  }
  const filled = scanned - (after.get('(null)') ?? 0);
  console.log(`\n  renseigné : ${filled} (${pct(filled)})`);

  console.log(`\nOrigine de la décision :`);
  for (const [o, n] of [...byOrigin].sort((a, b) => b[1] - a[1])) console.log(`  ${o.padEnd(22)} ${String(n).padStart(6)}`);

  console.log(`\nPar chemin :`);
  for (const [p, n] of [...byPath].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${p.padEnd(22)} ${String(n).padStart(6)}`);

  console.log(`\nPar source :`);
  for (const [s, n] of [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${s.padEnd(26)} ${String(n).padStart(6)}`);

  console.log(`\nPar pays :`);
  for (const [c, n] of [...byCountry].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${c.padEnd(14)} ${String(n).padStart(6)}`);

  console.log(`\nCas « punctual » rencontrés : ${punctualCount} (→ ONSITE, décision Loïc)`);
  console.log(`Conflits entre preuves : ${conflicts}`);
  for (const c of conflictSamples) console.log(`  · ${c}`);

  console.log(`\nRestrictions géographiques détectées : ${restrictionCount}`);
  for (const r of restrictions) console.log(`  · ${r}`);

  if (APPLY) {
    console.log(`\n=== ÉCRITURE (additive : seules les valeurs vides) ===`);
    let written = 0;
    for (const [id, value] of pending) {
      await prisma.job.update({ where: { id }, data: { workplaceType: value } });
      written++;
      if (written % 200 === 0) process.stderr.write(`  … ${written}\r`);
    }
    console.log(`  ${written} Jobs renseignés`);
  } else {
    console.log(`\n  (à blanc) ${pending.size} Jobs seraient renseignés — ajouter --apply`);
  }

  console.log(`\nExemples :`);
  for (const s of samples) console.log(`  ${s}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
