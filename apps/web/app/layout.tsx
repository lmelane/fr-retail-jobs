import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import './globals.css';

/**
 * Poppins, self-hosted by next/font: no render-blocking request to Google and no
 * layout shift, since the fallback metrics are matched at build time.
 */
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Offres d'emploi Mode, Luxe, Beauté & Horlogerie en France",
  description:
    "Toutes les offres d'emploi du secteur mode, luxe, beauté, horlogerie et retail en France, agrégées depuis les sites carrière des Maisons et les jobboards spécialisés.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={poppins.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
