import { describe, expect, it } from 'vitest';
import { CaptureUnavailableError } from '../capture/context.js';
import { HttpStatusError } from '../lib/http.js';
import { ingestionIssue } from '../lib/ingestionIssue.js';
import { SourceAccessGateError } from '../connectors/accessScope.js';
import { CAUSES, causeOf, ESCALATION_RUNS, remediationNote, remediationOf, retriesInRun, type Cause } from './ordinaryCauses.js';

/**
 * D-520 — chaque classe mesurée sur les RUN du 24/09 au 01/10/2026 (`audits/2026-10-02/remediation-auto/catalogue.out`)
 * reçoit sa cause et sa trajectoire depuis l'issue que le RUN en tire réellement (`ingestionIssue`) et le message
 * d'erreur de production, cité tel quel.
 */
const fromError = (error: unknown) => ingestionIssue(error);
const named = (name: string, message: string) => Object.assign(new Error(message), { name });

describe('le catalogue des causes nomme chaque classe mesurée en production', () => {
  const cases: Array<[string, ReturnType<typeof ingestionIssue>, string, Cause]> = [
    ['capture refusée par la politique d’accès (15 sources, 27 et 29/09 ; jamais passagère)',
      fromError(new CaptureUnavailableError('This access policy certifies only native HTTP requests')),
      'Native response capture unavailable; extraction stopped', 'CAPTURE_REFUSED'],
    ['base indisponible (erreur Prisma, relancée par la qualification depuis le 01/10)', { origin: 'INTERNAL', code: 'DATABASE_FAILURE', count: 1 },
      'Transaction API error: Transaction already closed', 'TRANSIENT_DATABASE'],
    ['transport (Rolex, ralph-lauren-avature « fetch failed »)', { origin: 'UNKNOWN', code: 'TRANSPORT_UND_ERR_CONNECT_TIMEOUT', count: 1 }, 'fetch failed', 'TRANSIENT_NETWORK'],
    ['5xx prouvé par sa réponse native (non bloquant, jamais repris)', { origin: 'SOURCE', code: 'HTTP_503', count: 1, captureBatchId: 'b', rawCaptureId: 'r' }, 'HTTP 503', 'PUBLISHER_OUTAGE_PROVEN'],
    ['5xx non prouvé : cause absente du catalogue, à instruire', fromError(new HttpStatusError(503, 'https://example.test/jobs')), 'HTTP 503 for https://example.test/jobs', 'UNCLASSIFIED'],
    ['admission sans résultat natif qualifié (kering, sephora-france)', fromError(named('SourceAdmissionGateError', 'Ingestion requires a qualified native result')),
      'Ingestion requires a qualified native result', 'QUALIFICATION_REJECTED'],
    ['délai (ulta-jibe, 10 026 offres)', fromError(new Error('__TIMEOUT__ ulta-jibe')), '__TIMEOUT__ ulta-jibe', 'TIMEOUT'],
    ['décision d’accès à renouveler (lvmh, 23/09)', fromError(new SourceAccessGateError('ACCESS_STALE', 'Access decision must be renewed for the current source revision, reader and evidence')),
      'Access decision must be renewed for the current source revision, reader and evidence', 'ACCESS_RENEWAL'],
    ['hors périmètre (urbn-hub, swatch-group, 30/09)', fromError(new SourceAccessGateError('ACCESS_SCOPE', 'Request is outside the reviewed public HTTP scope')),
      'Request is outside the reviewed public HTTP scope', 'SCOPE_OUTGROWN'],
    ['refus explicite en vigueur (lindex-easycruit, 6 RUN)', fromError(new SourceAccessGateError('ACCESS_DENIED', 'Automatic qualification cannot replace an explicit denial')),
      'Automatic qualification cannot replace an explicit denial', 'ACCESS_DENIED'],
    ['406 Avature (L’Oréal Professionnel)', fromError(new HttpStatusError(406, 'https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=0')),
      'HTTP 406 for https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=0', 'PUBLISHER_REFUSAL'],
    ['403 Workday (versace, 01/10)', fromError(new HttpStatusError(403, 'https://capri.wd1.myworkdayjobs.com/wday/cxs/capri/Versace/jobs')),
      'HTTP 403 for https://capri.wd1.myworkdayjobs.com/wday/cxs/capri/Versace/jobs', 'PUBLISHER_REFUSAL'],
    ['qualification rejetée (estee-lauder-companies, pvh)', fromError(named('SourceAdmissionGateError', 'Access qualification requires validated native evidence: REJECTED')),
      'Access qualification requires validated native evidence: REJECTED', 'QUALIFICATION_REJECTED'],
    ['liste non prouvée (tapestry)', { origin: 'UNKNOWN', code: 'ENUMERATION_NOT_PROVEN', count: 1 }, '', 'ENUMERATION_INCOMPLETE'],
    ['régression de santé (sephora-france)', { origin: 'UNKNOWN', code: 'SOURCE_HEALTH_REGRESSION', count: 1 }, '', 'HEALTH_REGRESSION'],
    ['identité d’employeur (lvmh, 6 RUN)', { origin: 'UNKNOWN', code: 'EmployerIdentityReviewRequired', count: 1 }, '', 'IDENTITY_REVIEW'],
    ['retenue prouvée (levis)', { origin: 'SOURCE', code: 'NATIVE_RETENTION', count: 1285, captureBatchId: 'b', completionReportHash: 'h' }, '', 'NATIVE_RETENTION'],
    ['défaut de code', fromError(new TypeError('x is undefined')), 'x is undefined', 'CODE_DEFECT'],
    ['cause jamais vue (selfridges, 0 offre lue)', fromError(new Error('generic-listing …: 63 liens d’offre, 0 offre lue')), '63 liens d’offre, 0 offre lue', 'UNCLASSIFIED'],
  ];
  it.each(cases)('%s', (_, issue, message, cause) => {
    expect(causeOf(issue, message)).toBe(cause);
  });

  it('un refus dont le message parle de transaction n’est jamais passager, donc jamais repris (audit D-520)', () => {
    const transaction = 'Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction.';
    for (const [code, expected] of [['ACCESS_DENIED', 'ACCESS_DENIED'], ['ACCESS_SCOPE', 'SCOPE_OUTGROWN']] as const) {
      const error = new SourceAccessGateError(code, `Access qualification refused: ${transaction}`);
      const r = remediationOf('diptyque-workday', fromError(error), error.message, new Set(), error.code);
      expect(r.cause).toBe(expected);
      expect(retriesInRun(r)).toBe(false);
    }
    // La garde rapporte un refus (ACCESS_INVALID) qui cite une transaction : il n'est pas reconnu passager par son texte.
    const invalid = new SourceAccessGateError('ACCESS_INVALID', `Access qualification refused: ${transaction}`);
    expect(retriesInRun(remediationOf('diptyque-workday', fromError(invalid), invalid.message, new Set(), invalid.code))).toBe(false);
    // Un refus de l'éditeur aussi, même si son message cite une transaction.
    expect(retriesInRun(remediationOf('versace', { origin: 'UNKNOWN', code: 'HttpStatusError', count: 1, detail: 'HTTP_403' }, transaction))).toBe(false);
    // Seule la classe Prisma (DATABASE_FAILURE, origine INTERNAL) est passagère.
    expect(retriesInRun(remediationOf('diptyque-workday', { origin: 'INTERNAL', code: 'DATABASE_FAILURE', count: 1 }))).toBe(true);
    expect(causeOf({ origin: 'UNKNOWN', code: 'DATABASE_FAILURE' })).toBe('UNCLASSIFIED');
  });

  it('une retenue que la source n’atteste pas n’est jamais « normale »', () => {
    expect(causeOf({ origin: 'UNKNOWN', code: 'NATIVE_RETENTION' })).toBe('UNCLASSIFIED');
  });
});

