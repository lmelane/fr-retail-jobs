/**
 * L'origine publique du SITE CANDIDAT, pour les liens absolus du balisage
 * JSON-LD (`url` d'un `JobPosting`). `NEXT_PUBLIC_SITE_URL` la fixe dans
 * l'environnement de l'API ; à défaut, `https://catwalks.io`, l'unique domaine
 * du site (R-78, D-177). Le repli historique vers l'URL Railway de Mode
 * Careers décrivait un site qui n'existe plus (lot 9). Sans barre finale.
 */
export function siteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL || 'https://catwalks.io';
  return url.replace(/\/$/, '');
}
