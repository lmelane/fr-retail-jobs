import { describe, expect, it } from 'vitest';
import { designatesMaison, isGroupPortal } from '../ordinaryIdentity.js';
import { escalationDeadline, identityQuestion, queueEntries, type QueueSource } from '../reviewQueue.js';
import { isNonBlockingIssue } from '../../lib/ingestionIssue.js';
import { failureLine } from '../../lib/runSummary.js';
import { MOTIFS_IDENTITE } from '../errors.js';

/** D-520, classe identité d'employeur : les règles pures, sur les cas réels mesurés du 24/09 au 01/10. */
describe('même Maison du registre (R-143 §5)', () => {
  it('reconnaît les graphies de la Maison et ses entités, jamais une autre société', () => {
    // b-s-international : le registre « B's International », l'éditeur « B&S International » (mêmes mots).
    expect(designatesMaison('B&S International', "B's International")).toBe(true);
    // puma : « PUMA North America, Inc. » et « PUMA SE » prolongent tous deux « Puma ».
    expect(designatesMaison('PUMA North America, Inc.', 'Puma')).toBe(true);
    expect(designatesMaison('puma se', 'Puma')).toBe(true);
    // funky-buddha : l'entité juridique ne porte pas le nom de la Maison, elle va en revue.
    expect(designatesMaison('ALTEX S.A.', 'Funky Buddha')).toBe(false);
    // Un mot qui commence comme la Maison n'est pas la Maison.
    expect(designatesMaison('Pumatech GmbH', 'Puma')).toBe(false);
    expect(designatesMaison('Swatch', 'Swatch Group')).toBe(false);
    expect(designatesMaison('anything', '')).toBe(false);
  });
  it('n’applique jamais la règle sur un portail de groupe', () => {
    expect(isGroupPortal({ maison: 'LVMH (toutes Maisons)', portalScope: 'MULTI_BRAND' })).toBe(true);
    expect(isGroupPortal({ maison: 'Tapestry (Coach, Kate Spade, Stuart Weitzman)', portalScope: null })).toBe(true);
    expect(isGroupPortal({ maison: "B's International", portalScope: 'SINGLE_BRAND' })).toBe(false);
  });
});

const portal: QueueSource = { key: 'tiffany-oracle', maison: 'Tiffany & Co.', tier: 'EMPLOYER_DIRECT', portalScope: null, careersDomain: 'eljs.fa.us2.oraclecloud.com' };

describe('la file de revue : une entrée par libellé, la preuve qui manque, la question précise', () => {
  it('regroupe les offres d’un même libellé et motif, sans employeur en jeu pour un portail non relu', () => {
    const refusals = ['63299', '63300', '63299'].map(externalId => ({ externalId, rawEmployerName: 'Tiffany & Co.',
      proposedName: 'PORTAL_OWNER_NOT_CERTIFIED', motif: 'PORTAL_OWNER_NOT_CERTIFIED' as const }));
    const [entry, ...rest] = queueEntries(portal, refusals);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ motif: 'PORTAL_OWNER_NOT_CERTIFIED', normalizedLabel: 'tiffany & co.', proposedKey: '', proposedName: null,
      offers: 2, sampleExternalIds: ['63299', '63300'] });
    expect(entry.question).toBe('Le portail tiffany-oracle (registre « Tiffany & Co. », eljs.fa.us2.oraclecloud.com) publie-t-il pour un seul employeur '
      + '(SINGLE_BRAND) ou pour plusieurs enseignes d’un groupe (MULTI_BRAND) ? Offres sans employeur nommé : 2. Une fois le portail relu, elles publient sous « Tiffany & Co. ».');
  });
  it('sépare deux employeurs en jeu pour un même libellé, et pose la question d’un job board autrement', () => {
    const swatch = queueEntries({ ...portal, key: 'swatch-group', maison: 'Swatch Group' }, [
      { externalId: '33197', rawEmployerName: 'Swatch', proposedName: 'Flik Flak', motif: 'EMPLOYER_SPELLING_DIVERGED' },
      { externalId: '40000', rawEmployerName: 'Swatch', proposedName: 'Omega', motif: 'EMPLOYER_SPELLING_DIVERGED' }]);
    expect(swatch.map(e => e.proposedKey).sort()).toEqual(['flik flak', 'omega']);
    expect(swatch[0].question).toMatch(/^Sur 1 offre de swatch-group \(registre « Swatch Group »\), l’éditeur nomme désormais « Swatch » à la place de « (Flik Flak|Omega) »/);
    const board = identityQuestion({ ...portal, key: 'luxe-talent', tier: 'SPECIALIST_JOBBOARD' },
      { motif: 'PORTAL_OWNER_NOT_CERTIFIED', rawLabel: 'Luxe Talent', proposedName: null, offers: 477 });
    expect(board.question).toContain('luxe-talent est un job board ; offres sans employeur nommé : 477.');
    expect(board.missingProof).toContain('R-142 §1');
  });
  it('a une question pour chaque motif, sans tiret cadratin (D-319)', () => {
    for (const motif of MOTIFS_IDENTITE) {
      const text = identityQuestion(portal, { motif, rawLabel: 'X', proposedName: 'Y', offers: 3 });
      expect(text.question.length).toBeGreaterThan(30);
      expect(text.missingProof.length).toBeGreaterThan(10);
      expect(`${text.question}${text.missingProof}`).not.toContain('—');
    }
  });
  it('escalade à 7 jours, ou 48 h quand la source ne publie plus rien (échéances de sourceState.ts)', () => {
    const t0 = new Date('2026-09-24T16:00:00Z');
    expect(escalationDeadline(t0, 12).toISOString()).toBe('2026-10-01T16:00:00.000Z');
    expect(escalationDeadline(t0, 0).toISOString()).toBe('2026-09-26T16:00:00.000Z');
  });
});

describe('un employeur à identifier ne fait plus échouer le RUN', () => {
  const issue = { origin: 'UNKNOWN' as const, code: 'EmployerIdentityReviewRequired', count: 463 };
  it('l’issue est non bloquante et la ligne du bilan dit pourquoi', () => {
    expect(isNonBlockingIssue('tiffany-oracle', issue)).toBe(true);
    expect(failureLine('tiffany-oracle', [issue], 'erreurs d’ingestion')).toBe('tiffany-oracle (non bloquant : employeur à identifier, 463 offres retenues en file de revue (D-520))');
  });
  it('une autre issue de la même source reste bloquante', () => {
    const other = { origin: 'UNKNOWN' as const, code: 'ENUMERATION_NOT_PROVEN', count: 1 };
    expect(isNonBlockingIssue('tiffany-oracle', other)).toBe(false);
    expect(failureLine('tiffany-oracle', [issue, other], 'erreurs d’ingestion')).toBe('tiffany-oracle (bloquant : erreurs d’ingestion)');
  });
});
