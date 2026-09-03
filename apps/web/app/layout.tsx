import type { Metadata } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { SiteNav } from '@/components/site-nav';
import { landingStats } from '@/lib/jobs';
import { SiteFooter } from '@/components/site-footer';
import { NavProgress } from '@/components/nav-progress';
import { RevealOnScroll } from '@/components/reveal-on-scroll';

/**
 * Typography — DA « Corporate Elegance » (design_2.md) : deux familles
 * self-hosted via @font-face dans globals.css, aucune requête CDN.
 *   FA Display = FF Modern (contenu : titres, chiffres clés)
 *   FA Sans    = Mona Sans (usage : nav, labels, boutons, métas)
 * Les deux Regular sont préchargées ci-dessous.
 */

/**
 * DEC-1 : la promesse est un COMPTEUR calculé en base, jamais « toutes » ni
 * « en France » (le site est monde, et la couverture Top-200 n'est pas encore
 * à 80 %). Base indisponible -> titre sans chiffre, sans surpromesse.
 */
export async function generateMetadata(): Promise<Metadata> {
  const stats = await landingStats();
  const scope = stats.companies > 0 ? `de ${stats.companies} Maisons ` : '';
  return {
    title: `Offres d'emploi ${scope}— Mode, Luxe, Beauté & Horlogerie`,
    description: `Les offres d'emploi ${scope}du secteur mode, luxe, beauté, horlogerie et retail, agrégées sans doublon depuis les sites carrière et les jobboards spécialisés, avec le lien de candidature direct.`,
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/display/FFModern-Regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/sans/FASans-Regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="font-sans antialiased">
        <Suspense fallback={null}>
          <NavProgress />
          <RevealOnScroll />
        </Suspense>
        <SiteNav />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
