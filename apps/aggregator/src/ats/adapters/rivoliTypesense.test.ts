import { describe, expect, it } from 'vitest';
import { docToJob, mergeVacancyLocales, parseVacancyPage, vacancySlug, type VacancyDoc } from './rivoliTypesense.js';

/** Trois documents tels que typesense.rivoligroup.com/collections/vacancy les sert (capturés le 2026-09-06, tronqués). */
const EN: VacancyDoc = {
  id: '19793',
  title: 'Senior Manager – E-Commerce',
  url: 'https://www.rivoligroup.com/careers/vacancies/senior-manager-marketing-ecommerce',
  page_locale: 'en_AE',
  job_location: ['Dubai'],
  department: 'Marketing',
  public_date_time_stamp: 1787515200,
  page_index_content: 'Apply for this position\n\n The Senior Manager – E-commerce is fully accountable for the end-to-end commercial performance.',
};
const AR_SAME: VacancyDoc = {
  id: '19806',
  title: 'مدير أول للتسويق والتجارة الإلكترونية',
  url: 'https://www.rivoligroup.com/ar/careers/vacancies/senior-manager-marketing-ecommerce',
  page_locale: 'ar_AE',
  job_location: ['Dubai'],
};
const AR_ONLY: VacancyDoc = {
  id: '18260',
  title: 'مساعد مبيعات - للمواطنيين الإماراتيين',
  url: 'https://www.rivoligroup.com/ar/careers/vacancies/Sales-Associate-EmiratiNationals',
  page_locale: 'ar_AE',
  job_location: ['Dubai', 'UAE'],
  public_date_time_stamp: '1787515200',
};

describe('mergeVacancyLocales', () => {
  it('fusionne les versions arabe et anglaise d’une même offre en gardant l’anglais', () => {
    const merged = mergeVacancyLocales([AR_SAME, EN, AR_ONLY]);
    expect(merged).toHaveLength(2);
    expect(merged.find((d) => d.id === '19793')).toBeDefined();
    expect(merged.find((d) => d.id === '19806')).toBeUndefined();
  });

  it('garde une offre qui n’existe qu’en arabe', () => {
    expect(mergeVacancyLocales([AR_ONLY]).map((d) => d.id)).toEqual(['18260']);
  });

  it('conserve la casse du slug pour l’URL — la minuscule répond 404 chez Rivoli', () => {
    expect(vacancySlug(AR_ONLY.url)).toBe('Sales-Associate-EmiratiNationals');
    expect(docToJob(AR_ONLY).externalId).toBe('sales-associate-emiratinationals');
  });
});

describe('docToJob', () => {
  it('lit titre, lieu, service, date et description du document', () => {
    const job = docToJob(EN);
    expect(job.title).toBe('Senior Manager – E-Commerce');
    expect(job.location).toBe('Dubai');
    expect(job.department).toBe('Marketing');
    expect(job.postedAt?.toISOString().slice(0, 10)).toBe('2026-08-23');
    expect(job.description).toContain('end-to-end commercial performance');
    expect(job.url).toBe(EN.url);
  });

  it('joint plusieurs lieux et accepte l’horodatage en chaîne', () => {
    const job = docToJob(AR_ONLY);
    expect(job.location).toBe('Dubai, UAE');
    expect(job.postedAt?.toISOString().slice(0, 10)).toBe('2026-08-23');
  });

  it('applique le titre, la description et l’URL de la page anglaise quand on les a', () => {
    const job = docToJob(AR_SAME, { title: 'Senior Manager - Brands', description: 'Long text', url: 'https://www.rivoligroup.com/careers/vacancies/x' });
    expect(job.title).toBe('Senior Manager - Brands');
    expect(job.url).toBe('https://www.rivoligroup.com/careers/vacancies/x');
  });
});

describe('parseVacancyPage', () => {
  it('lit le h1 et le bloc de texte de la page de détail', () => {
    const page = parseVacancyPage(`
      <main><div class="page-wrap vacancies--detail">
        <section><h1 class="text-uppercase m-0 "> Senior Manager - Brands</h1></section>
        <section><div class="co-7"><div class="default-text-block"><h3>the job</h3><p>The primary role of the Senior Manager will be to manage a diverse portfolio of fashion watch brands.</p></div></div></section>
      </div></main>`);
    expect(page.title).toBe('Senior Manager - Brands');
    expect(page.description).toContain('portfolio of fashion watch brands');
    expect(page.description).not.toContain('<');
  });
});
