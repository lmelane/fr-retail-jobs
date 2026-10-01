/**
 * D-500 / D-501 — LE CLIENT DE MESURE, en LECTURE SEULE sur la production : il remplace le client Prisma du code mesuré
 * (`globalThis.prisma`, lu par `@catwalks/db`) AVANT tout import de ce code. Chaque `$queryRaw` devient un fichier SQL
 * exécuté par `apps/aggregator/scripts/ops/db.py readonly` (psql, transaction en lecture seule par défaut, délai de 25 s),
 * dont la durée est relevée (`\timing`). Toute écriture lève une erreur. Aucun Prisma ne parle à la production.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

const DB_PY = process.env.CATWALKS_DB_PY ?? 'apps/aggregator/scripts/ops/db.py';

// ── Le client de MESURE : lecture seule, chaque requête relevée ──────────────────────────────────────────────────────
export const litteral = (v: unknown): string => v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint' ? String(v)
  : v instanceof Date ? `'${v.toISOString()}'` : Array.isArray(v) ? `ARRAY[${v.map(litteral).join(',')}]::text[]`
  : `'${String(v).replace(/'/g, "''")}'`;
export const texte = (s: Prisma.Sql) => s.strings.reduce((acc, part, i) => acc + part + (i < s.values.length ? litteral(s.values[i]) : ''), '');
type Releve = { sql: string; ms: number; etiquette: string };
export const journal: Releve[] = [];
export const etat = { etiquette: '' };
/** Exécute en lecture seule ; rend les lignes JSON et la durée serveur relevée par psql. */
export function executer(sql: string): { lignes: unknown[]; ms: number } {
  const dossier = mkdtempSync(join(tmpdir(), 'd500-lot-'));
  const fichier = join(dossier, 'r.sql');
  writeFileSync(fichier, `SET default_transaction_read_only = on;\n\\timing on\nSELECT coalesce(json_agg(t), '[]') FROM (${sql}) t;\n`);
  const sortie = execFileSync('python3', [DB_PY, 'readonly', 'sh', '-c', `psql "$DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -f '${fichier}'`],
    { encoding: 'utf8', maxBuffer: 1 << 29 });
  const lignes = sortie.split('\n').filter((l) => l.trim() && l.trim() !== 'SET' && !l.startsWith('Timing is'));
  const temps = lignes.filter((l) => l.startsWith('Time: ')).map((l) => Number(l.slice(6).split(' ')[0]));
  const donnees = lignes.filter((l) => !l.startsWith('Time: ')).join('\n');
  return { lignes: JSON.parse(donnees), ms: temps.at(-1) ?? NaN };
}
/** La capture : une requête marquée n'est pas exécutée, son texte est gardé, une réponse factice la remplace. */
export const capteur: { capture: { marque: string; texte?: string; reponse: unknown[] } | null } = { capture: null };
const lecture = (a: unknown, ...valeurs: unknown[]) => {
  // Un \`Prisma.Sql\` (appel en fonction) ou un gabarit (appel étiqueté) : un tableau de chaînes porte \`raw\`.
  const sql = Array.isArray(a) ? Prisma.sql(a as unknown as TemplateStringsArray, ...valeurs) : (a as Prisma.Sql);
  const t = texte(sql);
  const capture = capteur.capture;
  if (capture && t.includes(capture.marque)) { capture.texte = t; return Promise.resolve(capture.reponse); }
  const r = executer(t);
  journal.push({ sql: t, ms: r.ms, etiquette: etat.etiquette });
  return Promise.resolve(r.lignes);
};
const interdit = () => { throw new Error('ÉCRITURE INTERDITE : mesure en lecture seule'); };
export const un = <T,>(sql: string) => (executer(sql).lignes as T[])[0];
const client = {
  $queryRaw: lecture, $queryRawUnsafe: interdit, $executeRaw: interdit, $executeRawUnsafe: interdit, $transaction: interdit,
  occupationState: { findUnique: async () => un<{ releaseId: string }>(`SELECT "releaseId" FROM "OccupationState" WHERE id = 'active'`) },
  occupationRelease: { findUniqueOrThrow: async ({ where }: { where: { id: string } }) =>
    un<{ id: string; manifest: unknown; contentHash: string }>(`SELECT id, manifest, "contentHash" FROM "OccupationRelease" WHERE id = ${litteral(where.id)}`) },
  company: { findMany: async () => executer(`SELECT id, name, "parentGroup", "parentGroupId", "mergedIntoId", "sectorCodes" FROM "Company"`).lignes },
  companyAlias: { findMany: async () => executer(`SELECT "companyId", "displayName", "reviewId" FROM "CompanyAlias" WHERE "reviewId" IS NOT NULL`).lignes },
  sectorConcept: { findMany: async () => executer(`SELECT code, labels FROM "SectorConcept"`).lignes },
};
(globalThis as unknown as { prisma: unknown }).prisma = client;
process.env.DATABASE_URL ||= 'postgresql://mesure-lecture-seule@invalid/none';

