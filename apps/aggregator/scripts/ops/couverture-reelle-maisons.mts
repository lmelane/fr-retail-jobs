/**
 * QUELLES MAISONS SONT VRAIMENT SANS PORTAIL — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/couverture-reelle-maisons.mts
 *
 * ── POURQUOI CE SCRIPT REMPLACE `maisons-sans-portail.mts` ─────────────────────────────────────
 *
 * Ce dernier rapprochait une Maison et un portail par leur LIBELLÉ (nom, clé, domaine). Il a donc
 * compté « sans portail » toute Maison servie par un portail de GROUPE, dont le libellé est celui
 * du groupe et pas le sien.
 *
 * Mesuré le 19/09/2026 sur Christian Dior Couture, que le CEO a relevé : classée « ni source ni
 * offre » par ce rapprochement, alors que le registre de découverte du 09/09 porte
 * `catalogueSources: [{key: "lvmh", …}]` et `existingJobs: {world: 493, france: 283}`. Dior
 * n'était pas sans portail : elle était servie par `lvmh`, sous le libellé « LVMH (toutes
 * Maisons) ». Le chiffre de 1 032 Maisons « sans portail » était donc faux, et il a servi de base
 * à une recommandation de chantier.
 *
 * ── CE QUE CELUI-CI FAIT ───────────────────────────────────────────────────────────────────────
 *
 * Il part des OFFRES, pas des libellés. Une Maison est couverte si :
 *
 *   A. une source ACTIVE porte son libellé (nom, clé ou domaine)   — rapprochement direct
 *   B. des offres lui sont attribuées aujourd'hui                  — quel que soit le portail
 *   C. le registre de découverte lui connaît une source catalogue  — preuve historique
 *
 * C est la voie que le rapprochement par libellé ne peut PAS voir : c'est là que vivent les
 * Maisons de groupe. Le fichier d'audit `audits/2026-09-09/fashionjobs-portals/ledger.json` est
 * lu en LECTURE SEULE comme une observation datée, jamais comme une vérité courante : ce qu'il
 * affirme est confronté à la base avant d'être compté.
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const LEDGER = 'audits/2026-09-09/fashionjobs-portals/ledger.json';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });
const q = <T>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

const racine = (s: string) =>
  s.replace(/\s*\([^)]*\)\s*$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
   .toLowerCase().replace(/[^a-z0-9]+/g, '');

const tete = (d: string | null) => {
  if (!d) return null;
  const [t] = d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('.');
  return t && t.length >= 3 ? racine(t) : null;
};

type Maison = { id: string; name: string; canonicalKey: string | null; domain: string | null };
const maisons = await q<Maison>(`SELECT id, name, "canonicalKey", domain FROM "Company" ORDER BY name`);
const sources = await q<{ key: string; maison: string; status: string; careersDomain: string | null }>(
  `SELECT key, maison, status, "careersDomain" FROM "Source"`);
const offres = await q<{ companyId: string; n: bigint }>(
  `SELECT "companyId", count(*) AS n FROM "Job" WHERE "isActive" GROUP BY "companyId"`);
const offresPar = new Map(offres.map((r) => [r.companyId, Number(r.n)]));

const relieActive = new Set<string>();
for (const s of sources.filter((s) => s.status === 'ACTIVE')) {
  relieActive.add(racine(s.maison));
  relieActive.add(racine(s.key));
  const t = tete(s.careersDomain);
  if (t) relieActive.add(t);
}

/*
 * LE REGISTRE DE DÉCOUVERTE — une observation du 09/09, pas un état courant. On en retient
 * uniquement le fait « cette Maison était servie par cette source de catalogue », et on ne le
 * compte que si la source existe TOUJOURS et est ACTIVE aujourd'hui.
 */
