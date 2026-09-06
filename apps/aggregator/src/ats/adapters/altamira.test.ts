import { describe, expect, it } from 'vitest';
import { parseAltamiraDetail, parseAltamiraListing } from './altamira.js';

/** Deux lignes de careers.zegnagroup.com/default?FreeSearch= (capturées le 2026-09-06). */
const LISTING = `
<a href="/jobs/job-details?JobID=272432342&Team=242459886" class="">
  <div class="tableJobs__row">
    <div class="tableJobs__cell tableJobs__cell--medium"> <span class="tableJobs__cellText tableJobs__cellText--bold"> <img src="/documents/16241716" onerror="this.style.display='none'" /> </span> </div>
    <div class="tableJobs__cell tableJobs__cell--big"><span class="tableJobs__cellText tableJobs__cellText--bold"> Su Misura Customer Service Associate </span></div>
    <div class="tableJobs__cell tableJobs__headCell--big"><span class="tableJobs__cellText"> New York , United States </span> <span class="tableJobs__cellText tableJobs__cellText--hideBig"> <!-- Other/Other --> </span></div>
  </div>
</a>
<a href="/jobs/job-details?JobID=273015700&amp;Team=231361273" class="">
  <div class="tableJobs__row">
    <div class="tableJobs__cell tableJobs__cell--big"><span class="tableJobs__cellText tableJobs__cellText--bold"> Assistant General Manager </span></div>
    <div class="tableJobs__cell tableJobs__headCell--big"><span class="tableJobs__cellText"> Scottsdale , United States </span></div>
  </div>
</a>
<a href="/jobs/job-details?JobID=272432342&Team=242459886" class=""><div class="tableJobs__row"><span class="tableJobs__cellText tableJobs__cellText--bold"> Doublon </span></div></a>`;

/** Les cellules `data-title` de la fiche JobID=272432342, telles que rendues. */
const DETAIL = `
<td data-title="Title"><span class="LABLE">Su Misura Customer Service Associate</span></td>
<td data-title="Locations"><div class="LABLE">United States/NY/New York</div></td>
<td data-title="Brand"><span class="LABLE">Zegna</span></td>
<td data-title="Contract type"><span class="LABLE">Permanent Job</span></td>
<td data-title="JOB FUNCTION"><span class="LABLE">Other/Other</span></td>
<td data-title="Text"><div class="LABLE"><span><strong>ABOUT ZEGNA</strong></span><br><br>
<span>The global leader in luxury menswear, ZEGNA was founded in the Italian Alps in 1910. ${'Role text. '.repeat(30)}</span></div></td>`;

describe('parseAltamiraListing', () => {
  it('lit identifiant, équipe, titre et lieu de chaque ligne, avec & brut ou encodé', () => {
    const rows = parseAltamiraListing(LISTING);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      externalId: '272432342',
      team: '242459886',
      title: 'Su Misura Customer Service Associate',
      location: 'New York, United States',
    });
    expect(rows[1].externalId).toBe('273015700');
    expect(rows[1].team).toBe('231361273');
  });

  it('ignore la cellule logo (bold sans texte) et déduplique un identifiant répété', () => {
    const rows = parseAltamiraListing(LISTING);
    expect(rows.map((r) => r.title)).not.toContain('Doublon');
  });

  it('rend [] sur une page sans ligne', () => {
    expect(parseAltamiraListing('<html><body>Nessun annuncio</body></html>')).toEqual([]);
  });
});

describe('parseAltamiraDetail', () => {
  const [row] = parseAltamiraListing(LISTING);
  const url = 'https://careers.zegnagroup.com/jobs/job-details?JobID=272432342&Team=242459886';

  it('remonte la marque, le contrat, la fonction, le lieu éclaté et la description en texte', () => {
    const job = parseAltamiraDetail(row, DETAIL, url);
    expect(job.company).toBe('Zegna');
    expect(job.contract).toBe('Permanent Job');
    expect(job.department).toBe('Other/Other');
    expect(job.country).toBe('United States');
    expect(job.region).toBe('NY');
    expect(job.city).toBe('New York');
    expect(job.location).toBe('New York, United States');
    expect(job.description).toContain('ABOUT ZEGNA');
    expect(job.description).not.toContain('<');
    expect(job.description?.length ?? 0).toBeGreaterThan(200);
    expect(job.url).toBe(url);
    expect(job.externalId).toBe('272432342');
  });

  it('garde la ligne de liste quand la fiche est vide (page détail en erreur)', () => {
    const job = parseAltamiraDetail(row, '', url);
    expect(job.title).toBe('Su Misura Customer Service Associate');
    expect(job.location).toBe('New York, United States');
    expect(job.description).toBeUndefined();
    expect(job.company).toBeUndefined();
  });

  it('accepte un lieu à deux niveaux (Pays/Ville) sans région', () => {
    const job = parseAltamiraDetail(row, '<td data-title="Locations"><span>Italy/Milano</span></td>', url);
    expect(job.country).toBe('Italy');
    expect(job.city).toBe('Milano');
    expect(job.region).toBeUndefined();
  });
});