describe('la trajectoire : seule une panne passagère par sa classe revient seule ; toute autre issue bloquante est à instruire', () => {
  const database = { origin: 'INTERNAL' as const, code: 'DATABASE_FAILURE', count: 1 };
  it('une panne de base revient seule par une reprise dans le RUN', () => {
    const r = remediationOf('browns-shoes', database);
    expect(r).toMatchObject({ cause: 'TRANSIENT_DATABASE', trajectory: 'REVIENT_SEULE', means: 'RUN_RETRY', consecutiveRuns: 1 });
    expect(retriesInRun(r)).toBe(true);
  });

  it('présente au RUN complet précédent, elle est à instruire et n’est plus reprise', () => {
    const r = remediationOf('browns-shoes', database, '', new Set(['TRANSIENT_DATABASE']));
    expect(r).toMatchObject({ trajectory: 'A_REPARER', means: null, consecutiveRuns: ESCALATION_RUNS });
    expect(retriesInRun(r)).toBe(false);
    expect(remediationNote(r)).toBe('base de données indisponible ou lente → à instruire, déjà là au RUN complet précédent');
  });

  it('une reprise échouée n’est plus présumée passagère', () => {
    const r = remediationOf('browns-shoes', database, '', new Set(), undefined, true);
    expect(r).toMatchObject({ trajectory: 'A_REPARER', means: null });
    expect(r.expected).toMatch(/la reprise du RUN a échoué$/);
  });

  it('une autre cause au RUN précédent ne compte pas pour l’escalade', () => {
    expect(remediationOf('browns-shoes', database, '', new Set(['TIMEOUT'])).trajectory).toBe('REVIENT_SEULE');
  });

  it('aucune issue bloquante non reprise ne dit « revient seule » (D-453 §1 : elle est instruite)', () => {
    const blocking: Array<[string, Parameters<typeof remediationOf>[1], string]> = [
      ['versace', { origin: 'UNKNOWN', code: 'HttpStatusError', count: 1, detail: 'HTTP_403' }, ''],
      ['ulta-jibe', { origin: 'UNKNOWN', code: 'Error', count: 1 }, '__TIMEOUT__ ulta-jibe'],
      ['tapestry-x', { origin: 'UNKNOWN', code: 'ENUMERATION_NOT_PROVEN', count: 1 }, ''],
      ['sephora-france', { origin: 'UNKNOWN', code: 'SOURCE_HEALTH_REGRESSION', count: 1 }, ''],
      ['pvh', { origin: 'UNKNOWN', code: 'SourceAdmissionGateError', count: 1 }, 'Access qualification requires validated native evidence: REJECTED'],
      ['nars', { origin: 'INTERNAL', code: 'CaptureUnavailableError', count: 1 }, 'Native response capture unavailable; extraction stopped'],
    ];
    for (const [source, issue, message] of blocking) {
      const r = remediationOf(source, issue, message);
      expect(r.trajectory, source).toBe('A_REPARER');
      expect(retriesInRun(r), source).toBe(false);
      expect(r.expected, source).not.toMatch(/^rien/);
    }
  });

  it('un périmètre qui ne se redérive pas, l’identité et le refus explicite demandent une revue humaine', () => {
    expect(remediationOf('urbn-hub', { origin: 'INTERNAL', code: 'ACCESS_SCOPE', count: 1 }).trajectory).toBe('REVUE_HUMAINE');
    expect(remediationOf('lvmh', { origin: 'UNKNOWN', code: 'EmployerIdentityReviewRequired', count: 1 }).trajectory).toBe('REVUE_HUMAINE');
    expect(remediationOf('lindex-easycruit', { origin: 'UNKNOWN', code: 'SourceAccessGateError', count: 1 }, 'Automatic qualification cannot replace an explicit denial'))
      .toMatchObject({ trajectory: 'REVUE_HUMAINE', cause: 'ACCESS_DENIED' });
  });

  it('un échec connu décidé (D-480 §1) reste décidé, et lui seul', () => {
    const r = remediationOf('l-oreal-professionnel', { origin: 'UNKNOWN', code: 'HttpStatusError', count: 1, detail: 'HTTP_406' });
    expect(r).toMatchObject({ trajectory: 'DECIDEE', decided: 'D-480' });
    expect(remediationOf('l-oreal-professionnel', { origin: 'UNKNOWN', code: 'HttpStatusError', count: 1, detail: 'HTTP_403' }).trajectory).toBe('A_REPARER');
  });

  it('seules les deux causes passagères par leur classe sont reprises, et chacune a une sortie', () => {
    const retried = Object.entries(CAUSES).filter(([, e]) => e.means === 'RUN_RETRY');
    expect(retried.map(([c]) => c).sort()).toEqual(['TRANSIENT_DATABASE', 'TRANSIENT_NETWORK']);
    for (const [cause, entry] of retried) expect(entry.escalation, cause).toBeDefined();
    expect(Object.entries(CAUSES).filter(([, e]) => e.trajectory === 'REVIENT_SEULE').map(([c]) => c).sort())
      .toEqual(['TRANSIENT_DATABASE', 'TRANSIENT_NETWORK']);
  });
});

describe('l’alerte dit, pour chaque source bloquante, où elle va et ce qui est attendu', () => {
  it('une source non collectée porte sa ligne de trajectoire dans son bloc', async () => {
    const { alertHtml } = await import('./alert.js');
    const { remediationLine } = await import('./ordinaryCauses.js');
    const persistent = remediationOf('browns-shoes', { origin: 'INTERNAL', code: 'DATABASE_FAILURE', count: 1 }, '', new Set(['TRANSIENT_DATABASE']));
    const html = alertHtml({ degraded: 0, broken: 1, incidents: [{ source: 'browns-shoes', status: 'BROKEN', jobs: 0, previous: 70, notCollected: true,
      note: 'INTERNAL/DATABASE_FAILURE: Transaction already closed', remediation: [remediationLine(persistent)] }] });
    expect(html).toContain('base de données indisponible ou lente → à instruire, déjà là au RUN complet précédent : instruire la base');
  });
});
