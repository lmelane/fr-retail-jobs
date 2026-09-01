import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Catwalks — Offres Mode, Luxe, Beauté & Horlogerie en France',
  description:
    "Toutes les offres d'emploi du secteur mode, luxe, beauté, horlogerie et retail en France, agrégées depuis les sites carrière des Maisons et les jobboards spécialisés.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
