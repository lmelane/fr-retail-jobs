import { describe, expect, it } from 'vitest';
import { classifyCollectionHold, classifyExposure, countVerdict, emptyCounts, exposureLines, trajectory, EXPOSURE_CAUSES, type ExposureJob, type ExposureSource } from './offerExposure.js';
import { bulletinHtml } from './coverageBulletin.js';
import { evaluateCoverage } from './coverageAlert.js';

/** D-520 §3 — chaque offre a un état et une cause, en vocabulaire fermé ; ce qui n'a pas de cause connue est dit « inexpliqué ». */
const at = new Date('2026-10-02T15:00:00Z');
const h = (hours: number) => new Date(at.getTime() - hours * 3_600_000);
const rep = (over: Partial<ExposureSource> = {}): ExposureSource => ({ sourceKey: 'maison-ats', sourceTier: 'ATS_OFFICIAL', externalId: 'e1',
  url: 'https://x/e1', isActive: true, expiresAt: null, lastSeenAt: h(2), availabilityHold: null, availabilityHoldAt: null, holdRule: null,
  publisherClosedAt: null, sourceStatus: 'ACTIVE', lastHold: null, scopeOut: false, ...over });
const job = (over: Partial<ExposureJob> = {}): ExposureJob => ({ id: 'j1', isActive: true, mergedIntoId: null, closedAt: null, withdrawnAt: null,
  withdrawalReason: null, countryCode: 'FR', sources: [rep()], ...over });
const of = (j: ExposureJob) => { const v = classifyExposure(j, at); return `${v.state}/${v.cause}`; };

