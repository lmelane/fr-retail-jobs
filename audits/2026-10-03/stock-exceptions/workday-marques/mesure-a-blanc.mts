/**
 * MESURE À BLANC DE LA RÈGLE R-142 §3 (D-522 §6) — lecture seule, sans réseau. Refaite le 03/10/2026 après l'audit :
 * la Maison cible est cherchée comme le résolveur la cherche (`identity/existingMaison.ts`), le groupe porte le nom de
 * la liste, les licences et la marque hors périmètre sont appliquées.
 *
 *   CATWALKS_DB_ACCESS=… python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/2026-10-03/stock-exceptions/workday-marques/mesure-a-blanc.mts --in=<dossier des .jsonl> --out=<dossier> [--prada=<prada-rows.json>]
 *
 * Entrées (extraites par `extraire-retenues.mts`, hors dépôt) :
 *   RETENUE         les retenues `WORKDAY_EMPLOYER_ABSENT_IN_DETAIL` du RUN 9022fc4b… (<source>.retenues.jsonl) ;
 *   ENTITE_VF       les offres VF nommées par une entité juridique (vf-corporation.nommees.jsonl) ;
 *   SANS_EMPLOYEUR  les offres L'Oréal sans employeur du lot de qualification (l-oreal-professionnel.sans-employeur.jsonl) ;
 *   NATIF_LOREAL    les offres L'Oréal actives en base, libellé natif `dataLayer.jobBrand` (lu ici, lecture seule) ;
 *   LISTE_PRADA     les lignes de la liste Prada de la cassette du 03/10 (`--prada`), lues comme le lecteur les rendrait
 *                   avec `brandProperty: facility`.
 * Le périmètre appliqué est celui du fichier relu (`registre-relu-portails.csv`), par la fonction de production
 * (`employerFromCertifiedScope`) ; puis la Maison sous laquelle le résolveur publierait est lue en base (`existingMaison`).
 * Une offre déjà publiée sous une autre Maison que la cible est comptée à part : le résolveur la retiendrait (sauf la
 * précision groupe → marque, et la licence corrigée). Rien n'est écrit en base. Sortie : `<out>/mesure-a-blanc.json`,
 * `<out>/offres.jsonl`.
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { employerFromCertifiedScope, GROUP_BRAND_PATH, GROUP_LICENCE_RULE, GROUP_OUT_OF_PERIMETER_HOLD, CERTIFIED_SCOPE_PATH } from '../../../../apps/aggregator/src/identity/portalEmployer.js';
import { groupPortalBrands, labelIsOneOf } from '../../../../apps/aggregator/src/identity/groupBrands.js';
import { existingMaison } from '../../../../apps/aggregator/src/identity/existingMaison.js';
import { resolveCompany } from '../../../../apps/aggregator/src/normalize/company.js';
import type { NormalizedJob } from '../../../../apps/aggregator/src/types.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const dossier = arg('in'); const out = arg('out'); const pradaRows = arg('prada');
if (!dossier || !out) { console.error('usage: mesure-a-blanc.mts --in=<dossier> --out=<dossier> [--prada=<lignes.json>]'); process.exit(2); }

const csv = readFileSync(new URL('./registre-relu-portails.csv', import.meta.url), 'utf8').trim().split(/\r?\n/);
const entetes = csv[0].split(';');
const propose = new Map(csv.slice(1).map((l) => { const c = l.split(';'); return [c[entetes.indexOf('cle')], c[entetes.indexOf('portail_une_seule_marque')]] as const; }));

type Lot = 'RETENUE' | 'ENTITE_VF' | 'SANS_EMPLOYEUR' | 'NATIF_LOREAL' | 'LISTE_PRADA';
type Verdict = 'RESTE_RETENUE' | 'HORS_PERIMETRE' | 'INCHANGEE' | 'PROPRIETAIRE' | 'GROUPE' | 'LICENCE_GROUPE' | 'MARQUE';
type Ligne = { source: string; externalId: string; titre: string; lieu: string | null; lot: Lot; perimetre: string | null; verdict: Verdict;
  maison: string | null; maisonExiste: boolean | null; via: string | null; dejaPubliee: string | null; bloqueeParPrecedent: boolean };

const prisma = new PrismaClient({ log: [] });
try {
  const sources = new Map((await prisma.source.findMany({ select: { key: true, maison: true } })).map((s) => [s.key, s.maison]));
  const lots: Array<{ source: string; lot: Lot; jobs: NormalizedJob[] }> = [];
  const lire = (f: string) => readFileSync(join(dossier, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as NormalizedJob);
  for (const s of [...propose.keys(), 'jansport', 'tapestry']) {
    if (existsSync(join(dossier, `${s}.retenues.jsonl`))) lots.push({ source: s, lot: 'RETENUE', jobs: lire(`${s}.retenues.jsonl`) });
  }
  if (existsSync(join(dossier, 'vf-corporation.nommees.jsonl'))) lots.push({ source: 'vf-corporation', lot: 'ENTITE_VF', jobs: lire('vf-corporation.nommees.jsonl') });
  if (existsSync(join(dossier, 'l-oreal-professionnel.sans-employeur.jsonl'))) lots.push({ source: 'l-oreal-professionnel', lot: 'SANS_EMPLOYEUR', jobs: lire('l-oreal-professionnel.sans-employeur.jsonl') });
  // Les offres L'Oréal actives, sous leur libellé natif : seules les licences changent (les marques nommées sont déjà natives).
  const natifs = await prisma.$queryRawUnsafe<Array<{ externalId: string; title: string; location: string | null; brand: string | null }>>(
    `SELECT s."externalId", s.title, j.location, substring(s.raw->>'avatureJobData' from 'jobBrand:\\s*"([^"]*)"') AS brand
       FROM "JobSource" s JOIN "Job" j ON j.id = s."jobId" WHERE s."sourceKey" = 'l-oreal-professionnel' AND s."isActive"`);
  lots.push({ source: 'l-oreal-professionnel', lot: 'NATIF_LOREAL', jobs: natifs.filter((n) => n.brand?.trim()).map((n) => ({ externalId: n.externalId, title: n.title,
    location: n.location ?? undefined, url: 'x', company: n.brand!, employerEvidence: { rawName: n.brand!, path: 'dataLayer.jobBrand', rule: 'EXPLICIT_JOB_BRAND' },
    raw: { title: n.title, location: n.location } })) });
  if (pradaRows && existsSync(pradaRows)) {
    const rows = JSON.parse(readFileSync(pradaRows, 'utf8')) as Array<{ id: string; t: string; b: string; loc: string }>;
    lots.push({ source: 'prada-group', lot: 'LISTE_PRADA', jobs: rows.map((r) => ({ externalId: r.id, title: r.t, location: r.loc, url: 'x',
      ...(r.b ? { company: r.b, employerEvidence: { rawName: r.b, path: 'listing.facility', rule: 'CONFIGURED_BRAND_PROPERTY' } } : {}),
      raw: { title: r.t, ...(r.b ? { listingBrand: { property: 'facility', value: r.b } } : {}) } })) });
  }

  const cache = new Map<string, Awaited<ReturnType<typeof existingMaison>>>();
  const maison = async (source: string, name: string) => {
    const k = `${source}\u0000${name}`;
    if (!cache.has(k)) cache.set(k, await existingMaison(prisma, source, name));
    return cache.get(k)!;
  };
  const lignes: Ligne[] = [];
  for (const { source, lot, jobs } of lots) {
    const registre = sources.get(source) ?? '';
    const owner = registre.split('(')[0].trim();
    const perimetre = (propose.get(source) || null) as 'SINGLE_BRAND' | 'MULTI_BRAND' | null;
    const list = perimetre === 'MULTI_BRAND' ? groupPortalBrands(source, registre) : undefined;
    const publiees = new Map((await prisma.jobSource.findMany({ where: { sourceKey: source, externalId: { in: jobs.map((j) => j.externalId) } },
      select: { externalId: true, job: { select: { company: { select: { id: true, name: true, mergedIntoId: true } } } } } }))
      .map((e) => [e.externalId, e.job?.company ?? null]));
    const ownerRow = await prisma.company.findUnique({ where: { fashionjobsUrl: `resolved:${resolveCompany(owner).companyId}` } });
    const groupe = list ? await maison(source, list.group) : (ownerRow ? { company: ownerRow, via: 'REGISTRY_KEY' as const } : { company: null, key: resolveCompany(owner).companyId, name: owner });
    for (const job of jobs) {
      const apres = employerFromCertifiedScope(job, owner, perimetre, list);
      let verdict: Verdict; let cible: Awaited<ReturnType<typeof existingMaison>> | null = null;
      if (apres.publicationHold === GROUP_OUT_OF_PERIMETER_HOLD) verdict = 'HORS_PERIMETRE';
      else if (apres.publicationHold) verdict = 'RESTE_RETENUE';
      else if (apres.employerEvidence?.path === GROUP_BRAND_PATH) {
        verdict = 'MARQUE';
        const brand = list!.brands.find((b) => b.name === apres.employerEvidence!.rawName)!;
        cible = await maison(source, brand.maison ?? brand.name);
      } else if (apres.employerEvidence?.path === CERTIFIED_SCOPE_PATH) {
        verdict = apres.employerEvidence.rule === GROUP_LICENCE_RULE ? 'LICENCE_GROUPE' : perimetre === 'SINGLE_BRAND' ? 'PROPRIETAIRE' : 'GROUPE';
        cible = perimetre === 'SINGLE_BRAND' ? (ownerRow ? { company: ownerRow, via: 'REGISTRY_KEY' } : { company: null, key: resolveCompany(owner).companyId, name: owner }) : groupe;
      } else if (apres === job && lot === 'SANS_EMPLOYEUR' && perimetre === 'MULTI_BRAND') { verdict = 'GROUPE'; cible = groupe; }
      else verdict = 'INCHANGEE';
      const deja = publiees.get(job.externalId) ?? null;
      // Libellé natif d'une marque de la liste sur une offre publiée sous le groupe : le résolveur la précise (`resolve.ts`).
      const label = job.employerEvidence?.rawName ?? job.company;
      const nativeBrand = verdict === 'INCHANGEE' && list && label ? list.brands.find((b) => labelIsOneOf(label, [...(b.match ?? [b.name]), b.maison ?? b.name])) : undefined;
      if (nativeBrand && deja && (deja.id === groupe.company?.id || deja.id === ownerRow?.id)) { verdict = 'MARQUE'; cible = await maison(source, nativeBrand.maison ?? nativeBrand.name); }
      const allowed = verdict === 'MARQUE' && !!deja && (deja.id === groupe.company?.id || deja.id === ownerRow?.id)
        || verdict === 'LICENCE_GROUPE' && !!deja && labelIsOneOf(deja.name, list?.licences);
      const bloquee = !!deja && !!cible && deja.id !== cible.company?.id && !allowed;
      lignes.push({ source, externalId: job.externalId, titre: job.title, lieu: job.location ?? null, lot, perimetre, verdict,
        maison: cible ? (cible.company?.name ?? cible.name) : null, maisonExiste: cible ? !!cible.company : null,
        via: cible ? (cible.company ? cible.via : 'A_CREER') : null, dejaPubliee: deja?.name ?? null, bloqueeParPrecedent: bloquee });
    }
  }
  writeFileSync(join(out, 'offres.jsonl'), lignes.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const synthese: Record<string, Record<string, unknown>> = {};
  for (const l of lignes) {
    const k = `${l.source}${l.lot === 'RETENUE' ? '' : ` (${l.lot})`}`;
    const s = (synthese[k] ??= { perimetre: l.perimetre, offres: 0, liberees: 0, resteRetenues: 0, horsPerimetre: 0, inchangees: 0,
      changentDeMaison: 0, bloqueesParPrecedent: 0, parMaison: {} as Record<string, number>, maisonsACreer: [] as string[] });
    (s.offres as number)++;
    if (l.verdict === 'RESTE_RETENUE') (s.resteRetenues as number)++;
    else if (l.verdict === 'HORS_PERIMETRE') (s.horsPerimetre as number)++;
    else if (l.verdict === 'INCHANGEE') (s.inchangees as number)++;
    else {
      (s.liberees as number)++;
      if (l.bloqueeParPrecedent) (s.bloqueesParPrecedent as number)++;
      if (l.dejaPubliee && l.dejaPubliee !== l.maison && !l.bloqueeParPrecedent) (s.changentDeMaison as number)++;
      const pm = s.parMaison as Record<string, number>; const nom = `${l.maison} [${l.verdict}${l.maisonExiste ? '' : ', à créer'}]`; pm[nom] = (pm[nom] ?? 0) + 1;
      if (l.maisonExiste === false && !(s.maisonsACreer as string[]).includes(l.maison!)) (s.maisonsACreer as string[]).push(l.maison!);
    }
  }
  const retenues = lignes.filter((l) => l.lot === 'RETENUE');
  const aCreer = [...new Set(lignes.filter((l) => l.maisonExiste === false && !['RESTE_RETENUE', 'HORS_PERIMETRE', 'INCHANGEE'].includes(l.verdict)).map((l) => `${l.maison}`))].sort();
  const total = {
    retenues: retenues.length, liberees: retenues.filter((l) => !['RESTE_RETENUE', 'HORS_PERIMETRE', 'INCHANGEE'].includes(l.verdict)).length,
    resteRetenues: retenues.filter((l) => l.verdict === 'RESTE_RETENUE').length, bloqueesParPrecedent: lignes.filter((l) => l.bloqueeParPrecedent).length,
    vfChangentDeMaison: lignes.filter((l) => l.lot === 'ENTITE_VF' && l.verdict === 'MARQUE' && l.dejaPubliee && l.dejaPubliee !== l.maison && !l.bloqueeParPrecedent).length,
    lorealSansEmployeurAuGroupe: lignes.filter((l) => l.lot === 'SANS_EMPLOYEUR' && l.verdict === 'GROUPE').length,
    lorealLicencesAuGroupe: lignes.filter((l) => l.lot === 'NATIF_LOREAL' && l.verdict === 'LICENCE_GROUPE').length,
    maisonsACreer: aCreer.length, listeMaisonsACreer: aCreer,
  };
  writeFileSync(join(out, 'mesure-a-blanc.json'), JSON.stringify({ run: '9022fc4b-1b96-431d-bee9-86ed244ef4f1', total, sources: synthese }, null, 1) + '\n');
  console.log(JSON.stringify({ total }, null, 1));
} finally {
  await prisma.$disconnect();
}
