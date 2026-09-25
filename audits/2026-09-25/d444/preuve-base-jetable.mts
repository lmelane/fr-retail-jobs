/**
 * D-444 — PREUVE SUR BASE JETABLE, CONTRE LA VRAIE LISTE PUBLIQUE DE PRODUCTION.
 *
 * Écrit UNIQUEMENT dans une base PostgreSQL locale et jetable ; la seule lecture externe est `GET
 * https://catwalks.api.catwalks.io/api/jobs`, la route publique que le site sert déjà à `/offres` (aucune clé, aucune
 * écriture). Aucune URL de production n'est passée à un outil.
 *
 * La base reçoit :
 *   1. la version de la taxonomie des métiers active en production (`catwalks-occupations-20260914-v2`, manifeste
 *      embarqué `packages/db/data/occupations-v1.json`), publiée comme `activateOccupationRelease` la stockerait ;
 *   2. le registre des sociétés tel qu'un instantané de production le décrit (`--registre=<json>` : nom, clé, groupe ;
 *      les sociétés fusionnées sont écartées, leur fusion exigeant une revue d'identité) ;
 *   3. des offres agrégées CONCURRENTES, synthétiques, marquées `preuve-agg-` : plus fraîches, plus pertinentes pour les
 *      mots cherchés, du même métier, du même groupe et des mêmes secteurs que les offres Catwalks — tout ce qui, sans
 *      R-126, les mettrait devant ;
 *   4. les offres Catwalks, par le lecteur de D-444 (`synchroniserListe`) sur la vraie liste, deux fois (la seconde
 *      passe ne doit rien écrire) ;
 *   5. l'index de recherche de la génération courante, reconstruit.
 *
 * Usage : DATABASE_URL=postgresql://…@127.0.0.1:<port>/<base dont le nom contient « preuve »> \
 *   npx tsx audits/2026-09-25/d444/preuve-base-jetable.mts --registre=<instantané JSON> --sortie=<fichier JSON>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Prisma, PrismaClient } from '@prisma/client';
import manifesteV2 from '../../../packages/db/data/occupations-v1.json' with { type: 'json' };
import { compileOccupationManifest, occupationManifestHash, persistedOccupationDecision } from '../../../packages/db/occupations.ts';
import { MARCHES } from '../../../packages/db/marches.ts';
import { chargerContexte } from '../../../apps/aggregator/src/direct/contexte.ts';
import { listeHttp } from '../../../apps/aggregator/src/direct/liste.ts';
import { synchroniserListe } from '../../../apps/aggregator/src/direct/photo.ts';
import { publicationFixture } from '../../../apps/aggregator/src/test/publication-fixture.ts';
import { drainSearchIndex, initializeSearchIndex, searchIndexStatus } from '../../../apps/api/lib/search-index.ts';

const { values } = parseArgs({ options: { registre: { type: 'string' }, sortie: { type: 'string' } } });
const brute = process.env.DATABASE_URL ?? '';
let cible: URL;
try { cible = new URL(brute); } catch { throw new Error('REFUS : DATABASE_URL absente ou invalide'); }
if (!['127.0.0.1', 'localhost'].includes(cible.hostname) || !/preuve/.test(cible.pathname) || (process.env.DIRECT_URL && process.env.DIRECT_URL !== brute))
  throw new Error('REFUS : seule une base locale dont le nom contient « preuve » est admise (DIRECT_URL identique ou absente)');
if (!values.registre || !values.sortie) throw new Error('--registre=<instantané JSON> et --sortie=<fichier JSON> requis');

const prisma = new PrismaClient({ datasources: { db: { url: brute } } });
const LISTE = 'https://catwalks.api.catwalks.io';

async function activerTaxonomieProduction() {
  const manifest = compileOccupationManifest(manifesteV2).manifest;
  if (!(await prisma.occupationRelease.findUnique({ where: { id: manifest.id } })))
    await prisma.occupationRelease.create({ data: { id: manifest.id, contentHash: occupationManifestHash(manifest), manifest: manifest as unknown as Prisma.InputJsonValue } });
  await prisma.occupationState.update({ where: { id: 'active' }, data: { releaseId: manifest.id } });
  return manifest.id;
}

type Societe = { id: string; nom: string; cle: string | null; groupe: string | null; fusionneeDans: string | null };
async function semerRegistre(chemin: string) {
  const instantane = JSON.parse(readFileSync(chemin, 'utf8')) as { mesureLe: string; societes: Societe[] };
  const canoniques = instantane.societes.filter((s) => !s.fusionneeDans);
  await prisma.company.createMany({ skipDuplicates: true, data: canoniques.map((s) => ({
    id: s.id, name: s.nom, canonicalKey: s.cle ?? s.id, fashionjobsUrl: `resolved:${s.id}`, parentGroup: s.groupe,
  })) });
  return { mesureLe: instantane.mesureLe, societes: instantane.societes.length, semees: canoniques.length, fusionneesEcartees: instantane.societes.length - canoniques.length };
}

/** Les concurrentes : deux sociétés synthétiques du groupe LVMH, secteurs revus (manifeste immuable), et 60 offres FR. */
async function semerConcurrentes(releaseId: string) {
  const preuve = (code: string) => ({ code, source: 'https://example.com/preuve-d444', statement: 'Concurrente synthétique D-444', confidence: 'HIGH', basis: 'OFFICIAL_SOURCE', checkedAt: '2026-09-25T00:00:00Z' });
  const societes = [
    { id: 'preuve-agg-mode', nom: 'Concurrente Mode Preuve', codes: ['FASHION'] },
    { id: 'preuve-agg-beaute', nom: 'Concurrente Beauté Preuve', codes: ['BEAUTY', 'FRAGRANCE'] },
  ];
  const manifeste = { reviewer: 'preuve-d444', companies: societes.map((s) => ({ id: s.id, canonicalKey: s.id, codes: s.codes, evidence: s.codes.map(preuve) })) };
  const revue = `preuve-d444-${createHash('sha256').update(JSON.stringify(manifeste)).digest('hex').slice(0, 16)}`;
  await prisma.sectorReview.createMany({ skipDuplicates: true, data: [{ id: revue, reviewer: manifeste.reviewer, before: [], manifest: manifeste }] });
  for (const s of societes)
    await prisma.company.upsert({ where: { id: s.id }, update: {}, create: { id: s.id, name: s.nom, canonicalKey: s.id, fashionjobsUrl: `resolved:${s.id}`,
      parentGroup: 'LVMH', sectorCodes: s.codes, sectorEvidence: s.codes.map(preuve), sectorReviewId: revue } });
  const catalogue = compileOccupationManifest(manifesteV2);
  if (catalogue.manifest.id !== releaseId) throw new Error('Taxonomie active inattendue');
  const titres = ['Conseiller de vente parfum conseiller luxe', 'Conseiller de vente mode conseiller boutique', 'Responsable de boutique parfum luxe'];
  const fraiche = new Date(Date.now() - 3_600_000);
  let n = 0;
  for (let i = 0; i < 60; i++) {
    const id = `preuve-agg-fr-${String(i).padStart(2, '0')}`, titre = titres[i % titres.length], societe = societes[i % 2];
    const lien = `https://example.com/preuve-d444/${id}`;
    if (await prisma.job.findUnique({ where: { id } })) continue;
    await prisma.job.create({ data: {
      id, companyId: societe.id, source: 'GENERIC_JSONLD', externalId: id, title: titre, url: lien, city: 'Paris', countryCode: 'FR',
      employmentTerm: 'PERMANENT', workTime: 'FULL_TIME', language: 'fr', isActive: true, postedAt: fraiche, firstSeenAt: fraiche,
      description: `${titre}. Conseiller la clientèle, conseiller sur le parfum et la mode, conseiller en boutique de luxe.`,
      ...persistedOccupationDecision(catalogue.classify(titre)),
      sources: { create: { sourceKey: 'preuve-d444', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, isActive: true,
        ...publicationFixture({ sourceKey: 'preuve-d444', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, title: titre, city: 'Paris',
          country: 'FR', employmentTerm: 'PERMANENT', language: 'fr', postedAt: fraiche }) } },
    } });
    n++;
  }
  return { societes: societes.length, offresCreees: n, fraicheur: fraiche.toISOString() };
}

