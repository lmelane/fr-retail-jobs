import { describe, expect, it } from 'vitest';
import { CaptureUnavailableError } from '../capture/context.js';
import { HttpStatusError } from '../lib/http.js';
import { ingestionIssue, type IngestionIssue } from '../lib/ingestionIssue.js';
import { SourceAccessGateError } from '../connectors/accessScope.js';
import { CAUSES, issueCause } from './sourceState.js';
import { remediationLine, remediationNote, remediationOf, transientKind } from './ordinaryCauses.js';

/**
 * D-520 — la reprise dans le RUN, branchée sur le vocabulaire unique (`sourceState.ts`). Chaque cas vient d'un code ou
 * d'un message mesuré sur les RUN du 24/09 au 01/10/2026 (`audits/2026-10-02/remediation-auto/catalogue.out`).
 */
const transaction = 'Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction.';
const database: IngestionIssue = { origin: 'INTERNAL', code: 'DATABASE_FAILURE', count: 1 };
const transport: IngestionIssue = { origin: 'UNKNOWN', code: 'TRANSPORT_UND_ERR_CONNECT_TIMEOUT', count: 1 };

describe('seules deux familles sont passagères, par la classe de l’erreur et jamais par son texte', () => {
  it('une panne de base Prisma et une panne de transport non TLS', () => {
    expect(transientKind(database)).toBe('DATABASE');
    expect(transientKind(transport)).toBe('TRANSPORT');
  });

  const never: Array<[string, IngestionIssue]> = [
    ['capture refusée par la politique d’accès (15 cas des 27 et 29/09)', ingestionIssue(new CaptureUnavailableError('This access policy certifies only native HTTP requests'))],
    ['refus 403 (versace)', ingestionIssue(new HttpStatusError(403, 'https://capri.wd1.myworkdayjobs.com/wday/cxs/capri/Versace/jobs'))],
    ['refus 406 (Avature)', ingestionIssue(new HttpStatusError(406, 'https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=0'))],
    ['429', ingestionIssue(new HttpStatusError(429, 'https://example.test/jobs'))],
    ['5xx non prouvé', ingestionIssue(new HttpStatusError(503, 'https://example.test/jobs'))],
    ['5xx prouvé (non bloquant)', { origin: 'SOURCE', code: 'HTTP_503', count: 1, captureBatchId: 'b', rawCaptureId: 'r' }],
    ['délai', ingestionIssue(new Error('__TIMEOUT__ ulta-jibe'))],
    ['certificat TLS', { origin: 'UNKNOWN', code: 'TRANSPORT_UNABLE_TO_VERIFY_LEAF_SIGNATURE', count: 1 }],
    ['« DATABASE_FAILURE » qui ne vient pas de notre client', { origin: 'UNKNOWN', code: 'DATABASE_FAILURE', count: 1 }],
  ];
  it.each(never)('%s n’est jamais passagère', (_, issue) => {
    expect(transientKind(issue)).toBeNull();
    expect(remediationOf('s', issue).retry).toBe(false);
  });

  it('un refus d’accès dont le message parle de transaction n’est jamais repris (audit D-520)', () => {
    for (const code of ['ACCESS_DENIED', 'ACCESS_SCOPE', 'ACCESS_INVALID', 'ACCESS_STALE'] as const) {
      const error = new SourceAccessGateError(code, `Access qualification refused: ${transaction}`);
      const r = remediationOf('diptyque-workday', ingestionIssue(error), error.message);
      expect(r.cause, code).toBe('QUALIFICATION_REFUSEE');
      expect(r.retry, code).toBe(false);
    }
  });
});

describe('la remédiation : la classe et ce qui manque viennent de sourceState ; la reprise, d’ici', () => {
  it('la classe et la trajectoire sont celles du vocabulaire unique', () => {
    for (const issue of [database, transport, { origin: 'UNKNOWN', code: 'ENUMERATION_NOT_PROVEN', count: 1 } as IngestionIssue]) {
      const r = remediationOf('s', issue);
      expect(r.cause).toBe(issueCause(issue));
      expect(r.trajectory).toBe(CAUSES[r.cause!].trajectory);
    }
  });

  it('première panne de base : reprise dans ce RUN', () => {
    const r = remediationOf('browns-shoes', database, transaction);
    expect(r).toMatchObject({ cause: 'DEFAUT_INTERNE', transient: 'DATABASE', retry: true, seenAtPreviousRun: false });
    expect(r.expected).toMatch(/^reprise une fois en fin de RUN ; sinon : /);
  });

  it('déjà là au RUN complet précédent : plus de reprise, à réparer', () => {
    const r = remediationOf('rolex', transport, null, new Set(['TRANSPORT']));
    expect(r).toMatchObject({ retry: false, trajectory: 'A_REPARER', seenAtPreviousRun: true });
    expect(remediationNote(r)).toContain('déjà là au RUN complet précédent');
  });

  it('une autre famille au RUN précédent ne compte pas', () => {
    expect(remediationOf('rolex', transport, null, new Set(['DATABASE'])).retry).toBe(true);
  });

  it('reprise échouée : à réparer, jamais reprise deux fois', () => {
    const r = remediationOf('rolex', transport, null, new Set(), true);
    expect(r).toMatchObject({ retry: false, retryFailed: true, trajectory: 'A_REPARER' });
    expect(remediationNote(r)).toContain('reprise échouée');
  });

  it('un échec connu décidé (D-480 §1) reste décidé, et lui seul', () => {
    expect(remediationOf('l-oreal-professionnel', { origin: 'UNKNOWN', code: 'HttpStatusError', count: 1, detail: 'HTTP_406' }))
      .toMatchObject({ trajectory: 'DECISION', decided: 'D-480', retry: false });
    expect(remediationOf('l-oreal-professionnel', { origin: 'UNKNOWN', code: 'HttpStatusError', count: 1, detail: 'HTTP_403' }).trajectory).not.toBe('DECISION');
  });

  it('une retenue prouvée par la source n’est pas un défaut', () => {
    expect(remediationOf('levis', { origin: 'SOURCE', code: 'NATIVE_RETENTION', count: 3, captureBatchId: 'b', completionReportHash: 'h' }))
      .toMatchObject({ cause: null, trajectory: null, retry: false });
  });
});

describe('l’alerte dit, pour chaque source bloquante, où elle va et ce qui manque', () => {
  it('une source non collectée porte sa ligne de trajectoire dans son bloc', async () => {
    const { alertHtml } = await import('./alert.js');
    const persistent = remediationOf('browns-shoes', database, transaction, new Set(['DATABASE']));
    const html = alertHtml({ degraded: 0, broken: 1, incidents: [{ source: 'browns-shoes', status: 'BROKEN', jobs: 0, previous: 70, notCollected: true,
      note: 'INTERNAL/DATABASE_FAILURE: Transaction already closed', remediation: [remediationLine(persistent)] }] });
    expect(html).toContain(`${CAUSES.DEFAUT_INTERNE.label} → à réparer`);
    expect(html).toContain('déjà là au RUN complet précédent');
  });
});
