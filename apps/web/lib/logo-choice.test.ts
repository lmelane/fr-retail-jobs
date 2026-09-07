import { describe, expect, it } from 'vitest';
import { bestLogo, preferLogo, MIN_LOGO_PX } from './logo-choice';

/** Chaque cas vient d'une mesure réelle du 2026-09-07, Maison nommée. */
const ico = (width: number) => ({ width, opaque: false, name: `ico-${width}` });
const jpeg = (width: number) => ({ width, opaque: true, name: `jpeg-${width}` });

describe('preferLogo', () => {
  it('garde la plus grande à format égal (Lacoste : 32 chez ddg, 64 chez Google)', () => {
    expect(preferLogo(ico(32), ico(64)).width).toBe(64);
    expect(preferLogo(ico(64), ico(32)).width).toBe(64);
  });

  it("garde l'icône transparente contre un JPEG à peine plus grand (Ralph Lauren : ICO 48 vs JPEG 64)", () => {
    expect(preferLogo(ico(48), jpeg(64)).name).toBe('ico-48');
    expect(preferLogo(jpeg(64), ico(48)).name).toBe('ico-48');
  });

  it('accepte un JPEG nettement plus grand : la netteté finit par primer', () => {
    expect(preferLogo(ico(16), jpeg(64)).name).toBe('jpeg-64');
  });

  it('reste symétrique quel que soit l’ordre des candidats', () => {
    const cases = [[ico(32), jpeg(64)], [ico(1024), jpeg(64)], [jpeg(16), ico(16)]] as const;
    for (const [a, b] of cases) expect(preferLogo(a, b).name).toBe(preferLogo(b, a).name);
  });
});

describe('preferLogo — taille d’affichage demandée', () => {
  it('garde le transparent quand il couvre la taille affichée (pastille de liste)', () => {
    // Ralph Lauren en pastille 22px : l'ICO 48px suffit, pas de cadre blanc.
    expect(preferLogo(ico(48), jpeg(64), 44).name).toBe('ico-48');
  });

  it('prend l’opaque plus net quand le transparent ne couvre pas (hero 96px Retina)', () => {
    // Le même Ralph Lauren dans le hero : 48px agrandi à 192px est flou.
    expect(preferLogo(ico(48), jpeg(180), 192).name).toBe('jpeg-180');
  });

  it('reste symétrique à taille demandée', () => {
    expect(preferLogo(ico(48), jpeg(180), 192).name).toBe(preferLogo(jpeg(180), ico(48), 192).name);
  });

  it('ne prend jamais un opaque plus PETIT que le transparent', () => {
    expect(preferLogo(ico(64), jpeg(32), 192).name).toBe('ico-64');
  });
});

describe('bestLogo', () => {
  it('ignore les fournisseurs muets', () => {
    expect(bestLogo([null, ico(64)])?.width).toBe(64);
    expect(bestLogo([ico(64), null])?.width).toBe(64);
  });

  it('rend null quand aucun fournisseur ne répond', () => {
    expect(bestLogo([null, null])).toBeNull();
  });

  it('rend null sous le seuil : monogramme (PVH, L’Oréal, Estée Lauder à 16 px)', () => {
    expect(bestLogo([ico(16), jpeg(16)])).toBeNull();
  });

  it('accepte exactement le seuil (Penningtons, Buck Mason à 32 px)', () => {
    expect(bestLogo([ico(MIN_LOGO_PX)])?.width).toBe(MIN_LOGO_PX);
  });

  it('garde la très grande icône que seul DuckDuckGo sert (Ulta Beauty 1024 px)', () => {
    expect(bestLogo([ico(1024), jpeg(64)])?.width).toBe(1024);
  });

  it('rend null sur une image de format inconnu, jamais une taille devinée', () => {
    expect(bestLogo([{ width: 0, opaque: false }])).toBeNull();
  });
});