describe('classifyExposure : un état, une cause', () => {
  it('exposée : active, une représentation confirmée, un pays de marché ouvert', () => {
    expect(of(job())).toBe('EXPOSEE/CONFIRMEE');
    expect(of(job({ countryCode: 'US' }))).toBe('EXPOSEE/CONFIRMEE');
  });
  it('une source en pause garde ses offres servies (D-485, D-493, D-506), sous une cause à part qui se voit', () => {
    expect(of(job({ sources: [rep({ sourceStatus: 'PAUSED' })] }))).toBe('EXPOSEE/SOURCE_EN_PAUSE');
    // Une autre source active la confirme : c'est elle qui sert.
    expect(of(job({ sources: [rep({ sourceStatus: 'PAUSED' }), rep({ sourceKey: 'b', externalId: 'e2' })] }))).toBe('EXPOSEE/CONFIRMEE');
  });
  it('masquée : la retenue la plus forte nomme la cause (lien mort, plafond, non reconfirmée)', () => {
    const missed = rep({ availabilityHold: 'NOT_RECONFIRMED', availabilityHoldAt: h(1), holdRule: 'MISSED_BY_CREDIBLE_COLLECTION', lastSeenAt: h(30) });
    const ceiling = rep({ sourceKey: 'b', availabilityHold: 'NOT_RECONFIRMED', availabilityHoldAt: h(1), holdRule: 'CEILING_72H', lastSeenAt: h(80) });
    const dead = rep({ sourceKey: 'c', availabilityHold: 'APPLY_LINK_DEAD', availabilityHoldAt: h(1) });
    expect(of(job({ sources: [missed] }))).toBe('MASQUEE/NON_RECONFIRMEE');
    expect(of(job({ sources: [missed, ceiling] }))).toBe('MASQUEE/PLAFOND_72H');
    expect(of(job({ sources: [missed, ceiling, dead] }))).toBe('MASQUEE/LIEN_MORT');
    // Une seule représentation confirmée suffit à servir l'offre, comme `publicJobSql`.
    expect(of(job({ sources: [missed, rep({ sourceKey: 'board', sourceTier: 'SPECIALIST_JOBBOARD' })] }))).toBe('EXPOSEE/CONFIRMEE');
  });
  it('fermée : par la source, par l’échéance, par l’autorité de l’officiel (R-143 §3)', () => {
    expect(of(job({ isActive: false, closedAt: h(5), sources: [rep({ isActive: false })] }))).toBe('FERMEE/PAR_LA_SOURCE');
    expect(of(job({ isActive: false, closedAt: h(5), sources: [rep({ isActive: false, expiresAt: h(6) })] }))).toBe('FERMEE/PAR_ECHEANCE');
    expect(of(job({ isActive: false, closedAt: h(5), sources: [rep({ isActive: false, sourceTier: 'EMPLOYER_DIRECT', publisherClosedAt: h(5) }),
      rep({ sourceKey: 'wttj', sourceTier: 'SPECIALIST_JOBBOARD', externalId: 'w1' })] }))).toBe('FERMEE/PAR_AUTORITE');
    // Active mais échue : la recherche ne la sert plus, le refresh la fermera.
    expect(of(job({ sources: [rep({ expiresAt: h(1) })] }))).toBe('FERMEE/PAR_ECHEANCE');
    const native = classifyExposure(job({ isActive: false, closedAt: h(5), sources: [rep({ isActive: false, lastHold: 'APPLICATION_HTTP_404' })] }), at);
    expect(native.detail).toContain('APPLICATION_HTTP_404');
  });
  it('retenue par règle : chaque retrait est nommé par sa preuve, jamais par son seul motif', () => {
    const w = (reason: string, s: Partial<ExposureSource>) => job({ isActive: false, withdrawnAt: h(3), withdrawalReason: reason, sources: [rep({ isActive: false, ...s })] });
    expect(of(w('OUT_OF_SCOPE', { lastHold: 'NATIVE_SPONTANEOUS_APPLICATION' }))).toBe('RETENUE_PAR_REGLE/CANDIDATURE_SPONTANEE');
    expect(of(w('OUT_OF_SCOPE', { scopeOut: true }))).toBe('RETENUE_PAR_REGLE/HORS_PERIMETRE');
    expect(of(w('SOURCE_UNLISTED', { lastHold: 'NATIVE_ADVERTISEMENT_WITHDRAWN' }))).toBe('RETENUE_PAR_REGLE/POSTE_SANS_ANNONCE');
    expect(of(w('SOURCE_UNLISTED', { lastHold: 'SOURCE_UNLISTED' }))).toBe('RETENUE_PAR_REGLE/RETIREE_DU_LISTING');
    expect(of(w('ATTESTATION_MISSING', {}))).toBe('MASQUEE/RETIREE_SANS_PREUVE');
    expect(of(w('PUBLICATION_UNVERIFIED', {}))).toBe('NON_PUBLIABLE/PUBLICATION_NON_VERIFIEE');
    expect(of(w('SOURCE_RETIRED', { sourceStatus: 'RETIRED' }))).toBe('NON_PUBLIABLE/SOURCE_EXCLUE');
    expect(of(w('IDENTITY_CONTRADICTED', {}))).toBe('NON_PUBLIABLE/IDENTITE_CONTREDITE');
  });
  it('absorbée : regroupée sous une jumelle, avant tout cycle de vie', () => {
    expect(of(job({ mergedIntoId: 'j0' }))).toBe('ABSORBEE/DOUBLON');
    expect(of(job({ mergedIntoId: 'j0', isActive: false, closedAt: h(2) }))).toBe('ABSORBEE/DOUBLON');
  });
  it('un pays connu sans marché ouvert est servi par la recherche de ce pays seul ; hors marché, ce qu’aucune recherche n’atteint', () => {
    expect(of(job({ countryCode: 'IN' }))).toBe('EXPOSEE/PAYS_SEUL');
    expect(of(job({ countryCode: null }))).toBe('HORS_MARCHE/SANS_PAYS');
    expect(of(job({ countryCode: 'XK' }))).toBe('HORS_MARCHE/PAYS_INCONNU');
  });
  it('INEXPLIQUÉE plutôt qu’un état plausible : chaque incohérence reste visible', () => {
    expect(of(job({ isActive: false }))).toBe('INEXPLIQUEE/SANS_CAUSE');
    expect(of(job({ isActive: false, withdrawnAt: h(3), withdrawalReason: 'OUT_OF_SCOPE' }))).toBe('INEXPLIQUEE/SANS_CAUSE');
    expect(of(job({ isActive: false, withdrawnAt: h(3), withdrawalReason: 'SOURCE_UNLISTED' }))).toBe('INEXPLIQUEE/SANS_CAUSE');
    expect(of(job({ isActive: false, withdrawnAt: h(3), withdrawalReason: 'UN_MOTIF_NEUF' }))).toBe('INEXPLIQUEE/SANS_CAUSE');
    expect(of(job({ sources: [rep({ isActive: false })] }))).toBe('INEXPLIQUEE/SANS_CAUSE');
    expect(of(job({ sources: [rep({ availabilityHold: 'UNE_RETENUE_NEUVE', availabilityHoldAt: h(1) })] }))).toBe('INEXPLIQUEE/SANS_CAUSE');
  });
  it('chaque cause a sa trajectoire, et elle dit ce que le code fait (seul ATTESTATION_MISSING se rouvre par une collecte)', () => {
    const kind = (cause: string, context = {}) => trajectory({ state: 'X', cause, sourceKey: 'maison-ats', detail: '' } as never, { sourceStatus: 'ACTIVE', ...context }).kind;
    const all = Object.values(EXPOSURE_CAUSES).flat();
    expect(Object.fromEntries(all.map(c => [c, kind(c)]))).toEqual({
      CONFIRMEE: 'DEJA_SERVIE', SOURCE_EN_PAUSE: 'DEJA_SERVIE', PAYS_SEUL: 'DEJA_SERVIE',
      NON_RECONFIRMEE: 'REVIENT_SEULE', PLAFOND_72H: 'REVIENT_SEULE', LIEN_MORT: 'REVIENT_SEULE', RETIREE_SANS_PREUVE: 'REVIENT_SEULE',
      CANDIDATURE_SPONTANEE: 'AUCUNE', HORS_PERIMETRE: 'SUR_DECISION', POSTE_SANS_ANNONCE: 'REVIENT_SEULE', RETIREE_DU_LISTING: 'REVIENT_SEULE',
      PREUVE_DE_LA_SOURCE: 'REVIENT_SEULE', DOUBLON: 'AUCUNE', PAR_LA_SOURCE: 'REVIENT_SEULE', PAR_AUTORITE: 'REVIENT_SEULE', PAR_ECHEANCE: 'REVIENT_SEULE',
      IDENTITE_EN_REVUE: 'SUR_DECISION', IDENTITE_CONTREDITE: 'SUR_DECISION', SOURCE_EXCLUE: 'SUR_DECISION', PUBLICATION_NON_VERIFIEE: 'A_REPARER',
      SANS_PAYS: 'A_REPARER', PAYS_INCONNU: 'A_REPARER', SANS_CAUSE: 'A_REPARER',
    });
    // Une source en pause ne revoit rien : ce qui « revient seul » ne revient qu'à sa reprise.
    expect(kind('NON_RECONFIRMEE', { sourceStatus: 'PAUSED' })).toBe('A_REPARER');
    expect(kind('LIEN_MORT', { sourceStatus: 'PAUSED' })).toBe('A_REPARER');
    // Sur une base sans R-143 §2, la trajectoire d'une offre servie ne promet pas un masquage qui n'est pas livré.
    const v = { state: 'EXPOSEE', cause: 'CONFIRMEE', sourceKey: 'maison-ats', detail: '' } as never;
    expect(trajectory(v, { maskingLive: false }).text).not.toContain('masquée si');
    expect(trajectory(v, { maskingLive: true }).text).toContain('masquée si');
  });
  it('une publication retenue dès la collecte prend la cause de sa retenue ; une retenue à instruire reste inexpliquée', () => {
    const c = (hold: string) => { const v = classifyCollectionHold(hold, 's', 'd'); return `${v.state}/${v.cause}`; };
    expect(c('NATIVE_SPONTANEOUS_APPLICATION')).toBe('RETENUE_PAR_REGLE/CANDIDATURE_SPONTANEE');
    expect(c('NATIVE_DESCRIPTION_EMPTY')).toBe('RETENUE_PAR_REGLE/PREUVE_DE_LA_SOURCE');
    expect(c('WORKDAY_DETAIL_PERMISSION_DENIED')).toBe('RETENUE_PAR_REGLE/PREUVE_DE_LA_SOURCE');
    expect(c('APPLICATION_HTTP_404')).toBe('FERMEE/PAR_LA_SOURCE');
    expect(c('WORKDAY_EMPLOYER_ABSENT_IN_DETAIL')).toBe('NON_PUBLIABLE/IDENTITE_EN_REVUE');
    expect(c('LVMH_DETAIL_FETCH_FAILED')).toBe('INEXPLIQUEE/SANS_CAUSE');
  });
});

