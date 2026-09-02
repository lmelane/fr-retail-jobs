import type { Metadata } from 'next';
import { Noto_Sans } from 'next/font/google';
import './globals.css';

/**
 * Noto Sans, self-hosted by next/font: no render-blocking request to Google and
 * no layout shift, since the fallback metrics are matched at build time.
 *
 * Indeed's own stack is "Indeed Sans", "Noto Sans", … — Noto Sans is its public
 * fallback, so using it directly gets the closest neutral, humanist reading to
 * Indeed without licensing its proprietary face.
 */
const notoSans = Noto_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Offres d'emploi Mode, Luxe, Beauté & Horlogerie en France",
  description:
    "Toutes les offres d'emploi du secteur mode, luxe, beauté, horlogerie et retail en France, agrégées depuis les sites carrière des Maisons et les jobboards spécialisés.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={notoSans.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