const servieParGroupe = new Map<string, { source: string; offres: number }>();
if (existsSync(LEDGER)) {
  const clesActives = new Set(sources.filter((s) => s.status === 'ACTIVE').map((s) => s.key));
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8')) as Array<{
    labels?: string[];
    candidateCompanies?: Array<{ name?: string; canonicalKey?: string }>;
    catalogueSources?: Array<{ key?: string; status?: string }>;
    existingJobs?: { world?: number };
  }>;
  for (const l of ledger) {
    const src = (l.catalogueSources ?? []).find((s) => s.key && clesActives.has(s.key));
    if (!src?.key) continue;
    const noms = [...(l.labels ?? []), ...(l.candidateCompanies ?? []).map((c) => c.name ?? '')];
    for (const n of noms.filter(Boolean))
      servieParGroupe.set(racine(n), { source: src.key, offres: l.existingJobs?.world ?? 0 });
    for (const c of l.candidateCompanies ?? [])
      if (c.canonicalKey) servieParGroupe.set(racine(c.canonicalKey), { source: src.key, offres: l.existingJobs?.world ?? 0 });
  }
}
console.log(`\n   registre de découverte : ${servieParGroupe.size} libellé(s) rattaché(s) à une source ACTIVE\n`);

const A: Maison[] = [], B: Maison[] = [], C: Array<Maison & { via: string }> = [], D: Maison[] = [];
for (const m of maisons) {
  const emp = [racine(m.name), racine(m.canonicalKey ?? ''), tete(m.domain) ?? ''].filter(Boolean);
  if (emp.some((e) => relieActive.has(e))) { A.push(m); continue; }
  if ((offresPar.get(m.id) ?? 0) > 0) { B.push(m); continue; }
  const groupe = emp.map((e) => servieParGroupe.get(e)).find(Boolean);
  if (groupe) { C.push({ ...m, via: groupe.source }); continue; }
  D.push(m);
}

/* TÉMOIN — Dior doit être couverte, par le groupe. S'il retombe en D, le correctif a régressé. */
const dior = maisons.find((m) => m.name === 'Christian Dior Couture');
if (dior) {
  if (D.some((m) => m.id === dior.id)) {
    console.error('\n⚠ TÉMOIN ROUGE : « Christian Dior Couture » est classée sans portail alors que');
    console.error('  le registre de découverte la rattache à `lvmh`. Le rapprochement a régressé.\n');
    process.exit(1);
  }
  const ou = A.includes(dior) ? 'A (libellé)' : B.includes(dior) ? 'B (offres)' : C.find((m) => m.id === dior.id) ? `C (groupe ${C.find((m) => m.id === dior.id)!.via})` : '?';
  console.log(`   témoin — Christian Dior Couture : couverte en ${ou} ✓\n`);
}

const pct = (n: number) => `${((n / maisons.length) * 100).toFixed(1).padStart(5)} %`;
console.log(`═══ ${maisons.length} MAISONS — COUVERTURE RÉELLE ═══\n`);
console.log(`   A. portail à son nom                  ${String(A.length).padStart(5)}  ${pct(A.length)}`);
console.log(`   B. des offres lui sont attribuées     ${String(B.length).padStart(5)}  ${pct(B.length)}`);
console.log(`   C. servie par un portail de GROUPE    ${String(C.length).padStart(5)}  ${pct(C.length)}  ← invisible au rapprochement par libellé`);
console.log(`   D. VRAIMENT sans portail              ${String(D.length).padStart(5)}  ${pct(D.length)}`);
console.log(`\n   couvertes : ${A.length + B.length + C.length} · à trouver : ${D.length}\n`);

if (C.length) {
  console.log('── C. quelques Maisons servies par un groupe ──\n');
  const parSource = new Map<string, number>();
  for (const m of C) parSource.set(m.via, (parSource.get(m.via) ?? 0) + 1);
  for (const [s, n] of [...parSource].sort((a, b) => b[1] - a[1]).slice(0, 10))
    console.log(`      ${s.padEnd(24)} ${String(n).padStart(4)} Maison(s)`);
}

console.log('\n── D. les 30 premières vraiment sans portail ──\n');
for (const m of D.slice(0, 30)) console.log(`      ${m.name.slice(0, 44).padEnd(46)} ${m.domain ?? '—'}`);

writeFileSync('backups/maisons-a-trouver.csv',
  `nom;domaine\n${D.map((m) => `${m.name.replace(/;/g, ',')};${m.domain ?? ''}`).join('\n')}\n`, 'utf8');
console.log(`\n   liste complète des ${D.length} : backups/maisons-a-trouver.csv\n`);

await prisma.$disconnect();
