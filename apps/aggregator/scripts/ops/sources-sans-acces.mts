/**
 * QUELLES SOURCES N'ONT AUCUNE DÉCISION D'ACCÈS VALIDE — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/sources-sans-acces.mts
 *
 * ── CE QU'ON CHERCHE ───────────────────────────────────────────────────────────────────────────
 *
 * `assertSourceAccess` (connectors/sourceAccess.ts) refuse la collecte dans trois cas, qu'il faut
 * distinguer parce qu'ils n'appellent PAS la même action :
 *
 *   ACCESS_MISSING  aucune décision n'existe   → la campagne de qualification n'a jamais tourné.
 *                                                Rien n'a été refusé : la source n'a pas été jugée.
 *   ACCESS_STALE    décision périmée           → elle existe mais ne vaut plus pour la révision
 *                                                courante, le lecteur courant, ou a expiré.
 *   ACCESS_DENIED   verdict NOT_AUTHORIZED     → REFUS LÉGITIME. On ne le contourne jamais.
 *
 * Mesuré le 19/09/2026 : LVMH, Kering et L'Oréal sont en ACCESS_MISSING — `SourceAccessDecision`
 * est vide pour elles, `SourceRun` aussi, `lastRunJobs` est NULL. Elles n'ont pas été refusées,
 * elles n'ont jamais été appelées, alors qu'un appel direct à leur adaptateur rend 8 929 offres.
 *
 * Ce script ne corrige rien : il classe et il chiffre, pour qu'on sache ce qu'on peut relancer
 * sans forcer aucun garde-fou.
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);

type Ligne = {
  key: string; maison: string; kind: string; currentRevisionId: string | null;
  lastRunJobs: number | null; lastRunStatus: string | null;
  verdict: string | null; decisionRevision: string | null; validUntil: Date | null;
  publiees: bigint;
};

/*
 * DISTINCT ON rend la décision la PLUS RÉCENTE par source — la seule qui compte : « the latest
 * decision wins, including a denial; never search for an older grant » (sourceAccess.ts).
 */
const lignes = await q<Ligne>(`
  WITH derniere AS (
    SELECT DISTINCT ON ("sourceKey") "sourceKey", verdict, "sourceRevisionId" AS "decisionRevision", "validUntil"
      FROM "SourceAccessDecision" ORDER BY "sourceKey", sequence DESC
  )
  SELECT s.key, s.maison, s.kind, s."currentRevisionId", s."lastRunJobs", s."lastRunStatus",
         d.verdict, d."decisionRevision", d."validUntil",
         (SELECT count(*) FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId"
           WHERE js."sourceKey"=s.key AND j."isActive") AS publiees
    FROM "Source" s LEFT JOIN derniere d ON d."sourceKey" = s.key
   WHERE s.status='ACTIVE'
   ORDER BY s.key`);

const maintenant = Date.now();
const manquante: Ligne[] = [], perimee: Ligne[] = [], refusee: Ligne[] = [], valide: Ligne[] = [];

for (const l of lignes) {
  if (!l.verdict) { manquante.push(l); continue; }
  if (l.verdict !== 'ALLOWED') { refusee.push(l); continue; }
  /*
   * On ne peut pas rejouer ici toute la validation de `assertSourceAccess` (elle vérifie aussi
   * le hachage du document et la révision du lecteur). On teste les deux conditions LISIBLES en
   * SQL — révision liée et date de validité — et on le dit : un « valide » ici peut encore être
   * refusé par le contrôle complet, jamais l'inverse.
   */
  const liee = l.decisionRevision === l.currentRevisionId;
  const encoreValide = l.validUntil ? l.validUntil.getTime() > maintenant : false;
  if (!liee || !encoreValide) perimee.push(l); else valide.push(l);
}

const total = lignes.length;
const pct = (n: number) => `${((n / total) * 100).toFixed(1).padStart(5)} %`;
console.log(`\n═══ ${total} SOURCES ACTIVE — ÉTAT DE LA DÉCISION D'ACCÈS ═══\n`);
console.log(`   valide (révision liée, non expirée)   ${String(valide.length).padStart(4)}  ${pct(valide.length)}`);
console.log(`   ACCESS_STALE  périmée ou délièe       ${String(perimee.length).padStart(4)}  ${pct(perimee.length)}`);
console.log(`   ACCESS_MISSING  jamais jugée          ${String(manquante.length).padStart(4)}  ${pct(manquante.length)}   ← jamais refusée`);
console.log(`   ACCESS_DENIED  refus légitime         ${String(refusee.length).padStart(4)}  ${pct(refusee.length)}   ← on ne force pas`);

const somme = (xs: Ligne[]) => xs.reduce((n, l) => n + Number(l.publiees), 0);
console.log(`\n   offres publiées par les valides : ${somme(valide)}`);
console.log(`   offres publiées par les manquantes : ${somme(manquante)}`);

if (refusee.length) {
  console.log(`\n── Refus légitimes (${refusee.length}) — à ne jamais contourner ──\n`);
  for (const l of refusee) console.log(`   ${l.key.padEnd(28)} ${l.verdict}`);
}

console.log(`\n── Jamais jugées, par famille ──\n`);
const parFamille = new Map<string, number>();
for (const l of manquante) parFamille.set(l.kind, (parFamille.get(l.kind) ?? 0) + 1);
for (const [k, n] of [...parFamille].sort((a, b) => b[1] - a[1]))
  console.log(`   ${k.padEnd(28)} ${String(n).padStart(4)}`);

console.log(`\n── Les 40 premières jamais jugées ──\n`);
for (const l of manquante.slice(0, 40))
  console.log(`   ${l.key.padEnd(28)} ${l.kind.padEnd(22)} ${l.maison.slice(0, 40)}`);

const chemin = 'backups/sources-sans-acces.csv';
writeFileSync(chemin,
  `cle;maison;famille;etat\n${[
    ...manquante.map((l) => [l.key, l.maison, l.kind, 'ACCESS_MISSING']),
    ...perimee.map((l) => [l.key, l.maison, l.kind, 'ACCESS_STALE']),
  ].map((r) => r.map((c) => String(c).replace(/;/g, ',')).join(';')).join('\n')}\n`, 'utf8');
console.log(`\n   Liste complète : ${chemin}\n`);

await prisma.$disconnect();