describe('la répartition dans le bulletin (D-520 §3)', () => {
  const counts = emptyCounts();
  countVerdict(counts, classifyExposure(job(), at));
  countVerdict(counts, classifyExposure(job({ mergedIntoId: 'j0' }), at));
  const plain = (t: string) => t.replace(/[  ]/g, ' ');
  it('dit les états et l’absence d’offre sans cause', () => {
    const lines = exposureLines({ counts, identityReview: 0, unexplained: [] }).map(plain);
    expect(lines[0]).toBe('État d’exposition des 2 offres : exposée 1 ; absorbée par un doublon 1.');
    expect(lines.at(-1)).toBe('Aucune offre sans cause connue.');
    const withRetained = exposureLines({ counts, identityReview: 0, unexplained: [], retainedAtCollection: { 'RETENUE_PAR_REGLE/PREUVE_DE_LA_SOURCE': 3, 'INEXPLIQUEE/SANS_CAUSE': 2 } }).map(plain);
    expect(withRetained).toContain('À instruire : 2 publications retenues à la collecte pour un motif non arbitré.');
  });
  it('nomme les offres sans cause à instruire', () => {
    const c = emptyCounts();
    countVerdict(c, classifyExposure(job({ id: 'x9', isActive: false }), at));
    expect(exposureLines({ counts: c, identityReview: 0, unexplained: [{ id: 'x9', detail: 'inactive' }] }).at(-1)).toBe('À instruire : 1 offres sans cause connue (x9).');
  });
  it('le bulletin porte la répartition, sans tiret cadratin (D-319), et dit quand elle manque', () => {
    const evaluation = evaluateCoverage({ history: [], knownSources: [], entities: [] });
    const html = plain(bulletinHtml(evaluation, [], { at, exposure: { counts, identityReview: 0, unexplained: [] } }));
    expect(html).toContain('État d’exposition des 2 offres : exposée 1 ; absorbée par un doublon 1.');
    expect(html).not.toContain('—');
    expect(bulletinHtml(evaluation, [], { at, exposure: null })).toContain('Répartition par état d’exposition illisible à ce RUN');
  });
});
