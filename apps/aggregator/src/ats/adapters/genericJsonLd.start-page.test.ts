import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn(), fetchWithRetry: vi.fn() }));
import { fetchText } from '../../lib/http.js';
import { fetchGenericJsonLdJobs } from './genericJsonLd.js';

/**
 * LUMENTEE, RUN DU 02/10/2026 (D-522 §6) : cinq offres actives, toutes « D2C Growth Marketer », aux adresses
 * `/careers/`, `/careers/#roles`, `#main`, `#culture` et `#` — la même page, relue par chacune de ses ancres, et
 * publiée cinq fois sous cinq identités (l'empreinte de l'adresse). Les « 5 postes lisibles » de D-480 étaient ces cinq
 * copies. Une ancre de la page de départ est la page de départ : elle n'est plus relue. Le lien vers une autre page garde son
 * fragment (identité des offres déjà publiées).
 */
const html: string = JSON.parse(readFileSync(new URL('./__fixtures__/d522-6-lumentee-careers-reduite.json', import.meta.url), 'utf8')).html;
const config = { startUrl: 'https://lumentee.com/careers/' };
beforeEach(() => { vi.mocked(fetchText).mockReset(); vi.mocked(fetchText).mockResolvedValue(html); });

describe('Page de départ — une ancre n’est pas une page (Lumentee, 02/10/2026)', () => {
  it('prémisse : la page lie ses propres ancres, sous un chemin « career »', () => {
    for (const anchor of ['href="#roles"', 'href="#main"', 'href="#culture"', 'href="#"']) expect(html).toContain(anchor);
  });

  it('une seule lecture de la page, une seule offre par identité', async () => {
    const r = await fetchGenericJsonLdJobs(config);
    const requested = vi.mocked(fetchText).mock.calls.map((call) => String(call[0]));
    expect(requested.every((url) => !url.includes('#'))).toBe(true);
    expect(requested.filter((url) => url === config.startUrl)).toHaveLength(1);
    expect(new Set(r.jobs.map((j) => j.externalId)).size).toBe(r.jobs.length);
    expect(r.jobs.map((j) => j.url)).toEqual(['https://lumentee.com/careers/']);
  });

  it('le lien vers une AUTRE page garde son fragment : l’identité des offres déjà publiées ne change pas (Attaquer)', async () => {
    // Les liens réels de https://attaquercycling.com/pages/careers (03/10/2026) : la page elle-même et ses trois offres.
    const page = ['/pages/careers', '/pages/careers/apparel-graphic-designer#role', '/pages/careers/garment-technician#role',
      '/pages/careers/mid-weight-graphic-designer#role', 'https://attaquercycling.com/pages/careers'].map((href) => `<a href="${href}">x</a>`).join('');
    vi.mocked(fetchText).mockResolvedValue(page);
    await fetchGenericJsonLdJobs({ startUrl: 'https://attaquercycling.com/pages/careers' });
    expect(vi.mocked(fetchText).mock.calls.map((call) => String(call[0]))).toEqual(['https://attaquercycling.com/pages/careers',
      'https://attaquercycling.com/pages/careers/apparel-graphic-designer#role', 'https://attaquercycling.com/pages/careers/garment-technician#role',
      'https://attaquercycling.com/pages/careers/mid-weight-graphic-designer#role']);
  });
});
