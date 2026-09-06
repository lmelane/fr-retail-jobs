import { describe, expect, it } from 'vitest';
import { parseTaleoDescription, parseTaleoListing } from './taleo.js';

/** Une ligne de résultats telle que lde.tbe.taleo.net la rend (Brown Thomas Arnotts, 2026-09-06). */
const ROW = `
<div class="oracletaleocwsv2-accordion-head-info">
<h4 class="oracletaleocwsv2-head-title"><a href="https://lde.tbe.taleo.net/lde02/ats/careers/v2/viewRequisition?org=ARNOTTS&cws=79&rid=7770" class="viewJobLink">2026 Christmas Team</a></h4>
<div tabindex="0" >Brown Thomas, Dublin</div>
<div tabindex="0" >7770</div>
</div>`;

const ROW_2 = ROW.replace(/7770/g, '7795').replace('2026 Christmas Team', 'Beauty Advisor &amp; Stylist').replace('Brown Thomas, Dublin', 'Arnotts, Dublin');

/** Une page `viewRequisition` vivante, réduite au bloc utile. */
const DETAIL = `
<div class="well oracletaleocwsv2-job-description"><strong> 2026 Christmas Team </strong>
<span class="small"> Location </span> <strong> Brown Thomas, Dublin </strong></div>
<div name="cwsJobDescription" tabindex="0" class="row"><div style="all: unset;">
<p class="MsoNormal"><span><strong>Unwrap a Magical Opportunity this Christmas</strong></span></p>
<p class="MsoNormal">At Brown Thomas Arnotts, we’re reinventing the very essence of retail through innovation.</p>
<ul><li><p>A passion for customer service</p></li></ul>
</div></div><link rel="stylesheet" href="https://staticlde.tbe.taleo.net/social-plugin.css" type="text/css"/>
<div class="oracletaleocwsv2-button-navigation oracletaleocwsv2-job-description clearfix">
<a href="https://lde.tbe.taleo.net/lde02/ats/careers/v2/searchResults?org=ARNOTTS&cws=79" class="btn back-button">Back</a>
<li title="Share job on LinkedIn" data-href="https://www.linkedin.com/shareArticle?title=Hiring+2026+Christmas+Team">x</li>
<a href="https://lde.tbe.taleo.net/lde02/ats/careers/v2/applyRequisition?org=ARNOTTS&cws=79&rid=7770">Apply Now</a>
</div>`;

const GONE = `<span class='text-danger'>This job has moved or is no longer available. Please search our <a href='#'>current job openings</a>.</span>`;

describe('parseTaleoListing', () => {
  it('lit identifiant, titre, lieu et lien depuis une ligne', () => {
    const [job] = parseTaleoListing(ROW);
    expect(job.externalId).toBe('7770');
    expect(job.title).toBe('2026 Christmas Team');
    expect(job.location).toBe('Brown Thomas, Dublin');
    expect(job.url).toBe('https://lde.tbe.taleo.net/lde02/ats/careers/v2/viewRequisition?org=ARNOTTS&cws=79&rid=7770');
  });

  it('décode les entités du titre et lit plusieurs lignes', () => {
    const jobs = parseTaleoListing(ROW + ROW_2);
    expect(jobs).toHaveLength(2);
    expect(jobs[1].title).toBe('Beauty Advisor & Stylist');
    expect(jobs[1].location).toBe('Arnotts, Dublin');
  });

  it('déduplique deux lignes du même identifiant', () => {
    expect(parseTaleoListing(ROW + ROW)).toHaveLength(1);
  });

  it('rend une liste vide sur la page d’un octet servie hors session', () => {
    expect(parseTaleoListing('\n')).toHaveLength(0);
  });
});

describe('parseTaleoDescription', () => {
  it('extrait le texte de l’offre sans les boutons Retour/Partager/Postuler', () => {
    const text = parseTaleoDescription(DETAIL);
    expect(text).toContain('Unwrap a Magical Opportunity');
    expect(text).toContain('passion for customer service');
    expect(text).not.toContain('Apply Now');
    expect(text).not.toContain('Back');
    expect(text).not.toContain('<');
  });

  it('rend undefined sur une réquisition retirée, pour garder les champs de liste', () => {
    expect(parseTaleoDescription(GONE)).toBeUndefined();
  });
});
