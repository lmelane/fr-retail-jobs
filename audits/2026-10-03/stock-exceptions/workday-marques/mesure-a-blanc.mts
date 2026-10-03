/**
 * MESURE À BLANC DE LA RÈGLE R-142 §3 (D-522 §6) SUR LES ANNONCES RETENUES — lecture seule, sans réseau.
 *
 *   CATWALKS_DB_ACCESS=… python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/2026-10-03/stock-exceptions/workday-marques/mesure-a-blanc.mts --in=<dossier des .jsonl> --out=<dossier>
 *
 * Entrées : les sorties scellées extraites par `extraire-retenues.mts` (retenues `WORKDAY_EMPLOYER_ABSENT_IN_DETAIL` du RUN
 * 9022fc4b…, offres VF nommées par une entité juridique, offres L'Oréal sans employeur du lot de qualification).
 * Pour chaque offre, le périmètre que le fichier relu propose (`registre-relu-portails.csv`) est appliqué par la fonction
 * de production (`employerFromCertifiedScope`), puis la Maison sous laquelle le résolveur publierait est lue en base :
 * propriétaire du portail (clé du registre), ou marque (clé `resolveCompany`), existante ou à créer. Une offre déjà
 * publiée sous une autre Maison que la cible (ni le groupe) est comptée à part : le résolveur la retiendrait.
 * Rien n'est écrit en base. Écrit `<out>/mesure-a-blanc.json` (synthèse) et `<out>/offres.jsonl` (une ligne par offre).
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { employerFromCertifiedScope, GROUP_BRAND_PATH } from '../../../../apps/aggregator/src/identity/portalEmployer.js';
import { groupPortalBrands } from '../../../../apps/aggregator/src/identity/groupBrands.js';
import { resolveCompany } from '../../../../apps/aggregator/src/normalize/company.js';
import type { NormalizedJob } from '../../../../apps/aggregator/src/types.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const dossier = arg('in'); const out = arg('out');
if (!dossier || !out) { console.error('usage: mesure-a-blanc.mts --in=<dossier> --out=<dossier>'); process.exit(2); }

// Le périmètre proposé, relu dans le fichier même que le CEO appliquera.
const csv = readFileSync(new URL('./registre-relu-portails.csv', import.meta.url), 'utf8').trim().split(/\r?\n/);
const entetes = csv[0].split(';');
const propose = new Map(csv.slice(1).map((l) => { const c = l.split(';'); return [c[entetes.indexOf('cle')], c[entetes.indexOf('portail_une_seule_marque')]] as const; }));

const prisma = new PrismaClient({ log: [] });
type Ligne = { source: string; externalId: string; titre: string; lieu: string | null; lot: 'RETENUE' | 'ENTITE_VF' | 'SANS_EMPLOYEUR';
  perimetre: string | null; verdict: 'RESTE_RETENUE' | 'INCHANGEE' | 'PROPRIETAIRE' | 'GROUPE' | 'MARQUE'; maison: string | null; maisonExiste: boolean | null;
  dejaPubliee: string | null; bloqueeParPrecedent: boolean };
try {
  const sources = new Map((await prisma.source.findMany({ select: { key: true, maison: true } })).map((s) => [s.key, s.maison]));
  const maisonDe = new Map<string, { name: string } | null>();
  const maisonParCle = async (key: string) => {
    if (!maisonDe.has(key)) maisonDe.set(key, await prisma.company.findUnique({ where: { fashionjobsUrl: `resolved:${key}` }, select: { name: true } }));
    return maisonDe.get(key)!;
  };
  const fichiers: Array<{ f: string; lot: Ligne['lot'] }> = [];
  for (const s of [...propose.keys(), 'jansport', 'tapestry']) {
    if (existsSync(join(dossier, `${s}.retenues.jsonl`))) fichiers.push({ f: `${s}.retenues.jsonl`, lot: 'RETENUE' });
  }
  if (existsSync(join(dossier, 'vf-corporation.nommees.jsonl'))) fichiers.push({ f: 'vf-corporation.nommees.jsonl', lot: 'ENTITE_VF' });
  if (existsSync(join(dossier, 'l-oreal-professionnel.sans-employeur.jsonl'))) fichiers.push({ f: 'l-oreal-professionnel.sans-employeur.jsonl', lot: 'SANS_EMPLOYEUR' });
  const lignes: Ligne[] = [];
  for (const { f, lot } of fichiers) {
    const source = f.split('.')[0];
    const maisonRegistre = sources.get(source) ?? '';
    const perimetre = (propose.get(source) || null) as 'SINGLE_BRAND' | 'MULTI_BRAND' | null;
    const jobs = readFileSync(join(dossier, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as NormalizedJob);
    const publiees = new Map((await prisma.jobSource.findMany({ where: { sourceKey: source, externalId: { in: jobs.map((j) => j.externalId) } },
      select: { externalId: true, job: { select: { company: { select: { name: true, fashionjobsUrl: true } } } } } }))
      .map((e) => [e.externalId, e.job?.company ?? null]));
    const ownerKey = resolveCompany(maisonRegistre.split('(')[0].trim()).companyId;
    const owner = await maisonParCle(ownerKey);
    for (const job of jobs) {
      const apres = employerFromCertifiedScope(job, maisonRegistre.split('(')[0].trim(), perimetre, perimetre === 'MULTI_BRAND' ? groupPortalBrands(source, maisonRegistre) : undefined);
      let verdict: Ligne['verdict']; let maison: string | null = null; let existe: boolean | null = null; let cle: string | null = null;
      if (apres.publicationHold) verdict = 'RESTE_RETENUE';
      else if (apres === job) { verdict = lot === 'SANS_EMPLOYEUR' && perimetre === 'MULTI_BRAND' ? 'GROUPE' : 'INCHANGEE';
        if (verdict === 'GROUPE') { cle = ownerKey; maison = owner?.name ?? maisonRegistre.split('(')[0].trim(); existe = !!owner; } }
      else if (apres.employerEvidence?.path === GROUP_BRAND_PATH) {
        verdict = 'MARQUE'; cle = resolveCompany(apres.employerEvidence.rawName).companyId; const m = await maisonParCle(cle);
        maison = m?.name ?? apres.employerEvidence.rawName; existe = !!m;
      } else { verdict = perimetre === 'SINGLE_BRAND' ? 'PROPRIETAIRE' : 'GROUPE'; cle = ownerKey; maison = owner?.name ?? maisonRegistre.split('(')[0].trim(); existe = !!owner; }
      const deja = publiees.get(job.externalId) ?? null;
      // Le résolveur garde l'employeur déjà attribué s'il n'est ni la cible, ni le groupe que la marque précise.
      const bloquee = !!deja && !!cle && deja.fashionjobsUrl !== `resolved:${cle}` && !(verdict === 'MARQUE' && deja.fashionjobsUrl === `resolved:${ownerKey}`);
      lignes.push({ source, externalId: job.externalId, titre: job.title, lieu: job.location ?? null, lot, perimetre, verdict, maison, maisonExiste: existe,
        dejaPubliee: deja?.name ?? null, bloqueeParPrecedent: bloquee });
    }
  }
  writeFileSync(join(out, 'offres.jsonl'), lignes.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const synthese: Record<string, Record<string, unknown>> = {};
  for (const l of lignes) {
    const k = `${l.source}${l.lot === 'RETENUE' ? '' : ` (${l.lot})`}`;
    const s = (synthese[k] ??= { perimetre: l.perimetre, offres: 0, liberees: 0, resteRetenues: 0, inchangees: 0, bloqueesParPrecedent: 0, parMaison: {} as Record<string, number>, maisonsACreer: [] as string[] });
    (s.offres as number)++;
    if (l.verdict === 'RESTE_RETENUE') (s.resteRetenues as number)++;
    else if (l.verdict === 'INCHANGEE') (s.inchangees as number)++;
    else {
      (s.liberees as number)++;
      if (l.bloqueeParPrecedent) (s.bloqueesParPrecedent as number)++;
      const pm = s.parMaison as Record<string, number>; const nom = `${l.maison} [${l.verdict}]`; pm[nom] = (pm[nom] ?? 0) + 1;
      if (l.maisonExiste === false && !(s.maisonsACreer as string[]).includes(l.maison!)) (s.maisonsACreer as string[]).push(l.maison!);
    }
  }
  const retenues = lignes.filter((l) => l.lot === 'RETENUE');
  const total = { retenues: retenues.length, liberees: retenues.filter((l) => !['RESTE_RETENUE', 'INCHANGEE'].includes(l.verdict)).length,
    resteRetenues: retenues.filter((l) => l.verdict === 'RESTE_RETENUE').length,
    bloqueesParPrecedent: retenues.filter((l) => l.bloqueeParPrecedent).length };
  writeFileSync(join(out, 'mesure-a-blanc.json'), JSON.stringify({ run: '9022fc4b-1b96-431d-bee9-86ed244ef4f1', total, sources: synthese }, null, 1) + '\n');
  console.log(JSON.stringify({ total }, null, 1));
} finally {
  await prisma.$disconnect();
}
