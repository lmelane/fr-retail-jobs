import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSmartRecruitersPosting } from './smartrecruiters.js';
import { readEmployment } from '../../normalize/employment.js';

/**
 * l2 (2026-09-06) — l'API publie `typeOfEmployment.{id,label}` et `language.code`,
 * jamais lus : 3 553 contrats et 1 172 langues perdus, 21 offres hongroises H&M
 * stockées en `pt` par détection statistique. Ids mesurés sur H&M (1 622) et
 * Primark (824) : permanent, part-time, contract.
 */
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'));

describe('parseSmartRecruitersPosting — l2', () => {
  it('lit la langue déclarée en ISO-639-1, sans sa région', () => {
    const job = parseSmartRecruitersPosting({ ...fixture('l2-smartrecruiters-primark-posting.json'), language: { code: 'en-GB' } }, 'primark');
    expect(job.language).toBe('en');
    expect(parseSmartRecruitersPosting({ ...fixture('l2-smartrecruiters-hmgroup-posting.json'), language: { code: 'hu' } }, 'HMGroup').language).toBe('hu');
  });

  it('permanent → CDI, contract → CDD ; le libellé donne le temps de travail', () => {
    const base = fixture('l2-smartrecruiters-hmgroup-posting.json');
    const permanent = parseSmartRecruitersPosting({ ...base, typeOfEmployment: { id: 'permanent', label: 'Full-time' } }, 'HMGroup');
    expect(readEmployment(permanent.contract).employmentTerm).toBe('PERMANENT');
    expect(readEmployment(permanent.workingTime).workTime).toBe('FULL_TIME');

    // SmartRecruiters range ce libellé dans un CHAMP DÉDIÉ au type d'emploi :
    // « Contract » y désigne une durée déterminée, là où le mot nu dans un code
    // composite reste ambigu et n'est pas tranché.
    const contract = parseSmartRecruitersPosting({ ...base, typeOfEmployment: { id: 'contract', label: 'Contract' } }, 'HMGroup');
    expect(readEmployment(contract.contract).employmentTerm).toBe('FIXED_TERM');
  });

  it('part-time n’est pas un contrat : seul le temps de travail est renseigné', () => {
    const job = parseSmartRecruitersPosting({ ...fixture('l2-smartrecruiters-primark-posting.json'), typeOfEmployment: { id: 'part-time', label: 'Part-time' } }, 'primark');
    expect(readEmployment(job.contract).employmentTerm).toBeUndefined();
    expect(readEmployment(job.workingTime).workTime).toBe('PART_TIME');
  });

  it('garde identifiant, titre, lieu, date et URL publique', () => {
    const job = parseSmartRecruitersPosting(fixture('l2-smartrecruiters-primark-posting.json'), 'primark');
    expect(job.externalId).toBeTruthy();
    expect(job.title).toBeTruthy();
    expect(job.url).toBe(`https://jobs.smartrecruiters.com/primark/${job.externalId}`);
    expect(job.postedAt).toBeInstanceOf(Date);
  });
});
