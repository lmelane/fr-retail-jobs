import { describe, expect, it } from 'vitest';
import { parseIcimsListing } from './icims.js';

/** Une carte telle que hub-urbn.icims.com la rend (mesurée le 2026-09-05). */
const CARD = `
<ul class="container-fluid iCIMS_JobsTable">
  <li class="iCIMS_JobCardItem">
    <div class="row">
      <div class="col-xs-6 header left"><span class="sr-only field-label">Location</span><span> US-CA-Palo Alto</span></div>
      <div class="col-xs-6 header right"><span class="sr-only field-label">ID</span><span> 2026-31555</span></div>
      <div class="col-xs-12 title">
        <a href="https://stores-na-urbn.icims.com/jobs/31555/urban-outfitters-assistant-manager/job?hub=15&amp;in_iframe=1" class="iCIMS_Anchor">
          <span class="sr-only field-label">Title</span><h3> Urban Outfitters Assistant Manager</h3>
        </a>
      </div>
      <div class="col-xs-12 description">An Assistant Manager supports the service experience.</div>
    </div>
  </li>
</ul>`;

describe('parseIcimsListing', () => {
  it('lit titre, lieu, identifiant et lien depuis la carte', () => {
    const [job] = parseIcimsListing(CARD);
    expect(job.title).toBe('Urban Outfitters Assistant Manager');
    expect(job.location).toBe('US-CA-Palo Alto');
    expect(job.externalId).toBe('31555');
    expect(job.url).toContain('/jobs/31555/urban-outfitters-assistant-manager');
  });

  it('décode les entités du lien — sinon l’URL de candidature est cassée', () => {
    const [job] = parseIcimsListing(CARD);
    expect(job.url).not.toContain('&amp;');
    expect(job.url).toContain('hub=15&in_iframe=1');
  });

  it('remonte la description sans balises', () => {
    const [job] = parseIcimsListing(CARD);
    expect(job.description).toContain('Assistant Manager supports');
    expect(job.description).not.toContain('<');
  });

  it('ignore une carte sans lien ni titre plutôt que d’afficher une ligne vide', () => {
    expect(parseIcimsListing('<li class="iCIMS_JobCardItem"><div>Location</div></li>')).toHaveLength(0);
  });

  it('déduplique deux cartes du même identifiant', () => {
    expect(parseIcimsListing(CARD + CARD)).toHaveLength(1);
  });
});
