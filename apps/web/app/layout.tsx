import type { Metadata } from 'next';
import './globals.css';

/**
 * Typography is the Catwalks brand face "catwalks_font" (decision D14),
 * self-hosted via @font-face in globals.css — no next/font, no Google request.
 */

export const metadata: Metadata = {
  title: "Offres d'emploi Mode, Luxe, Beauté & Horlogerie en France",
  description:
    "Toutes les offres d'emploi du secteur mode, luxe, beauté, horlogerie et retail en France, agrégées depuis les sites carrière des Maisons et les jobboards spécialisés.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