const marcheDuPays = (pays: string | null) => (pays ? Object.values(MARCHES).find((m) => m.pays.includes(pays))?.code ?? `hors marché (${pays})` : 'sans pays');

try {
  const releaseId = await activerTaxonomieProduction();
  const registre = await semerRegistre(values.registre);
  const concurrentes = await semerConcurrentes(releaseId);
  const source = listeHttp(LISTE);
  const lue = await source.lire();
  const compte = await source.compter();
  const empreinteListe = createHash('sha256').update(JSON.stringify(lue)).digest('hex');
  // Les deux passes relisent la même réponse : la seconde prouve qu'une liste inchangée n'écrit aucune offre.
  const figee = { async lire() { return structuredClone(lue); }, async compter() { return structuredClone(compte); } };
  const contexte = await chargerContexte(prisma);
  const premiere = await synchroniserListe(prisma, figee, { contexte });
  const seconde = await synchroniserListe(prisma, figee, { contexte });
  await initializeSearchIndex();
  let lots = 0;
  while (await drainSearchIndex()) lots++;
  const lignes = await prisma.directOffer.findMany({ select: { id: true, countryCode: true, company: true, companyId: true, occupationCode: true, eligible: true, title: true } });
  const groupes = new Map((await prisma.company.findMany({ where: { id: { in: lignes.flatMap((l) => (l.companyId ? [l.companyId] : [])) } }, select: { id: true, parentGroup: true } }))
    .map((c) => [c.id, c.parentGroup]));
  const compter = <T>(xs: T[], cle: (x: T) => string) => xs.reduce<Record<string, number>>((acc, x) => ({ ...acc, [cle(x)]: (acc[cle(x)] ?? 0) + 1 }), {});
  const rapport = {
    mesureLe: new Date().toISOString(),
    base: `${cible.hostname}:${cible.port}${cible.pathname}`,
    liste: { url: `${LISTE}/api/jobs`, offres: Array.isArray(lue) ? lue.length : null, empreinteSha256: empreinteListe, compteAnnonce: `${LISTE}/api/jobs/filters` },
    taxonomieActive: releaseId,
    registre, concurrentes,
    premierePasse: premiere,
    secondePasse: { publiees: seconde.publiees, misesAJour: seconde.misesAJour, retablies: seconde.retablies, inchangees: seconde.inchangees, retirees: seconde.retirees, complete: seconde.complete },
    offres: {
      total: lignes.length, publiables: lignes.filter((l) => l.eligible).length,
      parPays: compter(lignes, (l) => l.countryCode ?? 'sans pays'),
      parMarche: compter(lignes, (l) => marcheDuPays(l.countryCode)),
      employeur: { catwalks: lignes.filter((l) => l.company === 'Catwalks').length, maisonPublique: lignes.filter((l) => l.company !== 'Catwalks').length },
      rattacheesAuRegistre: lignes.filter((l) => l.companyId).length,
      maisons: {
        distinctes: new Set(lignes.filter((l) => l.company !== 'Catwalks').map((l) => l.company)).size,
        rattachees: new Set(lignes.flatMap((l) => (l.companyId ? [l.companyId] : []))).size,
      },
      avecGroupe: compter(lignes.filter((l) => l.companyId && groupes.get(l.companyId!)), (l) => groupes.get(l.companyId!)!),
      metier: compter(lignes, (l) => l.occupationCode ?? 'non classée'),
      intitulesNonClasses: lignes.filter((l) => !l.occupationCode).map((l) => l.title).sort((a, b) => a.localeCompare(b, 'fr')),
    },
    index: { lots, ...(await searchIndexStatus()) },
  };
  writeFileSync(values.sortie, JSON.stringify(rapport, null, 2) + '\n');
  console.log(JSON.stringify(rapport, null, 2));
} finally {
  await prisma.$disconnect();
}
