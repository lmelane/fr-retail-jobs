import { describe, expect, it } from 'vitest';
import { extractEmployment } from '../employment.js';
import { resolveCanonicalDimensions } from '../../trust/resolve.js';
import { contratWttj } from '../../ats/adapters/wttj.js';

/**
 * R-143 §6 et §8 (D-513, lecture D-492 du 02/10/2026) — LE CONTRAT LU DANS LES PREUVES NATIVES, JAMAIS DEVINÉ.
 *
 * Chaque cas vient d'une offre servie relue le 02/10 (`audits/2026-10-02/r143-filtres-alertes/`). Les témoins de
 * précision protègent les alertes « CDI » : une description qui annonce un CDD et promet un CDI « à l'issue » est un CDD ;
 * une description qui nomme les deux sans trancher n'en dit aucun. Les témoins de rappel lisent les formules complètes
 * des langues servies et les libellés natifs de WTTJ et d'Eightfold.
 */
const terme = (description: string, title = 'Conseiller de vente') => extractEmployment(title, description).employmentTerm;

describe('la description ne tranche que si elle déclare UNE durée', () => {
  it('un CDD de Noël qui promet un CDI « à l’issue » est un CDD (servi comme CDI avant D-513)', () => {
    const noel = 'Nous recherchons des conseillers de vente enthousiastes pour enchanter les fêtes de fin d’année ! Nous te proposons un CDD. '
      + 'Si tu fais partie des plus motivés de la saison et que nous avons des postes à pourvoir, nous pourrions te proposer un CDI à l’issue de ton contrat.';
    expect(terme(noel)).toBe('FIXED_TERM');
  });
  it('« CDI ou CDD selon votre expérience » ne dit rien', () => {
    expect(terme('Informations pratiques • CDI ou CDD selon votre expérience et vos attentes, à temps plein')).toBeUndefined();
    expect(terme('Nous recrutons régulièrement sur des postes de Responsable de vente H/F en CDI et CDD.')).toBeUndefined();
  });
  it('une perspective ou une négation n’est pas une durée', () => {
    expect(terme('Mission pouvant déboucher sur un CDI.')).toBeUndefined();
    expect(terme('There is a possibility of a permanent position after the season.')).toBeUndefined();
    expect(terme('Ce poste n’est pas un CDD.')).toBeUndefined();
  });
  it('un mot nu qui ne qualifie pas un contrat ne compte pas', () => {
    expect(terme('Experience in permanent makeup and brows is a plus.')).toBeUndefined();
    expect(terme('Our temporary pop-up store opens in December.')).toBeUndefined();
  });
});

describe('les formules complètes des langues servies', () => {
  it.each([
    ['Contrat à durée indéterminée, 35 heures.', 'PERMANENT'],
    ['Contratto a tempo indeterminato, full time.', 'PERMANENT'],
    ['Contratto a tempo determinato di 6 mesi.', 'FIXED_TERM'],
    ['Wir bieten einen unbefristeten Arbeitsvertrag.', 'PERMANENT'],
    ['Die Stelle ist zunächst auf 12 Monate befristet.', 'FIXED_TERM'],
    ['Ofrecemos contrato indefinido.', 'PERMANENT'],
    ['Wij bieden een vast contract.', 'PERMANENT'],
    ['This is a permanent, full-time position based in London.', 'PERMANENT'],
    ['This is a 12-month fixed-term contract covering maternity leave.', 'FIXED_TERM'],
  ])('%s → %s', (description, attendu) => {
    expect(terme(description)).toBe(attendu);
  });
});

describe('les libellés natifs des sources', () => {
  it('WTTJ : `full_time` est affiché « CDI » par WTTJ, `part_time` ne dit aucune durée', () => {
    expect(contratWttj('full_time')).toBe('CDI');
    expect(contratWttj('temporary')).toBe('CDD / Temporaire');
    expect(contratWttj('part_time')).toBe('Temps partiel');
    expect(contratWttj('inconnu')).toBe('inconnu');
    const cdi = resolveCanonicalDimensions({ sourceKey: 'wttj-sector', title: 'Sales Associate', contract: contratWttj('full_time'), raw: { contract_type: 'full_time' } });
    expect(cdi.employmentTerm).toBe('PERMANENT');
    const partiel = resolveCanonicalDimensions({ sourceKey: 'wttj-sector', title: 'Conseiller de vente 14h', contract: contratWttj('part_time'), raw: { contract_type: 'part_time' } });
    expect(partiel.employmentTerm).toBeUndefined();
    expect(partiel.workTime).toBe('PART_TIME');
  });
  it('Eightfold : le sous-type de travailleur déclaré est lu, « Agency » ne dit rien', () => {
    const lire = (v: string) => resolveCanonicalDimensions({ sourceKey: 'estee-lauder-companies', title: 'Beauty Advisor', raw: { eightfoldDetail: { efcustomTextWorkerSubtype: [v] } } });
    expect(lire('Regular').employmentTerm).toBe('PERMANENT');
    expect(lire('Fixed Term (Fixed Term)').employmentTerm).toBe('FIXED_TERM');
    expect(lire('Agency').employmentTerm).toBeUndefined();
  });
  it('un intitulé explicite contraire au champ structuré reste « non précisé » (garde existante)', () => {
    const r = resolveCanonicalDimensions({ sourceKey: 'sandro', title: 'Conseiller de vente - CDD - Nice', contract: 'Permanent' });
    expect(r.employmentTerm).toBeUndefined();
  });
});
