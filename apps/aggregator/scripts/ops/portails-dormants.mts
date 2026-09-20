/**
 * LES PORTAILS DORMANTS — POURQUOI SONT-ILS EN PAUSE ? — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/portails-dormants.mts
 *
 * ── LA QUESTION ────────────────────────────────────────────────────────────────────────────────
 *
 * 145 Maisons ont un portail en base sous un statut autre qu'ACTIVE — Hermès (wttj, PAUSED),
 * AMI Paris (recruitee, PAUSED)… Le portail est identifié, l'ATS renseigné, le domaine connu.
 *
 * On NE les réactive PAS en masse. Une pause a une raison, et la perdre reviendrait à rouvrir le
 * défaut qu'elle protégeait. Ce script cherche donc cette raison, dans l'ordre où elle peut
 * survivre :
 *
 *   1. la NOTE de la source — quand un humain l'a écrite, elle prime sur toute déduction ;
 *   2. la dernière EXÉCUTION (`SourceRun`) — un échec répété explique souvent la mise en pause ;
 *   3. la dernière DÉCISION D'ACCÈS — un `NOT_AUTHORIZED` est un refus légitime, on n'y touche pas ;
 *   4. l'ancienneté — une source jamais exécutée n'a pas été « mise » en pause, elle n'a jamais démarré.
 *
 * Une source dont aucune de ces quatre voies ne donne de raison est une CANDIDATE à la
 * réactivation — pas une réactivation décidée. La décision appartient au propriétaire.
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T,>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);

type Dormante = {
  key: string; maison: string; kind: string; status: string; careersDomain: string | null;
  note: string | null; lastRunJobs: number | null; lastRunStatus: string | null;
  runs: bigint; dernierStatut: string | null; dernierNote: string | null; dernierRun: Date | null;
  verdictAcces: string | null;
};

const dormantes = await q<Dormante>(`
  WITH dernier_run AS (
    SELECT DISTINCT ON ("sourceKey") "sourceKey", status AS "dernierStatut", note AS "dernierNote", "ranAt" AS "dernierRun"
      FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC
  ), nb_runs AS (
    SELECT "sourceKey", count(*) AS runs FROM "SourceRun" GROUP BY "sourceKey"
  ), acces AS (
    SELECT DISTINCT ON ("sourceKey") "sourceKey", verdict AS "verdictAcces"
      FROM "SourceAccessDecision" ORDER BY "sourceKey", sequence DESC
  )
  SELECT s.key, s.maison, s.kind, s.status, s."careersDomain", s.note,
         s."lastRunJobs", s."lastRunStatus",
         coalesce(r.runs, 0) AS runs, d."dernierStatut", d."dernierNote", d."dernierRun",
         a."verdictAcces"
    FROM "Source" s
    LEFT JOIN dernier_run d ON d."sourceKey" = s.key
    LEFT JOIN nb_runs r ON r."sourceKey" = s.key
    LEFT JOIN acces a ON a."sourceKey" = s.key
   WHERE s.status <> 'ACTIVE'
   ORDER BY s.status, s.key`);

/* Le classement suit l'ordre de priorité du commentaire d'en-tête : la première raison trouvée gagne. */
type Classe = 'REFUS_ACCES' | 'NOTE_HUMAINE' | 'ECHEC_COLLECTE' | 'JAMAIS_DEMARREE' | 'SANS_RAISON';
const raisonDe = (d: Dormante): { classe: Classe; detail: string } => {
  if (d.verdictAcces && d.verdictAcces !== 'ALLOWED')
    return { classe: 'REFUS_ACCES', detail: `décision ${d.verdictAcces}` };
  if (d.note && d.note.trim())
    return { classe: 'NOTE_HUMAINE', detail: d.note.trim().slice(0, 90) };
  if (d.dernierStatut && d.dernierStatut !== 'OK')
    return { classe: 'ECHEC_COLLECTE', detail: `${d.dernierStatut}${d.dernierNote ? ` — ${d.dernierNote.slice(0, 60)}` : ''}` };
  if (Number(d.runs) === 0)
    return { classe: 'JAMAIS_DEMARREE', detail: 'aucune exécution tracée' };
  return { classe: 'SANS_RAISON', detail: `${d.runs} exécution(s), dernière ${d.dernierStatut ?? '—'}` };
};

const parClasse = new Map<Classe, Array<Dormante & { detail: string }>>();
for (const d of dormantes) {
  const { classe, detail } = raisonDe(d);
  parClasse.set(classe, [...(parClasse.get(classe) ?? []), { ...d, detail }]);
}

console.log(`\n═══ ${dormantes.length} PORTAILS DORMANTS (statut ≠ ACTIVE) ═══\n`);
const parStatut = new Map<string, number>();
for (const d of dormantes) parStatut.set(d.status, (parStatut.get(d.status) ?? 0) + 1);
for (const [s, n] of parStatut) console.log(`   ${s.padEnd(14)} ${String(n).padStart(4)}`);

console.log(`\n── Pourquoi ──\n`);
const ordre: Classe[] = ['REFUS_ACCES', 'NOTE_HUMAINE', 'ECHEC_COLLECTE', 'JAMAIS_DEMARREE', 'SANS_RAISON'];
const legende: Record<Classe, string> = {
  REFUS_ACCES: 'refus d\'accès — ne jamais forcer',
  NOTE_HUMAINE: 'une note explique la pause',
  ECHEC_COLLECTE: 'la dernière collecte a échoué',
  JAMAIS_DEMARREE: 'jamais exécutée — pas « mise » en pause',
  SANS_RAISON: 'aucune raison trouvée ← candidates',
};
for (const c of ordre)
  console.log(`   ${c.padEnd(18)} ${String((parClasse.get(c) ?? []).length).padStart(4)}   ${legende[c]}`);

for (const c of ordre) {
  const xs = parClasse.get(c) ?? [];
  if (!xs.length) continue;
  console.log(`\n── ${c} (${xs.length}) ──\n`);
  for (const d of xs.slice(0, 30))
    console.log(`   ${d.key.padEnd(26)} ${d.status.padEnd(9)} ${d.kind.padEnd(18)} ${d.detail}`);
  if (xs.length > 30) console.log(`   … et ${xs.length - 30} autre(s)`);
}

const chemin = 'backups/portails-dormants.csv';
writeFileSync(chemin,
  `cle;maison;famille;statut;classe;detail\n${dormantes.map((d) => {
    const { classe, detail } = raisonDe(d);
    return [d.key, d.maison, d.kind, d.status, classe, detail]
      .map((c) => String(c ?? '').replace(/[;\n\r]/g, ' ')).join(';');
  }).join('\n')}\n`, 'utf8');
console.log(`\n   Liste complète : ${chemin}\n`);

await prisma.$disconnect();
