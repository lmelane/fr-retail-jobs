import { describe, expect, it } from 'vitest';
import { parseEqwaDetail, parseEqwaListing } from './eqwa.js';

/** Deux lignes telles que recrutement-nocibe.fr/front-jobs.html les rend (capturé le 2026-09-06), imbrication du <td> comprise. */
const LISTING = `
<table class="table with-datatable" data-order='[[0, "desc"]]'>
  <thead><tr><th>Offre</th><th>Localisation</th><th>contrat</th></tr></thead>
  <tbody>
    <tr>
      <td data-sort="2025-06-12">
        <span class="job-title">
          <a href="https://recrutement-nocibe.fr/front-jobs-detail.html?id_job=4255&id_origin=0" title="Responsable adjoint F/H">
            Responsable adjoint F/H
          </a>
        </span>
        <span class="label label-default">12-06-2025</span>
        <span class="label label-default">CDI Temps complet</span>
        <span class="label label-default">réf : Paris 4255</span>
      </td>
      <td>Île-de-France<br/><small class="text-muted">75000 PARIS</small>            <td>CDI Temps complet</td>
      </td>
    </tr>
    <tr>
      <td data-sort="2025-07-02">
        <span class="job-title">
          <a href="https://recrutement-nocibe.fr/front-jobs-detail.html?id_job=4369&id_origin=0" title="Estheticien F/H">Estheticien F/H</a>
        </span>
      </td>
      <td>Hauts-de-France<br/><small class="text-muted">59000 LILLE</small>            <td>CDD Temps partiel</td>
      </td>
    </tr>
  </tbody>
</table>`;

const DETAIL = `
<div class="job-detail-reference">
  <dl class="dl-horizontal">
    <dt>Contrat</dt><dd>CDI Temps complet</dd>
    <dt>Localisation</dt><dd>&Icirc;le-de-France</dd>
    <dt>Fonction</dt><dd>A11 Responsable adjoint F/H</dd>
  </dl>
</div>
<div class="job-detail-desc">
  <h2>Contexte du recrutement et définition de poste</h2>
  <p><strong>Dans le cadre de notre développement nous cherchons des Responsables Adjoints.es à Paris F/H</strong></p>
  <p>Leader français de la distribution sélective de parfums et de cosmétiques, Nocibé est une filiale du groupe DOUGLAS.</p>
</div>`;

describe('parseEqwaListing', () => {
  const origin = 'https://recrutement-nocibe.fr';

  it('lit identifiant, titre, lien, date et contrat de chaque ligne', () => {
    const [first, second] = parseEqwaListing(LISTING, origin);
    expect(first.externalId).toBe('4255');
    expect(first.title).toBe('Responsable adjoint F/H');
    expect(first.url).toBe('https://recrutement-nocibe.fr/front-jobs-detail.html?id_job=4255&id_origin=0');
    expect(first.postedAt?.toISOString().slice(0, 10)).toBe('2025-06-12');
    expect(first.contract).toBe('CDI Temps complet');
    expect(second.contract).toBe('CDD Temps partiel');
  });

  it('sépare région, code postal et ville malgré le <td> imbriqué du gabarit', () => {
    const [first, second] = parseEqwaListing(LISTING, origin);
    expect(first.region).toBe('Île-de-France');
    expect(first.postalCode).toBe('75000');
    expect(first.city).toBe('PARIS');
    expect(second.city).toBe('LILLE');
  });

  it('déduplique une offre listée deux fois', () => {
    expect(parseEqwaListing(LISTING + LISTING, origin)).toHaveLength(2);
  });

  it('rend une liste vide sur une page sans tableau', () => {
    expect(parseEqwaListing('<html><body>Aucune offre</body></html>', origin)).toHaveLength(0);
  });
});

describe('parseEqwaDetail', () => {
  it('remonte la description en texte brut et le lieu affiché', () => {
    const detail = parseEqwaDetail(DETAIL);
    expect(detail.description).toContain('Responsables Adjoints.es à Paris');
    expect(detail.description).toContain('filiale du groupe DOUGLAS');
    expect(detail.description).not.toContain('<');
    expect(detail.location).toBe('Île-de-France');
  });

  it('laisse la description vide quand le bloc manque', () => {
    expect(parseEqwaDetail('<div class="job-detail-header"></div>').description).toBeUndefined();
  });
});
