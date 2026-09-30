import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resolveEmployer } from '../identity/resolve.js';
import { EmployerIdentityReviewRequired } from '../identity/errors.js';
import type { CandidateJob } from '../dedup/match.js';

/**
 * PILOTE L10 — le parcours complet, sur les trois cas représentatifs du corpus.
 *
 *   RAW → identité employeur → contrôles de publication → canonisation → dédup → JobSource
 *
 * Les trois profils viennent des mesures du 2026-09-21 sur le corpus réel :
 *
 *   · MONO     `knitwell-us-retail` — le RAW nomme « The Talbots LLC », un seul employeur ;
 *   · MULTI    `tapestry`           — le RAW nomme NEUF raisons sociales distinctes ;
 *   · ANONYME  `parfums-chanel`     — la page ne nomme AUCUN employeur.
 *
 * ── LE CRITÈRE QUI COMPTE ──────────────────────────────────────────────────────────────────────
 *
 * `writeFailed = 0` NE SUFFIT PAS : déplacer les annonces vers `held` ou `skipped` ne récupère
 * rien. Le pilote exige que les cas prouvés PUBLIENT, et que le cas ambigu soit refusé AVEC son
 * motif détaillé — celui que le lot de traçabilité vient de rendre visible.
 *
 * ── CE QUE CE PILOTE NE PROUVE PAS ─────────────────────────────────────────────────────────────
 *
 * `publicationPersistenceFixture` MOCKE `requireCurrentCaptureRevision` : la porte d'admission —
 * révision de source, décision d'accès, admission du lot — n'est donc PAS exercée ici.
 *
 * Ce pilote démontre la résolution d'identité, la persistance, la canonisation et la
 * déduplication. **Il ne vaut pas preuve pour L11**, qui porte précisément sur cette porte : seul
 * un run du véritable orchestrateur d'ingestion peut l'établir.
 */
const db = new PrismaClient();
beforeEach(async () => { await db.jobSource.deleteMany(); await db.job.deleteMany(); await db.company.deleteMany(); });
afterAll(() => db.$disconnect());

/** Une Maison et sa source, dans l'état que le corpus a mesuré. */
async function poser(cle: string, maison: string, scope: 'SINGLE_BRAND' | 'MULTI_BRAND' | null) {
  const company = await db.company.create({ data: {
    name: maison, canonicalKey: `${cle}-key`, fashionjobsUrl: `https://fashionjobs.test/${cle}`, sector: 'FASHION' } });
  await db.source.upsert({ where: { key: cle }, update: { portalScope: scope },
    create: { key: cle, maison, kind: 'generic-listing', status: 'ACTIVE', config: {},
      tier: 'EMPLOYER_SITE', tenantKey: cle, portalScope: scope } });
  return company;
}

/** Une candidate telle que `ingest.ts:193` la construit — l'origine du libellé décide de la branche. */
function candidate(cle: string, ext: string, companyId: string, employeur: string | null, maison: string): CandidateJob & { companyId: string } {
  return {
    sourceKey: cle, externalId: ext, companyId, title: 'Client Advisor',
    url: `https://exemple.test/${cle}/${ext}`, company: employeur ?? maison,
    rawEmployerName: employeur ?? maison,
    // Sans employeur natif, le libellé vient du REGISTRE : c'est la branche qui exige un
    // périmètre relu du portail, SINGLE_BRAND ou MULTI_BRAND (`resolve.ts`, D-479 §2).
    employerLabelOrigin: employeur ? 'ADAPTER_COMPANY' : 'SOURCE_CATALOGUE_LABEL',
    atsType: 'GENERIC_JSONLD', sourceTier: 'EMPLOYER_DIRECT', country: 'US', city: 'New York',
  } as unknown as CandidateJob & { companyId: string };
}

/** Un passage complet, résolution d'identité comprise. Rend le motif exact de chaque refus. */
async function passage(cle: string, companyId: string, maison: string, employeurs: (string | null)[], prefixe: string) {
  const resultat = { publie: 0, refuse: 0, motifs: [] as string[] };
  for (const [i, employeur] of employeurs.entries()) {
    const cand = candidate(cle, `${prefixe}-${i}`, companyId, employeur, maison);
    try {
      await db.$transaction(async (tx) => { await resolveEmployer(tx, cand); });
      await upsertDeduplicated(db, cand);
      resultat.publie++;
    } catch (e) {
      resultat.refuse++;
      resultat.motifs.push(e instanceof EmployerIdentityReviewRequired ? `${e.name}:${e.motif}`
        : e instanceof Error ? e.name : 'UnknownError');
    }
  }
  return resultat;
}

