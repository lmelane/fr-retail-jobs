import { describe, expect, it } from 'vitest';
import { careerCandidates } from './careerLinks.js';
describe('global career discovery signals', () => {
  it('finds observed international career labels and encoded paths', () => {
    const labels = ['Karriere', 'Stellenangebote', 'Lavora con noi', 'Trabaja con nosotros', 'Carreiras', 'Werken bij', '採用情報', '招聘', '채용', 'Вакансии'];
    for (const label of labels) expect(careerCandidates(`<a href="/${encodeURIComponent(label)}">${label}</a>`, 'https://example.com')).toHaveLength(1);
    expect(careerCandidates('<a href="/karriere">Mehr erfahren</a>', 'https://example.com')).toHaveLength(1);
  });
  it('preserves regional links and image accessibility labels', () => {
    const html = '<a href="https://de.example.com/stellenangebote">Deutschland</a><a href="https://jp.example.com/%E6%8E%A1%E7%94%A8">日本</a><a href="/openings" aria-label="Careers"><img></a>';
    expect(careerCandidates(html, 'https://example.com')).toHaveLength(3);
  });
  it('does not classify consumer talent programmes, substrings or mailto as career portals', () => {
    const html = '<a href="/loyalty">Talent</a><a href="/account">Talent</a><a href="/blog">Jobson</a><a href="mailto:jobs@example.com">Jobs</a><a href="/newsletter">Careers newsletter</a>';
    expect(careerCandidates(html, 'https://example.com')).toHaveLength(0);
  });
  it('reads the HTML fallback supplied by the publisher inside noscript', () => {
    expect(careerCandidates('<noscript><a href="https://brand.jobs.personio.de/">Karriere</a></noscript>', 'https://brand.example').map(x => x.to)).toEqual(['https://brand.jobs.personio.de/']);
  });
  it('retains custom career hosts and named ATS sites even without a separated keyword', () => {
    const links = ['https://www.opticalexpresscareers.co.uk/', 'https://www.signetjobs.co.uk/', 'https://aesop.wd3.myworkdayjobs.com/aesopcareers', 'https://www.groupe-printemps.com/nos-offres-demploi-et-de-stage'];
    for (const href of links) expect(careerCandidates(`<a href="${href}">Découvrir</a>`, 'https://example.com')).toHaveLength(1);
  });
});
