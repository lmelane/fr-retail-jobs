/**
 * Dimensions d'une image ICO, PNG, JPEG ou GIF lues dans son en-tête, sans
 * décoder les pixels et sans dépendance.
 *
 * Pourquoi : un favicon de 16×16 est une image parfaitement valide, servie
 * avec un statut 200 et un poids normal. Seules ses DIMENSIONS disent qu'elle
 * sera illisible une fois agrandie dans une pastille de 48 px (mesuré le
 * 2026-09-07 : L'Oréal, PVH, URBN, Rituals, Estée Lauder — 11 Maisons sur 120).
 * Un filtre sur le poids ne peut pas voir ça.
 */

export type ImageSize = { width: number; height: number };

/** ICO : plusieurs images dans un fichier — on retient la plus grande (0 encode 256). */
function icoSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  const count = view.getUint16(4, true);
  let largest = 0;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    if (entry + 2 > bytes.byteLength) break;
    const width = bytes[entry] === 0 ? 256 : bytes[entry];
    if (width > largest) largest = width;
  }
  return largest ? { width: largest, height: largest } : null;
}

/** JPEG : parcourir les segments jusqu'au SOF, qui porte les dimensions. */
function jpegSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  let offset = 2;
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

export function imageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.byteLength < 16) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const isIco = bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00;
  if (isIco) return icoSize(bytes, view);

  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (isPng && bytes.byteLength >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };

  const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
  if (isGif) return { width: view.getUint16(6, true), height: view.getUint16(8, true) };

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (isJpeg) return jpegSize(bytes, view);

  // SVG : vectoriel, donc jamais trop petit pour une pastille.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 200)).trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY };

  return null;
}
