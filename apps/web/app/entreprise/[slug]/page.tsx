import { notFound } from 'next/navigation';
import { CompanyProfileView } from '@/components/company-profile-view';
import { getCompanyBySlug } from '@/lib/companies';
import { getJobs } from '@/lib/jobs';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

const SECTOR_LABELS: Record<string, string> = {
  FASHION: 'Mode',
  LUXURY: 'Luxe',
  BEAUTY: 'Beauté',
  JEWELRY_WATCHES: 'Joaillerie',
  RETAIL: 'Retail',
  SUPPLIER: 'Fournisseurs',
  MEDIA_AGENCY: 'Médias',
  RECRUITER: 'Cabinets',
  OTHER: 'Hors référentiel',
  UNKNOWN: 'Hors référentiel',
};

/**
 * One Maison, on its own URL — decision D15: ~515 indexable pages, the
 * biggest SEO surface on the site after the offer list itself. Title and
 * description are built from real stored data (sector, live-offer count),
 * never invented copy.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const profile = await getCompanyBySlug((await params).slug);
  if (!profile) return { title: 'Entreprise introuvable' };

  const sector = profile.sector ? SECTOR_LABELS[profile.sector] ?? profile.sector : null;
  const jobWord = profile.jobCount > 1 ? 'offres' : 'offre';

  return {
    title: `Emplois ${profile.name} — Fashion Atlas`,
    description: [
      sector ? `${profile.name}, secteur ${sector}.` : `${profile.name}.`,
      `${profile.jobCount.toLocaleString('fr-FR')} ${jobWord} actuellement ouverte${
        profile.jobCount > 1 ? 's' : ''
      } sur Fashion Atlas.`,
    ].join(' '),
  };
}

/**
 * A Maison's dedicated page: header + facts (Indeed's "À propos" grid, honest
 * subset — no reviews/salaries/executives, decision D15), then its offers in
 * the same master-detail shape as /emplois. Page 1 of the offers is
 * server-rendered here; /api/jobs?maison=<name> powers infinite scroll.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const profile = await getCompanyBySlug(slug);
  if (!profile) notFound();

  const jobs = await getJobs({ maison: profile.name, page: 1 });

  return <CompanyProfileView profile={profile} jobs={jobs} />;
}
