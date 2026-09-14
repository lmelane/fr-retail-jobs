import type { Metadata } from 'next';

/**
 * D-420 (14/09/2026) — ce service ne sert plus AUCUNE page : il est l'API de
 * lecture du catalogue, sur `agregator.catwalks.io`. Le rendu Mode Careers a
 * été supprimé (0 mot-clé, 0 trafic organique mesurés avant suppression) ;
 * le front public est catwalks.io.
 *
 * Next exige un layout racine même pour un service qui n'expose que des
 * routes API. Celui-ci est donc volontairement vide : aucune police, aucune
 * feuille de style, aucun composant — rien à charger, rien à maintenir.
 */
export const metadata: Metadata = {
  title: 'Catwalks, API du catalogue',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
