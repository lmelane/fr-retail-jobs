import { describe, expect, it } from 'vitest';
import { partitionReplacedIdentity } from './replacedIdentity.js';

/**
 * Kastner & Öhler, production lue le 03/10/2026 (lecture seule) : 17 représentations actives, toutes de la révision
 * f6df8672 (lecture de page de départ), dont 3 pour la même fiche « backoffice » (la page de départ et ses ancres #top et
 * #cookieeinstellungen) ; et les 12 billets que rend /wp-json/wp/v2/jobangebot le même jour (nouvelle identité).
 */
const OLD = 'f6df8672-ef85-43ca-a2f2-ddb5371f0366';
const NEW = '00000000-0000-4000-8000-000000000001';
const A = 'https://www.kastner-oehler.at/job-karriere/angebot/';
const listed = ['deko-technikerin-graz-vollzeit', 'mitarbeiterin-kassa-spittal-geringfugig-samstags', 'modeberaterin-spittal-herren-vz',
  'junior-einkauferin-damen-graz-vollzeit', 'modeberaterin-herren-voecklabruck-teilzeit', 'dekorateurin-oberwart-teilzeit', 'modeberaterin-murpark-herren-tz',
  'modeberaterin-herren-graz-geringfugig-samstags', 'abteilungsleitung-innsbruck-vollzeit', 'dekorateurin-spittal-teilzeit',
  'modeberaterin-innsbruck-geringfugig-bis-vollzeit', 'modeberaterin-murpark-damen-tz'].map((slug) => `${A}${slug}/`);
const backoffice = `${A}backoffice-mitarbeiterin-graz-teilzeit/`;
const oldRows = [
  ...listed.map((url, i) => ({ id: `old-${i}`, url, raw: { catwalksPageUrl: url }, revisionId: OLD })),
  { id: 'old-bo', url: backoffice, raw: { catwalksPageUrl: backoffice }, revisionId: OLD },
  { id: 'old-bo-top', url: backoffice, raw: { catwalksPageUrl: `${backoffice}#top` }, revisionId: OLD },
  { id: 'old-bo-cookie', url: backoffice, raw: { catwalksPageUrl: `${backoffice}#cookieeinstellungen` }, revisionId: OLD },
  { id: 'old-stil', url: `${A}stilberaterin-home-and-living-graz-teilzeit/`, raw: { catwalksPageUrl: `${A}stilberaterin-home-and-living-graz-teilzeit/` }, revisionId: OLD },
  { id: 'old-moet', url: `${A}weihnachtsaushilfe-moet-popup-teilzeit-graz/`, raw: { catwalksPageUrl: `${A}weihnachtsaushilfe-moet-popup-teilzeit-graz/` }, revisionId: OLD },
];
const newRows = listed.map((url, i) => ({ id: `new-${i}`, url, raw: { source: 'wordpress-post-type-v1' }, revisionId: NEW }));
const spec = { batchId: 'test', sourceKey: 'kastner-ohler', replacedRevisionId: OLD, expectedReplaced: 12, expectedUnlisted: 5,
  statement: 'mêmes offres relues sous l’identité du billet WordPress (lecteur wordpress-post-type)' };

describe('Identité remplacée par le nouveau lecteur (Kastner & Öhler, 03/10/2026)', () => {
  it('prémisse : les 17 anciennes représentations ne portent aucune identité du nouveau lecteur', () => {
    expect(oldRows).toHaveLength(17);
    expect(new Set(newRows.map((r) => r.id)).size).toBe(12);
  });
  it('après la première collecte : 12 remplacées (même page), 5 non listées (backoffice et ses ancres, deux fiches retirées)', () => {
    const { replaced, unlisted } = partitionReplacedIdentity([...oldRows, ...newRows], spec, NEW);
    expect(replaced).toHaveLength(12);
    expect(replaced.every(({ old, by }) => old.url === by.url)).toBe(true);
    expect(unlisted.map((r) => r.id).sort()).toEqual(['old-bo', 'old-bo-cookie', 'old-bo-top', 'old-moet', 'old-stil']);
  });
  it('refuse avant la première collecte sous la nouvelle configuration, et un compte relu qui a changé', () => {
    expect(() => partitionReplacedIdentity(oldRows, spec, OLD)).toThrow('still the current configuration');
    expect(() => partitionReplacedIdentity(oldRows, spec, NEW)).toThrow('No active representation from the current revision yet');
    expect(() => partitionReplacedIdentity([...oldRows, ...newRows.slice(1)], spec, NEW)).toThrow('Reviewed count changed: 11 replaced and 6 unlisted');
  });
});
