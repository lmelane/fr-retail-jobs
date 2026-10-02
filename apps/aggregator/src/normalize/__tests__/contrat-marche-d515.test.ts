import { describe, expect, it } from 'vitest';
import { extractEmployment, readEmployment } from '../employment.js';
import { resolveCanonicalDimensions } from '../../trust/resolve.js';
import { EMPLOYMENT_LABELS, LANGUES_LIBELLES, employmentLabel } from '@catwalks/db/presentation';

/**
 * D-515 §3 (lecture D-492 du 02/10/2026) — LE CONTRAT SE LIT PAR MARCHÉ : « CDI » vaut l'intention d'emploi permanent, et
 * chaque marché la dit dans sa langue. Chaque cas vient d'une offre servie relue le 02/10
 * (`audits/2026-10-02/alertes-deux-temps/contrat-extraits-natifs.tsv`). La reconnaissance reste sur preuve native : une
 * perspective (« passage possible en poste permanent ») ou un temps de travail seul ne deviennent jamais un contrat.
 */
const terme = (description: string, title = 'Sales Advisor') => extractEmployment(title, description).employmentTerm;

describe('les équivalents locaux du CDI, sur preuve native', () => {
  it.each([
    ['Contratto a Tempo Indeterminato - Assistant Store Manager (F/M)', 'PERMANENT'],
    ['Contratto a Tempo Determinato - Addetto vendite', 'FIXED_TERM'],
    ['販売スタッフ（正社員）', 'PERMANENT'],
    ['セールスアドバイザー正社員(H&M 富山)', 'PERMANENT'],
    ['CRM & Promotion Manager (정규직)', 'PERMANENT'],
    ['Store Manager (계약직)', 'FIXED_TERM'],
    ['Verkäufer (m/w/d) in Festanstellung', 'PERMANENT'],
  ])('intitulé « %s » → %s', (title, attendu) => {
    expect(readEmployment(title).employmentTerm).toBe(attendu);
  });

  it.each([
    ['雇用契約期間：無期雇用契約（正社員）​  試用期間:3～6か月間', 'PERMANENT'],
    ['その他の情報​  雇用契約期間：有期労働契約（アルバイト）​  試用期間:3～', 'FIXED_TERM'],
    ['Sales Advisor 포지션은 주당 20/30 시간의 정규직 파트타임이며 주말과 저녁 교대 근무를 포함합니다.', 'PERMANENT'],
    ['• 근무형태: 계약직 (정규직 전환 가능) • 근무일시: 주 5일', 'FIXED_TERM'],
    ['Tjänsten är en tillsvidareanställning på 9 timmar per vecka.', 'PERMANENT'],
  ])('description « %s » → %s', (description, attendu) => {
    expect(terme(description)).toBe(attendu);
  });
});

describe('une perspective, une exigence ou deux durées ne sont jamais un contrat', () => {
  it.each([
    // Japon : « 正社員 » dans une description nomme presque toujours une perspective ou une exigence.
    ['• 社会保険（契約時間による） • 正社員登用制度 • インセンティブプログラム'],
    ['• 正社員を目指して働きたい学生（高校卒業以上）やフリーターの方'],
    ['・学歴不問 ・男女不問 ・正社員での就労経験3年以上'],
    // Corée : « 정규직 , 계약직 » nomme deux durées et ne tranche rien.
    ['ㆍ근무형태 : 정규직 , 계약직    ㆍ근무일시 : 주 5 일'],
    // Pays-Bas : la perspective d'un contrat permanent après un contrat d'un an (lue « vast contract » avant D-515).
    ['• Een jaarcontract met daarna de optie tot een vast contract • 25 vakantiedagen'],
    ['• Een tijdelijk contract met uitzicht op een vast dienstverband.'],
    ['• We bieden een job met uitzicht op vast dienstverband, met een salaris afhankelijk van je ervaring'],
    // Danemark : une embauche permanente qui « dépend du besoin » après un renfort de Noël.
    ['En fastansættelse afhænger af behovet, men en stor del af vores juleassistancer'],
    // Norvège : le gabarit de Glitter dit « fast stilling » sous un intitulé de renfort de Noël.
    ['Vi søker julehjelp. Dette er en fast stilling. Glitter har 1 måneders prøvetid.'],
  ])('« %s » → non précisé', (description) => {
    expect(terme(description)).not.toBe('PERMANENT');
  });

  it('« Full-time » seul est un temps de travail, jamais un contrat', () => {
    for (const valeur of ['Full-time', 'FULL_TIME', 'Full Time', 'Tempo pieno', 'Vollzeit', 'フルタイム']) {
      const r = resolveCanonicalDimensions({ sourceKey: 'any-ats', title: 'Sales Associate', contract: valeur });
      expect(r.employmentTerm, valeur).toBeUndefined();
    }
    expect(readEmployment('Full-time').workTime).toBe('FULL_TIME');
  });

  it('le témoin éprouve sa prémisse : sans l’assertion « 登用 », la perspective japonaise serait lue permanente', () => {
    // Le mot seul est bien une forme reconnue en intitulé : c'est l'assertion qui écarte la perspective.
    expect(readEmployment('正社員').employmentTerm).toBe('PERMANENT');
    expect(readEmployment('正社員登用あり').employmentTerm).toBeUndefined();
    expect(readEmployment('정규직 전환 가능').employmentTerm).toBeUndefined();
  });
});

describe('le libellé du contrat est celui de la langue du marché', () => {
  it('aucune langue autre que le français ne montre « CDI » ni « CDD » (le vietnamien les montrait)', () => {
    for (const langue of LANGUES_LIBELLES) {
      if (langue === 'fr') continue;
      const libelles = Object.values(EMPLOYMENT_LABELS[langue].employmentTerm);
      expect(libelles, langue).not.toContain('CDI');
      expect(libelles, langue).not.toContain('CDD');
    }
    expect(employmentLabel('employmentTerm', 'PERMANENT', 'vi')).toBe('Không xác định thời hạn');
    expect(employmentLabel('employmentTerm', 'PERMANENT', 'fr', 'CA')).toBe('Permanent');
    expect(employmentLabel('employmentTerm', 'PERMANENT', 'de')).toBe('Unbefristet');
    expect(employmentLabel('employmentTerm', 'PERMANENT', 'it')).toBe('Tempo indeterminato');
    expect(employmentLabel('employmentTerm', 'PERMANENT', 'es')).toBe('Indefinido');
  });
});
