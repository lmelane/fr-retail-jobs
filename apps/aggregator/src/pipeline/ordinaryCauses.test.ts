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
    ['capture indisponible (15 sources, 29/09)', fromError(new CaptureUnavailableError(new Error('write failed'))),
      'Native response capture unavailable; extraction stopped', 'TRANSIENT_CAPTURE'],
    ['transaction close rapportée par la garde d’accès (diptyque-workday, 01/10)',
      fromError(new SourceAccessGateError('ACCESS_INVALID', 'Access qualification refused: Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction.')),
      'Access qualification refused: Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction.', 'TRANSIENT_DATABASE'],
    ['transport (Rolex, ralph-lauren-avature « fetch failed »)', { origin: 'UNKNOWN', code: 'TRANSPORT_UND_ERR_CONNECT_TIMEOUT', count: 1 }, 'fetch failed', 'TRANSIENT_NETWORK'],
    ['5xx prouvé par sa réponse native', { origin: 'SOURCE', code: 'HTTP_503', count: 1, captureBatchId: 'b', rawCaptureId: 'r' }, 'HTTP 503', 'TRANSIENT_NETWORK'],
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

  it('une base indisponible garde sa classe propre, distincte d’un refus d’accès', () => {
    expect(causeOf({ origin: 'INTERNAL', code: 'DATABASE_FAILURE' })).toBe('TRANSIENT_DATABASE');
    // Le même code de garde, sans transaction close, n'est pas une panne passagère : rien ne le reprend.
    expect(causeOf({ origin: 'UNKNOWN', code: 'SourceAccessGateError' }, 'Access qualification refused: robots disallow')).toBe('UNCLASSIFIED');
  });

  it('une retenue que la source n’atteste pas n’est jamais « normale »', () => {
    expect(causeOf({ origin: 'UNKNOWN', code: 'NATIVE_RETENTION' })).toBe('UNCLASSIFIED');
  });
});

describe('la trajectoire : revient seule une fois, à réparer au 2e RUN complet de suite, humain d’emblée quand il le faut', () => {
  const capture = { origin: 'INTERNAL' as const, code: 'CaptureUnavailableError', count: 1 };
  it('une capture indisponible revient seule par une reprise dans le RUN', () => {
    const r = remediationOf('nars', capture);
    expect(r).toMatchObject({ cause: 'TRANSIENT_CAPTURE', trajectory: 'REVIENT_SEULE', means: 'RUN_RETRY', consecutiveRuns: 1 });
    expect(retriesInRun(r)).toBe(true);
  });

  it('présente au RUN complet précédent, elle passe à réparer et n’est plus reprise', () => {
    const r = remediationOf('nars', capture, '', new Set(['TRANSIENT_CAPTURE']));
    expect(r).toMatchObject({ trajectory: 'A_REPARER', means: null, consecutiveRuns: ESCALATION_RUNS });
    expect(r.expected).toMatch(/deux RUN/);
    expect(retriesInRun(r)).toBe(false);
    expect(remediationNote(r)).toBe('capture native indisponible → à réparer, 2e RUN de suite');
  });

  it('une autre cause au RUN précédent ne compte pas pour l’escalade', () => {
    expect(remediationOf('nars', capture, '', new Set(['TIMEOUT'])).trajectory).toBe('REVIENT_SEULE');
  });

  it('un refus de l’éditeur n’est jamais repris dans le même RUN', () => {
    const r = remediationOf('versace', { origin: 'UNKNOWN', code: 'HttpStatusError', count: 1, detail: 'HTTP_403' });
    expect(r).toMatchObject({ cause: 'PUBLISHER_REFUSAL', trajectory: 'REVIENT_SEULE', means: 'NEXT_RUN' });
    expect(retriesInRun(r)).toBe(false);
  });

  it('un périmètre qui ne se redérive pas deux RUN de suite demande une revue humaine', () => {
    expect(remediationOf('urbn-hub', { origin: 'INTERNAL', code: 'ACCESS_SCOPE', count: 1 }, '', new Set(['SCOPE_OUTGROWN'])))
      .toMatchObject({ trajectory: 'REVUE_HUMAINE' });
  });

  it('l’identité et le refus explicite sont humains dès la première fois, sans escalade', () => {
    expect(remediationOf('lvmh', { origin: 'UNKNOWN', code: 'EmployerIdentityReviewRequired', count: 1 }).trajectory).toBe('REVUE_HUMAINE');
    expect(remediationOf('lindex-easycruit', { origin: 'INTERNAL', code: 'ACCESS_DENIED', count: 1 }, '', new Set(['ACCESS_DENIED'])))
      .toMatchObject({ trajectory: 'REVUE_HUMAINE', consecutiveRuns: 2 });
  });

  it('un échec connu décidé (D-480 §1) reste décidé, même persistant', () => {
    const r = remediationOf('l-oreal-professionnel', { origin: 'UNKNOWN', code: 'HttpStatusError', count: 1, detail: 'HTTP_406' }, '', new Set(['PUBLISHER_REFUSAL']));
    expect(r).toMatchObject({ trajectory: 'DECIDEE', decided: 'D-480' });
    // Un AUTRE défaut de la même source n'est pas couvert par la décision.
    expect(remediationOf('l-oreal-professionnel', { origin: 'UNKNOWN', code: 'HttpStatusError', count: 1, detail: 'HTTP_403' }).trajectory).toBe('REVIENT_SEULE');
  });

  it('chaque cause qui revient seule a une sortie : son escalade', () => {
    for (const [cause, entry] of Object.entries(CAUSES))
      if (entry.trajectory === 'REVIENT_SEULE') expect(entry.escalation, cause).toBeDefined();
  });

  it('seules les trois causes passagères sont reprises dans le RUN', () => {
    expect(Object.entries(CAUSES).filter(([, e]) => e.means === 'RUN_RETRY').map(([c]) => c).sort())
      .toEqual(['TRANSIENT_CAPTURE', 'TRANSIENT_DATABASE', 'TRANSIENT_NETWORK']);
  });
});

describe('l’alerte dit, pour chaque source bloquante, où elle va et ce qui est attendu', () => {
  it('une source non collectée porte sa ligne de trajectoire dans son bloc', async () => {
    const { alertHtml } = await import('./alert.js');
    const { remediationLine } = await import('./ordinaryCauses.js');
    const persistentCapture = remediationOf('nars', { origin: 'INTERNAL', code: 'CaptureUnavailableError', count: 1 }, '', new Set(['TRANSIENT_CAPTURE']));
    const html = alertHtml({ degraded: 0, broken: 1, incidents: [{ source: 'nars', status: 'BROKEN', jobs: 0, previous: 50, notCollected: true,
      note: 'INTERNAL/CaptureUnavailableError: Native response capture unavailable; extraction stopped', remediation: [remediationLine(persistentCapture)] }] });
    expect(html).toContain('capture native indisponible → à réparer, 2e RUN de suite : vérifier le stockage des captures');
  });
});
