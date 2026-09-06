import { describe, expect, it } from 'vitest';
import { mergeJobylonJob, parseJobylonEmbed } from './jobylon.js';

/** Extrait du littéral `cdn.jobylon.com/jobs/companies/2631/embed/v2/` (Acne Studios, capturé le 2026-09-06). */
const EMBED = `
JBL.embed_v2['companies'] = [ 'Acne Studios', ];
JBL.embed_v2['jobs'] = [
    {
        id: '379770',
        url: '/jobs/379770-acne-studios-supply-chain-planner-japan/',
        title: 'Supply Chain Planner (Japan)',
        company: 'Acne Studios',
        company_id: '2631',
        logo:  'https://media-eu.jobylon.com/x.jpg',
        klass: { 'job-id-379770': true, 'job-lang-en': true, },
        layers: { 'layers_1': [ 'Japan', ], 'layers_2': [ 'Acne Aoyama Co Ltd', ], 'layers_5': [ '1750 \\u002D Supply\\u002DChain JP', ], },
    },
    {
        id: '380001',
        url: '/jobs/380001-acne-studios-sales-assistant-paris/',
        title: 'Sales Assistant \\u0027Marais\\u0027',
        company: 'Acne Studios',
        layers: { 'layers_1': [ 'France', ], },
    },
    {
        id: '379770',
        url: '/jobs/379770-acne-studios-supply-chain-planner-japan/',
        title: 'Doublon',
    },
];
JBL.embed_v2['locations'] = [ 'Paris', ];`;

/** Page publique `emp.jobylon.com/jobs/379770-…/` : le JSON-LD tel que capturé. */
const DETAIL = `<html><head><script type="application/ld+json">{"@context":"http://schema.org","@type":"JobPosting",
"datePosted":"2026-09-04T01:08:58+00:00","title":"Supply Chain Planner (Japan)",
"description":"<p>Acne Studios is a progressive luxury house. ${'Long text. '.repeat(30)}</p>",
"hiringOrganization":{"@type":"Organization","name":"Acne Studios","sameAs":"https://www.acnestudios.com/"},
"jobLocation":[{"@type":"Place","address":{"@type":"PostalAddress","streetAddress":"Tokyo, Japan","addressLocality":"","addressCountry":"JP"}}]}</script></head></html>`;

describe('parseJobylonEmbed', () => {
  it('lit identifiant, chemin, titre, société et pays depuis le littéral JavaScript', () => {
    const rows = parseJobylonEmbed(EMBED);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      externalId: '379770',
      path: '/jobs/379770-acne-studios-supply-chain-planner-japan/',
      title: 'Supply Chain Planner (Japan)',
      company: 'Acne Studios',
      country: 'Japan',
    });
  });

  it('décode les échappements \\uXXXX du littéral (apostrophe, tiret)', () => {
    const [, second] = parseJobylonEmbed(EMBED);
    expect(second.title).toBe("Sales Assistant 'Marais'");
  });

  it('déduplique un identifiant répété', () => {
    expect(parseJobylonEmbed(EMBED).map((r) => r.externalId)).toEqual(['379770', '380001']);
  });

  it('rend [] quand le littéral est absent, pour que l’adaptateur refuse un widget vide', () => {
    expect(parseJobylonEmbed('<html>rien</html>')).toEqual([]);
  });
});

describe('mergeJobylonJob', () => {
  const [row] = parseJobylonEmbed(EMBED);
  const url = 'https://emp.jobylon.com/jobs/379770-acne-studios-supply-chain-planner-japan/';

  it('garde l’identifiant Jobylon et prend description, date et lieu du JSON-LD', () => {
    const job = mergeJobylonJob(row, DETAIL, url);
    expect(job.externalId).toBe('379770');
    expect(job.url).toBe(url);
    expect(job.title).toBe('Supply Chain Planner (Japan)');
    expect(job.description?.length ?? 0).toBeGreaterThan(200);
    expect(job.postedAt?.toISOString()).toBe('2026-09-04T01:08:58.000Z');
    expect(job.location).toContain('Tokyo');
  });

  it('retombe sur la ligne de liste quand la page détail est vide', () => {
    const job = mergeJobylonJob(row, '', url);
    expect(job.title).toBe('Supply Chain Planner (Japan)');
    expect(job.country).toBe('Japan');
    expect(job.location).toBe('Japan');
    expect(job.description).toBeUndefined();
  });
});