describe('pilote L10 — attribution automatique de l\'employeur', () => {
  it('MONO : un portail certifié SINGLE_BRAND publie sans intervention', async () => {
    const cle = `pilote-mono-${randomUUID().slice(0, 8)}`;
    const co = await poser(cle, 'KnitWell Group', 'SINGLE_BRAND');
    const r = await passage(cle, co.id, 'KnitWell Group', ['The Talbots LLC', 'The Talbots LLC', 'The Talbots LLC'], 'a');

    expect(r.refuse, `refus inattendus : ${r.motifs.join(', ')}`).toBe(0);
    expect(r.publie).toBe(3);
    // `published` augmente RÉELLEMENT : rien n'est parti en held ni en skipped.
    expect(await db.jobSource.count({ where: { sourceKey: cle } })).toBe(3);
  });

  it('MULTI : un portail multimarque attribue PAR ANNONCE, jamais par portail', async () => {
    /*
     * `tapestry` déclare neuf raisons sociales dans son RAW. Chaque annonce nomme son employeur :
     * l'attribution ne passe pas par le propriétaire du portail, et c'est ce qui la rend correcte.
     */
    const cle = `pilote-multi-${randomUUID().slice(0, 8)}`;
    const co = await poser(cle, 'Tapestry', 'MULTI_BRAND');
    const r = await passage(cle, co.id, 'Tapestry',
      ['Coach Vietnam Company Limited', 'Tapestry Japan, LLC', 'Coach Korea Limited'], 'b');

    expect(r.refuse, `refus inattendus : ${r.motifs.join(', ')}`).toBe(0);
    expect(r.publie).toBe(3);
    const maisons = await db.job.findMany({ where: { sources: { some: { sourceKey: cle } } }, select: { companyId: true } });
    // Trois employeurs distincts : la preuve que l'attribution est au niveau de l'annonce.
    expect(new Set(maisons.map((m) => m.companyId)).size).toBeGreaterThan(1);
  });

  it('ANONYME : une annonce sans employeur nommé n\'est JAMAIS attribuée de force', async () => {
    /*
     * `parfums-chanel` ne nomme personne. Le libellé vient alors du registre, et le produit exige
     * un périmètre relu avant d'attribuer au propriétaire du portail — refus correct sur un
     * portail dont le périmètre n'a jamais été relu (NULL).
     */
    const cle = `pilote-anon-${randomUUID().slice(0, 8)}`;
    const co = await poser(cle, 'Chanel', null);
    const r = await passage(cle, co.id, 'Chanel', [null, null, null], 'c');

    expect(r.publie).toBe(0);
    expect(r.refuse).toBe(3);
    // LE MOTIF DÉTAILLÉ — invisible avant le lot de traçabilité, qui écrasait les sept causes
    // sous le seul nom de la classe.
    expect(new Set(r.motifs)).toEqual(new Set(['EmployerIdentityReviewRequired:PORTAL_OWNER_NOT_CERTIFIED']));
  });

  it('MULTI sans enseigne : l\'annonce qui ne nomme personne publie sous le groupe, les autres gardent la leur (D-479 §2)', async () => {
    // LVMH, RUN du 29/09/2026 : 30 annonces par jour sans Maison dans l'index public, refusées jusque-là.
    const cle = `pilote-multi-anon-${randomUUID().slice(0, 8)}`;
    const co = await poser(cle, 'LVMH (toutes Maisons)', 'MULTI_BRAND');
    const r = await passage(cle, co.id, 'LVMH (toutes Maisons)', ['Christian Dior Couture', null], 'e');

    expect(r.refuse, `refus inattendus : ${r.motifs.join(', ')}`).toBe(0);
    expect(r.publie).toBe(2);
    const jobs = await db.job.findMany({ where: { sources: { some: { sourceKey: cle } } }, select: { company: { select: { name: true } } } });
    // Le groupe porte le nom de sa clé, sans la parenthèse du registre.
    expect(jobs.map((j) => j.company.name).sort()).toEqual(['Christian Dior Couture', 'LVMH']);
  });

  it('second passage : aucun doublon', async () => {
    const cle = `pilote-idem-${randomUUID().slice(0, 8)}`;
    const co = await poser(cle, 'KnitWell Group', 'SINGLE_BRAND');
    await passage(cle, co.id, 'KnitWell Group', ['The Talbots LLC', 'The Talbots LLC'], 'd');
    const apres1 = await db.jobSource.count({ where: { sourceKey: cle } });

    await passage(cle, co.id, 'KnitWell Group', ['The Talbots LLC', 'The Talbots LLC'], 'd');
    const apres2 = await db.jobSource.count({ where: { sourceKey: cle } });

    expect(apres1).toBe(2);
    expect(apres2).toBe(apres1);
  });
});
