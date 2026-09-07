import { describe, expect, it } from 'vitest';
import { imageSize } from './image-size';

/**
 * Les cas viennent de vraies images mesurées le 2026-09-07 : les favicons de
 * PVH et L'Oréal (16 px, la cause des logos illisibles) et celui de Dior
 * (32 px, lisible). On construit ici les mêmes en-têtes à la main.
 */

function ico(widths: number[]): Uint8Array {
  const bytes = new Uint8Array(6 + widths.length * 16 + 64);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type = icon
  view.setUint16(4, widths.length, true);
  widths.forEach((w, i) => {
    bytes[6 + i * 16] = w === 256 ? 0 : w;
    bytes[6 + i * 16 + 1] = w === 256 ? 0 : w;
  });
  return bytes;
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe('imageSize', () => {
  it('lit un ICO à une seule image', () => {
    expect(imageSize(ico([16]))).toEqual({ width: 16, height: 16 });
  });

  it("retient la plus grande image d'un ICO multi-résolutions (cas Dior)", () => {
    expect(imageSize(ico([16, 32]))).toEqual({ width: 32, height: 32 });
  });

  it('décode la largeur 0 comme 256 px, ainsi que le veut le format ICO', () => {
    expect(imageSize(ico([256]))).toEqual({ width: 256, height: 256 });
  });

  it('lit un PNG', () => {
    expect(imageSize(png(64, 64))).toEqual({ width: 64, height: 64 });
  });

  it('lit un GIF', () => {
    const bytes = new Uint8Array(16);
    bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
    new DataView(bytes.buffer).setUint16(6, 48, true);
    new DataView(bytes.buffer).setUint16(8, 48, true);
    expect(imageSize(bytes)).toEqual({ width: 48, height: 48 });
  });

  it('traite un SVG comme toujours assez grand : il est vectoriel', () => {
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>');
    expect(imageSize(bytes)?.width).toBe(Number.POSITIVE_INFINITY);
  });

  it('rend null sur un format inconnu plutôt que d’inventer une taille', () => {
    expect(imageSize(new Uint8Array(64).fill(0x42))).toBeNull();
  });

  it('rend null sur un buffer tronqué', () => {
    expect(imageSize(new Uint8Array(4))).toBeNull();
  });
});
