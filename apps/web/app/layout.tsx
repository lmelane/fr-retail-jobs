import type { Metadata } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { NavProgress } from '@/components/nav-progress';

/**
 * Typography — DA « Corporate Elegance » (design_2.md) : deux familles
 * self-hosted via @font-face dans globals.css, aucune requête CDN.
 *   FA Display = Instrument Serif (contenu : titres, chiffres clés)
 *   FA Sans    = Mona Sans (usage : nav, labels, boutons, métas)
 * Les deux Regular sont préchargées ci-dessous.
 */

export const metadata: Metadata = {
  title: "Offres d'emploi Mode, Luxe, Beauté & Horlogerie en France",
  description:
    "Toutes les offres d'emploi du secteur mode, luxe, beauté, horlogerie et retail en France, agrégées depuis les sites carrière des Maisons et les jobboards spécialisés.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/display/FADisplay-Regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/sans/FASans-Regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="font-sans antialiased">
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <SiteNav />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
